# iOS再構築アプリ

既存Webの業務処理を共有bundleから利用し、通信・認証・暗号・保存・UIはApple APIへ接続する再構築アプリ。別bundle ID `com.weavelet.nativepilot` と専用Application Supportを使用し、旧`ios2`のコード／Swift Package依存を取り込まない。

現在の計画・未実装/未検証の区別は[ロードマップ](../docs/development/plans/app/web-native-commonality-roadmap.md)、機能ごとの完了証拠と失敗/再確認の記録は[completion ledger](../docs/development/plans/app/web-native-completion-ledger.md)を正本とする。会話・枝編集、ファイルI/O、Google同期、remote/local生成、モデル設定、添付と本文描画は各共有Web入口へ接続している。以下のpilot対象と段階ごとの「未対応」は開発履歴であり、現在の機能一覧ではない。

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
## 2026-10-15：機能未接続のiPhone UIモック

Debug起動引数 `--ui-mockup` で `IOSLayoutMockupView` を表示する。Catalystでも最大393×852ptのiPhone向け領域で確認できる。通常起動とReleaseは既存アプリを表示する。

チャット／分岐図はアイコンのみ。合成会話、本文内編集の開始・取消・メモリ内保存、モデルの仮選択、node選択、入力欄と未接続操作の説明を扱う。ChatState・実保存・Keychain・生成・同期へは接続しない。編集はアプリ終了で消える。

Catalystビルドと実画面でタブ切替、本文編集→保存、送信の未接続説明、393ptでの表示を確認。独立AstraのP2（状態所有者をwindow内へ移すことで通常アプリの複数窓が別stateになる問題）はAppスコープの遅延状態保持へ修正し、限定再監査は新規なし。最終buildログ `/private/tmp/weavelet-ui-mockup-final-build.log`。全業務/同期テストの反復は行わず、iPhone/Simulatorは使わない。最大文字サイズ・IME/画面キーボードは未確認。

ローカルの起動用成果物は `/private/tmp/weavelet-ui-mockup-20261015/OpenUIMockup.command`。必ずこの起動引数付き入口を使う（同フォルダーのappを直接起動すると通常ルートになる）。

### iPhone Airへのモック導入（2026-10-16、ユーザー明示指示）

署名Debugビルド・署名検証・インストール・起動が成功し、PID25538を確認。表示名は `Weavelet Mock`、既存bundle IDの更新として導入した。ホームから開き直してもモックになるよう、このビルドだけ `WEAVELET_LAUNCH_MODE=ui-mockup` をInfo.plistへ展開する。完成appの値も照合済み。通常ビルド/Releaseの選択条件は限定Astra再確認で新規なし。

最初の任意INFOPLIST_KEY指定では独自keyが出力されなかったため、Info.plistの明示key＋build変数へ修正し、再署名ビルド・再インストール後に引数なしで起動した。成功判定は最終版に限る。ログ `/private/tmp/weavelet-air-ui-mockup-{final-build,final-install,launch,processes}.log`。実データの読込/保存や同期へ接続しない。画面の目視確認はユーザーへ委ね、実機機能テストは実施していない。以後の通常確認は引き続きCatalyst。

### 標準ナビゲーションバーへの置換（2026-10-16）

モック上部の独自HStackをNavigationStack・inline navigationTitle・標準toolbarへ変更。左に一覧/アプリ内履歴、右に検索/新規を置き、モデルとアイコンのみのchat/branchは直下の操作帯に維持する。標準toolbarへplain button styleを継承させない。Catalyst build、393ptの実画面、検索開閉、限定Astra確認は新規なし。幅制約により標準barの会話名は末尾省略されることを実表示で確認した。ログ `/private/tmp/weavelet-ui-mockup-native-bars-build.log`。iPhoneへの今回版の再導入は行っていない。

Catalystの検証cloneもWeaveletLaunchMode=ui-mockupへ更新したため、現在のcloneは直接起動でもmockになる。起動用commandも従来どおり利用可能。機能未接続と通常アプリの保存経路は変更していない。

続くユーザー指示で標準バー版もiPhone Airへ署名ビルド・インストール・引数なし起動が成功（PID25674）。完成Infoのmock指定/表示名と署名も確認。ログ `/private/tmp/weavelet-air-native-bars-{build,install,launch,processes}.log`。実画面の目視はユーザー確認用とし、機能接続や追加の実機テストは行っていない。

### キーボードと会話末尾入力（2026-10-16）

標準keyboard toolbarに添付/プロンプトの未接続入口とキーボードを閉じる操作を追加。FocusStateで本文編集・composer・検索を区別し、本文編集開始時はフォーカスと対象へのスクロール、保存/取消・タブ切替時はフォーカス解除を行う。通常のkeyboard safe areaを維持し、スクロールでの対話的な閉じ方を使う。入力フッターは固定safeAreaInsetから会話末尾へ移動し、移動ボタンも本文内に置いて重なりを避けた。

Catalyst build成功（`/private/tmp/weavelet-ui-mockup-keyboard-build.log`）、実画面で末尾配置、入力、本文編集へのfocus移動・取消後のcomposer下書き保持を確認。初回pasteは入力されず、focusを再取得したtypeTextで成功。独立Astraの限定確認は新規なし。ソフトキーボードのtoolbar実表示、アニメーション中の押上げ・IMEはCatalystの確認から推定せず未確認。iPhoneへの今回版の再導入・Simulator実行は行っていない。

続く明示指示でキーボード対応版をiPhone Airへ署名ビルド・インストール・引数なし起動し、PID25894を確認。完成appのmock指定・署名も確認した。ログ `/private/tmp/weavelet-air-keyboard-mock-{build,install,launch,processes}.log`。キーボードの実画面操作確認は未実施。

### 編集欄の整列と操作領域（2026-10-16）

画像の独立レビューを受け、編集欄の固定最低200ptを撤去。標準の複数行TextFieldを1–10行で伸縮させ、閲覧時と同じbody/行間4/余白12へ合わせた。外枠とavatarの左端は維持。原文Menuの最低幅と、取消/分岐保存/保存の各labelに独立した44pt操作領域を指定した。draft、保存/取消、FocusState、keyboard toolbarは維持する。

Catalyst build成功（`/private/tmp/weavelet-ui-mockup-edit-alignment-build.log`）、編集の初期表示で下余白縮小、Return改行・保存後の本文保持を確認。短文への自動置換は選択操作が成立せず、AX setValueはBindingへ反映されなかったため短文時の実測成功とは扱わない。独立Astraの限定確認は新規なし。確認後にmockを再起動し合成データを初期化。IME・10行超の内部scroll・実機の寸法は未確認。iPhoneへの今回版の導入は行っていない。

続く明示指示で整列修正版もiPhone Airへ署名ビルド・インストール・引数なし起動が成功（PID25935）。完成Infoのmock指定・表示名と署名を確認、install先と起動processの一致も確認した。ログ `/private/tmp/weavelet-air-edit-alignment-{build,install,launch,processes}.log`。実機画面の目視・IME確認は未実施。

### 承認済み配置への既存機能接続（2026-10-16）

モックへ業務処理を複製せず、本番ChatViewを承認済み配置へ合わせた。標準bar、モデル選択、アイコンのみのchat/branch切替、本文内編集、会話末尾composerを既存ChatState・共有Web処理へ接続。詳細sheetや既存の評価・保護・文脈除外・分岐操作のhandlerを維持した。本文編集のdraftは親で保持し、会話移動や表示対象変更で失わず、元会話以外では保存しない。保存失敗時も保持する。通常起動は本番、Debugの `--ui-connected-preview` は本番画面を393×852ptで表示する。

Catalyst境界4件と入力3件が別runで成功し、最終build成功。隔離FAKE画面で本文編集→会話移動→復帰→保存→再起動、chat/branch切替、モデル選択入口、生成中→完了を確認した。共有仕様や保存形式・依存追加は変更していない。独立Astraの表示filter変更時にdraftが見えなくなるP2を回復欄で解消し、限定再監査は新規なし。証拠と未確認事項は[完成条件と証拠](../docs/development/plans/app/web-native-completion-ledger.md)を参照。今回iPhone更新は行っていない。

### 現在の検証端末（2026-10-17の後続指示）

ユーザーの指示により、しばらくiPhone Airの接続照会・ビルド先としての確認・インストールは行わない。通常検証はCatalystとし、Air確認は再開指示を受けてから戻す。以下のLAN接続時導入は以前の運用記録である。

### LAN接続時のAir導入と補助操作の接続（2026-10-17）

以後はユーザー指示により、通常検証はCatalystを維持し、iPhone AirがLAN接続されていれば検証・監査済みの変更をインストールする。従来の「実機更新は個別指示時のみ」をこの運用へ変更する。今回、前段接続版の署名build/install/通常launchが成功し、transport=localNetwork、PID27714を確認した。mock指定ではなく本番ChatViewを起動する。

続いて、承認済み配置の「最初へ／入力欄へ」、表示Menuの吹き出し切替、keyboard toolbarの画像・プロンプト入口を既存handlerへ接続した。keyboard補助はinline draft中は出さず、focus解除だけで画像pickerの所有Viewを破棄しない。共有業務処理・保存形式・依存は変更していない。Catalyst隔離実画面で上下移動、吹き出し往復、prompt picker開閉を確認し、独立Astraは新規なし。実keyboard上でのpicker継続・復帰とIMEは未確認。
