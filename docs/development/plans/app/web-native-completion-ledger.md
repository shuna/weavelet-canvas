# Web / 新iOSの完成条件と証拠

## 検索・任意分岐への到達・履歴の接続（2026-10-13追記）

Webの会話/祖先フォルダ名フィルタ、全文grep、branch本文/label/star検索を実callerから共有し、native検索画面へ接続した。空白の扱い、scope、DFS/activePath順序、flat会話の到達先は既存Webに従う。旧native保存に表示専用pathが残っている場合は現在の表示pathを一時入力に渡す。検索自体は保存元を変更しない。

任意深度の兄弟切替と検索到達は既存buildPathToLeaf/switchActivePathStateを使用し、activePathとmessagesを文書へ保存する。以前の「表示だけ変更しexportは旧path」のpilot仕様を置き換えた。テスト期待値はこの2項目だけを明示的に変更し、他の全raw項目の一致を維持した。履歴のentry/遷移/欠損chatのスキップも実Webnavigation-sliceから抽出して共用。生成中・未保存生成がある間は移動を拒否し、保存失敗時は文書・選択・focus・履歴を保持する。

独立Astraの2指摘は修正済み。新規/複製などによる選択変更も保存成功時に共有履歴へ反映する。兄弟候補は共有JSで親ごとに一度生成し、1000nodeの返却member数が1000であることを確認した。修正確認は新規指摘なし。

検証: 統合Web22件と型検査成功、候補修正の関連Web25件、表示path補正の検索8件成功（重複を含む）。Catalyst初回全133件、監査修正後の関連29件成功。bundle鮮度・差分検査成功。Catalyst実操作で検索sheet→非表示分岐の本文検索→到達→戻る→進むを確認。ログは `/private/tmp/weavelet-search-navigation-{web,types,catalyst,web-final,catalyst-final}.log`。履歴はセッション内、復元focusはnode単位でありスクロールのpixel anchorやWeb全view切替までは未接続。狭幅/実機/VoiceOverは未検証。

同時に実施した限定再監査で、生成要求のpath→本文投影と編集draftの最初のtext置換にSwift重複が残っていることを確認した。次の限定修正は既存WebmaterializeActivePathと編集text helperの共有であり、新しい実装方式や全面設計変更を追加しない。

## Google認証・手動同期・保存復旧の接続（2026-10-13追記）

GoogleAuthenticationはOSの認証画面、PKCE/state、URLSession、Keychainで認証し、DriveTransportへtoken(force:)を渡す。iOS OAuth client設定はビルドから注入し、未設定時は認証を無効にする。旧ios2のdrive.appdataは利用せず、Webと同じdrive.fileの同期先を扱う。フォルダ一覧条件・命名はWeb実callerの純粋関数から共有する。[設定方法と既存Web同期先へのアクセス制約](native-google-auth-configuration.md)を参照。

設定画面から接続、同期先選択、新規作成、鍵復元、手動同期/受信、競合解決、保存復旧、切断へ接続した。既存Web同期engineを呼び、受信結果をjournalへ保存してからアプリ保存、baseline確定を行う。中断後に元入力と現在の保存内容が違えば自動で上書きせず、明示的な解決を要求する。fresh起動のサンプルは送信せず、破損読込と未保存生成も保全する。正常な手動V3 importで保存を復旧した場合のみ読込失敗状態を解除する。

独立Astraの指摘2件（受信前中断後の編集上書き、会話追加/並替え時の未知数値丸め）を修正した。差分適用はchat IDと元raw値への参照を使い、JSで同値になる異なる大数値もIDに追従する。remoteで意味が変わった属性は受け入れ、削除済みchatを復活させない。修正確認は残件なし。手動UIで見つけた初回空sheetはitemによる画面引渡しへ修正した。

過去の判定表にあるGoogle認証/UI未接続という記述は本追記で更新する。実OAuth登録・既存Web同期先の権限・実オンライン相互運用は未確認であり、全体完成とはしない。

検証: Web一覧/命名23件、文書18件、型検査、bundle鮮度検査が成功。Catalyst初回はcompileのtry不足を修正後、119件すべて成功した。監査修正後の関連25件はcoordinator9件・session8件が成功、文書の追加2件だけfixtureのJSON閉じ括弧不足で失敗。fixture構文を直し、期待値を変えず文書8件が成功した。現在の122件はこれらの結果で検証済みであり、最終ソースの全122件を単一runしたものではない。ログは `/private/tmp/weavelet-google-connection-{transport,document-final,types-final,catalyst,catalyst-final,catalyst-document}.log`。修正後のCatalyst実画面で初回の設定→Google同期、未設定の説明と認証/作成ボタン無効を確認。実アカウント・実クラウド・実機は未確認、GitHubへの書込みは行っていない。

2026-10-12。最終目標は現行Webの機能を新iOSでも再現し、環境別に最適化しつつ共通仕様・必要な共通コードを持ち、全データのI/Oとオンライン同期結果の完全互換を検証すること。部分的な試作やテスト成功でこの目標を置き換えない。[段階計画](web-native-commonality-roadmap.md)と[機能対応表](web-native-stage1-map.md)を正本として、以下は完成判定に使う証拠の一覧。

## 現在の判定

2026-10-13 方針修正：以下の既受入は動作と互換性の証拠であり、重複したSwift規則の共有化完了を意味しない。既存Webの直接利用、環境非依存部分の切出し、具体的理由のあるnative実装の順で配置を決める。[限定した計画差分](web-native-commonality-roadmap.md#2026-10-13実装配置の限定修正)に従い、まずrecord変換とフォルダを共有元へ接続し、全state投影・編集/属性・生成要求へ順に進む。作業中のSwift案と未コミット成果は保全する。

全体は未完了。前段階は進捗あり（契約・fixture・Catalyst実装と実行証拠を追加）。展開V3の無損失読取・書出しとWeb同期wireの合成検証を追加した。内部型やDB方式の一致は要求せず、外部I/Oで情報・参照・順序・意味が保持されることを要求する。

| 完成対象 | 完成を示す証拠 | 現在 |
| --- | --- | --- |
| A 会話ライブラリ | 新規・改名・複製・削除・複数操作のWeb/native共通fixtureとCatalyst操作 | 共通8case、Web関連54件、Catalyst全41件＋修正回帰1件、独立Astra受入。実UIで作成・改名・複製・書出し・複数削除・再起動を確認 |
| A フォルダと所属 | 属性・削除時所属解除・複数移動の共有処理とUI | Web共有utility/native接続を実装。Web33・Catalyst29成功、独立Astra新規なしで受入。手動UI未確認 |
| A 探索・到達・履歴 | タイトル/本文/label/starのscope・順序・戻る/進むを実データで確認 | 上記共有処理/native接続・保存再読込み・実UIを確認。pixel scroll anchorと全view切替は未接続 |
| B 木と本文編集 | role・system prompt・挿入/編集/明示分岐/prune/順序・undoの共通fixtureとUI | 上書き・role・明示分岐・末尾追加を共通15caseとCatalyst実UIで確認。一般挿入/prune/undoは未実装 |
| B 分岐閲覧 | 任意nodeの切替と後続path、端の停止・履歴・表示保持 | 任意深度の兄弟切替と共有後続path・保存・履歴をCatalystで検証 |
| B 移動・属性 | clipboard/copy/cut/paste/会話間移動、label/star/pin/除外/保護の共通結果 | 未実装 |
| B 表示・draft・添付 | 5種content/Markdown/コード/表/画像、draft/IME、添付と編集位置保持 | V3の5種本文を投影表示、画像はURL文字表示。Markdown/画像描画・編集は未実装 |
| C 生成入力・provider | 設定優先順位、モデル能力、system/tool/image/reasoning、token budget/prefillの一致 | OpenAI互換remoteの共通request4件とnative設定・入力を接続。他provider/モデル能力/token budget等は未実装 |
| C 実行・取消・適用 | streaming/非stream/local、Stop、遅延結果拒否、usage/本文終端一回適用 | remote関連8件＋SSE修正関連3件成功（重複あり）、隔離CatalystでStop・再起動・正常完了・書出しを確認。独立Astra受入。local/usage等は未実装 |
| C 評価・命名 | safety/quality/local fallback/auto title、世代照合と各設定の一致 | 未実装 |
| C 復旧・背景 | 中断後再接続・既適用識別・部分本文保持をCatalystと必要な実機で確認 | 未実装 |
| D モデル資産 | 探索/取得/再開/import/検証/partial復元/容量不足/変換 | 未実装 |
| D 実行寿命・削除 | engine別load/share/owner/cancel/unload、利用者とwriter停止後削除 | 未実装 |
| E 全I/O項目 | 全persist rootとネスト項目、全交換版、未知項目、非表示枝の双方向fixtureと実読書き | 55rootとネスト代表項目のcorpus、Web関連138件、native全26件。CatalystでV3実ファイル往復の全値・順序一致。旧版/delta等は未完了 |
| E 内部保存・旧データ | 新native保存の再起動復元、旧iOS/Webデータ無損失取込、保存失敗時保持 | 取込V3と閲覧状態の隔離保存を実装。Catalyst全33件、実UI再起動で選択会話・表示方式・分岐復元を確認。旧データ移行・同期state全体は未完了 |
| E Google同期 | Web/native相互の暗号envelope・record/asset/commit/pack、競合・中断・誤鍵・再試行の結果一致 | native serviceとWeb実protocol共有bundleを統合。隔離11件、Web実コードとのmultipart/pack/属性packet相互確認、Astra受入。OAuth・アプリ全state/UI・実オンライン相互は未完了 |
| E CloudKit同期 | record/field/圧縮とchangeTag競合、Web/native相互読書き、失敗時保持 | Web実payload/record wrapperを合成検証。native圧縮wireの固定vector一致、provider接続未実装、旧iOS形式は不一致 |
| UI 全体 | UI対応表M1–M6、N1–N5、S1–S6の各受入をnative操作で確認 | 表示style切替・role・時刻なし・整列・leaf分岐のみ |
| UI アクセシビリティ等 | 狭幅/Dynamic Type/VoiceOver/keyboard/IME、両style切替の状態保持 | 通常幅Catalystの限定確認のみ |
| 共通化・環境最適化 | Web由来の同じ処理を双方の実経路から利用し、共有元の規則と各環境の接続を検証。別実装には具体的理由を記録 | 同期protocol・固定LZ等は共有済み。record変換・フォルダを共有へ接続中。編集/属性/生成要求にはSwift重複が残り未完了 |
| 統合・切替 | 上記全項目の証拠、Astra各段階監査、Catalyst build/test/操作、残存旧経路とデータ移行確認 | 未完了 |

新旧形式の読み取り、修復・拒否、追加・置換、全件・個別・表示枝export、圧縮exportと復旧exportはそれぞれ別経路として検証する。Webの不具合を新iOSへ複製して互換と呼ばない。必要な修正はWebの既存データを壊さず、fixtureと段階監査を伴って行う。

## 進め方

Webの既存実処理を基準に共有範囲を一機能分定め、nativeは共有処理への接続と環境固有部分を実装する。比較テストは共有設計の代用にせず、境界変換と理由のある別実装の互換性確認に限定する。独立Astraは段階の完成時に監査、修正箇所を再確認する。Catalystを通常のnative検証先とし、iOS固有の背景実行等はCatalystで証明できたと扱わない。既存ユーザーデータと本番同期先への未検証書込みは行わず、隔離したテストデータで保存・同期の実装を進める。

ゲートは部品ごとに増やさず、操作から保存・再読込みまたは同期結果まで通る機能一式ごとにまとめる。関連テスト・必要なビルド・Astra監査は原則一回、修正時は影響箇所だけ再確認する。同じsource・依存・fixture・設定への担当者と親の重複テストは行わない。中間確認は原因切分け・誤方針の早期検出・不可逆または高リスク操作の直前に限定する。

## 今回の独立監査と統合確認

Web corpus/wire検証とnative V3 I/Oは独立Astra Mediumの静的監査で新規指摘なし。Catalyst toolbarの設定ボタン欠落を修正し再監査・実操作確認。親側の型検査も成功。Web未知項目喪失・record順による兄弟順変化は[検証範囲](web-native-io-coverage.md)に記録し、修正を継続する。pinned孤立枝復元・競合・mergeの3監査指摘は修正済み。親の関連76件・型検査成功、最終Astraで新規なし。

## 次の実装単位

1. Webの交換・同期経路で未知拡張項目と兄弟順序を保持する。現在の変換仕様（参照数再計算等）と情報喪失を区別する。
2. nativeのrecord/asset/snapshot変換と暗号・圧縮の接続は共通fixtureで検証済み。次はproviderの実処理と隔離ローカル保存へ接続する。
3. nativeの取込V3と閲覧状態の隔離保存は接続済み。次は同期state全体と旧データ移行へ拡張する。Core Data等の採否は内部最適化として判断する。
4. providerの同期・競合・再試行と旧版引継ぎへ進め、A〜D/UIの未完了項目を段階的に実装する。

## 続く段階の受入

Web exportのtree/entry未知metadata保持とV3取込hash衝突を修正。欠損参照名の予約不足をAstra指摘で修正し、再監査で新規なし。native record/asset/packetは同じWeb固定fixtureへ接続し、rootId不正入力の指摘を修正して再監査完了。親の最終Web関連91件・型検査、Catalyst26件成功。既存不正delta読取、未知root/Google entry metadata、record順序、保存・通信・A〜D/UIは引き続き未完了。

## ローカル保存の受入

nativeの取込V3・表示方式・選択会話・閲覧分岐を原子的に保存し、保存成功前にmemoryを更新しない。Catalyst全33件成功。Astraの深度境界指摘を修正し、再監査で新規なし。親の実取込・終了・再起動で会話/表示/分岐復元を確認し、実保存sourceの全値・object順序も入力に一致した。

## node順序の受入

Web/nativeのGoogle recordへ明示nodeOrderを追加し、到着順が変わっても兄弟・clipboard順を復元する。旧形式5caseを残し新5caseと5packetを両環境で比較。独立追加・履歴再生・コピー時の順序伝搬を含むWeb関連110件・型検査、Catalyst全36件成功。Web/nativeとも独立Astraで新規なし。旧クライアントは追加metadataを保持・利用しないため、旧版混在時の順序保持は未保証。次は未知persist rootとcontent entry metadata保持、provider接続、A〜D/UIの未実装範囲へ進む。

## 会話ライブラリと未知保存項目の受入

Web/nativeの作成・改名・複製・複数削除を同じ8caseへ接続した。Webでは既存UIから実utilityを使用し、会話と本文storeを一度に更新する。nativeは保存成功後だけ状態を公開する。Web関連54件、Catalyst全41件成功後、監査で指摘されたstreaming中の削除拒否と保存成功後の古いerror残留を修正。Web会話管理13件とnative回帰1件のみ再確認し、独立Astraの修正確認は新規なし。統合ファイルは担当者の検証済みsourceとbyte一致。

Catalyst実UIで合成データに新規作成→改名→複製→V3書出し→追加2会話の複数削除→終了・再起動を実行。書出しは元2会話と他の全rootを保持し、新2会話のIDは別。削除・再起動後の保存sourceは元入力と全値・object順序まで一致し、会話選択・吹き出し表示・閲覧分岐も復元した。書出し証拠は `/private/tmp/weavelet-library-ui-backup.json`。全体のA（フォルダ・探索・履歴等）の完成とは区別する。

未知persist root保持は関連64件・型検査と独立Astraで受入。会話管理との統合接点は実setChatsを使用した3ファイル28件・型検査で確認した（前記件数と重複するため合算しない）。Google content entry未知metadata・未参照entryと旧client混在の保持、provider実接続は未完了。

## 本文編集の実装中

Bの最初の単位は本文・roleの上書き、明示分岐、取消、保存・再読込み・書出し。Webの先頭system分岐、roleだけの変更、本文とroleの同時変更でconfig.systemPromptを同期し、保護のruntime設定を優先してrole/本文の変更を拒否する。text編集は既存partの未知属性を保持する。Web関連3ファイル41件・型検査成功。text編集helperは実ソースを実行し、未知metadata・他part・入力不変・textなし時の追加を確認した。

新iOSの編集UI・保存と共通fixtureは実装中。独立AstraとCatalyst実操作は機能一式が揃ってから行い、このWeb検証だけでBを受入済みとはしない。並行してGoogle同期のcontent entry付随情報・同本文別metadata・明示GC後の非復活を実装中。旧record読取を維持し、旧writer混在時の保持保証とは区別する。

## 本文編集とGoogle entry保持の受入

B本文編集はWeb実domainに接続する共通15case・16tests、Web関連41件、Catalyst全47件成功。Astra指摘のconfig省略V3の編集失敗を修正し、影響するMessageEditingTests6件だけ再確認、独立再監査は新規なし。nativeではroleも保存時に確定するため、role付き分岐はWebの「branch→新node role変更」と同じ結果を比較し、Web UIと同一操作列とは主張しない。

B+E統合Catalystで分岐作成→上書き→別下書きの取消→終了・再起動を実操作。保存sourceで元の全node・別会話の不変、新分岐のactivePathと本文、取消下書きの不存在を確認した。証拠は `/private/tmp/weavelet-editing-ui-source.json`。設定省略の監査修正は別の関連テストで保存・復元・exportまで検証した。汎用挿入・prune・Undo・生成・新規添付取得はこの範囲に含まない。

E content entry拡張はWeb関連152件、native Catalyst関連16件、独立合同Astra監査で新規なし。本文・entry未知metadata・参照意味・明示GC後の非復活を検証し、検証済みファイルを親へbyte一致統合。旧writer混在、旧形式のmessage未知属性喪失、オンラインprovider接続は引き続き未達。これら部分機能の受入で全体目標を完了扱いにしない。

## メッセージ属性と同期serviceの接続中

Webのmessage未知属性をnode自身の属性と分離して `messageAttributesV1` に保持する変更を16ファイル統合した。取込・編集・分岐・clipboard・削除・書出し・同期mergeと、flat index指定の表示/除外/保護属性をnode IDへ変換する経路を対象とする。担当者の関連19ファイル285 tests、型検査、差分検査は成功し、親の統合対象は検証済みsourceとbyte一致。

nativeを同じfixtureへ接続し、MessageAttributes新6・既存MessageEditing6・SyncRecords16・WebExchange6の計34 testsが成功。既存fixtureのexpectedや比較条件は変更していない。Swift文字列の正規化同値判定を避けてUTF8で比較し、合成済み文字と結合文字列の属性競合・本文不一致を拒否する。source/testの5ファイルをbyte一致で統合し、projectには4refsだけを追加してremote生成設定を保持した。合同AstraでmessageAttributesは新規指摘なし、受入可能と判定された。同期service全体の受入とは区別する。

Google同期serviceはWebの実protocolコードを固定bundleとして再利用し、通信・暗号・保存をnativeへ接続中。担当者の隔離Catalyst関連7 testsと、Native生成multipart/packをActual Webで読む逆方向検証が成功。未完了streamの停止検証、同期保存fileの複数instance更新、message属性の最終codec/bundle統合を継続する。OAuth登録・アプリUI接続・実オンライン相互運用は未確認。

同期serviceの追加3件（別store instanceの並行保存、Task取消後のoutbox復旧、Web属性packetからの競合node remap）は成功。合同Astraで、競合解決commit後に最終保存だけ失敗すると復元snapshotとbaselineがずれ、次の送信で編集を取り消し得る問題が1件見つかった。resolve開始時に入力snapshotを保存候補へ載せ、baseline更新と同じ保存に反映する修正を追加。最終結果の受入保存失敗→再起動→pushで逆変更を作らない回帰1件が成功し、Astraの指摘確認は新規なし、同期serviceを受け入れた。固定bundleの鮮度確認にはWeb原本だけでなくadapter・generator入力のhashと依存版も含め、adapter変更後の古いbundleを拒否することを確認した。

2026-10-13、検証済みのnative 3 source・2 tests・共有bundle一式・2 wire fixtureを親へbyte一致統合し、projectには関連12refsだけ追加した。bundle SHA256は `e3a39782e7ff871c35c85521d80d9b2c7267929e0f9979ec5c6bdecb0f322c02`。親Web原本に対する鮮度確認も成功。隔離serviceの検証は既存7＋追加3＋修正1件。実WebによるNative multipart・pack・属性解決packetのread→acceptLocal→pushで全record値一致と重複公開なしを確認した。

統合による生成・会話管理・ローカル保存の接点はCatalyst関連22件で確認した。初回の生成2件は未知属性の投影に伴うJSON object key順の差だけで失敗したため、全値・UTF8文字列・配列順を維持するcanonical比較へ修正し、該当2件のみ再実行して成功。他20件は初回成功を使用し、既受入の34件やservice 11件は重複実行していない。nodeの列挙順を守る既存テストは変更していない。全state接続・OAuth・同期UIと実クラウド相互運用は次の実装対象であり、service受入だけでオンライン同期全体の完成とはしない。

## remote生成の操作確認と監査修正

OpenAI互換remoteの最初の一式を統合した。Web実request共通4件、Catalyst初回61件中の既存53件とremote7件が成功。Stopの失敗は模擬応答のContent-Type不足による受信待ちが原因で、正しいSSE headerと部分本文の観測後に解放するbarrierへ修正し、remote関連8件が成功した。不要になった独自data delegateは削除し、URLSession.bytesを利用する。

親は隔離Debugアプリで新規会話→入力→部分応答の観測→停止→終了・再起動→別入力の正常完了→V3書出しを実操作した。保存sourceと書出し全値が一致し、user/assistantが計4件、停止時の部分本文と完了本文が各一度だけ保存された。証拠は `/private/tmp/weavelet-remote-ui-export.json` と `/private/tmp/weavelet-remote-ui-source.json`。通常保存先・実Keychain・実API通信は使用していない。Debug起動は `WeaveletRemoteFixture=true` の一時plistを `INFOPLIST_FILE` に指定する（単独の `INFOPLIST_KEY_WeaveletRemoteFixture` 指定では生成plistに反映されなかった）。

独立Astraが指摘したSSEのCR区切りと先頭UTF8 BOM処理を修正した。関連3 testsが成功し、Astraの該当箇所確認は新規なしで、このOpenAI互換remote一式を受け入れた。最終2ファイルを検証済みsourceとbyte一致で統合。上記UI操作や無関係suiteは繰り返していない。全provider、local、評価、背景復旧、モデル能力、global設定の同期接続、生成tool callは引き続き未完了。

## 生成要求の共有元抽出（2026-10-13、接続途中）

`api.ts`の既存body構築を`src/api/requestBody.ts`へ、`submitHelpers.ts`の省略・content整形・role連結・system prompt処理を`src/utils/submitContext.ts`へ移した。Web実callerは抽出先を利用し、store参照による能力取得とruntime省略設定の取得だけを呼出側へ残した。生成bodyは資格情報やHTTPに依存せず、モデル能力を明示入力する。規則の再実装や期待値変更はない。

関連4ファイル44 tests（API 16、submit 9、remote contract 4、属性15）と型検査が成功。これはWeb側の依存分離の確認であり、native接続完了の証拠ではない。Swift RemoteRequestの重複はまだ残る。record/フォルダの共有bundle更新後、生成機能一式としてnative接続・Catalyst確認・独立Astra監査を行う。抽出だけの監査ゲートは追加しない。

生成接続の続き：`shared/google-sync/generation.ts`を追加し、Webから切り出した2関数をJSON境界で呼ぶ形にした。Swift `RemoteRequest`のbody構築・省略・role連結・system promptの別実装を、この共有呼出へ変更中。入力は選択したmessages/config/省略指定/モデル能力に限り、全snapshotや資格情報は橋渡ししない。既存4 fixtureでbridgeの出力も同じ期待bodyになることと型検査を確認した。固定bundle公開と`SharedWebOperations`の統合待ちであり、現時点ではnative接続のbuild/test成功とは数えない。モデルカタログの能力取得は既存の未接続範囲として残る。

## フォルダ共有処理の統合（2026-10-13、静的監査受入）

作業treeの12ファイルをbyte一致で統合し、projectにはChatFolders source/testの4refsのみ追加した。規則は`chatFolders.ts`をWeb実callerと固定bundleから利用し、nativeは既知fieldのset/removeを元OrderedJSONへ反映する。無関係な本文・未知数値・rootをJSON往復しない。Swift重複草案は`/private/tmp/weavelet-ChatFolders-pre-sharing.swift`へ保全済み。Web4 files/33 testsと型検査、Catalyst5 suites/29 testsが成功。初回nativeのtest message autoclosureのthrowsコンパイルエラーを修正して最終成功。ログは`/private/tmp/weavelet-folders-{web-test,tsc,native-test}.log`。独立Astra監査中で、手動UI・実クラウドは未確認。Webのrollbackは同期persist throwに限り、非同期IDB保存失敗への保証を追加したとは扱わない。共有bundle一式はrecord担当の最終検証後に統合する。

フォルダの独立Astra監査は新規指摘なし。共有元の実利用、未知属性・順序保持、複数操作、保存失敗時保持、生成状態を保持する更新を静的確認して受入。生成中の一覧UIは無効化されており、更新経路の静的確認と実UIでの操作可否は区別する。手動UIと実クラウドは引き続き未確認。

## Shared codec and generation integration, 2026-10-13

Actual Web records now owns conversion; Swift duplicate rules and host codec callbacks were removed. Web rootId string validation was integrated with five negative cases and the valid empty-tree case. Web 45 and Catalyst 23 cases passed (records 16, sync attribute conflict 1, attribute projection 6). Bundle SHA256: `29b68dba02ba20a492fdeff0c0d9a79b5f789ba56df958c620154b17c8596adb`; freshness check against main source and dependencies passed. Untested Swift SyncDocument and stale worker Web sources were not integrated.

Parent Catalyst RemoteGenerationTests: 9 passed, existing expectations unchanged; log `/private/tmp/weavelet-shared-generation-native-test.log`. Independent Astra review of shared records and generation accepted the feature with no new findings. Model catalog and other provider gaps remain.

CUA manual check on the same build's isolated Debug fixture: created New Folder 1, selected New Chat 1, moved it into the folder, reopened the list, then quit and relaunched. Folder membership, expansion and prior message content survived. Only synthetic debug-remote-fixture data was used, with no real API or Keychain access. The temporary built Info.plist fixture flag was restored after quitting. This covers the create/move/restart path, not every folder UI action or live cloud sync.

## Editing sharing: identified preservation issue, 2026-10-13

The next editing adapter will call actual branch-domain operations rather than retain Swift rules. Review of `contentStore.ts:isDeltaEligible` found that all text parts are currently eligible, including parts with unknown attributes; delta reconstruction emits only type/text. The editing worker owns a limited full-storage fallback fix and a regression proving preservation, including investigation of multiple-part boundaries. This is a Web source fix to be shared by both environments, not a relaxed comparison. The currently audited bundle remains fixed until the editing feature is integrated.

2026-10-13: The user requested a separate placement/cost audit of existing Web and iOS construction for unnecessary optimizations, custom implementations, and rules reimplemented without a shared source. Independent Astra is reviewing current main; editing/document workers will distinguish their in-progress replacements from remaining duplication. This is the requested audit, not a new mandatory gate for every small change.

Unused resource follow-up: removed only PBX file/build/group/resource references 039/03A/03E/03F for RecordsBridge.js and the standalone DMP bundle. Original files remain preserved; project plist validation passed. This change is included in the next editing Catalyst build, without a separate test gate.

Document integration acceptance includes all existing chat create/duplicate/delete/reorder operations, not just leaf edits. A UI projection may use JavaScript number semantics, but moving chats must not swap or round their unknown raw metadata. The document worker will reuse editing's opaque-value boundary before native persistence is connected; the current helper tests alone do not prove this integration.

## 2026-10-13 follow-up: raw content boundary regression

Editing's new Catalyst case exposed a missing guarantee after codec sharing: resolveContent sends a full entry through JavaScript and rounds unknown numeric metadata (9007199254740993 becomes 9007199254740992). The raw store survives, but WebExchange.encoded uses this path to build exported messages. The previous codec acceptance is therefore insufficient for this input. Do not relax the test or compare only the store; preserve raw values with the shared opaque boundary while retaining Web delta resolution. The codec owner is fixing this before editing acceptance.

Library follow-up: moved Web default-chat construction into createLibraryChat and connected the existing Web generateDefaultChat caller; duplicateLibraryChat/deepCloneSingleChat can accept the native-allocated identity. Related 14 tests and type checking passed. Native ChatLibrary replacement remains pending; this extraction alone does not complete library sharing.


2026-10-13 — Latest main integration (`7a0a383a`, #523): source workspace remains byte-identical to the preservation snapshot `3bf7e881`; integration is isolated on `codex/shared-main-integration`. Adopted main's ID-based actions, readonly workspace, hierarchy/selective imports, summaries and generic encrypted synchronization. Kept opaque roots/message attributes/content entry graphs and shared library/folder source rules. Full-file import preserves original content entries; selective preview retains its existing resolved-subset contract. Unknown persisted roots use the sidecar during import planning and commit, so opaque names cannot replace runtime actions.

Validation expectation changes are explicit: main excludes only `SYNC_LOCAL_SETTINGS` from online records (a separate policy fixture is checked against Web source; old wire fixtures remain unchanged); append imports now remap folder IDs beneath an import root; persistence has three new known roots; explicit GC owns unreferenced entries after deleting all chats. The malformed-delta case outside the expanded-V3 acceptance contract now reports the normalization error before publishing, matching main's removal of the old swallowed exception. Its exact error, unchanged live state and direct resolver failure are tested. No unknown-value, node-order or content-entry comparison was relaxed.

Web integration: 132 suites / 1,438 tests passed, one existing benchmark skipped; TypeScript and Vite build passed. Independent Astra found and verified fixes for persisted-root injection during replace import and the native key-header transport connection; final static audit has no unresolved finding. Catalyst full run passed all suites except three SyncSession cases whose old `theme` edit is no longer synchronized. Those cases now edit `defaultSystemMessage` and preserve fault injection/restart/ciphertext assertions. The affected SyncSession suite passed all 8 cases on rerun; the other 78 cases passed in the full run, giving coverage of all 86 current Catalyst cases. Bundle freshness passed with SHA256 `cde27e82cd2e6d20735af0c92b62065d76af431099d1f805cf68ceac2f3381d7`. Manual UI, physical devices and live cloud were not exercised in this integration. Native library sharing and the separate editing/full-state work remain incomplete; this integration is not overall Web/iOS parity.

## 共有編集・文書保存・会話管理の接続（2026-10-13）

統合済みmainを基準に、Swiftの編集・属性規則と会話管理規則を、実Webのbranch-domain/branchUtils/chatLibraryへ接続した。初期設定も純粋な定数へ抽出して両版から利用する。属性の取込・書出しは文書単位の呼出しとし、messageごとのbundle読み直しを除去した。UI・URLSession・Keychain・暗号・原子的保存はnativeを維持する。

full snapshotとV3 sidecarを分けて保存し、未知root・未参照entry・原delta・大きな数値と未知属性を保持する。V3で変更した共有rootだけをsnapshotへ反映し、同期除外される端末設定と完全ファイルI/Oを混同しない。保存v2はsnapshot.stateを独立JSON文字列として格納し、外部深さ256を維持したままv1/旧v2も読める。更新時刻はWebのrecordChatEdits/フォルダ判定へ一元化し、保存成功後にのみ表示状態を更新する。

独立Astraで見つかった保存wrapperの深さ超過、raw deltaへopaque参照を先に適用する問題、新規deltaのpatch文字列へopaque参照が残る問題を修正した。既存deltaはraw入力に実Web resolverを適用後に境界投影し、未変更の保存元deltaは維持する。新規deltaは投影内で展開してからraw属性を復元する。内部contentHashは衝突suffixも許す参照IDであり、opaque投影の有無により同本文entryが重複する場合があるが、次Web書込みと外部recordの内容・参照保持を確認した。hashの一致をI/O互換性と取り違えてSwift再実装や全キー再採番を追加していない。

全件削除時は最新Webと同じく本文entryをGCまで保持する。旧fixtureは変更せず、保持されるentryと参照数、追加される更新時刻を明示した。undefinedのvalue欠落patchと不正deltaの空本文受入も接続テストで発見・修正し、情報保持や拒否条件を弱めていない。旧resolverを前提とした不要な差分化制限は撤去した。

検証: Web全体134 suites/1,473 tests成功（既存benchmark1件skip）、型検査とVite build成功。最終の新規delta修正後は共有編集20 cases成功（新規2 casesを含む）。Catalyst初回95 casesで3ケース/4assertが失敗し、原因修正後の影響7 suites/55 casesではnull保存の1ケースだけ失敗した。その列挙境界を修正して文書6 cases成功、最終delta修正と追加保存回帰を含む編集10 casesも成功。変更のない成功結果を再利用して現在の97 casesを検証済みとするが、最終ソースで全97件を単一runした結果ではない。bundle鮮度・差分検査成功。独立Astraのこの機能単位の最終静的監査は残件なし。

bundle SHA256: `5a8d351d59b02366f93b67fae015cb0f2b02db6e3bf5480feeec8cda12e22573`。検証ログは `/private/tmp/weavelet-sharing-{web,types,build,catalyst,catalyst-final,catalyst-null,catalyst-editing}.log`。実UI・実機・実クラウドを今回は再検証していない。full-stateの保存/公開境界は接続済みだが、OAuth・同期UI・実クラウド相互運用、他providerや全機能のiOS移植は引き続き未完了。
