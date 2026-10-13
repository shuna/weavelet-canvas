# iOS再構築アプリ

既存Webの業務処理を共有bundleから利用し、通信・認証・暗号・保存・UIはApple APIへ接続する再構築アプリ。別bundle ID `com.weavelet.nativepilot` と専用Application Supportを使用し、旧`ios2`のコード／Swift Package依存を取り込まない。

現在の機能と完了証拠、未確認範囲は[completion ledger](../docs/development/plans/app/web-native-completion-ledger.md)を正本とする。会話・枝編集、ファイルI/O、Google同期、remote/local生成、モデル設定、添付と本文描画は各共有Web入口へ接続している。以下のpilot対象と段階ごとの「未対応」は開発履歴であり、現在の機能一覧ではない。

実配布依存はGoogleSync bundleのnpm処理、WKWebView描画のReact/remark/rehype/KaTeX、lz-string、Catalyst arm64の固定llama.cpp/wllama samplerとApple frameworks。node_modules全体、旧ios2のSDK、Web WASMをnative appへ持ち込まない。同期bundle内license、MarkdownResources/NOTICE、LZ/DMP license、LocalLlama-Licensesを同梱する。DMPはGoogle公式repoがarchive済みの固定互換依存であり、全依存の保守継続・脆弱性不存在は保証しない。 KaTeXは未信頼数式の展開に到達する既知advisoryの修正版0.18.2へ、lodashは4.18.1（4.18.0はnpmでBad releaseとしてdeprecated）、@babel/runtimeは7.26.10へ限定固定する。後二者の脆弱機能は現共有入口では未使用だが、配布する既知脆弱版を除くため更新した。

## 対象

- 同じ会話状態による整列表示／ユーザー右・アシスタント左の吹き出し表示。取込後の表示設定・選択会話・会話別の閲覧分岐を保存・復元する。
- role明示、時刻なし、本文とアイコンの左端整列、長文の折返し。
- 任意深度の兄弟選択、共有Web規則による後続path選択、検索到達、戻る/進む。
- リポジトリの`tests/fixtures/web-native/branch-siblings.json`のshared 8ケースを、WebとSwiftから同じファイルで検証。fixtureのWeb観測ケースはSwiftへ強制しない。

- 展開V3 JSONのファイル取込み・再書出し。順序付きJSONを交換用に保持し、表示用モデルは別に構成する。未知項目・非表示分岐・未参照本文を保持する。
- text/image_url/reasoning/tool_call/tool_resultの表示用投影。画像は現段階ではURLの文字表示のみ。

## Catalystでの検証

リポジトリルートから実行する。シミュレータは不要。

```sh
xcodebuild -project ios-rebuild/WeaveletPilot.xcodeproj \
  -scheme WeaveletPilot \
  -destination 'platform=macOS,variant=Mac Catalyst' \
  -derivedDataPath /private/tmp/weavelet-native-pilot-derived \
  CODE_SIGNING_ALLOWED=NO test
```

アプリは`/private/tmp/weavelet-native-pilot-derived/Build/Products/Debug-maccatalyst/WeaveletPilot.app`。fixtureを実ファイルから読むテストなので、リポジトリ全体を保持した状態で実行する。

## 互換性の制約

内部表現やローカル保存はCore Data等で最適化可能。現在は交換データを`OrderedJSON`で保持し、`WebExchange`から表示用モデルを取り出す。これは内部DB形式をWebへ合わせる要求ではない。読み込み失敗時は現在の会話を変更しない。

OpenAI互換remote送信は実装済み。Google同期serviceは接続済みだが、アプリ全state・認証・同期UIへの接続は未完了。添付取得、他provider、旧Web形式・旧iOS移行は未対応。delta本文は共有resolverで表示用に展開し、保存元のdeltaを保持する。分岐選択は共有Web処理でactivePathとmessagesを更新し、保存・再書出しへ反映する。parserは重複key、深さ256超、孤立surrogateを拒否する。これらは全体完成までに扱いを確定する制約。

Catalystの結果はiPhone/iPad実機、Dynamic Type、VoiceOver、IME、キーボード表示中の検証を代替しない。

## 2026-10-12の検証結果

Xcode 27.0のMac CatalystでビルドとXCTest 26件が成功（同一JSONのshared 8caseを含む）。親が実起動し、整列／吹き出しの表示、長いURLの折返し、A→B→Aの分岐操作、表示切替後の選択保持、端のボタン無効を確認した。本文全文を並べたMenuが横へ伸びる問題は、前／次と位置表示へ変更して解消した。

独立Astra Mediumは限定pilotを静的監査し新規指摘なし。追加のV3 I/O・toolbar変更も独立Astra Mediumで新規指摘なし。親が合成corpusをファイルから取り込み、5種本文と分岐位置を確認、別ファイルへ再書出し後に全JSON値・全object項目順序の一致を確認した。取込み後の吹き出し切替と表示設定・ファイル両ボタンの表示も確認。検証入力は合成値のみ。狭幅、Dynamic Type、VoiceOver、キーボード、iPhone/iPad実機、実オンライン同期は未検証。

## Google同期の暗号互換

`SyncCrypto`はCryptoKitのAES-256-GCM、CommonCryptoのPBKDF2-HMAC-SHA256、Securityの乱数を使う。Webと同じ固定fake vectorへenvelope・暗号文のbyte一致を確認し、誤鍵/AAD/改ざん/形式不正を拒否する。追加4件を含むCatalyst全13件成功、独立Astra Mediumで新規指摘なし。内部鍵はnativeのSymmetricKeyであり、Webの内部型は共有しない。暗号処理単体の証拠であり、LZ圧縮・records・クラウド同期への接続は未完了。

## 共通圧縮コード

`SyncCompression`はWebと同一の固定lz-string 1.5.0/MITをJavaScriptCoreから呼ぶ。アプリはnode_modulesなしでビルド可能。6固定vectorでGoogle BEとCloudKit UTF16LEのbyte一致を確認、孤立surrogateを含む圧縮結果はbyte列のまま渡す。固定scriptのみを評価し、入力をコードへ埋め込まない。sourceとlicenseはshared/vendorに記録し、licenseもbundleへ含める。

親の統合作業ツリーでCatalyst全18件成功（I/O6・兄弟等3・暗号4・圧縮5）。独立Astra Mediumは新規指摘なし。現段階は操作ごとにJSC contextを生成する小さい構成。実同期の頻度・データ量で性能を測定する段階は未完了であり、共有方式全体の性能優位を主張しない。

## Google recordとパケットの境界

`SyncRecords`でsnapshot/record/assetの双方向変換と外部packetのencode/decodeを実装。全55rootを含む実Web由来5caseと4packetを、Web・Swiftの共通fixtureで比較する。数値表記・Unicode・整数key列挙・SHA256・delta・参照整合を検証し、暗号/LZにも接続。DMP 1.0.5固定ソースはWebと共通で、licenseと出所を記録する。

統合後Catalyst全26件成功、独立Astra MediumのrootId指摘修正後は新規なし。これらはcodecの機能であり、UI・保存・オンライン通信へは未接続。Webに残るrecord到着順依存とentry未知項目喪失も別途修正が必要。

## 隔離ローカル保存

`LocalStateStore`は`Application Support/com.weavelet.nativepilot/local-state.json`へ原子的に書き込む。内部envelopeに元V3 JSON文字列・表示方式・選択会話・会話別閲覧pathを保持し、保存成功後だけ画面状態を更新する。サンプルのみの操作は保存しない。破損loadはエラーを表示し、元ファイルを自動上書きしない。

Catalyst全33件成功。独立Astra Mediumで見つかった深度256のV3をenvelopeで包む復元不成立は、sourceを独立JSON文字列にして修正、境界testと再監査で受入。親が実ファイル取込→別分岐→吹き出し→別会話→終了→再起動を操作し、選択会話・表示方式・前の会話の閲覧分岐を確認した。実保存sourceの全JSON値とobject順序も合成入力に一致。旧iOS保存・同期state全体の永続化や大容量データ性能は未検証。

## Google recordのnode順序保持

wire専用nodeOrderをWebと共通に追加し、record到着順から独立してchat/clipboardのnode順を復元する。旧5caseの読取を残し、新5case・到着順反転・5packetを共通fixtureで比較。整数key列挙、UTF8でのID識別、未記載IDのUTF16順、削除ID無視、異常metadataとアプリ内同名属性の分離も検証。Catalyst全36件成功、独立Astraで新規なし。旧クライアントが追加metadataを落とす制約と、content entry metadata喪失は未解消。

## 会話ライブラリ

会話一覧から新規・改名・複製・複数削除を操作できる。Webと同じ8caseのV3期待結果を使用し、原子的保存後に状態を公開する。全41テスト成功後、保存失敗からの復帰を追加1テストで確認した。独立Astra監査と修正確認は新規指摘なし。検証済みsourceを親作業ツリーへbyte一致で統合。

Catalyst実操作で新規→改名→複製→書出し→追加会話の複数削除→再起動を確認。元の合成V3は全値・object順序を保持し、会話・表示方式・閲覧分岐も復元した。フォルダ、探索、本文編集、生成、オンライン同期providerは未実装。

## 本文編集と同期entry拡張

保存済み会話の本文編集・role変更・上書き・明示分岐・末尾追加を操作できる。保存失敗は下書きと旧sourceを保持し、取消は下書きを破棄する。共通15case、Catalyst全47件とconfig省略の修正後関連6件、独立Astraで受入。実UIで分岐・上書き・取消・再起動復元を確認した。一般挿入/prune/Undo/生成/新添付取得は未実装。

Google同期codecのcontentEntryFormat:1をWebと共通fixtureで照合し、同本文別metadataと参照を保持する。旧records読取、厳密delta、明示GC後の非復活を含む関連16件、独立Astraで受入。providerネットワーク接続・旧writerとの混在保持は未完了。

## 2026-10-13の統合

OpenAI互換remoteのstream/nonstream・Stop・部分保存・遅延結果拒否と、未知message属性の編集/分岐/export/同期保持を統合した。Catalyst実操作では隔離したFAKE応答でStop→再起動復元と正常完了→V3書出しを確認した。鍵と通信はnative APIを使い、message属性を生成APIへ送らない。

Google同期のWeb実protocolは `shared/google-sync/GoogleSync.bundle.js` をJavaScriptCoreで共有し、通信・CryptoKit暗号・保存をnativeへ接続する。変更後は `node shared/google-sync/generate.mjs` で生成し、`node shared/google-sync/generate.mjs --check` でWeb原本・adapter・生成script・依存版・bundleの鮮度を確認する。生成済みsource snapshotは手編集しない。

同期service関連11件、Web実コードとのmultipart/pack/属性packetの相互確認、独立Astraの修正確認が成功。親の統合接点22件も確認した（messageのJSON key順依存を除いた2件のみ再実行）。本番OAuth・同期UI・実クラウド・実機性能は未確認。最新の完成範囲は[完成条件と証拠](../docs/development/plans/app/web-native-completion-ledger.md)を参照する。

## 共有文書・編集・会話管理の接続

2026-10-13、実Webのbranch-domain/branchUtils/chatLibraryをnativeへ接続した。保存v2はfull snapshotとV3 sidecarを保持し、旧保存v1も読める。UIの書出しは共有文書投影を使う。本文差分の展開と原delta保持、未知属性・大数値、深さ256、保存失敗時の元状態保持、編集後の再起動を確認した。初期設定と更新時刻の規則もWeb由来となった。検証件数・修正後の限定再実行・独立監査は[完成条件と証拠](../docs/development/plans/app/web-native-completion-ledger.md)に記録する。同期の認証/UIと実オンライン相互運用は引き続き未完了。
