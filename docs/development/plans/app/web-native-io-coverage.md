# E：合成I/O corpusとWeb経路の検証範囲

## 現在の位置付け（2026-10-21）

本書の初回corpusは2026-10-12の固定資料であり、55既知root等の数値を現在の永続root総数として扱わない。後続root・機能の保持証拠は[完成条件と証拠](web-native-completion-ledger.md)、現在の残件は[ロードマップ](web-native-commonality-roadmap.md)を参照する。日付別の「未接続」「次は」は当時の記録。

現在は共有編集・message属性、保存・record・暗号化wire、Google/CloudKit/フォルダーprovider、旧iOS JSON/TLVW・zstd/旧クラウドreadonly読取まで接続し、各機能の限定検証を記録済み。実Google OAuth設定/クラウド相互運用、旧保存への実到達、iCloud Drive配信、旧writer混在時の新拡張保持と全体の最終互換性受入は未完了。provider未実装と実接続未検証を区別する。内部DB方式の一致は要求しない。

以下は観測差分と後続修正の履歴。既知の差を解消した後も、旧版writerの制限や未確認範囲を消して完全互換とは判定しない。

2026-10-12。最終受入はWebと新iOSのデータ形式・オンライン同期方式の完全互換であり、交換・同期のI/O結果で判定する。新iOSの内部表現やローカルDB（CoreData等）は最適化できる。未知項目の破棄書戻しを認めず、旧iOS独自保存データにも無損失の引継経路を必要とする。この文書は段階ごとの部分検証を示す。隔離したテストデータへの保存・同期実装は進めてよい。未検証の既存ユーザーデータ上書きと本番同期書込みは行わない。初回corpus検証の後、pinned孤立枝・未知拡張保持・取込衝突を修正し、native保存と同期wireの明示node順序を追加した。各段階の証拠と旧形式の扱いは下記に記す。

## 合成corpus

`tests/fixtures/web-native/io-corpus.json`は`{fixtureVersion:1, exportV3:{...}, syncSnapshot:{version:18,state:{...}}}`。version 3は交換形式、18はWeb永続stateの版、fixtureVersionは検証資料の版であり別物。実ユーザーデータ・credentialsは読み取っていない。API key、token、passphrase、generation ID、モデル・画像・URL・エラーは合成値のみ。`FAKE_TEST_ONLY`等の値は認証や推論に使えず、example.invalidは接続先ではない。

| 対象 | corpus内の代表項目 | 今回の実接続 |
| --- | --- | --- |
| 永続root | `persistence.ts:FULL_PERSIST_KEYS`の55項目すべて＋未知xFixtureRoot | 実createPartializedStateの全root・全値比較 |
| Chat/tree | 2chat（4nodeの分岐tree＋flat）、ID/title/titleSet/folder/messages/config/imageDetail、rootId/activePath、3種のnode状態map | 実validator、persist serializer、prepareChatForExport、Google record復元 |
| Config | model/max_tokens/temperature/presence_penalty/top_p/frequency_penalty、stream/providerId、reasoning_effort/budget、verbosity/force_reasoning/systemPrompt/modelSource/modelSettings | 上記経路で全項目の値を比較 |
| OpenRouter | routingのorder/only/ignore/sort/fallbacks/parameters/max_price/data_collection/zdr、promptCache、responseCache、stickySession。nodeのgeneration/token/cost/cache全10項目 | serializer/Google record経路で保持を比較 |
| Content | text、image_url、reasoning、tool_call、tool_result。Unicode/改行、画像detail、tool arguments。未知本文/画像拡張、未参照本文 | 実buildExportContentStore、Google content/asset record、decode |
| Node/folder | node全既知項目（観測/label/starred/pinned含む）、folder id/name/expanded/order/color、未知拡張 | inactive nodeを含む実export/record経路 |
| 評価 | 6設定、13カテゴリのflags/scores/thresholds、5品質軸/閾値、standard/system結果と全reasoning、提案、source/timestamp、localSafety/hint/context、未知拡張 | 全state比較とGoogle復元比較。評価APIを実行しない |
| その他設定 | provider10種、favorite/cache/custom model全代表項目、prompts、token統計、verified/pending統計、proxy、履歴、UI設定、clipboard | 実persist/record全state比較 |
| ローカルモデル | definition/displayMeta全代表項目、single/multi/sharded manifest、4task割当、favorite/executionMode、SavedModelMeta全代表項目 | JSON metadata保持のみ。モデルファイルやOPFSの実在・native推論は対象外 |
| 未知項目 | export/root/chat/tree/node/config/content/image/folder/provider/prompt/clipboard/evaluation/entryのxFixture拡張 | 保持と下記の観測上の喪失を区別 |

「全項目」は現型の代表fieldを含む意味であり、全enum値・任意JSON・全異常入力の網羅ではない。55rootはtest内へ独立した固定一覧を記す。期待データは手で設定したcorpusの値と明記した変換（messages省略、参照数再計算等）から構成する。製品関数で期待出力を自動生成し、その関数自身へ照合する検証にはしない。

## Webの実経路と観測差分

`src/utils/ioCorpus.contract.test.ts`が実validateExportV3、createPartializedState、buildExportContentStore、prepareChatForExportを呼ぶ。normalization/importサービスの接続は[読取契約](web-native-exchange-read-contract.md)の別fixtureを参照する。UIのExportChatが組み立てるwrapperとdownload操作は今回直接実行していない。

- createPartializedStateは55rootを保持する。実hydrateから入った未知rootはprivate Symbolの付随データとしてruntimeと分離し、保存時に元rootへ戻す（後続修正済み）。branched chatのmessagesを省略するが、flat messagesと未知nested fieldは保持する。今回runtime node map/streamingの差替えがない入力で比較する。
- buildExportContentStoreは全本文・refCountとcontent entryの未知拡張を保持する。delta展開時は直下deltaだけを除去する（後続修正済み）。
- prepareChatForExportはinactive nodeと本文、tree・entryの未知拡張を保持する（後続修正済み）。参照数の再計算と未参照本文の省略、visible-onlyのnode/filterは既存仕様を維持する。flat chatはcloneのみでstoreは空になる。
- Google toRecords/fromRecordsは55rootと未知root/nested metadataをこのcorpusで保持する。一方branched messages・未参照contentStore entry・entryの未知拡張を省略し、contentHashをローカル形式へ戻してrefCountを再計算する。再計算後はsystem/rich/answerが1、inactiveがclipboard参照を含め2。元refCount=99と一致するとは主張しない。
- Google recordの順序を並べ替えてもrecordの値は同一だが、復元treeのnode列挙順と兄弟一覧順が変わる。corpusの兄弟はn-inactive→n-assistant、sort済recordからは逆順になる。record wireがnode順を明示していないことと、Web UIが列挙順を使うことの組合せを観測する。通常transportが必ず並べ替えるという主張ではない。
- 初回に観測したpinned孤立枝の復元拒否は修正済み。pinned=trueの欠損親IDを保持して復元し、unpinned欠損親・循環・本文/画像欠損は引き続き拒否する。pushではlocal/remoteのどちらにも元から存在しない孤立edgeを構造競合として止める。merge時も欠損親IDを保持し、両端の欠損親IDの衝突で循環が生じても無限ループせず既存の別会話コピーfallbackへ進む。

これらの省略・再構成が正常仕様として許容できるかは項目ごとに判断が必要であり、未知項目喪失や順序変化を新iOSへそのまま移植して完全互換としない。未知項目喪失・順序のtestは観測を固定しており、問題を解消したという意味ではない。pinned孤立枝は上記の修正・回帰検証を行った。

## Google暗号・record wire

`src/store/storage/google/syncWire.contract.test.ts`が実toRecords/fromRecords、encode/decode、createKeyEnvelope/unlockKey、encrypt/decryptへ接続する。Unicode/画像を含む4contentのcanonical SHA-256 IDとasset ID、version/order/一部record pathは固定期待値を使う。別形式の生snapshotと単純一致させず、全state metadataと各nodeの本文・参照意味を比較する。

暗号vectorはfake passphrase `FAKE TEST ONLY long passphrase`、dataset `fake-dataset`、salt hex `000102030405060708090a0b0c0d0e0f`、raw key hex `000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f`、IV hex `000102030405060708090a0b`。PBKDF2-SHA256 600000回・32byte、AES-256-GCM・128bit tag、UTF-8 additionalDataを使う。key envelopeのAADは`fake-dataset:key`、本文AADは`fake-dataset:commit:file-1`。ciphertextはIV12byte＋暗号本文＋tag16byte。確定wrappedKey/ciphertext hexはtest内定数を新native APIからも同条件で照合する。値はNodeのpbkdf2Sync/createCipherivで独立計算して固定し、test実行時に製品関数から生成しない。

test内のみ固定乱数を使ってenvelope生成と既知ciphertextを照合する。製品の乱数・nonceを固定する変更はない。誤dataset/AAD、改ざんtag、未対応iterationを拒否することも確認する。LZ-string Uint8Arrayの確定vectorは`{"fake":"日本語"}`→hex `378220660860d60a6205c2429e9a069cd07951202f90`。圧縮vectorはinstalled lz-stringから一度計算して固定した互換ベクトルであり、独立codec実装の証明ではない。

既存`google/sync.test.ts`も関連検証に含め、fake Drive/cache上の同期・競合・暗号の既存保証を維持する。実Driveのread/write、認証、変更feed、Worker/native codec、ネットワーク障害・端末またぎを今回実行したとは扱わない。

## CloudKit wire

同testは実lzStringToBase64/base64ToLzStringと実saveCloudKitRecordを呼び、fetchだけ合成Responseへ置換する。getCloudKitConfigを呼ばず、明示fake config/tokenを渡す。実クラウドへの書込みはない。

既存recordType=`WeaveletSnapshot`、recordName=`weavelet-default-snapshot`、payload BYTES、snapshotVersion/updatedAt INT64、deviceId STRING、update時recordChangeTagを固定期待値と比較する。payloadはJSON snapshot→lz-string compressのUTF-16 code units→raw UTF-16LE bytes→base64。既知code units `[D800,0000,00FF,4E2D,DFFF]`→`ANgAAP8ALU7/3w==`で孤立surrogateを含むbyte保持を確認し、corpus全体の逆変換も照合する。現helperはプラットフォームのUint16Array byte orderに依存し、testはlittle-endianの現Web環境を固定する。

Googleの暗号化record集合とCloudKitのsnapshot recordは別方式。旧iOSのrecord名/WVLT/zstdとの引継ぎ、CloudKit providerのhydrate/競合/last-write-wins、auth store、実クラウド通信は今回新規testの対象外。既存CloudKit unitを関連実行するが、これだけで新iOSのオンライン完全互換は完成しない。

## 検証と次の条件

2026-10-12、`vitest run src/utils/ioCorpus.contract.test.ts src/store/storage/google/syncWire.contract.test.ts src/utils/exchangeRead.contract.test.ts src/utils/import.test.ts src/utils/chatExport.test.ts src/utils/contentStore.test.ts src/store/persistence.test.ts src/store/storage/google/sync.test.ts src/store/storage/cloud/providers/cloudkit.test.ts`：9ファイル138件成功（今回追加13件）。`tsc --noEmit`成功。native corpusの読取・表示・無損失再exportは別担当であり、このWeb検証の結果に合算しない。独立監査も別担当。

次は既知の喪失/順序差の扱い、nativeのrecord実装と暗号・圧縮への接続、全未知項目保持、旧データ引継ぎと書込失敗時の元データ保持、オンライン競合の意味を確定する。未確認領域を非対応にする許可ではなく、完全互換を満たすまで残る範囲である。

## Nativeで追加した証拠

展開V3は順序付きJSONから表示モデルへ投影し、全sourceを保持して再書出しする。Catalystの実ファイル選択・保存経路で、合成V3の全値とobject項目順序の一致を親が照合した。55rootのsyncSnapshotはJSON codecの往復のみであり、nativeの同期・保存への適用を確認したものではない。

暗号はCryptoKit/CommonCrypto/Securityを使う独立実装を追加し、ここで固定したenvelopeと暗号文へbyte一致。誤鍵・AAD違い・改ざん・不正形式の拒否も含むCatalyst全13件成功。独立Astra Mediumで新規指摘なし。暗号とrecords・ネットワークへの接続は別の未完了段階。

## 後続段階の完了証拠

Webの孤立枝修正は独立Astra Mediumで、競合検出の緩和・merge時の親ID喪失・合成循環時の無限ループの計3指摘を修正し、最終再監査で新規なし。親の統合作業ツリーでsyncWire/sync/merge/branchSearch/ioCorpusの5ファイル76件と型検査が成功した。初回138件とは重複を含むため合算しない。

nativeの圧縮はWeb installedと同一のlz-string 1.5.0/MIT（min版4814byte）をshared/vendorに固定し、JavaScriptCoreから値引数で呼ぶ。CloudKit圧縮文字列の任意UTF-16 code unitはbyte列で橋渡しし、Swift Stringへ変換しない。日本語・絵文字・空文字・長文・コード風入力・全sync corpusの6固定vectorでGoogle BE/CloudKit LEのbyte一致と復元を確認。script hashも照合、licenseはbundleへ含める。圧縮は認証機構ではなく、全破損の検出は主張しない。

圧縮の独立Astra Mediumは新規なし。親の統合作業ツリーでCatalyst build/test全18件成功。この結果はI/O部品の互換証拠であり、nativeの保存・オンライン同期全体の完成ではない。

## Exportの未知拡張保持

全件/個別/表示枝のみのcallerを確認し、treeとentryの未知metadata保持を修正。delta＋未知nested metadata、入力不変・個別export clone独立性を含む関連7ファイル85件と型検査成功。独立Astra Mediumで新規なし。Google entry拡張と永続root未知項目は別経路であり、まだ未修正。

## V3取込の本文ID衝突

同hashに異なる本文・metadataがある場合、取込entryを別名へ退避し、取込nodeとdelta依存の参照を同じ対応で更新する。同一entryのみrefCountを加算する。既存entryを変更せず、own keyとして特殊名も処理する。別名候補は実在keyだけでなく既存/取込delta・chat・既存clipboardの参照名も予約し、欠損参照を新aliasが偶然解決しないようにした。この不足はAstra指摘を受けて修正し再監査で新規なし。

append/replace、別名の衝突、同一entry再利用、metadata差、逆順delta chain、特殊key、既存参照不変、欠損参照名の予約を実import serviceで検証。既存の不正delta許容と読取失敗境界はこの変更では直していない。JSON property順差は安全側で別entryへ分ける。親の統合作業ツリーで最終import service 25件成功。

## Native Google record / packet

`SyncRecords`はsnapshotとrecord/assetの変換を実装し、CryptoKit SHA256と固定JSCのJSON数値・UTF16整列・DMPを組み合わせる。固定DMPはWeb installed 1.0.5と同一ソースからbundleし、出所/hashとApache-2.0 licenseを含む。可変入力はJSCへ値として渡す。

共通`record-wire.json`は実Web codec由来の5case（全corpus564records、pinned孤立枝、delta、正規等価Unicode/整数ID、empty）と4packet（snapshot/records/commit風/数値・slash・Unicode・整数key）を保持。SwiftとWebの両テストが同じ固定fixtureへ接続する。全record値・復元snapshot・canonical hash、外部packetの圧縮byte/SHA256一致を検証した。公開`encodeWire/decodeWire`はWeb同様のJSON.stringifyを経由し、内部ASTの保存表現を強制しない。暗号・LZとの結合往復もこの入口を使う。

Astraの不正rootId受入指摘を型・参照検査と回帰testで修正、再監査は新規なし。親の統合作業ツリーでCatalyst全26件成功。UI・永続保存・networkはまだ未接続。record到着順による兄弟順変化、entry未知拡張・未参照本文の省略は既存Webと同じ観測であり、解消済みとは扱わない。

親の最終Web検証は共通record/packet9件を含む6ファイル66件と、更新後import service 25件の計7ファイル91件。型検査・差分確認も成功。最初に実行した旧import 11件は25件へ置き換えて数え、重複加算しない。

## Nativeの隔離保存と再起動

取込V3 JSONのsourceと閲覧状態をbundle専用Application Supportへ原子的に保存する。内部envelopeはWeb形式から独立し、sourceをJSON文字列として保持して外部parserの深度上限へwrapper分を加算しない。保存失敗時はmemory/diskを保持し、破損loadはエラー表示・元ファイル非上書き。sampleのみでは書き込まない。

担当worktreeでCatalyst全33件成功、親の統合5ファイルは検証済み版とbyte一致。Astraの深度境界指摘を修正・再監査で新規なし。親が合成V3の取込、分岐1/2・吹き出し・別会話への切替、終了・再起動を実操作し、選択会話と表示方式、前の会話の分岐が復元されることを確認。実保存sourceの全JSON値とobject順序は取込元に一致した。これは取込V3＋閲覧状態の保存証拠であり、同期state全体・旧データ移行・大容量性能の証明ではない。

## Google recordの明示node順序

Webの新writeはwire専用の`nodeOrder.chats[chatId]`・`nodeOrder.clipboard`配列を追加する。アプリstate/tree内の同名未知属性とは別領域。readは指定された現存IDの順序を復元し、未記載IDをUTF16順で追加、削除済みIDは無視する。整数index keyはJavaScriptの列挙仕様を維持する。metadataがない旧recordは従来の到着順で読める。

独立追加が補助orderだけで新たな競合にならないよう、applyChanges・merge・replayでorder配列を合成する。通常fieldの競合条件は維持する。chatコピーの新IDとbranch remap後にも順序を伝搬。Astra Mediumで新規なし、親の関連6ファイル110件・型検査成功。実クラウド通信は未検証。

共通`record-wire.json`のfixtureVersion 2は、新形式5caseに加え元の5caseをlegacyCasesとして保持し、圧縮packetも旧4件に新record集合1件を追加した。新orderの期待値は入力のObject.keysから固定し、元の復元期待は変更していない。Webとnativeの双方でrecord列を反転しても同じnode順に戻ることを確認済み。nativeはCatalyst全36件成功、独立Astra Mediumも新規なし。親の統合source/test/fixtureは検証済みworktreeと一致する。

旧readerは追加orderを利用しない。旧writerが再serializeすると追加metadataは落ちるため、旧クライアント混在時まで順序保持を保証したものではない。旧データの読取互換と、更新済みWeb/native間の順序保持を分けて扱う。

## Web未知persist rootの保持

local merge、同期hydrate、Worker処理、import復元で未知rootをprivate Symbolに分離し、full/local保存時に元の名前へ戻す。setChats等のruntimeと同名の未知保存値も内部関数とは別に保持する。runtime全fieldを保存する方式は採らず、実行中だけのtoken/cacheは混入しない。setStateのobject/callback全置換でも付随データを保持し、partialize cacheの更新条件へ含める。

担当worktreeで関連5ファイル64件・型検査成功、独立Astraは新規なし。親の統合後は会話管理の実setChatsも用いて、2機能の接点を限定検証した。部分hydrateでは未知rootを合併し、省略を削除として扱わない。prototype予約名はlocal保存では保持するが、Google同期の既存unsafe-key検査は弱めず明示拒否する。実クラウド通信・実ユーザーデータでの確認は行っていない。

## 本文編集のmessage属性保持（後続修正済み）

初期調査では、flatのtree化とbranchのmessages再投影によりmessage要素直下の未知属性や、数値indexのomitted/collapsed/protected mapを失う経路があった。現在は`src/utils/branchUtils.ts`の`readMessageAttributes`/`setMessageAttributes`/`copyMessageAttributes`/`deleteMessageAttributes`と`messageAttributesV1`でnode本体と分離して保持し、materialize/flat-tree変換へ接続している。flat mapは生成node IDへ移し、既存tree IDを数値indexとして解釈し直さない。

Web/nativeは共有編集処理を利用する。属性衝突、inactive branch、本文編集、record/交換・保存への接続と限定再確認はledgerの「メッセージ属性と同期serviceの接続中」「共有編集・文書保存・会話管理の接続」および後続記録を参照する。これは修正済み範囲の証拠であり、全旧クライアントの書戻しや実クラウドまで保証するものではない。

## Google content entry拡張の受入

Web/nativeのwriterにwire専用`contentEntryFormat:1`、`contentEntries`、`contentEntryRefs`、`retainedContentEntries`を追加した。entry identityは本文IDと未知metadataの組合せで、同じ本文でもmetadataが異なれば別entryになる。content/refCount/deltaは内部表現として再構成し、deltaは厳密展開する。snapshot中の全entryを送るが、復元はnode/clipboard参照とretained集合だけを対象とする。明示GC後に古いimmutable recordがwireへ残っても復活させない。

Webはmerge・chatコピー・clipboard競合で本文とmetadataを一組として選択する。実push/fresh replay・後続commitもfake Driveで検証。関連8ファイル152件・型検査成功。nativeは共通`content-entry-wire.json`の固定追加recordと意味を比較し、Catalyst関連16件成功。テスト済みsourceは親へbyte一致で統合。独立AstraのWeb/native合同監査は新規指摘なしで、この機能範囲を受入。

旧recordの読み取りは継続する。旧writerは新拡張を保持できず、旧版混在時の保持保証は未達。壊れた未参照deltaも送信対象となるため同期を明示停止する。既存local GCを変更して未知metadataを永久保持する方式は採っていない。provider接続は後続で実装・隔離検証済み。実クラウド通信と全アプリ互換性の最終確認は未完了。
