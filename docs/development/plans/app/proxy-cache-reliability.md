# Web Proxy Cache API移行・信頼性修正 詳細設計

対象はWeb版のみである。iOSのソース、契約、UI仕様には変更を加えない。既存の
`proxy-worker`、Service Worker、SWなしのWebストリーム経路、IndexedDB復旧経路を
一つの状態機械として修正する。新しいCloudflare製品、依存パッケージ、バックグラウンド
実行基盤は導入しない。

## 確認済みの現状と制約

* `proxy-worker/src/index.ts` はKVのNDJSON値を定期更新し、`setInterval(async ...)`と最終
  `put` を競合させている。上流EOFをLLMの`[DONE]`と区別せず、完了通知を先に流す。
* `public/sw-stream.js` は内側LLMの`[DONE]`を受けた時点で外側Proxy SSEの`done`を待たずに
  読み取りを止める。`submitRuntime.ts`のSWなし経路はfinallyで成功・失敗・中断を問わずACKと
  IndexedDB削除を行う。`useStreamRecovery.ts`もネットワーク例外/EOFを終端として扱ってACKし、
  最後に記録を削除する。
* IndexedDBには最後に完了したProxy event IDしか保存されない。Proxy SSE未完ブロック、LLM SSE
  未完ブロック、`<think>`パーサの未完タグ状態が同じトランザクションに含まれないため、再接続境界で
  欠落または本文/思考の取り違えが起こる。
* Cloudflare Cache APIの`put`は保存成否にかかわらず`undefined`で解決する。`match`は
  miss/expiryを`undefined`として返し、`delete`は実行データセンターだけを消す。Cache APIは
  拠点間複製・保持を保証しない。この制約は受入済みである。
* HTTPリクエストは接続中は継続できるが、クライアント切断または応答終了後の`waitUntil`は合計
  30秒までである。したがって、切断後の生成完走は保証せず、期限前に部分状態を保存して`interrupted`
  として終える。別isolateへ届いたcancelで上流readerを直接停止することも保証できない。
* Workers Freeは1 invocationあたり50 subrequest、isolateあたり128MBである。Cache APIの
  `match`/`put`/`delete`も初期ヘッダ待ちの接続に数えられる。

公式根拠: [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/),
[ctx.waitUntil](https://developers.cloudflare.com/workers/runtime-apis/context/),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

## 保存形式とCache API

### キー・認可・TTL

`proxy-worker/src/index.ts`に、外部から直接ルーティングされない固定パスを作る。

```
GET https://<worker-origin>/_weavelet_stream_cache/v1/<SHA-256(sessionId)>
```

`cacheKey(sessionId, request.url)`は`crypto.subtle.digest('SHA-256', UTF-8 sessionId)`をhex化し、
上記URLの**GET Request**を返す。元の`sessionId`、LLM endpoint、認証ヘッダ/APIキーをURL、
Cache-Control、保存本文、ログへ入れない。`sessionId`は既存どおり`chatId:crypto.randomUUID()`で
生成され、復旧/ACK/cancel各APIは既存の`authenticate`を通過したものだけがCache APIを操作する。
open-proxy設定では、推測困難なsessionIdが能力トークンになる既存の信頼モデルのままである。複数利用者を
同一Workerで隔離する機能は今回追加しない。

Cache値は次のJSONを本文にした`Response`である。`Cache-Control: max-age=300`、
`Content-Type: application/json`を付ける。5分は回収の上限であり、TTLまでの保持は主張しない。

```ts
interface CachedSession {
  version: 1;
  firstEventId: number;
  chunks: Array<{ id: number; data: string }>;
  generationTerminal: 'streaming' | 'complete' | 'interrupted' | 'failed';
  cacheCapability: 'available' | 'overflow';
  error?: string;
  openRouterObservation?: Record<string, string | number>;
}
```

`data`は上流から届いたraw SSE文字列であり、JSON stringify済みのSSE断片ではない。`firstEventId`
より前をクライアントはIndexedDBで持つ。復旧では実IDが`lastEventId`より大きいchunkだけを同じIDで
再送する。`cache.put`の解決は保存確認と扱わず、ログに機密を含めない分類済み失敗を残すだけにする。
`cache.match`が`undefined`なら即時に`event: cache-miss`を返し、ポーリングしない。これは早期eviction、
別拠点、初回保存前のいずれも正直に表す。

`generationTerminal`は上流・Proxy通信の結果だけを表す。正常接続中に全文を受信し、上流の`[DONE]`と
outer Proxy `done`が確認できれば、cacheを一度も作らなくても`complete`である。`cacheCapability`は
復旧可能性だけを表す。容量超過やcache put失敗は生成を`overflow`/失敗へ変えない。ACKがcacheなしで
`deleted:false`を返すことも正常である。

### 容量・CPU・書込み直列化

`MAX_RECOVERY_CACHE_BYTES = 1_048_576`をWorker内定数とする。chunkを受け取る時にUTF-8 byte長を
加算し、上限を超えたら以後本文を追加せず、`cacheCapability`を`overflow`にする。通常の接続中も上限までだけ
メモリに保持し、それ以降は中継を継続する。これにより無制限の`ndjsonBody +=`と再シリアライズを排除し、
Recoveryの上限を明示する。通常完了でクライアントが接続されたままならCache保存を行わない。

クライアント切断をwriter.write失敗で検知した時点で、保持済みchunkを含む`streaming` snapshotを一度
保存する。その後は10秒ごと、かつ終了前にだけ保存する。最大25秒でabortするので、成功しても
即時+10秒+20秒+終端の最大4回であり、50 subrequestを大きく下回る。

`enqueueSnapshot()`はsessionごとの`Promise` chainへsnapshotの**不変コピー**を追加する唯一の書込み口に
する。タイマーは同期コールバックから`void enqueueSnapshot()`するだけで、最後は`clearInterval`後に
chainをawaitする。したがって古い定期保存が新しい終端保存を上書きせず、Cache APIの無条件putでも
同一実行内の順序は保たれる。`Response(JSON.stringify(snapshot))`はこのchain内で生成する。

Cache保存が失敗・容量超過しても、通信が正常に完了した事実は`complete`として伝える。クライアントが
切断済みで上流を期限abortした場合だけ`generationTerminal: interrupted`になる。保存不能時に既存snapshotが
あればrecoverはその`streaming`状態を返し、存在しない時だけcache-missになる。保存失敗をcache-missと
同一視しない。

## Worker状態遷移

```
connected --disconnect signal--> disconnected --<=20s read--> complete | interrupted | failed
     |                                       | snapshot chain
     |-- upstream [DONE] + outer done -------+-- cache snapshot before outer terminal SSE
```

1. `handleStream`は上流fetchのヘッダ受信まで45秒のAbortController deadlineを持つ。応答/例外で必ず
   timerを解除する。初期ヘッダ前のAbort、ネットワーク例外は502で終了する。
2. 上流readerの`TextDecoder`と小さいSSE scannerで`[DONE]`を跨ぎchunk境界でも追跡する。EOFだけでは
   `complete`にしない。`[DONE]`確認済みなら`complete`、切断期限のabortなら`interrupted`、他のreader
   例外なら`failed`である。cache容量超過はこの判定に関与しない。
3. `complete`では、cacheが必要になった場合に限り最終snapshotの完了を待ってから、外側Proxy SSEに
   `event: done`を送る。`failed`、`interrupted`は同じく保存を試みた後に非完了terminal eventを送る。writerはfinallyで一度だけ
   closeし、upstream readerはcancel/release、timerとactiveStreamsを必ず解放する。
4. `public/sw-stream.js`とSWなし経路は、内側`[DONE]`を記録しても外側Proxy `done`を読むまでreaderを
   続ける。outer `done.complete !== true`、outer EOF、outer error/interrupted/cache-missは成功にしない。
5. `handleRecover`は`cacheCapability: available`のCacheだけgeneration terminalをSSEとして返す。
   `cacheCapability: overflow`は、上流が正常完了していても保存されたprefixだけでは完全復旧を証明できないため、
   送れるchunkの後に`event: interrupted`（`reason: capacity`、`complete: false`）を必ず返す。従って
   recovery側はACK/deleteをせず、部分結果として保持する。`streaming`だけは既存の2秒pollを上限
   25秒に限定する。pollごとにreader cancel/releaseを行い、クライアント切断ではwriterを
   closeして終了する。5分KV前提の待機は削除する。
6. ACKは`complete` terminalを受信し全chunkを適用した時だけ送る。Workerはcache.deleteのbooleanを
   `{ deleted }`で返すが、別拠点での削除・TTL・evictionは保証しない。完了snapshotの前にACKを受けないよう
   terminal SSEはsnapshot await後に出す。ACK失敗はローカル成功を失敗へ変えない。

### 切断検知と切断後期限

`enable_request_signal` を有効にした `request.signal` を切断検知の主経路とする。`writer.closed.catch`と5秒間隔の
SSE comment heartbeat（`: ping\n\n`）は補助経路であり、いずれも`startDisconnected()`を一度だけ起動する。
heartbeatはProxy/LLM SSE parserが無視する形式に限定し、timerとhandlerはfinallyで解除する。別isolateへのcancelと
切断後30秒を超える生成完走は引き続き保証しない。

`startDisconnected()`は即時snapshotを一度だけenqueueし、上流readのdeadlineを切断検知から20秒、cache保存の
最終待機deadlineを25秒に設定する。cache putはAbortSignalを受けないため、snapshot queueには同時に一つだけを
許可し、未解決putがあれば定期enqueueをskipする。20秒で上流をabortし、最終snapshotは残り5秒だけawaitする。
25秒を超えたらWorker本体はcache putの完了を待たずにterminal処理を終える。古い`streaming` snapshotしか残らない
ことはあり得るが、recoverはその状態を25秒までpollした後`interrupted`として返す。cache put timeout/失敗は
cache-missではない。

### Cancel

`activeStreams`に存在する同一isolateではAbortControllerをabortし、結果を`localAbortRequested: true`と
する。存在しない別isolateでは`localAbortRequested: false`である。OpenRouter generation IDがあれば
provider cancelを実行し、成功HTTP 2xx/失敗/未実行を別フィールドで返す。providerのresponse bodyは不要なので
必ず`body.cancel()`する。`{ cancelled: true }`という一律の成功表現は削除する。

別isolateでprovider cancelも使えない場合、上流停止の保証はない。これは独立実行基盤を導入しない条件では
解消不能であり、クライアントはcancelが受理されたことと停止完了を混同しない。部分cacheはTTLまでbest effortで
残る。

## クライアントの永続化と復旧

`src/utils/streamDb.ts`の`StreamRecord`に次を加え、`appendText`ではなく一回のreadwrite transactionで
更新する`saveProxyCheckpoint`（命名は実装時に既存慣例へ合わせる）を追加する。

```ts
lastProxyEventId: number;          // fully processed proxy eventのみ
llmSsePartial: string;             // 未完の内側LLM SSE block
thinkTagCheckpoint: { state: 'outside' | 'inside'; pending: string };
bufferedReasoning: string;         // reasoning専用deltaとthinkタグ双方の累積値
acknowledged: boolean;             // 最終結果または部分結果をUIへ適用済み
```

外側Proxy SSEのpartialは保存・復元しない。未完blockからはevent cursorを進めず、recover GET開始時は常に
空のouter partialで再解析するため、同じ未完blockをキャッシュから完全な形で受け取れる。`ThinkTagParser`と
`public/sw-stream.js`のplain JS copyに`checkpoint()`/`restore()`を最小追加する。完全なProxy eventを処理して
本文・reasoningをUIへ反映した後、`bufferedText`、`bufferedReasoning`、event ID、内側LLM partial、think state、
generation ID、観測値を一つのcheckpointとして保存する。タイマーflushは値の参照を後から読まず、作成時の
snapshotをchainに渡す。これでevent IDだけ進んでpartial/stateが古い、または逆の状態が生じない。

Service Workerでは同じcheckpointを`dbUpdate`一回で保存する。`[DONE]`受信はcheckpointを保存するが、
outer done受信まで`onDone`とACKを出さない。SWなし`submitRuntime.ts`も同じcheckpointを使い、finallyで
reader.cancel/releaseとflush chain awaitを行う。ただし成功でない場合はACKも`deleteStreamRecord`も行わず、
statusを`failed`または`interrupted`として保持する。

`useStreamRecovery.ts`は最初にrecordの内側LLM/think checkpointから復元し、`bufferedReasoning`も既存の
reasoning content blockへ適用する。`buildRecoveredMessage`と比較判定は本文だけでなくreasoningを含める。
reasoning専用deltaと`<think>`タグ双方を同じcheckpointに加算する。各復元イベントを同じcheckpoint関数で記録し、
ネットワーク例外、reader EOF、abortは「復旧未完」であって完了ではない。これらではACKを送らず、
`acknowledged=false`のrecordを保持する。

初回cache-missは、切断直後のsnapshot保存との競合でもあり得るため、500ms間隔・最大3回の短いGET retryを行う。
再試行の終了条件は「complete/failed/interrupted terminalを受信」「retry上限のcache-miss」「通信例外/abort」のみである。
completeだけACKと`deleteRequest`の対象にする。non-complete terminalまたは上限後cache-missでは、本文とreasoningを
UIへ適用できたrecordだけ`acknowledged=true`へ更新して今後の自動復旧対象から外し、stale cleanupまで記録を残す。
通信例外/abortでは`acknowledged`を変更しないため、次回に再試行できる。この定義でpendingは
`acknowledged=false`だけを意味し、二重の状態を作らない。

## HTTP期限、Retry-After、資源解放

Workerのstream/request/moderation上流fetchと、WebのSW/SWなしstream fetchに「初回応答ヘッダ45秒」の
deadlineを設ける。timerはresponse取得時と例外時に解除し、timeout時はAbortControllerをabortする。以後の
chunk無通信45秒も同じcontrollerでreaderをcancelし、raceの負けた`reader.read()`を放置しない。

POST生成には自動再試行を加えない。ネットワーク例外やヘッダ前timeoutでも、上流が既に受理した可能性があり、
自動retryは二重課金/二重生成になるためである。429/5xxは上流の`Retry-After`を`CORS_HEADERS`のexpose listと
proxy responseへ透過し、本文は上限付きで読む。Web側はRetry-Afterの秒数またはHTTP日付を表示可能なエラーへ
変換するが、同一送信を自動で再発行しない。`submitRuntime.ts`には`upstreamDataStarted`をrequest単位で置き、
本文が空でもreasoning、usage、generation ID、finish reasonを含む最初の上流eventを処理した時点でtrueにする。
既存の「system messageを除く」再送はこの値がfalseの時だけ許可する。これによりreasoning-only/usage-only開始後の
再POSTによる二重生成を防ぐ。

不要なresponse bodyは`cancel()`して解放する。上流非2xxの本文は上限（8 KiB）まで読み、readerをcancel/
releaseする。stream/recover/クライアントのfinallyはtimer clear、reader cancel（await/catch）、releaseLock、
writer closeをそれぞれ一度だけ行う。moderationは既存の小さいJSON用途以外に本文を貯めない。

## ファイルごとの変更

| ファイル | 変更 |
| --- | --- |
| `proxy-worker/src/index.ts` | KV Env/helpers/定期KV制御をCache API helperとbounded snapshotへ置換。完了判定、20秒disconnect read abortと25秒保存待機上限、recover/ACK/cancel HTTP契約、deadline/Retry-After/body解放を実装。 |
| `proxy-worker/wrangler.toml` | KV namespace binding/commentを削除。既存互換日付・observabilityはこの要求外のため変更しない。 |
| `.github/workflows/deploy-proxy-worker.yml` | KV placeholder検査stepを削除し、Cache APIに必要なbindingがない構成と整合させる。 |
| `proxy-worker/README.md` | KV作成手順・KV枠をCache APIのbest-effort/5分TTL/拠点非共有/30秒中断/容量上限へ置換。 |
| `public/sw-stream.js` | outer doneまで読む、checkpoint atomic flush、think checkpoint、deadlineとreader解放、成功時だけACK/削除。 |
| `src/utils/proxyClient.ts` | Cache APIという内部実装名を契約へ漏らさず、terminal/cache-miss parse、ACK/cancel result、Retry-After helperを追加。 |
| `src/utils/streamDb.ts` | checkpoint型とatomic transaction helper、部分適用済みmark helperを追加。 |
| `src/hooks/submitRuntime.ts` | SWなしProxyのcheckpoint/outer terminal検証、成功限定ACK/delete、timeout資源解放、Retry-Afterエラーを実装。 |
| `src/hooks/useStreamRecovery.ts` と `src/hooks/streamRecoveryHelpers.ts` | persisted内側parser stateから本文・reasoningを復元し、短いcache-miss retry、complete以外で復旧データを消さない状態遷移へ修正。 |
| `src/utils/thinkTagParser.ts` と既存sync test | checkpoint/restoreのTS/Service Worker同値性を維持する最小拡張。 |

## 回帰テスト計画

既存Vitest構成で次を追加し、WorkerはCache APIをMapで模擬する。

1. Worker: `[DONE]`後にouter doneを送ること、`[DONE]`なしEOFが`interrupted`であること、final cache put完了前にdoneを送らないこと。
2. Worker: snapshot競合（遅い定期putと終端put）、put timeoutで古いstreaming snapshotが残る場合、cache-miss/expiry、actual event IDによるoffset、cache容量上限でも通常接続の生成がcompleteになること、1MiB超過後に切断して上流が正常完了してもrecoverは部分扱いでACKしないこと、20秒read/25秒保存期限、reader/timer解放、ACKのlocal-only delete結果、同一/別isolate cancel結果。
3. Worker HTTP: 429/5xxのRetry-After透過、初期ヘッダdeadline、POSTを自動再送しないこと、エラーbody上限。
4. `proxyClient` parser: cache-miss、cacheCapability=overflowを伴うterminal、interrupted、分割されたProxy SSE control event。
5. `streamDb`: checkpointの全フィールドが一transactionで保存され、event IDとLLM partial/think checkpointが同じ世代になること。
6. Service WorkerとSWなし: 内側`[DONE]`だけではdoneにしないこと、失敗/abort/EOFでACK・削除しないこと、完了だけでACK・削除すること、reader timeoutがcancel/releaseすること、writer.closed/heartbeatからdisconnect処理を一度だけ開始すること。
7. Recovery: outer Proxy SSE blockを途中で切った後も空のouter parserから正しく再開すること。LLM SSE blockと`<think>`/`</think>`が各々境界で分割された状態から、本文欠落も思考混入もなく、reasoning専用delta/thinkタグ双方を回復すること。network失敗はpending recordを残し、cache-missは短期retry後に、terminal partialは内容を残して自動再試行対象だけを止めること。
8. `submitRuntime`: 本文なしのreasoning-only、usage-only、generation-ID-only event後はsystem message除去の再POSTをしないこと。

実装後は`proxy-worker`のtypecheck/test、Webの対象Vitest、production buildを一度実行し、必要なら実ブラウザで
Proxy経路の正常完了・切断復帰を区別して確認する。Cloudflare実デプロイ確認はPR作成前のコード検証とは別に報告する。

## 意図的な限界

Cache APIのeviction、5分前の消失、PoP移動、Cache APIのput保存成否、別isolateからの直接abort、切断後30秒を
超える生成完走は保証しない。キャッシュ能力の喪失は、生成が正常完了した場合でも復旧不能であることだけを表す。
実際に切断期限で止まった生成はcache-missまたはinterruptedとしてローカルの部分結果を残す。確実な継続/停止には
Durable Objects、Queue、Workflow等の別実行主体が必要だが、今回の範囲では追加しない。
