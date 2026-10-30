# LAN内OpenAI互換サーバー接続の詳細設計

2026-10-30。基準は `origin/main` の `9c73b2d2`。設計時点の基準。Web実装の検証状況は末尾の実装記録を参照。

## 1. 完成範囲と判断

WebアプリをPC・スマートフォン等の複数端末で使い、LAN上のOpenAI Chat Completions互換サーバー1件へ接続する。接続情報（認証キーを含む）と登録モデル設定を既存の端末間同期に含める。

- 固定プロバイダ `lan`、表示名「OpenAI互換（LAN）」を1件追加する。OpenAI公式の設定は流用しない。
- LAN用リクエストは端末から直接送る。全体のプロキシ設定より優先し、クラウドへの代替送信は行わない。
- 既存のProviderConfig、カスタムモデル、モデル選択、保存・同期・競合表示を拡張する。接続管理クラスや汎用HTTP層は作らない。
- LANの会話本文を使うタイトル・要約・品質評価もLANへ送る。OpenAI Moderationによる安全性評価はLAN会話では実行しない。明示的な外部送信の許可機能は追加しない。
- 既存の `modelSource: 'local'` は端末内推論を意味する。LANは `modelSource: 'remote'` と `providerId: 'lan'` の組合せにし、端末内モデル機構を流用しない。

対象外は複数LANサーバー、探索・Bonjour、任意ヘッダー、Cookie認証、Responses API、独自推論パラメーター変換、画像生成、クラウド中継によるLAN到達、ネイティブ同期基盤の新設。

`ios2` はWebと別レコード・別形式（WVLT、Drive appDataFolder）で同期している。設定をSyncSnapshotへ足すだけではWebとの同期にならない。既存のWeb計画でもiOSは凍結されているため、本変更では触らない。「端末間同期の完成」は対応Web版同士を指し、Webとネイティブ間の同期を完成したとは扱わない。新たなネイティブ実装へ移す場合も、本書の設定・送信契約を引き継ぐ。

## 2. 接続データと検証

`ProviderId` に `'lan'` を追加し、`DEFAULT_PROVIDERS` と `PROVIDER_ORDER` に追加する。保存形式の新しいルートや接続IDは増やさない。

```ts
// DEFAULT_PROVIDERS.lan の初期値（設計例）
{
  id: 'lan',
  name: 'OpenAI互換（LAN）',
  endpoint: '',
  modelsEndpoint: undefined,
  modelsRequireAuth: false,
  apiKey: undefined,
}
```

| 設定 | 保存先・意味 |
| --- | --- |
| 生成API URL | `providers.lan.endpoint`。例 `http://192.168.1.20:8000/v1/chat/completions` |
| モデル一覧URL | `providers.lan.modelsEndpoint`。例 `http://192.168.1.20:8000/v1/models`。空欄は一覧取得を使わず手動登録 |
| 認証「なし／Bearer APIキー」 | LANに限り `modelsRequireAuth` を両API共通の認証要否として使う。false/trueの選択であり、認証モード用の重複フィールドは増やさない |
| APIキー | `providers.lan.apiKey`。認証なしへ変更した保存時に削除し、送信時も認証要否を確認する |

既存クラウドプロバイダに対する `modelsRequireAuth` の意味・動作は変えない。LANの有効キーを求める処理はprovider解決と一覧取得に置き、認証なしなら保存データにキーが残っていても返さない。Bearer選択時の空キーは保存・送信不可。空文字とundefinedは既存保存規約に合わせ正規化する。

URLは保存時と外部データ適用後の送信前に `URL` で検証する。http/httpsの絶対URLのみ、ユーザー名・パスワード埋込みとfragmentを拒否する。前後空白を除去し、パスやqueryは勝手に書き換えない。2つのURLを設定する場合は同じorigin（scheme/host/port）に限定する。LAN内DNS・IPv6・VPNを妨げるIP範囲判定は設けない。「LAN」は送信経路の区分であり、ホストが私設ネットワークであることをアプリが保証する名称ではない。

生成URL空欄の初期状態は保存可能だが未設定として生成と一覧取得を止める。空欄をOpenAI公式URLへ補完しない。HTTPの場合は画面に「通信内容とAPIキーは暗号化されません」と表示する。TLS証明書の検証を無効化する機能は作らない。

LAN接続設定の4項目は `provider-slice` の1回の更新で反映する。既存 `updateProviderConfig` のpatch対象を必要な項目まで拡張し、LANの接続設定一式を保存するactionを追加する。既存クラウド用setterの整理は行わない。

## 3. 設定画面とモデル一覧

既存のモーダルとインラインの両方にLANを表示する。共通の `ProviderSettingsForm` にLAN時だけモデル一覧URL・認証選択を表示する。Azure API Versionは表示も変更もしない。

LAN設定は「保存」操作で4項目を一括検証・保存する。既存クラウド設定の自動保存は変更しない。LANの未保存変更がある状態で閉じる・プロバイダを切り替える場合は、既存確認UIを用いて破棄を確認する。保存失敗ではフォームを保持する。同期からの更新が来ても、入力中のLANフォームを無条件に上書きしない。

LAN選択時に未設定URLへ自動fetchしない。一覧取得は保存済み設定を使う「モデル一覧を取得」操作とし、新たな接続診断APIや生成による接続テストは増やさない。未保存フォームを使って通信しない。

`fetchProviderModels` のLAN分岐は次を区別する。既存クラウドの返値契約は広げない。

- 一覧URLなし：通信せず、手動登録の案内。
- 正常な `{ data: [...] }`：一覧を表示。`data: []` は正常な0件。
- 401/403：認証エラー。404/405：一覧未対応として手動登録を案内。
- 非2xx・JSON形式不正・通信失敗：エラー表示。成功した0件に変換せず、保存済みモデルを削除しない。

LANのエラーは通常の例外でhookへ返し、`useProviderModels` に端末内のprovider別エラーを持たせる。共通Result階層は作らない。接続情報・キー・認証方式変更でキャッシュを無効化する。同期による接続設定変更でも同様に無効化する。取得開始時の設定と完了時の設定が異なれば、古い結果・エラーを反映しない。キャンセルと既存hookのcleanupを使い、永続request管理は増やさない。

fetch失敗だけでは権限拒否、CORS、DNS、接続拒否を確定できない。「同じLAN、サーバー起動、URL、ブラウザのLAN許可、サーバーのCORS設定を確認」の共通案内にする。

## 4. モデル設定の正本

登録モデルは `providerCustomModels.lan`、お気に入りは既存 `favoriteModels` を使い、識別子は `(providerId, modelId)` とする。表示名、contextLength、maxCompletionTokens、streamSupport、supportsReasoning、supportsVision、supportsAudioを既存型で保存する。

- LAN一覧からお気に入りへ追加する際は、そのモデルの設定を既存カスタムモデルにも登録する。未登録なら追加し、登録済みならユーザーの設定を上書きしない。直接の `setFavoriteModels` を使う選択確認経路も同じ条件を満たす。これで非同期の一覧キャッシュを同期しなくても設定が復元できる。
- お気に入り解除だけでは登録モデルを削除しない。登録モデルの削除は既存の明示操作に限定する。削除後の能力は既存favoriteに残る値を用い、プロバイダ参照はLANのまま保持する。
- 登録モデルのmodelIdは既存どおり編集不可とし、ID変更は別モデルの追加で行う。
- `ProviderCustomModelList` に最大出力・画像入力・音声入力の不足項目を足す。編集時は推論を含む全保存項目を復元し、お気に入りへ渡す際も欠落させない。
- LANではモデルIDから能力を推定しない。明示的な情報がなければreasoning/vision/audioはfalse、streamはtrueとして利用者が変更できる。文脈長・最大出力・料金は不明のまま保存し、128kや無料と断定しない。文脈長不明時は既存unknown用トークン予算を使用する。
- 数値は空欄か有限の正整数（文脈長・最大出力）とし、双方設定時に最大出力が文脈長を超えない。既存の料金入力を残す場合は空欄か有限の非負値。
- `modelLookup` はLANについて他プロバイダの同名モデルを検索しない。特に `findCachedModel` の「指定providerのキャッシュなしなら全体検索」をLANでは止める。LANではカスタムモデルが存在すれば、その空欄も正本とし、文脈長・最大出力等をfavorite/cacheの旧値で補完しない。カスタムモデル自体がない場合だけfavorite > LAN cache > unknownの順で解決する。新しい消去フラグは増やさない。LANでは明示falseをモデル名による推測でtrueに戻さない。通常関数と同じ値を返す購読hookにも同じ規則を適用する。
- LANの画像入力はChat Completionsのマルチモーダル入力を意味する。`modelType: 'text'` を使い、画像生成APIの追加とはしない。

Chat Configの既存生成パラメーターを使う。LANは標準のmessages/model/stream、既存の生成パラメーターを送信する。reasoning対応を有効にした場合は既存の非OpenRouter形式を使う。既存の明示的 `force_reasoning` は能力設定より優先するため、非対応サーバーではreasoning対応とforceの両方を無効にする。画面の説明もこの条件を示す。サーバー独自形式の自動変換は行わない。送信前処理の `modelSupportsSystemRole` もLANではモデル名推測を適用せず、設定されたsystem promptを既存の標準system roleとして扱う。任意IDが `o1-` 等でもsystem promptを落とさない。専用のsystem対応設定は増やさない。保存・再編集・同期によりfalseや空欄が消えないことを確認する。

## 5. 解決・送信経路

`ResolvedProvider` に任意の `providerId` を追加する。明示指定・favoriteから解決できたIDを保持し、以後の有効Config、評価Contextへ渡す。既存fallbackはIDなしを許容する。LANを選択して作成する設定には必ず `providerId: 'lan'` を保存する。明示された未対応providerやLAN未設定を、fallbackや公式URLへ変換しない。モデルIDのみでLANを推測しない。

既存 `getProxyConfig(providerId?: ProviderId)` にLANならundefinedを返す小さな分岐を足す。汎用の経路戦略・接続ポリシーは作らない。endpointの文字列・私設IPの推測で経路を選ばない。

| 経路 | 変更と契約 |
| --- | --- |
| 通常生成・非stream | `api.ts:getChatCompletion` に解決済みIDを持つConfigを渡し、provider付きgetProxyConfigを使う |
| stream、SWあり | `submitRuntime` も同じIDでproxy解決。LANではSWへproxyConfig/sessionIdを渡さない |
| stream、SWなし | `getChatCompletionStream` に同じID。直接fetchのまま既存parserを使う |
| タイトル・要約 | 元会話がLANなら、全体のtitleModelや別summaryConfigより元会話のLAN provider/modelを優先する。本文は既存の補助プロンプトを使う。画面のモデル表示と `startBubbleSummary` の `summary.generation`、実際の送信を同一の有効Configに揃える |
| 品質評価、自動・手動・Modal | `EvaluationContext` に解決済みIDを追加し、`runQualityEvaluation` へ渡す。元会話のLANモデルに直接送信。LANでは検証済み生成URLをquery込みでそのまま使い、`/chat/completions` の追加・書換えをしない。URL中のクラウド名によるJSON mode推測も適用せず、`response_format` を付けない |
| 安全性評価、自動・手動・Modal | 選択engineに関係なくLAN会話からの `runSafetyCheck` 呼出しを禁止する。local/hybridとして明示選択した利用可能な端末内分類器だけ実行できる。localの未割当・準備失敗・推論失敗でも外部へ代替しない。未実施を安全判定として保存せず、利用不可理由を画面表示。LAN Moderation APIは作らない |
| キャンセル・復旧 | LANリクエストにproxy sessionを作らないためproxy cancel/ack/recoveryを呼ばない。既存の直接接続時の中断・受信済み本文復旧を使う。バックグラウンド継続を保証しない |

LANの一覧・生成・品質評価は `redirect: 'error'`、`credentials: 'omit'` とする。意図しない別ホストへの本文転送とCookie送信を避け、Cookie認証を対応範囲に含めない。SWへはこのためだけの任意 `providerId` を渡し、LANなら同じfetchオプションを適用する。SWでは古い版に必要な属性が無視され得るため、対応SWの有効化とページ再読込みまでを更新条件にする。

評価の実入口は `useEvaluation:runEvaluationForPhase`、`triggerManualSafety`、`triggerManualQuality` と `EvaluationModal` の直接呼出しを含める。ボタン無効化だけに頼らず各ハンドラーでも解決済みproviderを確認する。生成開始時に解決したID・URL・有効キーを処理内で保持し、待機中の設定同期や会話モデル変更で別接続先へ差し替えない。LANからクラウドへ変更した後の新しい操作はその変更後の設定に従う。

LAN時は既存OpenRouter専用制約をLANへ持ち込まない。会話のprovider/model選択を変更しても保存済みOpenRouter設定を削除する必要はないが、LAN生成のリクエストに専用header/bodyを含めない。実行可否を決める既存ハード制約を黙って迂回せず、矛盾する設定が有効なら送信前に設定変更を案内する。

LAN会話に対する補助生成の制限は、モデル実行の範囲である。Google Drive/iCloud等への利用者が設定したデータ同期は引き続き動く。「完全オフライン」や「本文が端末外へ一切出ない」という表示はしない。

## 6. 保存・同期・競合

保存は `providers.lan`、`providerCustomModels.lan`、`favoriteModels`、チャットの既存Configのみを拡張する。現行のpersist keysへ新ルートは追加しない。キーも同期対象であり、端末固有設定への除外は行わない。

| 対象 | 扱い |
| --- | --- |
| URL・認証方式・キー | 同期。1つの接続設定として扱う |
| 登録モデル・能力・制限値・お気に入り | 同期。チャットのprovider/model参照も同期 |
| 取得キャッシュ・接続エラー・取得中状態・未保存フォーム | 端末内のみ。既存providerModelCacheの同期除外を維持 |
| OS/ブラウザ権限・到達可否 | 各端末で判定。同期しない |

既存のレコード同期はオブジェクトを葉まで分割するため、LANのURLとキーを別々に同時編集すると組合せが混ざる。`google/records.ts:toRecords` のflattenで `['state','providers','lan']` だけはJSON値1件として出力する。既存fromRecordsはオブジェクト値を復元できることをテストする。新しい同期エンジンや競合ダイアログは作らない。

同一接続設定の競合は既存の「設定はローカル値を採用」という手動解決規約に従い、URL・認証・キーを一式で採用する。混合した接続先へキーを送らない。モデル配列・favorite配列は現行単位で競合する。細粒度モデル統合は追加しない。

Google Driveとフォルダー同期は既存EncryptedSyncを通す。iCloudは既存の圧縮スナップショット保存であり、アプリ独自のE2E暗号化が共通にあるとは説明しない。接続情報は選択した同期先の既存保護・競合規約に従う。今回それらを統一する移行はしない。

受信直後・再起動後・オフライン時でも設定を保持する。LANに到達できないことを理由に設定やモデルを削除せず、クラウドモデルへ置換しない。同期受信したURL・キーも送信前検証の対象とする。キーをエラー文・ログ・URLに含めない。

## 7. 互換性と導入

- 既存保存データにLANがなければ空の初期値を補完する。既存クラウド設定・旧API endpoint/キーはそのまま保持する。
- 対応版の `normalizeProviderConfigs` は未知providerのエントリーを保持したうえで既知の初期値を補う。未知providerを選択肢へ増やさず、解決時には未対応として止める。動的プロバイダ機構を作る目的ではない。
- ただし配布済み旧版は未知providerを落とし、削除を同期し得る。新コードだけで旧版の書込みを止められるとは扱わない。
- 導入手順は全端末の旧ページ・旧タブを閉じ、対応Web版と対応SWへ更新し、再読込みしてからLAN設定を保存・同期する。旧版から同じデータへの書込みを再開しない。旧版併用保証や旧版リモート停止機構は追加しない。
- 既存クライアントとのprovider追加互換性は本実装の受入項目。ios2との共通同期移行をこの追加へ抱き合わせない。

## 8. ブラウザ・サーバー条件

サーバーは端末から到達できるアドレスにbindし、使用ポートを通す。各端末のlocalhostはその端末を指すため、他端末からはLAN IPまたは各端末で解決できるホスト名を使う。

Webの配信originをサーバーのCORS許可に設定し、GET/POST/OPTIONS、Content-Type、Bearer使用時のAuthorizationのpreflightへ応答させる。TLSは端末が信頼する証明書を使用する。安全制限をブラウザ設定やElectronのwebSecurity無効化で回避する設計にはしない。

HTTPSページからHTTPのLANへ接続できるかはブラウザ・OS・URL・LANアクセス許可に依存する。Chromeの例外をSafari等にも一般化しない。実装では標準fetchと既存SWを使い、非標準APIやブラウザ専用Request型拡張は先に追加しない。サポート対象環境で直接接続できない場合は、LAN側の信頼済みHTTPS化等で条件を整える。権限が必要なら画面上の一覧取得等の利用者操作を起点にし、SWからの初回権限取得を前提にしない。

参照（2026-10-30確認）：[Chrome Local Network Access](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access)、[MDN CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)、[MDN Request.redirect](https://developer.mozilla.org/en-US/docs/Web/API/Request/redirect)。実ブラウザでの成立性を文書確認だけで保証しない。

## 9. 変更箇所

パスはリポジトリルート相対。実装時は記載symbolの全callerを再確認する。

| 対象 | 最小変更 |
| --- | --- |
| `src/types/provider.ts`, `src/store/provider-config.ts` | 固定lan ID・空の初期値・表示順。新Provider階層は作らない |
| `src/store/provider-helpers.ts`, `provider-slice.ts`, `rehydrateData.ts` | LAN正規化・一括保存・有効キー・未知設定保持・同期後のキャッシュ無効化 |
| `src/components/ProviderMenu/{ProviderMenu,ProviderMenuInline,ProviderSettingsForm,ProviderModelList,ProviderCustomModelList,providerMenuHelpers}` | LAN設定保存、一覧取得の操作とエラー、モデル登録、能力欄。Sidebarは既存ORDERを使用 |
| `src/hooks/{submitHelpers,useSubmit,submitRuntime,useEvaluation}.ts` | 解決ID伝播、補助生成のLAN固定、安全性評価の制限 |
| `src/api/{api,evaluation,providerModels}.ts`, `src/utils/proxyClient.ts` | LAN直接接続・認証・fetchオプション・一覧エラー |
| `src/utils/swBridge.ts`, `public/sw-stream.js` | IDを渡し、LANの直接fetchオプションを揃える。既存worker更新手順を使用 |
| `src/utils/{modelLookup,chatModelResolution}.ts`、既存モデル選択caller | 同名モデルの混同防止、登録モデルの同期、LAN IDの保持 |
| `src/components/ConfigMenu`、`SettingsMenu/{AutoTitleToggle,EvaluationSettings}`、`SummarySettings`、`Chat/ChatContent/Message/View/{EvaluationModal,EvaluationPanel,bubbleSummaryGeneration}` | LANでは別モデル指定が適用されない説明・記録、安全性評価の利用不可表示と直接呼出しの制御。新しい許可設定は作らない |
| `src/store/storage/google/records.ts` | LAN接続設定だけレコード1件にする。暗号化・transportは変更しない |
| `public/locales/{en,ja}` の既存model/API/evaluation翻訳 | 新しい文言の追加。既存言語fallbackを維持 |

Cloudflare Worker、OAuth、クラウド認証、ネイティブソース、依存パッケージは変更しない。

## 10. 実装後の検証と受入条件

小変更ごとの反復はせず、実装後に関連単体テスト・Web型検査・Webビルド・差分確認をまとめて行う。新しいテスト基盤は導入しない。

1. **設定・認証**：未設定のLANはfetchなし。なし→Bearer→なしの保存・再起動・同期後にヘッダーが正しい。無効URL・別origin一覧URL・空Bearerキーは送信前拒否。公式設定を変更しない。
2. **一覧**：正常0件/401/404/不正JSON/通信失敗を区別する。変更前設定の遅延応答と同期後の古いキャッシュを破棄し、登録モデルは残す。
3. **モデル**：全項目とfalse/未設定を登録・編集・favorite・同期で保持。同名モデルがクラウド側にあってもLAN能力を混ぜない。キャッシュがない別端末で登録名・能力・出力上限が復元される。文脈長・最大出力を登録→favorite化→カスタムで空欄→同期しても旧数値が復活しない。通常lookupと購読hookを照合する。
4. **全送信経路**：全体proxyEnabled=trueで、非stream/SWありstream/SWなしstream/タイトル/要約/品質評価を走らせ、LAN先以外の生成・評価fetchがないことをstubで確認。認証なしではAuthorizationなし。LANの3xxを拒否。自動・手動・Modalの安全性評価は全engineについて外部fetchなし、特にlocal未割当・準備失敗・推論失敗で代替送信しない。独自の生成パス・queryでも品質評価は同一URLかつresponse_formatなし。`o1-` 等の任意IDでもLANのsystem promptを保持し、reasoning能力falseかつforce=falseなら推論パラメーターなし。要約の記録と送信のモデルが一致する。
5. **同期**：既存EncryptedSyncの2端末テストで接続情報・キー・モデル・favorite・chat参照をround-trip。URLとキーを両端末で競合変更し、混合しない。LAN cache/権限/エラーは非同期。iCloudは既存snapshot経路で同じ設定が保存・復元されることを確認。
6. **互換性**：LANなしの旧snapshotを復元できる。未知providerは保持するが送信しない。旧版がLANを落とす既知条件を再現し、更新条件の必要性を記録する。新旧混在を成功条件にはしない。
7. **実接続**：PCとスマートフォンの対応Web版2端末で、一覧・手動モデル・通常生成・stream・停止・再読込み・同期復元を確認する。LAN外では設定を保ったエラー。対象ブラウザでCORS、LAN許可、HTTP/HTTPS、SWあり/なしを区別して記録する。

現時点では上記は検証計画であり、合格済みの結果ではない。サーバー製品・URL・認証の実値・対応ブラウザは未取得。独自推論パラメーター互換性と実機のLAN権限/SW動作は未検証。

## 11. Astra監査

初回監査の6指摘（全送信経路、旧版削除、ios2非互換、モデルUI不足、認証なし時のキー、安全性評価の独立経路）を本書へ反映した。

詳細設計のAstra Medium独立監査では、local安全性評価失敗時の外部代替、品質評価のURL書換え、カスタムモデルの空欄への旧値補完、モデル名によるsystem role/force reasoningの4点が追加指摘された。第4・5・9・10節に反映した。親の追加確認で要約生成の保存メタデータとUIも実モデルに揃える対象に含めた。

同日、同じAstraが修正箇所を再確認し、「実装開始用の設計として合格。追加の必須修正や矛盾なし。新しい通信層・同期基盤・設定フラグを増やしておらず、削除すべき過剰設計なし」と判定した。監査サイクルはここで終了する。この合格は設計に対するものであり、実装・実接続・同期競合の動作保証ではない。

## 12. Web実装記録（2026-10-30）

固定LANプロバイダ、明示保存する接続フォーム、モデル登録・能力編集、LAN直接送信、補助生成のLAN固定、外部Moderation禁止、接続設定の一体同期を実装した。ネイティブ版は対象外。

検証済み：

- Web型検査・ビルド。最終の全単体テスト1391件合格、既存ベンチマーク2件スキップ。
- Chromiumの設定画面でLAN設定保存と、未保存状態で閉じる際の破棄確認を操作。ダークモード画面を確認。
- Chromiumと検証用HTTPサーバーでCORSを含む一覧・非stream・直接stream・SW streamを実通信。全体proxyEnabled=trueでも4件すべて検証用サーバーへ直接到達し、Authorization/Cookieなし。実推論サーバーの互換性を保証する結果ではない。
- EncryptedSyncの新しいreaderで接続情報・キー・モデル・favorite・会話参照を復元し、一覧cacheが同期されないことを確認。URL/キー競合の一体採用はレコードmergeテストで確認。
- 旧SWがLAN機能確認に応答しなければ生成本文を渡さず停止する。全端末で旧タブを閉じ、対応Web版とSWへ更新して再読込み後にLAN設定を保存する。

未確認：実推論サーバーのURL・モデル・認証方式が未提供。実スマートフォン、対象Safari等のLAN権限/HTTP/HTTPS、実サーバーの独自パラメーター互換性は未検証。これらは検証用HTTPサーバーや型検査では代替できない。
