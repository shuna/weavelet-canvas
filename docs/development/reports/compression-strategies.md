# 本文・metadata圧縮の比較方法

## 目的

本文とmetadataを同じ方式で圧縮する場合と、別の方式で圧縮する場合について、保存・転送容量と圧縮・復元時間の関係を比較する。productionの同期方式を変更する実験ではなく、bench専用のフレームと局所処理モデルによる比較である。

個人exportの本文・タイトル・IDは参照していない。既知の集計値を使って、架空のチャット・ノード・本文を生成する。

## 入力と分離

保存状態のsnapshotと、同期で送るlogical Commitは異なる。snapshotを`toRecords`で同期レコードへ変換し、その変更列から初回Commitを作る。容量はsnapshotのJSONとlogical CommitのJSONを別々に記録する。

本文側に分離するのは、`content`、`assets`、旧形式の`chats/<id>/messages`の`Change.after`文字列。旧形式はメッセージ配列全体を分離するため、role・typeなどの小さい項目も本文側に残る。削除の`after:null`、キー・before値・親Commit参照・ノード属性などはmetadata側とする。system promptなど、設定に含まれる文章もmetadata側に残る。

本文文字列内部のJSONを再整形せず、配列・プロパティの順序、空白、Unicodeを保持する。各componentのcodec往復、フレームへのbyteコピー、AES/IndexedDB往復を確認し、復元後の`JSON.stringify(logicalPayload)`が元と完全一致することを必須にする。

## 比較候補と容量計上

全8候補は次のとおり。LZは既存のJavaScriptライブラリ`lz-string`、gzipはブラウザーの`CompressionStream`を使う。圧縮なしも対照に含める。

| 候補 | 全体または本文 | metadata |
|---|---|---|
| whole-none | 全体を圧縮なし | 分離なし |
| whole-lz | 全体をLZ | 分離なし |
| whole-gzip | 全体をgzip | 分離なし |
| split-body-gzip-meta-gzip | 本文をgzip | gzip |
| split-body-gzip-meta-lz | 本文をgzip | LZ |
| split-body-lz-meta-gzip | 本文をLZ | gzip |
| split-body-lz-meta-lz | 本文をLZ | LZ |
| split-body-gzip-meta-none | 本文をgzip | 圧縮なし |

これに、適用できる更新Commitでは現行方式の`existing-inline-lz`を追加する。親Commitがあり、logical CommitのLZ圧縮後サイズが256KiB以下の場合を対象とし、logical CommitのLZ符号化とversion-2 inline manifestのLZ符号化の両方、およびinline復号を計上する。新方式向けのcanonical hash計算は、この現行対照には加えない。

全体・分離の8候補には、共通のbench専用binary headerを20B付ける。本文とmetadataを分けたJSON wrapper自体の容量は、`jsonWrapperBytes`として別に記録し、binary headerと重複計上しない。これはproductionのmanifestや新protocolそのものではない。

`--transport`ではフレームを1MiBずつ分割し、実AES-GCMの各partの28B overhead、共通bench manifestの暗号文容量、実IndexedDB保存・読取を計測する。inline対照は1ファイルで、20B headerと別manifestを付けない。inlineの実形式とgzipのbench形式のbyte差を、そのまま本番形式の差とは扱わない。1ファイル対2ファイル以上という要求段階の違いは比較できる。HTTPヘッダー・Drive固有のファイルmetadata・共通の認証鍵取得は含めない。

## 時間とネットワークのモデル

componentとcodecの組み合わせごとに1回ずつ符号化・復号し、同じ出力と計測値を候補間で再利用する。これはofflineの組み合わせ比較であり、実行時に全方式を試す選択処理の費用を提案しているわけではない。

JSONの `cpuAndLocalMs` はCPU使用時間ではなく、下記の処理を合算した経過時間モデルである。本番の通常Commit送信とpack生成・検証では、hash計算やmanifest形式が異なるため、本番Engineの総時間とは区別する。

codec内の時間と、実Workerへのコピー・結果返却を含む往復時間を別に記録する。モデルにはWorker往復時間を使い、本文分離、JSON化、フレーム組立、復元の時間を加える。8候補には新方式向けのcanonical Commit hash計算も加える。合成データ生成と`toRecords`への変換は共通の前処理として別記する。

AES/IndexedDBについては、`encryptMs + decryptMs + writeMs + readMs`をモデルへ加算する。`transportObservedMs`は鍵生成・検証・cleanupも含む実測wall timeとして別に残し、モデルへ二重加算しない。

回線は上り・下り対称の10／50／100Mbps、RTT（要求と応答が戻るまでの時間）は0／100msを仮定する。並列数2として、各方向の要求回数の段階数を`ceil(dataParts / 2) + 別manifestの有無`で見積もる。往復のモデルは次式とする。

```text
総時間 = ローカル処理の経過時間
       + 暗号文容量 × 16 / (Mbps × 1000)
       + 2 × RTT(ms) × 各方向の段階数
```

方式間の時間が等しくなる回線速度を、RTT 0ms／100msごとに計算する。正の交点がない場合は`null`とする。Pareto判定は容量とローカル処理の経過時間についての比較であり、すべてのRTT条件で速いことを意味しない。

## 合成分布・反復・制約

反復文、構造のある架空の日本語・英語・コードとseed付き編集、圧縮しにくい乱数本文の3分布を使う。structured分布も類似本文を多く含み、個人データの分布を代表する保証はない。画像や実際の変更頻度・履歴量を再現する測定でもない。

小ケースは本文設定650B・各分布3反復、大ケースは5300B・各分布1反復。小ケースのsnapshotは約8.6〜8.9MB、logical Commitは約11.9〜12.5MBであり、「10MB側」は概数である。測定項目は初回、タイトル更新、分岐形式の本文更新、旧形式のメッセージ配列更新。小ケースには小さいpackも加える。分岐本文更新の設定は両ケースとも5300Bとする。

実Chromeの一時プロファイルで測る。単回の大ケースでは分散を判断できず、JIT・GC・CPU競合・実行順の影響がある。実ネットワーク、信頼できるピークメモリ、ハードウェアによる圧縮支援は測定していない。同期全体や実Driveでの完了時間の保証には使わない。

## 再現コマンド

このworktreeでViteを起動する。同じコンピューターで重い測定を並行させない。

```sh
./node_modules/.bin/vite --host 127.0.0.1 --port 5177 --strictPort
```

別のterminalで、分布ごとに独立したChrome processを使って実行する。

```sh
for profile in repeated structured incompressible; do
  node scripts/benchmark-compression-strategies.mjs \
    --profile="$profile" --body-bytes=650 --edit-body-bytes=5300 \
    --repetitions=3 --seed=12345 --scale=1 --transport --strategies=all \
    --report="docs/development/reports/compression-strategies-small-$profile.json"
done

for profile in repeated structured incompressible; do
  node scripts/benchmark-compression-strategies.mjs \
    --profile="$profile" --body-bytes=5300 --edit-body-bytes=5300 \
    --repetitions=1 --seed=12345 --scale=1 --transport --strategies=all \
    --report="docs/development/reports/compression-strategies-full-$profile.json"
done
```

`WEAVELET_TEST_URL`と`PLAYWRIGHT_CHROME_EXECUTABLE`で接続先とChrome実行ファイルを変更できる。`--smoke`は構造・往復確認用の小さいfixtureであり、本測定の代わりにはしない。

3倍ケースは同じ5300B本文で`--scale=3 --repetitions=1 --strategies=whole-gzip,split-body-gzip-meta-gzip`を指定し、分布ごとに別processで実行する。fresh補足は同じ2候補で`--scale=1 --profile=incompressible`とする。`--smoke --inject-failure=whole:lz:decode`で失敗候補の記録・除外と後続候補の継続を再現できる。

## 結果

容量は暗号文合計（共通bench manifest込み）、MBは10進、時間はローカル処理の経過時間モデルである。実Drive同期時間ではない。

### 大ケース：初回Commit、各1回

| 方式 | repeated：MB / ms | structured：MB / ms | incompressible：MB / ms |
|---|---:|---:|---:|
| 全体・圧縮なし | 64.318 / 642.9 | 69.365 / 1149.1 | 64.340 / 640.4 |
| 全体LZ | 0.680 / 15998.1 | 8.574 / 8456.7 | 辞書上限で失敗 |
| 全体gzip | 0.754 / 631.8 | 5.189 / 1412.0 | 45.580 / 1813.1 |
| 本文gzip／metadata gzip | 0.625 / 757.6 | 5.001 / 1582.5 | 45.420 / 1847.7 |
| 本文gzip／metadata LZ | 0.696 / 1002.0 | 5.072 / 1857.0 | 45.490 / 2106.9 |
| 本文LZ／metadata gzip | 0.586 / 13093.9 | 8.394 / 8150.3 | 辞書上限で失敗 |
| 本文LZ／metadata LZ | 0.656 / 13359.4 | 8.465 / 8431.1 | 辞書上限で失敗 |
| 本文gzip／metadata圧縮なし | 4.123 / 722.3 | 8.499 / 1565.1 | 48.917 / 1819.9 |

snapshot / logical Commitは、repeated 61.058 / 64.315MB、structured 63.010 / 69.362MB。以前のsnapshot単体圧縮結果とは別の入力である。

incompressibleの全体LZ（64,337,151B）と本文LZ（60,513,341B）は符号化時に`RangeError`となり、既知の辞書サイズ上限として失敗した。これらを使う3候補は、容量・時間や交点を推測せず失敗として記録している。履歴走査のcall stackエラーとは別件である。このrunのgzip時間には先行LZ失敗後のGCが影響する可能性があり、別processで補足測定する。

### 小ケース：初回Commit、3反復

| 分布 | 全体gzip：MB、ms中央値 [min,max] | 分離gzip：MB、ms中央値 [min,max] |
|---|---:|---:|
| repeated | 0.458、159.4 [156.9,178.9] | 0.451、212.7 [207.9,229.5] |
| structured | 1.003、289.2 [277.7,302.9] | 0.989、331.2 [317.8,354.2] |
| incompressible | 5.932、311.5 [304.7,325.3] | 5.887、349.9 [343.7,368.9] |

小ケースの全体gzipから分離gzipへの容量削減は約0.8〜1.7%。大ケースはrepeatedで128,438B（圧縮後容量の17.0%）、structuredで187,865B（3.62%）だった。logical Commit全体の17%を追加削減する意味ではない。

大ケースの全体gzipと分離gzipの等時間となる対称回線速度は、repeated約16Mbps、structured約18Mbps（送信1回＋受信1回、今回の単発ローカル時間）。送信だけなら約半分となる。同じpayloadの受信回数が増えるほど、容量削減の影響は増える。時間のばらつきや本番形式差があるため、この値を採用条件として固定しない。

### Astraとの検討と暫定判断

- 全体gzipを大payloadの第一候補とする。本文gzip／metadata LZは、これまでの全ケースで分離gzipより大きく遅く、採用しない。本文LZは反復の大ケースでは小さいが、約12秒以上の追加処理と辞書上限の失敗がある。
- 分離gzipは大ケースで容量を減らす候補として残す。本文・metadata・復元結果の同時保持による追加メモリと、実Engine経路の費用を確認するまでは、新protocolとして採用しない。今回、ピークメモリ比較は実施していない。
- 小更新は既存inline LZを維持する候補。titleでは実形式218B・1fileに対してwhole-gzip benchは375B・2files。byte差すべてを本番差とは扱わないが、manifest公開・取得を別段階にする要求数の差は残る。短い本文・legacy配列更新もraw結果に含む。
- 方式選択のために大payloadへLZを試す処理は再導入しない。将来は圧縮前サイズで候補を絞り、閾値付近やmetadata一括更新を追加検証する。現段階では閾値を決めない。
- 新方式はopt-inのまま。マージ、本文delta／ノード参照、outboxのID・暗号文固定、履歴保持数は変更しない。既存deltaと分離gzipの併用は今回の比較対象に含めていない。

### 3倍ケース：gzipの2候補、各1回

| 分布 | snapshot / logical Commit MB | 全体gzip：MB / ms | 分離gzip：MB / ms | 暗号化ファイル数：全体 / 分離 |
|---|---:|---:|---:|---:|
| repeated | 182.531 / 192.293 | 2.255 / 1962.1 | 1.872 / 2231.1 | 4 / 3 |
| structured | 188.384 / 207.382 | 15.479 / 4425.6 | 14.915 / 4854.4 | 16 / 16 |
| incompressible | 182.348 / 192.107 | 136.054 / 5298.6 | 135.564 / 5500.9 | 131 / 131 |

全分布・初回／タイトル／本文／legacy配列更新で、両候補とも復元後のJSON完全一致を確認した。LZはこの3倍ケースで実行していない。logical Commitは最大207,381,896Bで、試作native経路の256MiB展開上限未満に収まる。分離する場合も本文とmetadataの合計を基準にすべきであり、区分ごとに上限を緩める提案ではない。

分離の容量削減は約17.0%／3.64%／0.36%、追加ローカル時間は約269／429／202ms。repeatedではpart数も減るため、RTT100msモデルの交点は約89Mbpsへ変わる。これは1MiB part・並列数2という実験条件による結果であり、常に同じ要求数差になるわけではない。

難圧縮データの通常サイズをLZなし・新しいChrome processで補足測定した結果は、全体gzip45,580,456B・1784.0ms、分離gzip45,419,863B・1858.8msだった。容量差は160,593B、追加時間は約75msで、分離を直ちに採用する根拠にはしない。

各分布は別Chrome processだが、2候補自体は同じprocess内で成分の計測値を再利用する比較であり、候補ごとの完全なメモリ分離はしていない。ピークメモリの優劣や端末の必要メモリは断定できない。完走は入力と実装の組み合わせでの確認であり、一般的なサイズ上限や、100万ノード以上の対応を示すものではない。LZの辞書上限も、一般的な「61MB上限」を意味しない。

### 検証成果物

測定スクリプトは `scripts/benchmark-compression-strategies.mjs`。数値のみのJSONは同じディレクトリーの `compression-strategies-small-*.json`（各15ケース）、`compression-strategies-full-*.json`（各4ケース）、`compression-strategies-3x-*.json`（各4ケース）に保存した。native fresh補足は `compression-strategies-full-incompressible-native-fresh.json` に分けた。

10レポート・73 workloadsで521組み合わせの成功と3組み合わせのLZ辞書上限による失敗を記録した。共通component計測値を使う組み合わせの数であり、521回の独立標本ではない。

本文分離・復元とAES/IndexedDBの5テスト、TypeScriptチェック、通常smokeに加え、codec失敗を注入して失敗候補の除外と後続候補の継続を確認した。Node 20で全1,337テスト成功、任意実行のbenchmark 2件はskip。分離gzipの本番形式追加、方式選択の閾値、新しい圧縮依存ライブラリは追加していない。
