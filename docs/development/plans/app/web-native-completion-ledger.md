# Web / 新iOSの完成条件と証拠


## Web共有フォルダー同期とnativeファイル接続（2026-10-13）

共有 `a08e5e36` / native `53b483a4`。実Web FileSystemTransport/EncryptedSyncを固定bundleから呼び、manifest・ID・履歴・暗号化・競合・compaction無効の規則を共有する。nativeはsecurity-scoped URL/bookmark、NSFileCoordinator、原子的な期待bytes照合と保存、iCloud未downloadの開始/到着待ちを担当する。空フォルダーでの作成、既存接続、解除、鍵復元、初回保存再開、受信、競合解決とjournal回復をUIへ接続した。GoogleSyncControllerの既存公開/回復処理をmode指定で再利用し、Googleの既存経路は既定modeで維持する。

初回保存は実Webのif-emptyを使い、その意図をjournalに残す。作成中に他の履歴が先に到着した場合に上書きしない。filesystem target metadataはbookmarkと同じnative同期storeの別rootへ保存し、フォルダー切替では選択を解除してから更新する。正常保存/公開後にだけinitializedとheader再開状態を更新する。フォルダーへの書込完了はiCloud配信完了を意味しない。NSFileCoordinatorの保証は協調するFile Provider/書込者の順序付けであり、非協調する全外部writerへの汎用CASとは記載しない。

検証済み：Web filesystem関連17 tests、型、bundle鮮度が成功。Catalyst初回25 cases中24成功（raw file 4、folder接続3、既存Google controller17）。残る1caseはtmp URLのscope取得が常にfalseというテスト前提が実環境と異なった。拒否を明示注入し、metadata参照前の拒否と未取得scopeの未解放を確認するテストへ訂正した。native修正後はraw file 5＋folder接続4の9 casesが成功。変更のないGoogle17件は初回結果を再利用し、最終26 casesを単一runした結果ではない。ログ `/private/tmp/weavelet-folder-sync-{catalyst,final,web,types,freshness}.log`。

代表経路：全項目の既存io-corpusでnative作成/暗号化ファイル保存→受信/アプリ保存/再起動→別側設定更新→再起動したpublisherへの受信を確認。欠損したimmutable履歴の拒否、元stateとjournal保持、復元後の再開、初回前に到着した他履歴の保持も確認した。さらに実Swiftが生成した暗号化ファイルを、actual Web FileSystemTransport/EncryptedSyncでunlock/pullし全records一致を確認、Webで編集/pushしたbytesをfixture化してnative受信でも全records一致を確認した。fixtureは `tests/fixtures/web-native/filesystem-native-web-wire.json`（合成データ、FAKE passphrase）。Web caller確認はNode上のdisk facadeであり実ブラウザの権限/ファイルAPI試験とは分ける。

Web往復用の最初のdisk facadeはcreate=trueで空fileを作る実API動作を欠いてENOENTになった。facadeを実APIに合わせて修正し同じ全records確認が成功（`/private/tmp/weavelet-folder-sync-web-interop{,-final}.log`）。検証専用scriptは `/private/tmp/weavelet-folder-sync-web-interop.test.ts` に保全し、常設の検証管理基盤は追加していない。native受信のwire fixtureケースは通常のCatalyst testに含めた。

独立Astraでdirectoryを列挙から落とす問題、確定不存在がNotFoundにならない問題、scope開始前のmetadata参照を発見し修正。directory/空file/不存在/権限拒否/downloadPendingを区別する。追加でrootの再検証とsymlinkのdownload拒否、contentを持たないdirectoryをdownloadPendingにしない扱いを確認した。指摘範囲の限定再監査は新規なしで、全体の再監査は行っていない。

Catalyst実UI：最新build成功（`/private/tmp/weavelet-folder-sync-ui-build.log`）。旧検証processがmodalを開いたまま残っていたため、modalを閉じた後にQuit menuで終了し、PID消失を確認して最新buildを起動した。Apple標準pickerで `/private/tmp/weavelet-folder-picker-proof-parent/sync` を選択し参照保存、正常終了/再起動後のbookmark復元と同フォルダーの読み取り（同期data不存在の正しい表示）を確認。pickerにはiCloud Drive入口も表示されたが実cloudを操作していない。通常領域・実Keychainは使わずDebug fixture storeへ保存した。終了後にPID消失とbuilt Info.plist復元を確認した。前項の既定設定UI記録では終了操作だけでterminal確認を省いていたため、今回確認で補正した。

共有bundle SHA256 `759ecf7b6deda96d2298ebf283bba110b2a827c30c21aa17c4ab41df4b81b2de`。実iCloud配信・placeholderの実際の到着/オフライン/競合コピー、iPhone/iPad実機、ブラウザの実folder権限は未確認。CloudKitは対象として維持し、native接続は残件。全機能移植や実cloud全項目の互換性が完了したという意味ではない。


## 新規会話の既定設定接続（2026-10-13）

実Webのnew chat config構築をnewChatDefaults/newChatConfigへ切り出し、generateDefaultChat/createLibraryChatとnative shared bridgeから共用した（共有 `a179263c`、native `40bf8e92`）。保存済defaultChatConfig/defaultSystemMessage/defaultImageDetailとモデル情報を、新規作成と全削除後の補充へ渡す。初期値固定のnative UI呼出を撤去した。既定設定UIは既存ChatConfigViewを再利用し、3rootだけをfull snapshotへ保存する。保存時のtoken clampは実Webのpure関数を呼び、未指定tokenはnullへ変換しない。全global設定UIやOpenRouter全controlの移植完了を意味しない。

共有契約7 tests・型・bundle生成/鮮度の担当成功と、親の既存Web chat-library 8 tests成功を再利用。独立AstraでmodelStateをstate内に入れる境界不一致を発見し、top-level引数へ分離した。native新規作成テストは保存cacheによるstream=false/max4000→3200を確認する。該当差分の再監査は新規なし。

Catalyst初回12 cases中11成功。残る1caseは既定設定をV3 rootへ置いたfixtureの誤りだった。実syncDocument.tsのDOCUMENT_SHARED_ROOTS/v3DocumentLayoutは会話・本文・folder・evaluationだけをV3共有rootとし、既定設定はfull snapshotのstateに属する。fixtureを正式snapshot経路へ訂正し、情報保持assertを維持して該当1case成功。Webの形式に沿う訂正であることを独立Astraも限定確認した。最終12 casesを一括で再実行した結果ではない。

代表経路ではV3未知raw値のimport/export、保存済既定値から新規作成、保存/再起動、fakeDrive暗号化同期、受信/再起動、全削除後の補充を確認。別caseでfresh設定保存、保存失敗時の元disk/state保持、stale拒否、空systemによる旧prompt解除、既存会話不変を確認した。オンライン比較は実Web recordsのJSON数値/キー順規則で、file I/Oのraw byte保持と区別する。ログ `/private/tmp/weavelet-default-settings-{catalyst,final,web-library}.log`。

隔離FAKE Catalyst実画面で既定設定を開き、system文とmodelを編集・保存・再表示し保持を確認。最初のAXクリックは別fieldへ入力したため、画面で位置を確認して検証用の値へ直した。これは入力自動化の訂正であり実装変更ではない。通常データ、実API/Keychainは使用せず、終了後にbuilt Info.plistのfixture flagを元へ戻した。実UIの新規作成は自動接続テストと重複するため反復しない。実機・VoiceOver・実クラウドは未確認。

最新共有bundle SHA256: `da914d5e84430562f5a7d49b02ab8aa736ed752d3cee8e3440119ae9c9802e9b`。次の同期方針は[計画の最終方針](web-native-commonality-roadmap.md#2026-10-13apple同期とフォルダー同期の最終方針)を参照。CloudKit除外指示は撤回され、CloudKitを維持したうえでWeb/iOS共通のローカルフォルダー同期とnative iCloud Drive対応を追加する。Google OAuth未登録のため実接続を待たず隔離検証を先行する。

## iOS全体の採用境界監査と先頭文入力（2026-10-13）

採用境界の監査を再構築版の全40 Swift source、C/C++境界・ビルド、共有bundle/描画依存とlicenseへ拡張。[計画の全範囲監査](web-native-commonality-roadmap.md#ios全範囲への監査拡張2026-10-13)に分担・coverage・必要独自の根拠・条件付き依存を記載した。初期load失敗後の新規作成/snapshot適用による原保存file上書きを修正。MalformedSaveの既存ケースへ拒否/元bytes保持/明示置換後の通常作成を追加し成功（`/private/tmp/weavelet-ios-audit-preservation.log`）。独立Astraの修正確認は新規なし。Markdown license欠落、nested依存来歴、到達可能なKaTeX展開DoSも補完/公式版更新を完了した。最終確認は以下の通り。


依存修正の最終状態（親 `c42d4eeb` / `61e7a98`）：KaTeX 0.18.2、lodash 4.18.1、Babel runtime 7.26.10へ限定更新し、npm/Yarnの両lockとCIのresolutionsを整合。lodash 4.18.0の公式deprecatedを親・独立Astraが発見したため採用を撤回し、非deprecatedの後続4.18.1へ修正した。全100 actual package/versionのNOTICEを確認し、旧欠落24件の固定版license・出典を保持した。実際のnested pathを記録し、補完licenseが存在しない／版が一致しない生成を拒否する。

再利用と追加確認：依存更新時の関連117 tests、型、両bundle鮮度が成功。最終Yarn配置変更後はrenderer 3 testsだけを再確認した。lodash版選択修正後は影響する76 tests、Yarn frozen install、Google bundle鮮度が成功し、無関係suiteを再実行していない。公式KaTeX 0.18.2のUnicode/edef回帰入力を各5秒上限の隔離processで拒否し、許容budget 256の正常描画も成功（`/private/tmp/weavelet-katex-regressions.log`）。最終単一runで全117 testsを再実行したという意味ではない。

親Catalystビルドと既存MarkdownViewTests 1 caseが成功（`/private/tmp/weavelet-ios-full-audit-markdown.log`）。実WKWebViewで数式・表・code・HTML非実行、copy、原文/文字サイズ更新、描画process終了時のfallbackを確認した。統合36ファイルは担当最終版とbyte一致し、ビルド済みappのNOTICE・JS・CSS・sourcesもsourceと一致。独立Astraは修正一式を確認し、最後のlodash限定再確認で残件なし。テストの大量複製や新しい監査基盤は追加していない。

最終SHA256：GoogleSync `bdb6ce0eaab7569a53a196afd4036ef070d5fcd8986047a4a3ca29199d08044a`、Markdown JS `4b928f759eed6ef3c8b20260f40e31ae57377904cb2c122bbfeeaf1f0a49ccd3`。担当ログ `/private/tmp/weavelet-native-deps-*`、lodash再確認 `/private/tmp/weavelet-lodash-patch-*`。生成JSのhighlight grammar文字列内の末尾空白警告は意味を変えないため保持した。既存npm lockのjose/workers-types不足は本変更とは分けて残し、全repo npm ci整合を確認済みとは扱わない。全repoに残る無関係advisory、iOS実機、実クラウド、全UI/AXは未確認。新iOS全範囲の採用境界監査と、全機能の動的完成は別である。

先頭文入力は実Webの一時map/key/消費規則を共有helperへ切り出し、Web実callerとnativeから使用。native UIはuser nodeと通常入力欄に配置し、入力は保存・同期しない。共有normalizeでtrimしたprefixを既存localInput/Outputへ渡し、最初のtoken前から表示する。途中再生成では共有plan.prefillKey、末尾再生成/通常送信では共有sticky keyを使用。生成中に別値へ編集されたdraftは残す。

共有関連41 tests・型・生成鮮度成功。native初回4ケース中3成功。残るケースは末尾assistant再生成をmidchatと誤認したfixtureが原因で、実`prepareRegenerateState → resolveRegenerateTarget`は末尾をappendとする。後続userをfixtureへ追加して本当にmidchatを通し、消費対象・未消費sticky保持・保存/再起動の非永続性assertを変えず該当1ケース成功（`/private/tmp/weavelet-prefill-{catalyst,final}.log`）。停止・保存失敗・再試行・late output拒否の既存確認にもprefixを通した。独立Astraはこの機能差分に新規なし。隔離Catalyst実UIでuser行の先頭文欄の展開・編集を確認。実モデルとのprefill手動生成、全UI/AXは今回未確認。実装commit `c3f85dd0`、共有 `502f485a`。

## ローカル生成接続の実装・検証状況（2026-10-13）

共有入力に加えて、実Webのfallback prompt・stop・出力処理・モデル設定規則を共通化した。nativeは端末専用GGUFコピー、公式llama.cpp/Metal、既存wllama sampling、取消・原子的保存への接続を担当する。モデルIDのUTF8をSHA-256でファイル名にし、同期metadataと実ファイルの存在を混同しない。ファイルは同期snapshotへ入れない。

再利用した成功：共有関連56 tests・型・bundle鮮度。Catalyst初回25ケースのうち23ケース成功。失敗したlocal接続2ケースでは、共有bridgeのopaque数値復元が抜けており修正。その後の本文assertは実WebExchangeが出力するpartsを検証するよう修正し、全文・raw属性・保存/再起動の保証は維持した。最終は影響する接続2＋実tinyモデル/Metal停止1の計3ケース成功。25ケースの成功範囲は複数runの合算であり、最終全件一括runではない。ログ `/private/tmp/weavelet-local-generation-{catalyst,connection,final}.log`。独立Astraの限定再確認は新規なし。ライセンスnoticeの最終bundle同梱も確認。

実UIではGGUF選択・端末コピー・設定保存と再起動後の保持を確認。pickerのOpenが一時無効だったため調べたが、元のGGUF UTTypeのまま明示選択で成功し、推測による型制限変更は残していない。一方、実生成（stories260K、max_tokens=8、temperature=0）でMetal実行後にmallocのfree block corruptionによるSIGTRAP終了が発生した。自動テスト成功だけで機能完成とは扱わず、native担当が通常完了経路の所有権/寿命を調査中。ログ `/private/tmp/weavelet-local-generation-ui.log`、crash `~/Library/Logs/DiagnosticReports/WeaveletPilot-2026-10-13-155238.ips`。検出されたthreadだけでWebKitや依存ライブラリの責任と断定しない。

依存境界の判断は[計画の監査結果](web-native-commonality-roadmap.md#2026-10-13独自実装と依存ライブラリの境界監査)を参照。公式emsdk 5.0.5を隔離tmpへ導入し、Webの8 WASM/4 glue再生成を別worktreeで開始。まだ生成・ロード完了ではない。現在のnative backendはCatalyst arm64/単一GGUFで、iOS実機、全lowbit形式、分割GGUF、ONNX等の完成を意味しない。

追加確認（`11ae12e5`）：最終decode後にlogits取得がない場合、非同期計算の完了前にcontext内bufferを解放し得るため、公式`llama_synchronize`をcontext解放前に呼ぶ。modelとcallback状態はそれまで保持する。8token通常完了→再実行の1ケースを追加し、既存callback停止1ケースと合わせ2件成功（`/private/tmp/weavelet-local-completion-fix.log`）。独立Astraはこの解放順序と限定差分に新規なし。元のmalloc破損の正確な書込元まで同定したという証拠ではない。

修正後の隔離Catalyst UIで2回連続生成→保存→正常終了→再起動→両結果の末尾表示に成功。以前の4messagesと初回の保存済み結果も維持し、計10messagesを確認。証拠 `/private/tmp/weavelet-local-completion-ui{,-restart}.log`、`/private/tmp/weavelet-local-completion-ui-saved.json`。この経路で再発はなかった。モデル選択・local生成・停止/保存失敗/遅延callbackの接続を確認済みとし、全local機能やメモリ安全性全般の保証へ拡張しない。

Web生成物の続報（`37451913`）：正確sourceとpatch 0001–0007から8 WASM/4 glueを再生成し、既存smokeのモデルpathだけを隔離コピーでtinyモデルへ変えてChromium全8件load/推論/exit成功。全ST/MTの実結果は指定と一致、exit timeoutなし。cachebusterを更新、glue差分はWebGPU JSPI診断ログ除去のみ、他3種はbyte一致。親でも全12生成物のSHA-256を担当検証済み出力と照合。ログ `/private/tmp/weavelet-wllama-{cve-setup,build,smoke}.log`、hash一覧 `/private/tmp/weavelet-wllama-artifact-hashes.json`。独立Astraは生成元の公式修正・生成/ロード証拠・cachebusterを確認し新規なし。Web配布物にも今回のGGUF修正反映を確認できたが、Firefox/Safari、大モデル、実GPU offload、既存OPFSデータは未確認。モデルとSDKは配布物に追加していない。

## ローカル推論の依存採用監査（2026-10-13）

追加SDKやSwift tokenizerを導入せず、既存Webのllama.cpp/wllama sampling実装へC ABIで接続する。公式upstreamが保守中であることと固定revisionの安全性は別に判断する。独立Astraが公式13 advisoryを今回のC API入口へ分類した結果、server/RPC専用5件は対象外、関連6件は固定4abef75fへ修正取り込み済み、CVE-2026-27940は通常loaderのno_alloc=true経路に非該当、CVE-2026-33298は未修正だった。

| 依存 | 判断と条件 |
| --- | --- |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) / Metal | 公式C APIの直接接続を条件付き採用。MIT、保守継続を確認。CVE-2026-33298の[公式修正4e5b83b2](https://github.com/ggml-org/llama.cpp/commit/4e5b83b226919c146fbfa754641a6772bcb2d722)をbackportし、不正tensor byte-sizeを拒否することが受入条件。 |
| [wllama](https://github.com/ngxson/wllama) | 既存Web用wrapperとsamplingコードを再利用。MIT、保守継続を確認。旧固定系列を使うため公式修正の追跡が必要。取得tag/SHAとpatch fingerprintを照合しHEAD fallbackを使わない。 |
| lowbit独自patch | 既存形式の互換性のため同じCコードを使用。保守主体は本repoであり、upstreamの安全性保証に含めない。標準GGUFだけの成功をlowbit全形式の検証済みとしない。 |
| JavaScriptCore / WKWebView | OS標準の既存共有経路を継続。新JS runtimeやMarkdown parserを追加しない。 |

source取得cacheのpatch同一性、ライセンスnoticeのアプリ同梱、既存Websetupのtag不一致/HEADfallbackとpatch0006構文問題も修正対象とする。現Web利用8 WASM variant/4 JS glueの再生成にはemsdk≧5等が必要で、手元PATH/標準配置では未検出。現Webバイナリは修正済みと扱わず、source修正とartifact再生成・実ロードを分けて記録する。[公式advisory一覧](https://github.com/ggml-org/llama.cpp/security/advisories)の今回公開分を照合したもので、未公開問題・独自patch全体・全不正入力の安全なエラー復帰を保証するものではない。

## ローカル生成の共有入力とCatalystエンジン接続調査（2026-10-13）

実Web buildLocalChatMessagesのrole/text変換とuseSubmitのprefill trimを共有元へ移し、Web callerとshared localGenerationInputで使用する。既存submit contextの省略・system prompt・本文順序を維持し、画像等をrole/string入力へ含めない既存動作も維持する。configは変更せず、モデルtemplate・推論・保存処理は今回変更していない。共有関連45件、型、bundle鮮度・差分確認の担当成功を再利用。親統合dd2d551eでは同一suiteを再実行していない。

エンジン調査はwllama正確tag 2.3.7（5e63e3b2）、llama.cpp 4abef75fを一時取得し、既存Web patch0001–0005とlowbit C/loader/graphを適用。既存ローカルWeb sourceのllama.cppも同revisionだった。setupのv2.3.7指定は実tagと不一致でHEADへfallbackし、patch0006は構文エラー（corrupt patch:71）があるため、現Web artifactと再取得sourceが完全一致するとは扱わない。Webバイナリ・取得scriptは未変更。0006はWASM memory64用としてprobeへ未適用で、native採用版の最終決定とはしない。

Catalyst arm64 C/C++/Metal静的libraryをビルドし、ASMにもarm64-apple-ios17.0-macabiを指定後、全157 objectのMACCATALYSTとSwift import/link、llama_chat_apply_template実行が成功。アプリ固有のtemplate規則をSwiftへ再実装せず接続できる根拠とする。成果は `/private/tmp/weavelet-catalyst-llama-{source,build,build-input,probe}`、ログは同prefixのconfigure.log/build*.log/swift.log。モデル未取得であり、実推論・Metal実行・消費電力・アプリ統合は未確認。

localModels/activeLocalModels/savedModelMeta等は実Webのfull snapshot・同期対象。nativeのファイル参照は端末ローカルに分離し、同期metadataを実ファイル存在の証明に使わない。次は同エンジンの読込・生成・停止と共有入力のnative接続を一式で実装する。AstraとアプリCatalyst確認はその一式にまとめ、今回の共有抽出やビルドprobeごとの監査ゲートは追加しない。未変更の保存/暗号化同期suiteは再利用する。全ローカル機能（分割GGUF、ONNX/評価等）の完成とは扱わない。

## 再生成・途中生成の共有接続（2026-10-13）

既存WebのresolveRegenerateTarget、削除/後続付替え、placeholder作成と同target確定をgenerationPlanへ共通化し、実Webの再生成・次のみ生成・完了callerも委譲する。再生成は旧assistantの意図的置換であり、勝手に旧枝を残す仕様へ変更しない。保護/pinned判定は実処理を維持。nativeは既存メッセージ操作メニューから同じprepare/finalizeを利用し、共有requestPathで送信範囲を決める。生成開始前の保存成功後だけ通信し、停止・保存失敗時の部分出力と再試行を既存経路で扱う。

共有81件・型・bundle鮮度成功を再利用（初回UUID mock初期化と型1件は担当修正済み）。Catalystは新テストのresolveContent引数名を修正して実行後、19件中17件成功。中間置換テストが汎用6メッセージfixtureを3件と誤認してID数が不足していたため、対象シナリオの3本文を明示して該当ケースが成功した。一般fixtureの既存検査は維持。

同期代表1件は保存→再起動/export→既存fakeDrive暗号化同期→受信→再起動/exportを通し、旧target消去・新target本文・後続parent/activePath・非表示node metadataを確認。初回は内部contentHashの固定比較が失敗し、実Web records.ts:258–283のrestoreEntry/restoreがローカルhashを再割当する根拠から全metadataと参照本文の比較に分離した。次に本文objectのキー順だけの差を確認し、同:63–69のwire canonical処理で比較。配列順序と値・metadataを維持し、情報欠落を隠す比較には変更していない。最後は同期1件だけ再実行して成功。他18件は成功結果を再利用し、全19件を最終ソースで単一runした結果ではない。

ログ `/private/tmp/weavelet-message-regeneration-{catalyst,final,affected,sync}.log`。独立Astraは機能一式に新規なし、fixture/内部hash比較の変更も限定確認して新規なし。保存/同期基盤全suiteの再実行は省略。隔離FAKE Catalystの実画面で中間assistantの「再生成」を実行し、本文がFAKE partialからFAKE partial completeへ更新され、後続user/assistantの本文が残ることを確認した。「ここから生成」はmenu表示と自動接続テストまでで、手動実行は省略。実API・実クラウド・実機は未確認。全生成モード・prefill・評価・自動タイトルまで完了したとは扱わない。

## remote送信先・認証ヘッダー・OpenRouter制約の共有接続（2026-10-13）

実Webの3つの完了API入口に重複したAzure URL/header構築をrequestTransportへ集約し、OpenRouterのrouting/sticky session/prompt cacheは既存controlsから環境非依存部分を移した。generationRequestはoptional transport指定時にbody/endpoint/headers/認証descriptorを返す。実キーはhostで結合し、nativeのURL解析結果を利用するためJavaScriptCoreへ独自URL parserを追加しない。native直接通信ではproxy専用response cacheを適用しない。

共有関連49件・型・bundle鮮度の担当成功を再利用。URLグローバルなしVMでも実bundle呼出を確認済み。apiVersionは実Webと同じpersist rootから渡し、customHeadersは現Web生成callerが未指定のため新しい保存root/UIを追加しない。nativeはHTTPS/同origin/HTTPヘッダーを確認後に鍵を注入する。OpenRouter max_priceの未知属性だけをraw投影し、大きな数値を保持する。

Catalyst初回18件中16件成功。失敗2件はOpenRouter設定付き会話をfixture.invalidへ送れるというテストの誤前提であり、実Web openrouterRequestのendpoint拒否に合わせた。新testは他origin拒否と別providerでcontrolsを送らない検証を分け、旧catalog fixtureはFakeURLProtocolによる完全捕捉を維持してprovider/credential双方のURLをOpenRouterへ揃えた。実装や情報保持assertは緩めていない。該当2件のみ再実行し成功、他16件を再利用。最終ソースで全18件を単一runした結果ではない。ログ `/private/tmp/weavelet-request-transport-catalyst.log` と `/private/tmp/weavelet-request-transport-final.log`。機能一式の独立Astraは新規なし。fixture修正も該当差分だけ再確認し、期待緩和・実通信への切替なし、新規指摘なし。

未変更の保存/暗号化同期の全検証は省略。実API・実Keychain操作・実機は未確認。OpenRouterの観測/料金表示・リモート取消・proxy機能や全provider対応を完了したとは扱わない。

## remote応答の本文・推論抽出の共有接続（2026-10-13）

実Web submitRuntimeのreasoning優先順・非stream本文変換をremoteResponseへ切り出し、Web callerとshared remoteOutputから利用する。構造化本文は既存apiContent、分割thinkタグは既存ThinkTagParserを使い、Swiftの独自抽出を撤去した。nativeはURLSession/SSE UTF8・取消・保存を担当し、JSContextは生成単位で保持する。

正常終了だけでなくerror/cancel/切断時にもflushする根拠は、実Web直接通信のfinally（proxyなし）。native停止時も保存前に同じ共有flushを行い、失効した生成通知は既存guardで拒否する。既存代表生成・停止・切断テストの入力をstructured本文/reasoning_details/分割タグへ変更し、従来の完成parts期待と旧データ保持を維持。保留タグの停止・切断保存とSession再利用の接続を確認した。

共有関連58件・型検査・bundle鮮度の担当成功を再利用。Catalyst生成14＋provider境界2＋生成中同期保全1の17件が一回で成功、失敗なし。ログ `/private/tmp/weavelet-response-content-catalyst.log`。独立Astraは新規指摘なし。未変更の同期/保存基盤の全経路、共有業務規則のnative大量複製は省略した。

実API/クラウド・実機は未確認。toolcall実行やCohere固有形式は今回追加していない。service workerの既存抽出・provider固有通信の全統一を完了したとは扱わない。

## provider一覧・認証先・モデル選択（2026-10-13）

既存WebのnormalizeModelsとfavorite補完を共有接続し、nativeはURLSession・provider別Keychain・選択UIを担当する。Web一覧取得失敗で空配列を保存していた経路は旧cacheを保持するよう修正。成功した空一覧は従来どおり反映する。nativeは認証付き一覧の同origin、保存endpoint一致、provider別鍵を確認し、公開一覧へ鍵を送らない。cache更新は対象subsetの差分だけ保存し、未知属性・元数値表現・編集中configを保持する。

再利用する成功結果：共有normalize関連34件、取得失敗関連41件、補完関連11件と型・bundle鮮度の担当結果（件数には重複あり）。今回の必須確認：Catalystでprovider境界2・生成13・生成中同期保全1の計16件、失敗0。保存失敗・取消・遅延応答・stale拒否・raw保持と認証先を確認した。ログ `/private/tmp/weavelet-provider-models-catalyst.log`。独立Astraは新規指摘なし。今回はcompile/test失敗なし。

省略した重複確認：変更のない共有業務規則のnative複製、保存/書出し/暗号化同期の全経路、画像/Markdown、小変更ごとの監査。隔離FAKE Catalystの実画面では一覧表示・provider切替・閉じた後の会話設定保持を確認。空cacheのためモデル選択は手動未確認。実Keychain操作・実API/クラウド・実機は未確認。Cohere生成とlocal実行は未対応であり、provider全機能の完成とは扱わない。

## 会話生成設定・モデル切替・stream/token補正（2026-10-13）

既存WebのswitchConfigModel/savedModelSettings/normalizeConfigStreamとremoteモデル上限判定をpure共有元へ切り出し、Webの旧入口も委譲する。モデル別設定entryの未知属性を上書きで失う経路は、共有元で既存entryへ既知設定を重ねる最小修正を行った。nativeの会話設定画面からモデル/provider・stream・token・temperature・推論設定を編集し、切替結果の差分を原raw値へ戻す。古いdraftと保存失敗時は公開せず、UTF8表現差も上書きしない。

要求は会話model/streamを優先し、モデル空の旧会話のみ従来Keychain値をfallbackする。Keychain Codableと認証情報の保存は維持。transportは共有処理で確定した要求のstreamを使用する。旧testsの端末上書き期待はこの会話設定優先へ更新し、Keychain失敗保全・旧会話fallback・元source不変assertを維持した。local実行は明示未対応であり、モデル一覧取得や全provider接続を実装済みとはしない。

共有56 tests・型・bundle鮮度は担当成功結果を再利用。CatalystはPBX参照ID重複とテスト変数名重複のcompile失敗を修正後、設定1＋生成13の14件が成功。非streamモデルでは会話/端末stream=trueでも正規化後falseで受信完了する実接続、raw未知数値、保存失敗/retry、stale/Unicode拒否、再起動を確認した。監査のフォームString比較指摘はUTF8比較へ修正し該当箇所のみ再確認、新規なし。ログ `/private/tmp/weavelet-chat-config-catalyst-tests.log`。

隔離FAKE Catalystで会話設定を開き、モデル/provider、token256、temperature0.3、stream=falseを保存して再表示で保持を確認。実API送信、実機、狭幅/VoiceOver、モデル切替直後の設定プレビューは未確認。変更のない同期・画像・Markdownの検証は再利用し、全機能完成とは扱わない。

## remote推論能力の共有接続（2026-10-13）

nativeの能力false固定を廃止し、既存Web modelLookup/APIの実判定を `modelReasoning.ts` へ切り出した。Webのget/useとAPIも同じ元を使う。customの明示値、favorite/cacheとID推定、mandatoryの明示false等の優先規則は維持する。nativeは保存snapshotのfavoriteModels/providerModelCache/providerCustomModelsを読み取り専用で渡し、metadataを要求bodyへ混入させない。既存の端末model/stream指定は維持し、provider取得・モデル切替・stream/token補正は別の残件とする。

共有元の既存57＋新2件、型検査、bundle鮮度の担当成功結果を再利用。Catalystは要求境界・raw値保持・代表生成の4件が一回で成功し、保存済みモデル情報から実ChatState送信へ推論設定が届くことと、保存後の3rootのbyte保持を確認した。ログ `/private/tmp/weavelet-model-capability-catalyst.log`。独立Astraは新規なし。保存/同期基盤、SSE、画像/表示の未変更領域は反復検証していない。実API・実クラウド・実機は未確認であり、生成機能全体の完成とはしない。

## 検証運用の更新と画像composer接続（2026-10-13）

確認済みの共有元・保存/書出し/暗号化同期の結果は、関連コードが不変なら再利用する。現在の追加範囲は画像入力とチャット別の一時draft。実Webの `replaceTextValue/textValueOf/hasMeaningfulMessageContent` を共有composerから直接呼び、本文位置・parts順序・画像のみの送信判定をSwiftへ複製しない。共有composerの新2件＋既存12件、型検査、bundle鮮度確認は担当成功結果を再利用する。

残る必須確認はnativeの引数/結果変換、画像元bytesと入力時detail、配送先chatの保持、保存失敗時のdraft保全、および一式のCatalystと独立Astra監査。WKコピーの未確認境界も今回の接続確認へまとめる。未変更の保存・同期基盤の全経路、共有元と同じ業務規則のnative複製テスト、小変更ごとのCatalyst/監査は省略する。失敗があれば実Web呼出経路を根拠に原因を記録し、修正箇所と影響範囲だけ確認する。

画像ファイル/写真/PasteButtonとチャット別draftを接続した。本文入力中はnative値だけを更新し、送信時に一度shared composerへ渡す。画像選択完了前に別会話へ移っても元の配送先と入力時detailを保持し、添付取消でも本文を保持する。append保存成功後だけdraftを消し、保存失敗時は本文・画像と保存済みデータを維持する。独立Astraはこの機能一式に新規指摘なし。

Catalyst初回15件中14件成功。切断PNGの拒否1件はImageIOの形式情報だけではヘッダのみの入力を通す実装不備だったため、1pxサムネイルの実decode確認を追加した。元bytes/期待値を維持し、ImageInputTests2件だけ再実行して成功、監査もその6行だけ再確認して新規なし。RemoteGenerationTests12件・MarkdownViewTests1件は初回成功を再利用する。保存失敗/retry、画像のみ送信、古い生成結果拒否、raw属性、再起動/書出しの既存代表経路が含まれる。WKコードのDOMボタン→OS clipboard、表示process終了時の原文fallbackも成功。ログは `/private/tmp/weavelet-composer-catalyst.log` と `/private/tmp/weavelet-composer-image-final.log`。最終ソースで全15件を単一runした結果ではない。

写真pickerの実操作、IME/狭幅/VoiceOver、実機、実クラウドは未確認。同期/保存基盤と共有元の既存成功suiteは重複実行していない。これらは入力接続の部分成果であり、Web全機能の再現完了とは扱わない。

## 共有Markdownとnative画像表示の接続（2026-10-13追記）

実WebのMarkdownRenderer/ContentBodyをローカルWKWebViewへ同梱し、GFM・KaTeX・highlightと生成中のpolicy/250ms更新を共有した。言語一覧とLaTeX前処理は環境非依存部分だけ切り出し、Webの旧exportを維持。Swift側は原文切替、OS文字サイズ、コピー、リンクscheme制限、高さ通知を担当し、本文をJavaScript文字列へ連結しない。保存元・外部I/O・同期は変更していない。画像添付はURLSessionとImageIOで非同期取得・縮小し、読込/失敗表示と拡大を追加した。表示用decodeは最大2048px、元データは維持する。

共有元renderer3件と既存policy5件・型診断・生成鮮度の担当成功結果を再利用。Catalyst画像2件、WK接続1件成功。WK初回はSDKのcallback引数ラベルでcompile失敗し修正。画面外requestAnimationFrame待ちを中止し、DOM更新を待つ方式へ変更した後、旧DOMにも本文が含まれるため待機完了を早く判定するテスト不備を修正した。内容・表・数式・script非実行・原文・fontSizeのassertは維持し、WK1件のみ再実行した。ログ `/private/tmp/weavelet-rich-display-{catalyst-final,markdown-final}.log`。Astraの生成終了後もisGeneratingがtrueになる指摘をrunningへ接続して解消し、該当箇所だけ再確認、新規なし。

Catalyst実画面で10メッセージ（160行長文を含む）の数式・コード・本文、原文切替、添付画像の表示/拡大を確認。初期構成でWebContentが8プロセス・各約90〜140MiBとなるため、画面外の本文はWebViewを破棄し高さだけ保持した。先頭表示時の観測は3プロセス・各約104〜106MiB。測定条件の統制されたbenchmarkや実機消費電力の証拠ではない。一時データ領域の共有案は効果を確認できず撤去した。最終ライフサイクル変更のCatalyst build成功、同期/保存試験は表示変更と無関係なので反復していない。

残る表示受入: 狭幅・VoiceOver・実機のDynamic Type/消費メモリ、継続スクロール時の安定性、実操作の選択/コピー。コピーの手動操作はUI自動化が同名要素を区別できず未確認。後続composer一式では実DOMボタンからOS clipboardへの接続を自動確認したが、ユーザー操作による選択/コピーの確認とは区別する。豊富な本文表示の接続は進んだが、この残件や全機能移植を完了扱いにしない。

## 形式判定・プレビュー・選択追加・全置換の共有取り込み（2026-10-13追記）

実Web importServiceの変換・検証・選択追加を `src/utils/fileImport.ts` へ抽出し、Webとnativeが同じ入口を使う。nativeはJSON/gzip読込、raw境界、確認UI、atomic保存を担う。既知設定の全置換初期値は実Web `getInitialState/createPartializedState` から生成し、Swift側へ既定値を再実装しない。設定の初期化は既定オフ。選択IDはUTF8 identityを使用し、古いプレビューからの保存はsnapshot/sidecarのbyte照合で拒否する。

Astra指摘のsummary設定投影、初期値のundefined削除、Unicode識別子の混同、古い状態照合を修正。追加調査で見つかったPlayground判定の独自model必須条件は実Web `isOpenAIContent` 共用へ変更した。手動確認では実Web converterの文字列本文無視を検出し、既存 `strToTextContent` による正規化を共有元へ追加した。情報欠落を既定値・比較方法の緩和で隠していない。独立Astraは修正した範囲だけ再確認し、新規なし。

再利用する成功証拠: importService65件、フォルダ16件、Catalyst取り込み7件（raw属性・summary・Unicode・stale拒否・保存失敗/retry・設定リセット・空置換・再起動）。最終の文字列本文修正後は共有取り込み/utility19件・型検査と、nativeの該当接続1件だけを再確認した。選択追加→暗号化同期の代表1件も成功。初回同期の2assert失敗はWeb `records.ts` のtoRecords/fromRecordsが本文hashとキー順を変換するためで、期待chatを実共有変換から取得する全体比較へ訂正し、受信hash先の5parts・未知属性の確認を維持した。全suiteを最終ソースで一括再実行した結果ではない。ログ `/private/tmp/weavelet-import-{projection,string}-catalyst.log`。

実Catalystで合成ファイルの閲覧専用プレビュー、本文1件、設定初期化の既定オフ、追加保存、一覧と本文表示、既存会話保持を確認。手動の再起動・書出し・同期は自動の成功証拠と重複するため反復しない。最新origin/main `7a0a383a` は統合先の祖先であることを確認し、元作業ツリーの未コミット変更を保全した。実クラウド・実機・狭幅・VoiceOverは未確認。本文のrich表示など全体目標の残件へ進む。

## 形式・範囲指定の書き出しとgzip V3（2026-10-13追記）

実Web ExportChat/DownloadChatのpayload構築をfileExportへ共有し、nativeは同じ入口へ接続した。全件V3/V1/OpenAI/OpenRouter/LMStudioと、単体・表示枝V3/OpenAI/LMStudio/Markdownを提供する。OpenRouterは全件/単体の現在枝を出力し、独立の表示枝指定は持たない。V1は全件のみ。V3/OpenAIの全枝出力と、現在枝・変換先で表せる本文だけを出す形式をUIで区別した。Markdownの既存変換はDOM処理から分離し共用する。

全件V3は未変更raw領域を維持するpayloadChangesで出力し、既存無引数exportも維持した。単体V3は所属folderを除外し、対象会話の評価結果だけを出す。独立Astraで見つかったsummaries/summaryTargetsのopaque化による失敗・欠落は、絞込みに必要なmap/参照IDを公開し他属性をopaque保持する修正で解消。情報が省かれる外部形式のnative説明不足も修正し、再監査は新規なし。

gzipはnative zlibを利用し、圧縮V3の取込はmagic判定後に既存V3経路へ渡す。CRC/切断/余剰データを拒否し、解析または保存失敗前に既存状態を公開しない。標準Node zlib生成fixtureの展開、原文数値表記・未知rootを含むgzip往復、再起動、圧縮V3の取込から暗号化同期までを検証した。

検証: Web関連117件・型検査成功。初回Catalyst10件中2件は追加fixtureに必須の評価phase/settingsがないため失敗し、有効なfixtureへ訂正（raw未知値の比較は維持）。監査回帰追加後の関連11件は全成功。bundle鮮度・差分検査成功。実Catalystの形式/範囲sheetから全件V3+gzipを保存し、`/private/tmp/weavelet-v3-all.json.gz` をPython gzipで展開してV3・2会話・6nodeを確認した。ログ `/private/tmp/weavelet-file-export-catalyst-final.log`。旧形式の取込、追加/置換/選択取込UI、PNG書出しは残件。実クラウド・実機・狭幅・VoiceOverは未検証。

## 範囲コピー・切り取り・貼り付け・会話間移動（2026-10-13追記）

実Web callerの範囲検証・本文存在確認・copy/cut/paste/moveをbranch-clipboard共通処理へ抽出し、nativeも同じ処理を呼ぶ。複数会話とclipboardを一度に保存し、保存成功後だけ表示・共有編集履歴を公開する。clipboard正本は既存full snapshot.state.branchClipboardであり、V3 sidecarやOS clipboardへ別実装しない。copyのみでも再起動・同期で保持し、古い操作の拒否にはclipboardを含むsnapshotを照合する。

collapsed/omitted/protectedを旧形式と互換のoptional clipboard mapsとして保持し、貼付先の新IDへ移す。protected範囲のcut/moveは共有側で拒否し、copyは許可する。既存IndexedDbStorageの参照保持を使い、cut後のGC・再読込み後にも貼り付けられることを検証。remove/pasteが変更前entryの参照数を書き換える問題もentry分離で修正した。空会話への貼付は既存Webどおり実在する挿入先nodeを要求する。

独立Astraで、native差分用の再構築配列を履歴captureへ渡すと無関係な会話も変更扱いになるP2を検出。履歴には実処理の参照を保った結果を渡し、差分用配列と分離した。3会話の回帰でA/Bの履歴へCが入らず、Cの更新でA/B履歴が失われず、UndoがCの属性や表示pathを変えないことを確認。修正後の監査は新規なし。

検証: Web関連196件、監査修正関連64件と型検査成功（重複あり）。初回Catalystは追加テストの配置誤りでcompile失敗し、生成中拒否loopを正しいテストへ移動後、関連31件が全成功（編集30件＋暗号化同期往復1件）。同期先でclipboardの3maps・未知node属性・5種本文を保持して貼付でき、両側の再起動でもclipboardが残ることを確認。Catalyst実操作はcopy→paste→undoで元の表示に復元することを確認した。cut/moveは自動テストで確認し、手動実行は未実施。ログ `/private/tmp/weavelet-clipboard-catalyst-final.log`。bundle鮮度・差分確認成功。実クラウド・実機・狭幅・VoiceOverは未検証。

## 上下移動・後続整理付き編集・子孫削除（2026-10-13追記）

実Web moveNode/replaceNodeAndPrune/deleteBranchの規則をbranch-domainの共通入口へまとめ、実Web callerとnative treeEditから利用する。先頭systemとの交換・経路端の移動は変更なし。置換と後続整理は指定範囲にprotectedがあれば本文だけ保存して理由を返す。保護された対象への置換と、保護された子孫を含む枝削除は共有入口で拒否し、Web/nativeとも理由を表示する。これは既存の「削除から保護」表示を破っていたWeb経路の修正であり、pinnedの明示削除は引き続き許可する。

flat変換で既存hashを再利用すると変更前content entryのrefCountまで更新する原因も、既存ensureBranchTreeStateのentry分離で修正した。nativeは既存共有履歴と保存経路へ接続し、古いdraft・生成中・保存失敗では文書と履歴を維持する。未知属性、複合本文、非表示枝を含む変更結果は共有処理から反映する。

検証: Web関連151件と型検査成功。統合Catalyst関連27件成功（編集26件＋暗号化同期往復1件）。移動→置換と後続整理→非表示枝削除の結果をfakeDriveで新規受信し、経路・削除結果・残存ノード未知属性・保護・5種本文・再起動後exportを確認した。独立Astraは新規なし、bundle鮮度・差分確認成功。Catalyst実操作は移動とUndo、後続整理sheetの件数と保護説明、枝削除confirmationとcancelを確認。最終削除の手動実行はしていない。ログ `/private/tmp/weavelet-tree-edits-catalyst.log`。

clipboard/copy/cut/paste/会話間移動と、他の未実装分類は残る。実クラウド・実機・狭幅・VoiceOverは未検証。origin/main 7a0a383aまで取込済みで、元checkoutの未保存変更は触っていない。

## 編集Undo/Redoの共有接続（2026-10-13追記）

実Web branch-sliceのsnapshot・履歴上限・undo/redo・変更対象判定をbranchHistoryへ抽出し、Web callerとnativeが同じ処理を利用する。履歴は会話横断・セッション内。本文編集・挿入・削除・非表示枝整理・表示属性変更を既存操作経路から記録し、nativeは保存成功後だけ文書と履歴を公開する。生成中の操作を拒否し、取込/同期では本文または木が変わった会話の履歴だけを無効化する。

独立Astraで指摘された「別会話でundo後、古い表示pathが復元結果を上書きする」問題は、影響した全会話の表示を更新して修正した。復元時の再構築を対象会話だけに限定し、無関係な会話の未知metadataと省略configを保持する。前段で残件だったdeleteBranchStateのentry共有と削除root参照も共有元で修正済み。ただしnativeの子孫削除UIは未接続。

Catalyst全158件の初回実行では4テストが失敗。履歴deltaの比較は既存Web解決結果と元rawデータ保持を分けて検証する形へ修正した。既存WebのJSON数値変換で生じる丸めと表記正規化を明示し、元baseのraw bytes、delta構造、未知属性の一致は維持する。同期復旧の失敗はnavigationが未設定mapをset undefinedとして差分化したためで、JSON境界で未設定値を除外する共有側修正と回帰テストを追加した。

検証: Web初回130件、修正関連30件、navigation回帰8件と型検査成功（重複あり）。修正後Catalyst関連32件が全成功し、失敗した全テストと、削除undo後の暗号化同期・新規受信・再起動を含む。全件の再実行とは区別する。独立Astra再確認は新規なし。Catalyst実操作で挿入→undo→redo→undo、本文の消失/復元とボタン有効状態を確認。ログは `/private/tmp/weavelet-history-catalyst-final.log`。実クラウド・実機・狭幅・VoiceOverは未検証。全機能の完成には未到達。

## メッセージ削除・非表示枝整理（2026-10-13追記）

メッセージ1件の削除は後続メッセージを残す既存Web removeNode、非表示枝整理は表示path・pinnedとその子孫・protectedを残す既存pruneHiddenNodesStateへ接続する。nativeは共有差分を保存してから公開し、確認画面を開いて以降のsource変更と生成中保存を拒否する。pinnedは共有規則が読むbooleanとして投影し、その他の未知属性はopaque参照で保持する。子孫ごとの枝削除と編集undoは別の未完了項目。

共有元で2件を修正した。共通変更準備とpruneで本文entryを分離し、releaseContentによるrefCount変更・delta昇格が変更前stateへ漏れることを防ぐ。activePathが空のpruneでrootが削除された場合はrootIdを空文字へ直し、同期record復元の不正参照を防ぐ。別のdeleteBranchStateには独立したstore浅copyとreleaseContentによる同entry共有問題が残る（branch-domain.tsのdeleteBranchState）。子孫削除の接続時に修正する残件として記録し、この結果を全削除経路の修正完了とは扱わない。

検証: Web関連7suite140件、型検査成功。Catalyst関連29件が一括成功し、root/中間/flat/全件削除、pinned子孫・protected保持、保存失敗/retry、古いdraft/生成中拒否、再読込/export/recordと隔離fakeDriveへの削除反映・fresh受信を含む。独立Astraは新規なし、bundle鮮度・差分検査成功。ログ `/private/tmp/weavelet-removal-catalyst.log`。手動Catalystはメニュー→1件削除確認→キャンセルと、非表示枝整理の例外説明→キャンセルを確認した。手動の最終削除は実行せず、削除結果は隔離自動テストの証拠とする。実クラウド・実機・狭幅は未検証。

## 本文挿入の共有接続（2026-10-13追記）

Web insertNodeの対象判定・tree準備・挿入をinsertNodeStateへ抽出し、実Web callerとnative編集bridgeから同じ処理を利用する。WebのhistoryBaseは維持。nativeは各メッセージの「前に挿入」から既存入力sheetへ接続し、保存成功後に更新する。全本文保存へ元source照合と生成中拒否を追加し、古いdraftや未保存生成の上書きを防ぐ。挿入の空本文・3role・保護nodeの前への追加は既存Webどおり許可し、枝削除や編集undoを本段階へ混ぜていない。

Web関連5suite100件と型検査成功。Catalyst関連26件のうち編集14件・生成11件は初回成功。隔離fakeDriveの挿入同期テスト1件は、本文objectをtype/text順とした期待値が失敗した。実Web records.tsのcanonical（63–67行）がkeyをソートしcontent record（179行）へ適用するため、受信はtext/type順となる。期待値をその正確なwire順へ修正し根拠をテストに記載した。配列順・値・非表示nodeの一致は維持し、該当1件の再実行が成功。最終26件の単一runではない。保存失敗/retry、stale/生成中拒否、root/中間/flat、再読込/export/record、共有暗号同期からfresh受信/再読込を含む。

独立Astraは新規なし、bundle鮮度・差分検査成功。Catalyst実操作で中間メッセージの「前に挿入」→本文入力→保存→指定位置への表示と既存後続本文の保持を確認。ログは `/private/tmp/weavelet-insertion-catalyst.log` と `/private/tmp/weavelet-insertion-sync-final.log`。実クラウド・実機・狭幅は未検証。prune/undoと残る全機能は引き続き未完了。

## ノード属性設定の接続（2026-10-13追記）

label/star/pinは実Web setNodeFieldの環境非依存処理を共有し、collapsed/omitted/protectedも実setNodeMapの更新処理へ接続した。Web側の履歴・runtime map・生成無効化は既存callerに残す。nativeは6項目の設定画面・状態表示・折りたたみを提供し、共有結果を保存成功後に公開する。未変更のfalse属性、未知属性、contentStoreを保持し、flat会話は必要な操作だけtree化する。生成中・古いdraft・保存失敗では元データを維持する。

検証: Web既存関連78件と新規contract9件、型検査成功。Catalyst関連27件の初回は26件成功、1件はツール交換もomittedで除外されるというテストの誤った想定で失敗した。実Web filterOmittedMessagesがtool_call/tool_resultを保持する根拠をコメントに残し、通常本文の除外とツール交換の保持を別々にassertして該当1件の再実行が成功した。最終27件を単一runしたものではない。設定の再読込・V3往復・record・隔離fake Driveでの暗号同期受信を含む。bundle鮮度・差分検査成功、独立Astraは新規なし。

Catalyst実操作で6項目の設定画面、保存したlabel/star/pin/除外/保護の表示、本文折りたたみ、保護時の上書き保存無効を確認。ログは `/private/tmp/weavelet-node-options-catalyst.log` と `/private/tmp/weavelet-node-options-catalyst-final.log`。実クラウド・実機・狭幅・VoiceOverは未検証。最新origin/main `7a0a383a`を再取得し統合先の祖先であることを確認、元作業ツリーは保全した。

## 残存する生成・編集の重複除去（2026-10-13追記）

限定再監査で特定した2箇所を修正した。生成要求の選択path→role/content投影は実WebのmaterializeActivePathへ接続し、Swift独自投影を削除。編集draftの最初のtext取得・属性を保つ置換は、Web useEditViewLogicからmessageTextへそのまま抽出し、双方の実callerが利用する。nativeは編集開始時に原文を取得し、保存時にoriginalPartsとeditedTextを渡す。キーストロークごとのJSC実行は追加していない。

appendの空本文判定も共有保存経路でWeb hasMeaningfulContentを使用する。後続text・画像・未知属性を失わず、通信設定とraw数値精度の復元はnative境界に残す。既存15編集fixtureの期待値は変更していない。Web104件と追加append境界を含む編集22件（重複あり）、統合Catalyst編集/生成/検索到達26件、型検査・bundle鮮度・差分検査成功。独立Astraは新規なし。ログは `/private/tmp/weavelet-shared-request-draft-{catalyst,types}.log`。実API送信・実機・全provider能力は未確認。

統合先はcodex/shared-main-integration。取得済みorigin/main `7a0a383a`（#523）を祖先に含むことを確認。元作業ツリーの未コミット変更を維持し、GitHubへは書き込んでいない。

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
| B 木と本文編集 | role・system prompt・挿入/編集/明示分岐/prune/順序・undoの共通fixtureとUI | 上書き・role・明示分岐・末尾追加を共通15caseとCatalyst実UIで確認。一般挿入は上記共有接続とCatalyst操作を確認。1件削除・非表示枝整理を共有接続済み。共有undo/redoを上記の範囲で接続済み。上下移動・後続prune・子孫削除UIも上記の範囲で接続・検証済み |
| B 分岐閲覧 | 任意nodeの切替と後続path、端の停止・履歴・表示保持 | 任意深度の兄弟切替と共有後続path・保存・履歴をCatalystで検証 |
| B 移動・属性 | clipboard/copy/cut/paste/会話間移動、label/star/pin/除外/保護の共通結果 | 6属性のWeb実処理共有・native設定・保存/交換/隔離同期を確認。clipboard/copy/cut/paste/会話間移動を上記の共有処理・保存・隔離同期へ接続済み |
| B 表示・draft・添付 | 5種content/Markdown/コード/表/画像、draft/IME、添付と編集位置保持 | 実Web Markdown/コード/表/数式を共有描画し、native画像表示・画像取得・会話別draftを接続。上記機能群のCatalyst/Astra確認済み。IME・選択/コピー手動操作・狭幅等は残件 |
| C 生成入力・provider | 設定優先順位、モデル能力、system/tool/image/reasoning、token budget/prefillの一致 | OpenAI互換remoteの共通request4件とnative設定・入力を接続。他provider/モデル能力/token budget等は未実装 |
| C 実行・取消・適用 | streaming/非stream/local、Stop、遅延結果拒否、usage/本文終端一回適用 | remote関連8件＋SSE修正関連3件成功（重複あり）、隔離CatalystでStop・再起動・正常完了・書出しを確認。独立Astra受入。local/usage等は未実装 |
| C 評価・命名 | safety/quality/local fallback/auto title、世代照合と各設定の一致 | 自動命名の共有・native接続済み。評価/正確なtoken数は残件 |
| C 復旧・背景 | 中断後再接続・既適用識別・部分本文保持をCatalystと必要な実機で確認 | 未実装 |
| D モデル資産 | 探索/取得/再開/import/検証/partial復元/容量不足/変換 | 未実装 |
| D 実行寿命・削除 | engine別load/share/owner/cancel/unload、利用者とwriter停止後削除 | 未実装 |
| E 全I/O項目 | 全persist rootとネスト項目、全交換版、未知項目、非表示枝の双方向fixtureと実読書き | 55rootとネスト代表項目のcorpus、Web関連138件、native全26件。CatalystでV3実ファイル往復の全値・順序一致。上記形式/範囲exportとgzip V3往復を接続。旧版取込等は未完了 |
| E 内部保存・旧データ | 新native保存の再起動復元、旧iOS/Webデータ無損失取込、保存失敗時保持 | 取込V3と閲覧状態の隔離保存を実装。Catalyst全33件、実UI再起動で選択会話・表示方式・分岐復元を確認。旧データ移行・同期state全体は未完了 |
| E Google同期 | Web/native相互の暗号envelope・record/asset/commit/pack、競合・中断・誤鍵・再試行の結果一致 | native serviceとWeb実protocol共有bundleを統合。隔離11件、Web実コードとのmultipart/pack/属性packet相互確認、Astra受入。OAuth・アプリ全state/UI・実オンライン相互は未完了 |
| E CloudKit同期 | record/field/圧縮とchangeTag競合、Web/native相互読書き、失敗時保持 | Web実payload/record wrapperを合成検証。native圧縮wireの固定vector一致、provider接続未実装、旧iOS形式は不一致 |
| UI 全体 | UI対応表M1–M6、N1–N5、S1–S6の各受入をnative操作で確認 | 表示style切替・role・時刻なし・整列・leaf分岐のみ |
| UI アクセシビリティ等 | 狭幅/Dynamic Type/VoiceOver/keyboard/IME、両style切替の状態保持 | 通常幅Catalystの限定確認のみ |
| 共通化・環境最適化 | Web由来の同じ処理を双方の実経路から利用し、共有元の規則と各環境の接続を検証。別実装には具体的理由を記録 | 同期protocol・固定LZ・record変換・フォルダ・本文編集・属性・生成要求・検索/分岐履歴はWeb由来の共有処理へ接続済み。残る未実装機能も同じ配置原則で進める |
| 統合・切替 | 上記全項目の証拠、Astra各段階監査、Catalyst build/test/操作、残存旧経路とデータ移行確認 | 未完了 |

新旧形式の読み取り、修復・拒否、追加・置換、全件・個別・表示枝export、圧縮exportと復旧exportはそれぞれ別経路として検証する。Webの不具合を新iOSへ複製して互換と呼ばない。必要な修正はWebの既存データを壊さず、fixtureと段階監査を伴って行う。

## 進め方

Webの既存実処理を基準に共有範囲を一機能分定め、nativeは共有処理への接続と環境固有部分を実装する。比較テストは共有設計の代用にせず、境界変換と理由のある別実装の互換性確認に限定する。独立Astraは段階の完成時に監査、修正箇所を再確認する。Catalystを通常のnative検証先とし、iOS固有の背景実行等はCatalystで証明できたと扱わない。既存ユーザーデータと本番同期先への未検証書込みは行わず、隔離したテストデータで保存・同期の実装を進める。

検証は関連機能群の代表経路へまとめ、保存・再起動・書出し・暗号同期を機能追加ごとに一律反復しない。基盤変更時のみ影響範囲を追加する。テスト作成前に実WebのID再採番・本文参照変換・キー順を確認し、共有元では業務規則、nativeでは引数/結果変換・情報保持・保存失敗時の保全を検証する。関連コードが不変の成功結果は再利用し、期待値の変更には実処理の根拠を残す。完成条件を満たした機能群は追加監査循環をせず次へ進む。関連テスト・必要なビルド・Astra監査は原則一回、修正時は影響箇所だけ再確認する。同じsource・依存・fixture・設定への担当者と親の重複テストは行わない。中間確認は原因切分け・誤方針の早期検出・不可逆または高リスク操作の直前に限定する。

### 取り込み完了後の本文表示の配置判断（2026-10-13）

現在の `MarkdownRenderer.tsx` は実Webの remark-gfm / remark-math / rehype-katex / rehype-highlight と `preprocessLaTeX` を使用する。旧iOS `MessageBubble.swift` の `inlineOnlyPreservingWhitespace` はブロック構造を扱わず、この経路の拡張を既定にしない。次の表示段階はWeb由来の解析・前処理と `resolveStreamingMarkdownMode` の共用を先に検討し、描画、選択、リンク操作、画像読み込みはnative境界として配置する。解析ASTだけでは数式・表の描画を別実装するため、既存React描画をWKで共用する方式を選び、上記の実測と残る受入を記録した。表・コード・数式・画像の表示、原文切替、選択とコピー、Dynamic Typeを一式の受入に含め、旧iOSと見た目だけ一致しても完成とは扱わない。

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


## CloudKit共有規則・native手動同期（2026-10-13）

配置はWebの既存snapshot規則・LWW・upload guardsを共有、nativeはApple CloudKit SDK、raw JSON保持、原子的保存、UIのみ。共有コード・native transportはそれぞれ専用worktreeでlocal commitを回収し、元のdirty workspaceは変更していない。公開コンテナーIDはユーザー承認の `iCloud.com.sstcr.WeaveletCanvas` を設定した。追加依存SDKなし。Google/フォルダーの設定除外をCloudKit FULL persistenceへ誤流用しない。

- 再利用する成功結果：フォルダー同期17 Web/26 Catalyst、既存LZ wire fixture、変更のないCloudKit Web関連50 cases。CloudKit全体55 casesの成功後、変更を加えた共有5 casesのみ再確認した。Web型検査・bundle鮮度も成功。
- 今回の必須確認：native接続6 cases（全項目・巨大整数・未知root/wrapper・再起動、取得済みrecord CAS/時刻固定、server採用、受信中の編集、保存失敗保全/再試行、missing/破損/版違い/循環folder/解除時の非適用）とCKRecord変換1 case。現在の全7 casesについて成功範囲を確認したが、最終ソースで全7件の単一runをした結果ではない。
- 省略した重複確認：Google/フォルダー暗号化全経路、全Webテスト、全nativeテスト、以前の全iOS依存監査。共通版判定やLWWの業務テストをSwiftへ大量複製せず、native接続・保全へ絞った。

失敗と修正：初回buildは新テストのtry漏れで実行前に失敗。実行後はnative6ケース中5ケースが圧縮UTF16の孤立surrogateをhost UTF8変換へ渡す際のエラーで失敗（他の保全assertの派生失敗を含む）。TextEncoder境界で標準 `toWellFormed()` を使い、圧縮payload自体は変更しない。共有テストでは孤立surrogateを拒否するnative host mockを通して実Web Blobとmetrics一致を確認した。現Catalystで接続5ケース成功、残る全項目1ケースはroot位置の期待値だけが相違した。

root位置の原因：実Web `mergeSyncDocumentSnapshot` は `{...existing.state,...incoming.state}` で既存root位置を維持し、新rootを末尾へ追加する。受信JSONと保存JSONは値・キー集合・全ての内部順序が一致し、state直下のroot位置だけが既存文書に従っていた。期待値をこの実処理へ修正し、root位置を既存順序+新rootとして明示確認、UTF8キー集合と各rootのOrderedJSON値を全件比較した。全体canonical化で内部配列順・数値・参照の差を隠していない。該当1ケースだけ再実行して成功し、他の5ケースの成功を再利用した。

独立Astra：受信版違いを適用するP1と循環folderを保存するP2を共有receiveGuardで修正。未知wrapper rootの保持も追加し、限定再監査は新規なし。SDKのCAS、取得済みsystem fields保持、更新時刻固定、古い状態での受信、保存失敗時の更新順序には新規なし。native旧版隔離/移行UIは未実装なので、版違いは元CloudKitレコードを維持したまま拒否する。

ログ：`/private/tmp/weavelet-cloudkit-integration.log`（build失敗）、`weavelet-cloudkit-integration-retry.log`（host変換失敗）、`weavelet-cloudkit-integration-final.log`（5 cases成功/1 root位置相違）、`weavelet-cloudkit-corpus-debug.log`（差の原因確認）、`weavelet-cloudkit-corpus-final.log`（該当1 case成功）。bundle SHA256 `fcbb7e2724bf5e7e6fc2a5a3668cf5746e33197a4abf0ed28a751cfe245f3df3`。テストはFAKE corpus/CKRecord/transportと隔離ローカル保存のみ。実CloudKitアカウント・新app IDのコンテナー利用許可・署名・実Web相互運用・実iCloud Drive配信・実Google OAuthは未確認。CloudKit自動同期と旧版の隔離/移行UIも残件であり、全機能のWeb/iOS互換性完成とはしない。


## CloudKit自動送信・旧版原文保全（2026-10-13）

前段の手動同期に、保存イベント、5秒idle、直列送信、再起動時の未送信変更保持、foregroundでの復帰を接続。idle値は実Web共通定数を参照する。native queueとmetadata/archive storeは専用worktreeからlocal commitを回収し、controller/Appへ接続した。CloudKit SDKは実操作まで遅延作成するため、自動同期OFFの起動ではアカウントへ接続しない。

旧版はraw BYTESを原子的に保存し、異なるpayloadを全て順序保持、同一payloadだけ重複排除する。新しい旧版受信や接続解除で以前の未書出データを消さない。UIで個別JSON書出しを利用可能にした。隔離保存失敗、壊れたmetadata、通常保存失敗は既存bytes/会話を維持する。

再利用した成功：前段CloudKit transport変換、既存LZ wire、変更のないCloudKit provider50 cases、フォルダー暗号化同期一式。今回Webは共有bridge5+実Web cloud scheduler6の11 cases、型検査、bundle鮮度成功。native初回はqueue3/store3/controller9の15 casesが成功。Astra指摘修正後はcontroller11 casesを再確認し、追加したdirty restartの縮小保護は影響3 casesのみ確認した。現在はqueue3/store3/controller12、合計18 casesの成功範囲を確認済みだが、最終ソースで全18件を単一runした結果ではない。指摘修正後の最初のbuildは追加テストのtry漏れで実行前に失敗し、修正後の11 casesは成功した。

独立AstraのP1：dirty restartの競合で旧版がlocalより古いと隔離せず上書きする経路を、LWW前の共有receiveGuard/原文隔離へ修正。P2：一時的な通信失敗後に有効設定のまま停止する経路をforeground再開へ接続。旧版停止は別フラグとし、自動再送しない。限定再確認は新規なし。追加でcold restartにmetricsがなく縮小保護が抜ける経路を共通remote metricsによるCAS再送前ガードへ修正し、限定監査は新規なし。thresholdや期待値を弱めていない。解除は設定保存より先にnative queue/sessionを止める。

ログ：`/private/tmp/weavelet-cloudkit-auto-{web,types,freshness,catalyst,final,final-retry,shrink}.log`。新キュー/storeの型検査のみのworker結果をXcode実行結果と混同していない。旧版JSON書出しはraw payload→既存LZ復元の結果を接続テストで確認した。backgroundは期限切れ/完了時の終了処理を実装し、Apple公式API仕様を確認したが、実OSによる期限切れ・送信完了を確認した結果ではない。

手動UI：FAKE profile指定で最新Catalystを起動し、当該processは確認できた。CUAの対象取得がcgWindowNotFoundになり、同じBundle IDの別セッション2件が稼働中で対象windowを選別できなかったため、UI成功として扱わない。別セッションには触れず、今回起動したFAKE processだけを終了し、不在を確認した。実CloudKit/実iCloud Drive/実Google OAuthの操作はしていない。追加の検証用管理基盤、別Bundle IDへの改変、全領域テスト/監査の再循環は追加していない。

## タイトル自動生成・設定・利用量保存（2026-10-13）

Webの実callerから純粋な規則を共有し、nativeはURLSession、認証情報のbind、raw JSON投影/差分復元、世代照合、原子的保存、UIを担当する。通常送信の応答保存後だけ自動生成し、再生成/続行では起動しない。設定3rootの保存は他の会話/設定を保持する。利用量の未知属性・未変更entry・大数値を保持し、タイトル保存失敗ではmemory/diskの元データを維持する。NFC/NFDが異なるchat ID・本文・設定はbytesで区別する。

独立Astraの3 P2を修正した：local主モデルからremoteタイトル要求を作る時のmodelSource、再生成/続行の誤起動、外側の未追跡Taskによる全体置換後の起動。補助configは共有元でremoteに設定、appendだけに限定、同期準備の直後にHTTPTaskを登録し全体置換時にcancelする。限定再監査は新規なし。bundle生成時に画像件数→cost→modelLookup→Web storeの依存混入が失敗し、既存純粋関数を移動して再exportした。その後JSC初期化がauthのVite環境参照で失敗し、同じ公式endpoint定数をpure provider-configへ移動して修正。定数移動の独立限定確認も新規なし。

成功結果：Web関連43件の成功範囲。定数移動後は影響するタイトル3+submit9の12件だけ再確認し成功、変更のない残り31件は再利用した。Web型検査とbundle鮮度も成功。CatalystはRemote18+Local4が成功、タイトル6件はfixture修正後の限定runで全成功。現在28件の成功範囲であり、最終ソースの全28件を単一runした結果ではない。タイトル6件ではmock通信、変更済み本文、Unicode bytes、通常生成→命名→保存→再起動、再生成/続行の非起動、同ID/同本文import後の遅延応答非適用、保存失敗と設定root保全を確認した。

失敗は区別する：最初の2 buildは引数label/escaping不足で実行前に失敗。bundle初期化失敗ではタイトルと生成の接続testが失敗。その修正後の残る2ケースは新fixtureのnode ID個数不足とURLProtocolのhttpBody取得不足で失敗し、既存RemoteRequest.fixtureBodyと実append経路の必要ID数へ合わせた。期待値や比較を緩めていない。ログは `/private/tmp/weavelet-title-{web-final,web-source-final,types-final,freshness-final,catalyst-source-fixed,catalyst-title-final}.log`。

省略した重複確認：変更のない保存/暗号化同期の全往復、全iOS依存監査、全Web/nativeテスト。追加SDKはない。native利用量は共有文字数fallbackでありWASM tokenizerによる正確なWeb token数との一致は未確認。実API通信、今回の設定UI操作、実機は未確認。実Google/CloudKit/iCloud Driveの相互運用と残機能の完成条件は維持する。

## 主生成の利用量・OpenRouter観測保存（2026-10-13）

実Web callerを先に調査した。remote正常returnで現在ticketの生成先だけ累算し、Stop・通信失敗・localでは累算しない。観測されたprompt/completion値が両方ある場合はそれを優先してimageTokensを維持し、それ以外は保存済みchatから実Webの送信文脈を再構成する。この既存処理を共有元に切り出し、Webのworker計測は維持した。送信時のtoken limit/retryやfavorite由来providerと、従来の累算文脈/keyが異なる場合がある点は既存仕様の残差として明示する。

nativeは検証済み要求originを共有処理へ渡し、OpenRouterの対象originだけusage/headerを観測する。本文・観測・利用量を同じatomic保存へ接続した。保存失敗では元memory/diskと未保存生成結果を保持し、再試行で一度だけ加算する。未変更entryと観測時のimageTokensの巨大整数・未知属性は保持する。変更対象counterのJSC安全範囲外は保存拒否とし、丸めた値を書き込まない。同じ境界検証をタイトルにも共用した。

独立Astra P2：usage-only SSEの後に本文未到着でStop/切断すると空出力earlyreturnで観測が失われる経路を修正。空本文でも観測があればassistant/観測保存へ進め、累算禁止を維持した。限定再監査は新規なし。統合時に同一chatの他の生成中nodeをsummary判定へ渡す既存Web挙動も保持した。

成功範囲：workerのWeb関連39件と型検査を再利用し、複数生成の影響4件を限定再確認した（1件追加で共有側40件）。親はremoteOutput4+title3の7件、Web型検査、bundle鮮度が成功。Web合計47件の成功範囲であり、単一runではない。Catalyst初回31件中30件成功。新通信失敗fixtureがデータと切断を同時に送っていたため、実byte消費前に切断し観測assertが1件失敗した。データ受信後に切断するfixtureへ修正し、期待値を維持した。監査修正後はタイトル6+利用量関連4の10件を限定確認し成功。現在Remote22+Local4+Title6の32件の成功範囲で、最終ソース全32件の単一runではない。監査修正後の最初のbuildはthrowing条件式のtry不足で実行前に失敗した。Web追加header testは実parserが使用するX-OpenRouter-Cache-Statusへfixtureを訂正して成功した。

ログ：`/private/tmp/weavelet-usage-{web-final,types-final,freshness-final,catalyst,catalyst-limited,catalyst-fix}.log`。変更のない保存/暗号化同期全往復、全依存監査、全Web/native suiteを反復しない。この段階で新規UI/SDKは追加していない。利用量設定/費用UI、正確なtoken数、OpenRouter事後照合、実APIと実クラウド相互運用を残件とし、全体目標を継続する。

## 利用量設定・費用表示・live推定（2026-10-13）

WebのgetModelCost/isKnownModel/calculateUsageCost、費用表/sidebarの合計判定を純粋な共有元へ分離し、実Web callerとnative bridgeを接続した。custom/favorite/cacheの優先順、モデル未登録と料金情報欠落の区別、無料とゼロの違い、toPrecision(3)を維持する。全体の設計を作り直さず、UI・保存・workerだけ各環境の境界へ残す。

iOS設定へ累計ON/OFF、モデル別費用と合計、確認付きリセットを追加。ON/OFFはcountTotalTokensだけ、リセットはtotalTokenUsedだけ変更し、他のroot・未知属性・会話・進行中生成を維持する。live表示は共有送信文脈と文字数fallbackのoverlayを費用計算へ渡し、元memory/diskへ保存しない。実Webのcompletion先頭typeによるlive計数条件も共有関数へ接続した。価格・live値は推定表示であり、実請求額とは区別する。

成功結果：workerの共有費用関連17件とWeb/shared型検査、合計共通化後の影響9件を再利用。親のlive共有5件、Web型検査、bundle鮮度も成功。Catalyst Remote22+Title6+新設定3、計31件の成功範囲を確認。最初の2 buildはthrowing nil-coalescingのtry漏れと、テストがprivate generation setterへ代入したため実行前に失敗。テストはsetterを公開せず実mock URLSessionからstreamを開始する経路へ変更した。実行後は31件中30件成功、live fixtureのproviders root未指定が1件失敗した。実nativeと同じ既存defaultsを参照するfixtureへ修正し、その1件のみ成功。合計共有元変更後も価格接続2件だけ再確認して成功した。全31件の最終ソース単一runとは扱わない。

新設定3件はtoggle/reset後の再起動・他項目保持、保存失敗時memory/disk保持、実mock stream中のlive report非保存と設定/reset後の生成保持を確認する。独立Astraの機能群監査と合計共有化の限定確認は新規なし。ログは `/private/tmp/weavelet-cost-{web-live,types,freshness-final,catalyst,catalyst-retry,catalyst-final,catalyst-live,catalyst-summary}.log`。最新mainはfetchし、origin/main 7a0a383aが既に統合branchの祖先であることを確認した。

変更のない暗号化同期全往復、全依存監査、全suiteを反復しない。実UIの手動操作、正確なtokenizer、OpenRouter事後照合、実APIと実クラウド相互運用は未確認。既存同期/I/Oの全体完成条件は維持する。


## iPhone Airインストール・ビルド環境再確認（2026-10-13）

監査済みcheckpoint 8d2910bcを専用worktreeから実機へ導入した。未完成の要約機能と元worktreeの未コミット変更は保全し、導入対象へ含めていない。Xcode 27.0 (27A266a)、iOS/macOS SDK 27.0、初回コンポーネント設定完了を再確認。追加済みアカウントのAutomatic signingによりcom.weavelet.nativepilotのCloudKit対応プロファイルでDebugビルド成功。署名済みappのコンテナーはiCloud.com.sstcr.WeaveletCanvas、環境はDevelopment。codesign検証成功、iPhone Airへインストール成功、最終起動成功とプロセスPID 21382を確認した。

署名解決の変更はチーム設定、コンテナー権限の明示値、Markdown同梱フォルダのMarkdownResourcesへの変更に限定。iOS bundleでResources名が予約される問題を回避した（Apple公式: https://developer.apple.com/go/?id=bundle-structure ）。既存アセットは保持し、generator・bundle参照・接続テストを同じパスへ修正。独立Astra監査は新規なし。最終差分確認成功、Catalyst MarkdownViewTests 1件成功。

失敗は区別する。初回署名はアカウント/プロファイル不足、その後はコンテナー変数の解決とbundleフォルダ名で失敗。初回Catalyst確認は専用worktreeにnative library cacheがなく実行前に失敗し、既存cacheをコピーしてsource/input/artifactの既存ハッシュ検証を通した後に成功した。最終再インストール直後の起動は端末ロックで失敗したが、解除後の再起動とプロセス確認は成功。ログは/private/tmp/weavelet-air-{final-build,final-install,final-launch,final-processes,markdown-catalyst-final,native-cache}.log。

既存の共有業務処理・同期テスト結果を再利用し、全suite/暗号化同期往復/依存監査を反復していない。実機の画面手動操作と実クラウド相互運用は未確認。Development権限での起動はWeb Production同期の成功証明にはならない。


## バブル要約・圧縮（2026-10-13）

Web実処理由来の選択・原文保持・生成要求・評価・CRUD・表示判定を共有し、nativeへ接続。UIは単一/ここまで/範囲target、要約/圧縮、停止、設定と保存候補を扱う。flat message-Nとwire NはbranchTreeがない場合だけ変換し、branch IDを再解釈しない。unknown値と巨大整数はopaque参照で保持、対象counterの安全範囲超過は保存を拒否する。応答が古い/出力上限到達でも実Web同様の利用量更新だけを反映し、無効な要約を書き込まない。設定rootの削除は完全なstate置換経路を使い、旧rootをmergeで復活させない。

再利用した成功結果：共有workerの7ファイル53件と型検査。親統合後は変更に影響する共有操作・要約送信・submitHelpersの3ファイル26件、Web型検査、bundle鮮度を確認し成功。Catalyst初回は10件中title既存5件成功。要約prepareが共有planの返却にないstatusを要求して全要約がnilになる不具合を修正。新fixtureのcontentHash参照欠損と、未登録provider指定を実データ構造に合わせて修正した。root削除title1件とSummary4件の限定run成功、その後の監査修正と生成→自動採用→再起動接続test追加後はSummary5件成功。計11件の成功範囲であり、最終ソース全11件の単一runではない。保存失敗時memory/disk保持、設定root削除、unknown巨大整数、unsafe counter、stale原文、flat変換、実mock通信と生成後保存を含む。

独立Astraはplan返却判定、重複終了jobによる生成中job隠蔽、削減成功の未採用、omit時の表示/送信不一致を指摘。plan必須request読取、busy優先＋重複終了job除去、共有use操作を利用量と同atomic保存へ接続、既存送信omit条件を共通関数へ分離して表示にも適用した。指摘範囲の再監査は新規なし。SummaryIdentityはUnicode正規化で別IDを混同しないようUTF8 bytesで比較/hash。古いtaskのdeferが新ticketを解除しない。ログは/private/tmp/weavelet-summary-{bundle-final,freshness-final,types-final,web-final,catalyst,catalyst-fixed,catalyst-final}.log。

省略した重複確認：全保存/暗号化同期往復、全依存監査、変更のない全suite。追加SDKなし。画面手動操作、正確なtokenizer、実API/実クラウド同期、要約追加後の実機再インストールは未確認。Air上の導入済み版は前の監査済みcheckpointを維持する。全体目標の完了とは扱わない。


## 手動オンライン評価とWeb配置へのUI調整（2026-10-13）

共有coreのWeb実caller接続、native context/request/parse/result保存を統合。安全性はOpenAI専用Keychain credential、品質は既存provider解決とOpenRouter routing制約/補助要求cache無効を使用する。JSCにURL globalがないため検証済native URL metadataを共有判定へ渡す。秘密値は共有入力へ渡さず既存bindEnvelopeで同一originへ束縛。差分はraw stateへ適用し、未変更dimension/unknown属性と新安全性応答の精密値をopaque参照で保持する。世代比較はUTF8 encoded bytes、delta本文は既存共有resolverへ接続した。

再利用する成功結果：共有担当の関連19件・Web型検査。監査修正後の影響core8件が成功、変更のないhookを再実行しない。bundle生成/鮮度と差分確認成功。Catalystは評価adapter3件＋store1件、Markdown表示1件の5件の成功範囲。評価3件はUI分割修正後のrun、store1件はFAKE捕捉修正後の限定run、UI最終変更後はstore1＋Markdown1を確認した。最終5件を単一runした証拠ではない。代表store経路はimport→評価結果保存→再起動→exportの評価root一致、書込失敗時memory/disk不変と再試行成功、未知巨大値保持を確認。追加の暗号化同期全往復は、同期・変換基盤が不変のため既存corpus/wire成功を再利用する。

独立Astra指摘：投影stateに差分を適用してopaqueRefが残る問題、新result再投入による精密値丸め、必須OpenRouter制約と非対応endpointの不一致を拒否しない問題を修正した。UIでは生成中に無効な表示切替項目を選べる問題をdisabledで修正。変更範囲の限定再監査は新規なし。保存・通信・root保持の全再監査は行っていない。

失敗は区別する。初回安全性testのopenRouter:nullは実Web validatorが不正設定として拒否するため、制約なしfixtureは属性未指定へ訂正した。UI追加後は巨大View式の型推論でbuild失敗し、既存message行構築を小さい関数へ分離した。store追加testはURLProtocolがfixture.invalidを捕捉せずDNS失敗し、FAKE host捕捉を追加して元assertのまま成功。以前の失敗を保存失敗の成功証拠に数えない。ログは/private/tmp/weavelet-evaluation-{bundle-final,freshness-final,catalyst,catalyst-final,catalyst-ui-fixed,catalyst-store-fixed,layout-final}.log。

Catalyst実画面は別bundle IDのFAKE cloneで確認。初回表示でMarkdown切替の独立行と大きいタイトル/Scroll終端の入力欄が残ることを観測し、右上menu・inlineタイトル・下端固定へ修正。最終画面で重複行消失、右上操作/本文端/固定入力欄、テキスト切替を確認。手動評価sheetの品質/安全性・範囲controlsを表示したが実API実行はしない。検証アプリは終了しprocess消失を確認、通常store/Keychainを操作していない。iPhone狭幅・Dynamic Type最大・ソフトウェアキーボード/IME実操作と実APIは未確認。Airの導入版は前のcheckpointを維持する。

自動/local/hybrid評価、評価設定UI全体、main split/sidebar/branchのWeb配置再現、実クラウド同期は残件。最新origin/main 7a0a383aをfetchし統合branchの祖先と確認済み。部分機能の成功を全体完了にしない。


## ローカル品質評価・サイドバー（2026-10-13）

WebのlocalEvaluation/useEvaluationからprompt・fallback・400/150文字切詰め・採点/解析・local/hybrid条件を共有し、nativeは既存GGUF生成adapterの5軸実行と保存へ接続。共有担当の25件・Web型検査を再利用、bundle生成/鮮度と差分確認成功。Catalyst初回はlocalGeneratorのescaping指定不足でbuild失敗、修正後NativeLocal4＋既存/統合評価5の計9件成功。停止/stale/空応答fallback/累積callback/進捗/モデル置換拒否/秘密を読まないlocal分岐/保存失敗/再起動/未知metadataを確認。さらに既存の隔離tiny GGUFで実5軸推論1件成功（6.747秒、source=local、15進捗、5個の有限な採点値）。FAKE GGUFを実推論と呼ばず、Webとの結果同一性や評価内容の有用性を実model試験から主張しない。10件の成功範囲は単一runではない。

新classifierやSDKは追加せず、Transformers moderationをGGUFで近似していない。モデルfileのdevice/inode/size/mtimeをaxis/fallback前後と最終適用前に照合する。深いstate bytes検査はaxis間と保存前、token callbackはTask取消だけとし、各tokenで全documentをserializeしない。独立Astraは新規なし。ログ: /private/tmp/weavelet-local-evaluation-{bundle,freshness,catalyst,catalyst-fixed,real-gguf}.log。モデル資産/同期/暗号化基盤の未変更成功は再利用し、全往復や全依存監査を反復しない。

sidebarはNavigationSplitViewで既存会話/フォルダーViewとcallbackを再利用。compactの制御には[Apple公式preferredCompactColumn API](https://developer.apple.com/documentation/swiftui/navigationsplitview/init(columnvisibility:preferredcompactcolumn:sidebar:detail:))を使用した。FAKE Catalyst実画面で一覧/チャット/下端入力の同時表示、標準toggle、タイトルの欠け解消、0件選択footer非表示、選択1件の移動/削除iconの収まりを確認した。子sidebarのtraitがcompactになるためwideにも閉じるbuttonが残った問題は、root traitでoptional callbackを渡して修正、限定Astraは新規なし。UI最終build成功（/private/tmp/weavelet-sidebar-final-build.log）。確認アプリ終了とprocess消失を確認。通常データ・Keychainへ触れず、移動/削除は実行していない。

iPhone compact・最大Dynamic Type・キーボード、Web/nativeの実クラウド相互運用は未確認。nativeの分析モデル割当/資産管理UI、Transformers分類器、auto/hybrid評価、iPhone向けGGUF engine buildは残る。前の「未接続local品質」はCatalyst単一GGUF品質まで更新したのであり、全local完成にはしない。一覧並替えには既存native操作APIがなく、サイドバー移植だけでは未実装部分を補っていない。

## ローカルモデルの役割設定（2026-10-13）

Webのlocal-model-sliceの有効化・役割割当setterをpure共有元localModelRoleへ切り出し、実Web callerとnative JSC接続が同じ処理を呼ぶ。native設定画面では有効化、generation/analysisの割当・解除、既存単一GGUF定義への端末ファイル再指定を接続した。モデル定義/他task/保存metadataはdeltaの対象外で、未知形式の定義も削除しない。既存LocalModelFiles.installの一時copy＋renameを再利用し、新規SDKは追加していない。

再利用した成功結果：共有元3件、Web型検査、bundle生成/鮮度。native接続2件は保存失敗時メモリ/disk保持、raw巨大数値・他task・metadata保持、保存/再起動と端末ファイル未指定の拒否を確認。初回fixtureはV3 extrasをsnapshot settingsと誤認して空配列の添字で失敗。実syncDocument.v3DocumentLayoutでは共有5root以外がsidecarとなるため、実settings経路applySnapshotへ修正しXCTUnwrapを使った。元V3 sidecarの書出し保持も別に確認し、期待値を緩めていない。保存失敗testの初回成功を再利用、変更したtestのみ再実行成功。ログ /private/tmp/weavelet-local-role-catalyst{,-fixed}.log。独立Astraは一式/fixture限定追確認とも新規P2以上なし。

FAKE Catalyst cloneで設定route、役割menu、空定義説明と配置を確認。確認アプリ終了とprocess消失を確認。通常store/Keychainへ触れず、有効化や割当の手動保存・ファイルpicker操作は行っていない。新しいモデル定義の登録、download、複数GGUF/Transformers管理、auto/hybrid評価は残件。V3未知extrasの保全とlive store設定は別の経路であり、V3 extrasを勝手に設定へ昇格しない。実機狭幅・最大文字サイズ・実同期相互運用は未確認。

## iPhoneOSのnative GGUF engine（2026-10-13）

Web由来の同一wllama/llama pin・patch・lowbit C・samplerをiPhoneOS arm64へビルド。Swift処理の別実装は追加せずLocalLlamaの既存実行経路のplatform guardだけ広げた。Catalyst成果物とiPhoneOS成果物を分離し、それぞれのbuild-input/artifact hashをverifyする。暗号/同期/署名権限は変更していない。

担当成功結果：両engine build/verify、両unsigned app build、iPhone archiveのMachO IOS/min17.0確認。親で成果物を取り込み両verify成功、署名付きAir向けbuild/install成功（/private/tmp/weavelet-air-engine-{build,install}.log）。entitlementは既存team/appIDとiCloud.com.sstcr.WeaveletCanvas・CloudKit・Developmentを維持。独立Astraは新規P2以上なし。端末キャッシュへ既存1.1MBの検証用GGUFをコピーし、既存5軸実推論testを実機で実行する準備をした。XcodeはAirロック解除待ちの後、runner起動前の接続喪失でexit65終了。device lockStateもpasscodeRequired=trueを確認したため、テスト本体の失敗や成功とは扱わない（/private/tmp/weavelet-air-engine-real-test.log）。ロック解除後に同じ対象testを再実行する。物理端末runnerで使用するapp container相対GGUFパスをtestに追加、業務処理は変更しない。

未変更の共有業務rule/全同期往復/全依存監査は再実行しない。iPhone実推論、広いモデルのメモリ/消費電力、狭幅UI/IME/Dynamic Type、Production CloudKitとWebの実相互運用は未確認。今回のDevelopment署名installだけではクラウド互換性完成とはしない。

## フォルダ階層のサイドバー表示（2026-10-13）

WebのChatHistoryList/ChatFolderと既存folderHierarchy helperを基準に、共有folderRowsで親IDの正規化・親子順・深さ・可視状態・pathを投影する。nativeは表示順/インデント/折畳みをこの情報へ接続し、子フォルダを親の会話より前へ表示する。壊れた親chainは既存Web helperと同じくrootへ露出する。移動menuは同名フォルダをpathで区別、削除説明は子と会話がparentへ繰上がる実共有処理へ合わせた。

独立Astra P2：wide sidebarの表示中に検索/履歴で別階層chatへ移るとonAppearが再実行されず選択会話がhidden。選択IDのUTF8 bytes変更時にも共通revealを呼び、既存共有move(empty chatIds)で祖先を開くよう修正。親で確認した空folder IDのroot sentinel自己再帰は、shared表示入口で非空key==idのidentity検証を追加して拒否。循環parent chainのroot表示とは区別し、元データを削除・再構築して隠していない。

共有18件・Catalyst folder7件、bundle生成鮮度、差分確認が成功。Catalyst初回は専用worktreeのengine cache未準備で停止、親の検証済みcacheをcloneして成功。独立Astraの限定再監査は新規P2以上なし。変更のない保存/暗号化同期の全往復は再実行しない。実画面の階層/選択遷移、狭幅/大きな文字は未確認。drag並替え・parent編集・Web全機能再現完了とは扱わない。最新origin/mainをfetchし、統合branchの祖先で追加差分なしと確認した。

## 単一GGUFの新規登録：監査指摘の修正中（2026-10-13）

Webの単一定義/ID・重複判定・未指定役割の自動割当をpure共有元へ分離し、実Web callerとnative登録UIへ接続。nativeはOSのSHA256、copy/hash照合、no-overwrite link、既存原子的state保存を担当。未知model metadataはopaque参照で維持し、OPFSのsavedModelMetaを端末コピーだけで捏造しない。新規SDKは追加していない。

担当の共有3件/Web型検査/bundlecheck/Catalyst境界2件は成功。担当が誤って開始したSimulator runはINT停止・未確認扱い、このtaskが起動したUDIDのみshutdownし、指定されたCatalystで再実行した。親統合の生成provenance競合は双方の実sourceから再生成して解消、bundlecheck成功。

独立AstraのP2は4件：NFC/NFD model IDの別定義混同と世代見逃し、duplicate候補scan後のGGUF再指定見逃し、Task取消後の登録継続、実Web callerでの既存ID衝突検証の未接続。担当へ限定修正を依頼済みで、現段階は受入未完了。主生成との競合はcommit前syncInputSnapshotの既存guardで拒否されるため追加guardは不要。修正後は該当範囲のみ確認し、既存全同期/全suiteを繰り返さない。

### 同機能の指摘解消・統合確認

42756ae3で4件を限定修正した。IDはUTF8、設定世代はencoded bytes、既存候補fileはOS世代をscan前後/commit前に検証、各await後とfile確定/state保存前にTask取消を確認。Web callerも現登録IDを渡してOPFS保存前に衝突を拒否する。追加Catalyst2件と既存2件の成功結果を再利用、Web共有3件/型検査/生成鮮度成功。独立Astra限定再監査は新規P2以上なし。親統合後にmodel import2＋folder hierarchy1の接続3件を実行し全件成功（/private/tmp/weavelet-local-import-hierarchy-integration.log）。未変更の全同期往復/全suiteは反復していない。

FAKE Catalystで実file pickerから既存検証用1.1MB GGUFを新規登録し、生成/分析の自動割当、端末内ファイルあり、有効化を確認。そのまま本文の品質評価へ接続し、5軸進捗→完了、source=localの5有限score保存と合成会話3件保持を確認した。toyモデルの評価品質・実用性を保証した結果ではない。実API/クラウドへ送信せず、通常store/Keychainを変更していない。

同じ隔離実画面で親子インデント、Workの折畳みによるchild消失、全会話検索でNested chatへ移動した際の祖先展開と本文到達も確認。表示中会話の強調とselected accessibility traitをWebのactive rowに合わせて追加し、Catalyst buildと実表示を確認した（/private/tmp/weavelet-sidebar-active-build.log）。確認アプリ終了とprocess消失を確認。今回のGGUF登録/階層UIはAirへ再installしていない。iPhone実推論・狭幅/大きな文字・実クラウド相互運用、複数GGUF/分類器/自動評価など全体残件は維持する。


## 文字同一性・分析モデル寿命・ローカルprompt境界（2026-10-13）

5a8b2b7aではOrderedJSONの文字列とobject keyの同一性をJavaScript同様のUTF8 byte比較へ合わせた。数値表記・項目順・保存形式を変更しない。担当native全275件のrunは1skip・1failureを含み、全件成功とはしない。失敗したNodeOptionsStateTestsは変更前にも再現し、I/O corpusの不正OpenRouter設定を生成要求として使っていた。実Web validatorに従い元設定の拒否を確認したうえで、要求専用の有効configに限ってomitted挙動を検証するよう訂正。保存corpusと情報保持assertは維持し、該当testのみ成功。ログ /private/tmp/weavelet-{json-equality-test,json-equality-baseline-test,node-options-valid-request}.log。独立Astraは新規P2以上なし。

8351c4eaはWeb同様に品質評価一式でGGUFを1回loadし、各軸context/samplerは独立させた。scoped ownerと生成taskのstrong referenceで解放順を維持する。担当関連26件成功、親で実GGUF5軸とdecode取消の2件成功（/private/tmp/weavelet-model-session-integration.log）。loader1回/context5回を確認したが、消費電力や大モデル性能の証拠ではない。50c4bfd1はUTF16文字数truncateで生じる孤立surrogateを、Web wllamaのTextEncoderと同じ置換文字にする処理をbridgeのprompt出力だけへ適用。共有1件/型検査/bundle鮮度とnative接続1件成功、独立Astra新規P2以上なし。元会話本文や外部JSON全体の正規化は行わない。

## 生成中のチャット行と入力欄の配置（2026-10-13）

7b979c0aで通常appendにも既存Web共有generationPlanを利用し、生成開始時にassistant IDを予約する。要求はrequestPathからplaceholderを除外し、確定時は同じIDを更新。生成中・保存失敗の出力は対象MessageView内へ表示し、従来の末尾別枠と空行の重複を除いた。空出力時の空assistant保持は実Web共有finalizeに基づくため、旧nativeの「assistantなし」期待だけを訂正した。タイトルの通常append条件、prefill、usage、部分保存・保存再試行は維持する。

親統合でRemoteGeneration22件＋ConversationTitle6件の28件が成功（/private/tmp/weavelet-inline-generation-integration.log）。共有元業務ruleと保存/同期基盤の既存成功は再利用し、全暗号化同期往復を反復しない。独立Astraは新規P2以上なし。

入力欄はWeb EditViewの本文→操作列に合わせ、本文を全幅で置き、その下に左の生成設定・右の送信/停止を配置した。Binding、画像入力、操作時のguardには変更なし。Catalyst最終build成功（/private/tmp/weavelet-composer-layout-build.log）、独立Astraの限定追確認も新規P2以上なし。実画面確認はMacのロックにより開始できず、未確認として残す。iPhone狭幅、IME、最大文字サイズ、生成行の実画面・スクロール追従、Airへの今回版導入は未確認。WebのBranch editor/分割表示は表示styleとは別機能であり、吹き出し切替で代用して完成扱いにはしない。


## 現行58保存rootの代表互換経路（2026-10-13）

実Web persistence.tsのFULL_PERSIST_KEYSとhistorical corpusを照合し、mainで追加されたlastContentEditedAt・bubbleSummaryConfig・branchSwipeDirectionをcurrentPersistenceRootsとして補った。歴史55rootの旧snapshotを変えず、最新58rootの非default値を同じfixtureから確認する。summary configは有効な最小設定と未知metadataを含み、送信要求の不正設定を検証用に捏造しない。

Web hydration→partializeの全値比較6件成功。Catalyst代表2件ではCloudKit payload→受信→全root/順序比較→保存再起動、Google暗号化upload→鍵復元→別client download→再起動を確認した。Googleは実Web SYNC_LOCAL_SETTINGSがbranchSwipeDirectionを除外するため独立clientの端末設定を維持し、残り2rootは同期されることを確認。CloudKitは3root全てを保持する。これは両providerの規則差に従う検証であり、全項目を無条件に同期するよう仕様変更していない。

初回Googleは新receiverに保存済み文書がなくpublicationSnapshotが拒否された。既存受信fixtureと同じく空V3を先に読み込んで独立保存を準備し、元assertを維持して再実行成功。ログ /private/tmp/weavelet-current-roots-{web,native}-final.log、失敗は /private/tmp/weavelet-current-roots-native.log。独立Astraは新規P2以上なし。既存保存失敗/誤鍵/競合/取消/全wireの成功結果は基盤不変更につき再利用し、全suiteを繰り返していない。検証はFAKE transport・隔離storeであり、実CloudKit/Google接続や全ネスト項目の全組合せ完成を主張しない。

9d764849ではWeb自動評価のtext-only抽出とphase別auto判定を共有autoEvaluationPlanへ切り出し、実Webpre/post callerとnative用bridgeへ接続した。担当関連16件・型検査・bundle鮮度が成功、独立Astraは新規P2以上なし。nativeの生成前後接続は別担当で実装中であり、この共有抽出だけを自動評価全体の完成とはしない。


## 自動評価：生成接続と監査指摘の修正中（2026-10-14）

c9c62bcfで実Web useSubmitのOpenRouter送信前制約をautoPreSendSafetyAllowedへ切り出した。画像のみでもpre safety autoかつengineがlocal以外ならhard制約を拒否する条件を共有し、autoPlanの空text判定と分ける。親初回bundleはWeb storeを含むre-export元openrouterControlsをimportして失敗し、同じ関数のpure元openrouterRequestへ接続して再生成成功。共有関連17件・型検査・最終鮮度成功、存在しないuseSubmit.test.tsを新たに実行した証拠とは数えない。

1ec6d172/d4e22492でnative生成前後のnonblocking評価・予約済みassistant IDへのphase別保存・設定UIを接続した。optional OpenRouter設定は不在keyを省略し、JSON nullによるshared validator拒否と区別する。担当12件＋追補1件の成功を再利用し、親で新しいBranch bridgeも含むbundleに対する評価13件が成功（/private/tmp/weavelet-auto-evaluation-integration.log）。保存元の精密値/未知属性を保持し、保存成功前に結果を公開しない。Local/Hybrid classifierは未接続として明示し、remoteへ偽装しない。

独立AstraはP2を2件確認：merged user本文を評価する一方で最後のraw user一件しか世代照合せず、前方user編集/最新omittedで古い評価を保存できる点と、一方dimensionの準備失敗が他方の評価も停止する点。必要送信依存の照合とdimension別準備エラーへ限定修正を依頼した。現段階は一式の受入未完了。指摘修正後はその影響範囲だけ確認し、既存全同期・全suiteを反復しない。実API/実機/狭幅UIは未確認。


### 自動評価の指摘解消と結果適用の共有

5d93b13bで送信requestPathの順序・role・解決済み本文と該当omittedをencoded bytesで照合し、生成先assistant自身を除外した。安全性/品質の準備は別do-catchとし、片方の失敗を表示しても準備できた側は実行する。担当Catalyst関連15件成功、omitted本文assertの限定追加確認も成功。独立Astra限定再確認は前回2件解消・新規P2以上なし。親結合2件（生成並行auto品質＋graph view保存失敗）も成功した（/private/tmp/weavelet-branch-auto-integration.log）。

結果適用では、実Webautoのentry全置換とnativeのmanual context付与が別の規則になっていたため18a9feb6でapplyAutoEvaluationResult/setAutoResultへ共通化した。成功dimensionだけ更新し、未更新dimension/未知entry属性を保持。更新dimの旧manual contextを除き、incoming phaseとlocalSafetyを同じ元で扱う。手動set-resultは不変更、nativeはopaque参照でraw精密値を復元する。共有6件・型検査・bundle鮮度、Catalyst境界2件成功。独立Astraは新規P2以上なし。新SDK、別状態管理、テスト比較の緩和は追加していない。

## 分岐図・分割表示のnative接続（2026-10-14）

46f32d04/fee105fd/5513f7f2でselected chatの共有配置→native card/edge→共通navigateを接続。右上のChat/Branch editor/左右・上下splitを既存snapshot.state.chatActiveViewへ保存し、吹き出しstyleやSavedChatStateへ二重保存しない。flat chatは既存shared ensureで変換して元raw値へ差分を復元し、保存失敗時は変更を公開しない。入力生成/参照delta解決/JSC配置はdetachedで行い、元delta/unknown metadataを再保存用に再構築しない。

統合確認でInt.max request IDのJSC丸め、NFC/NFD Stringキー衝突、delta preview空を修正。request IDはUInt32、描画/ForEach/Task identityはUTF8 bytes、previewは参照hashだけ共有resolverで解決する。独立AstraのP2「旧graphが現在の別chatへ作用」はgraphと生成元keyを保持し、公開/表示/click時に最新keyを照合、navigate先も生成元chatIDとする限定修正で解消。同node IDを持つ2chatの回帰を含むCatalyst7件成功、先のNav/Store成功は再利用。独立Astra限定再確認は新規P2以上なし。

Macのロック解除後、通常storeと別のFAKE合成fixtureで右上切替・左右split・branch-only・nodeclick→本文到達を確認。実表示でcomposerがgraphまで横断していることを観測し、20ea0be1でchatContent内へ3行移動、Chat pane下端固定へ修正。最終Catalyst build成功（/private/tmp/weavelet-branch-pane-final-build.log）、限定Astra新規なし、最終実画面で左右splitの入力がChat pane内に収まり、branch-onlyでは入力領域がないことを確認した。アプリを終了し両検証cloneのprocess消失を確認、通常store/Keychain/実クラウドに触れていない。上下splitの実操作、iPhone狭幅/最大文字サイズ/IME、pan/zoomの実手操作は未確認。複数chat graph・node編集/多選択/比較等のWeb全graph機能は残件であり、閲覧と到達を全完成としない。

## 分岐node操作と比較の共有元（2026-10-14）

4196cc96で分岐cardのmenuから既存NodeOptions、範囲clipboard、branch削除確認へ接続した。本文側と同じhandlerを使い、属性更新/コピー/削除規則をSwiftで再実装していない。対象は選択会話の全nodeで、非表示branchも扱う。独立Astraは新規P2以上なし。Catalyst build成功（/private/tmp/weavelet-branch-actions-build.log）。

FAKE Catalyst実画面で非active nodeのlabel/star/pin保存、同nodeの範囲copy、削除確認の表示と取消を確認。保存fileでactivePath不変、未知node/body属性の保持、既存合成会話4件保持、clipboardの対象ID/属性保持を確認した。確認clone終了とprocess消失を確認。通常store/Keychain/実通信を使用していない。cut/paste・削除の実行、iPhone狭幅/最大文字サイズは未確認。

d8c15c72/5a0e39baでWeb BranchDiffModalの行構築をpure branchDiffへ移し、実Web callerと固定JSC bridgeへ接続した。delta解決・textのみ抽出・role選択・差分行を同じ元で処理する。native比較画面への接続は次の範囲であり、この切出しだけで比較機能完成とはしない。

fc195ef1/f045577aで独自の二次元LCS tableを既存diff-match-patch1.0.5へ置換した。新依存を追加せず、単語/空白をJSON行へ写して既存line helperを利用し、全行を復元する。辞書上限とdeadlineでは強調粒度が粗くなるが、元の両本文は保持する。同一長文が辞書上限の非対称処理で変更扱いになる独立AstraのP2は、同一入力の早期equal返却と回帰caseで修正した。限定再監査は新規P2以上なし。

共有6件（両辞書上限、deadline、Unicode/空白と両本文復元を含む）、型検査、生成bundle鮮度、実JSC呼出は成功。ログ /private/tmp/weavelet-shared-word-diff-{web-final,types,bundle-final}.log。既存固定Apache-2.0依存の利用であり、archive済み公式repositoryを保守継続中とは扱わない。helperと版の境界は[公式利用例](https://github.com/google/diff-match-patch/wiki/Line-or-Word-Diffs)に従う。空白の強調区切りは旧算法と異なるcaseがあるが本文一致を維持する。deadlineは処理全体のhard timeoutではなく、Web同期描画の応答時間・大モデル/実機性能は未測定。未変更の全暗号化同期suiteを反復していない。

### 比較画面のnative接続

03c6f8e3で現在枝との比較・同会話の2node比較を分岐menuへ接続した。実Web handleNodeDiffのLCA/trimを既存branchUtilsのbuildNodeDiffPathsへ切り出し、Webとnativeが同じ元を呼ぶ。nativeはdeltaの読取り投影、背景JSC呼出、SwiftUIの差分/両原文/選択copyだけを担当し、保存文書を変更しない。source key変更で比較対象とsheetを破棄し、結果公開時にも会話IDと元データを照合する。

担当Catalyst関連9件（比較境界の追加2件を含む）・build・型検査・bundle鮮度成功を再利用。ログ /private/tmp/weavelet-native-branch-diff-{test,build,tsc,generate}.log。統合は同sourceのcherry-pickのみで差分確認成功、独立Astraは新規P2以上なし。FAKE実画面確認はMacロックで開始できず、比較sheet表示/VoiceOver/狭幅は未確認。clone processも起動していない。複数会話graph/多選択の操作は後続範囲であり、全Branch editor完成とはしない。

## 会話一覧・共通操作・設定の配置（2026-10-14）

7d847396でWeb Menuの配置を基準に、一覧上部へ既存検索（library初期mode）、一覧下端へ同期/ファイル/設定を置いた。共通file importer/exporter・取込確認・検索/設定sheetはNavigationSplitView全体へ接続し、compact一覧から利用できるようにした。compact/detailOnlyでは詳細側の代替入口を保持する。設定は一般・会話設定・同期とデータ・評価・ローカルモデルへ分類、画面名を「設定」にした。通常会話行はiconと一行title、明示的選択modeだけ44ptのcheck操作を出す。既存選択/move/delete/生成guard/保存失敗表示を再利用し、新規業務処理は追加していない。

担当最終Catalyst build・差分確認成功（/tmp/weavelet-native-sidebar-placement-{build,diff-check}.log）を再利用。親統合の差分確認成功、独立Astraは新規P2以上なし。UI入口の移動だけのため業務ruleや全暗号化同期suiteを複製・再実行しない。実表示、compactでのsheet遷移、最大文字サイズ/VoiceOverはMacロックにより未確認。実機へ今回版を再installしていない。プロンプト管理など未実装機能を配置変更で完成扱いにはしない。
## プロンプトライブラリ・CSV・既存適用処理の共有（2026-10-14）

4bb71b7bでWeb popup/inline/Import/ExportのCRUDとCSV処理をpure promptLibraryへ接続し、native設定から名前/本文/分類label、追加/削除/全削除、保存/取消、CSV追記/置換とCSV/gzip書出しを利用できるようにした。CSVは実Webと同じheader付きPapaParse、Object.valuesの先頭2列、各行の新ID、名前/本文のみの書出しを維持する。未編集の未知prompt/root属性・順序・精密値はopaque参照と既存applySnapshotで保持する。古いdraftは保存前に拒否し、保存失敗では元のmemory/diskを維持する。

独立AstraのP2「CSV全読込/JSC変換/UUID生成/gzipの同期UI実行」はdb7a353dでdetachedへ移した。公開前に操作token・画面表示・draft ID/内容・保存元snapshotを照合し、取消/離脱後の結果を拒否する。限定再監査は新規P2以上なし。共有元2件、native境界2件とasync追加1件（最終関連3件）、型検査、Catalyst build、bundle鮮度成功を再利用。親統合後の生成hash/差分確認も成功。ログ /private/tmp/weavelet-native-prompt-{vitest,test,tsc,freshness,build}.log、/private/tmp/weavelet-native-prompt-async-{test,build,freshness}.log。未変更の全暗号化同期suiteは反復していない。

93ab2f28/23e83c97ではWebのsystem library挿入とCommandPrompt適用をpure promptApplicationへ接続した。実useEditViewLogicは元partsをそのまま編集用にcloneするため、従来の先頭part再構築は画像消失/reasoning変換/未知属性欠落を起こす。先頭textは属性を保持して追記し、非textは新しいtextを前置して元の全partsを順序・参照ごと保持する限定修正を行った。systemの二重改行規則は不変更。型検査/関連18件成功、同じprompt一式の独立監査で追加P2以上なし。ログ /tmp/weavelet-shared-prompt-preservation-{tsc,tests,diff-check}.log。期待値変更はこの実呼出経路のデータ欠落修正に基づき、比較方法を緩めていない。

今回のnativeライブラリ実表示/大CSV応答性/実機導入は未確認。composer・本文編集・system設定へのnative適用は次の接続範囲であり、ライブラリ管理だけで全prompt機能完成とはしない。CSVには意図的に分類label/任意metadataを含めず、全データJSONの往復保全とは別のWeb互換出力として扱う。
### プロンプトの入力・編集・system設定へのnative適用

a90b5b8c/86fef754で入力欄と既存本文編集へslash pickerを配置し、実Web CommandPromptの名前検索と適用を固定共有bridgeへ接続した。JSC contextはactor内で再利用し、UI外で検索/適用、取消・検索語・会話・元snapshot・最新入力を照合する。選択はdraftだけを更新する。共有結果の全partsを既存保存/置換整理/undoへ渡すため、MessageDraftへ適用済みpartsを保持する接続だけを追加した。既定systemMessageと通常非auxiliaryのconfig.systemPromptは別保存先のまま、同じ共有二重改行挿入を使う。

担当Web関連19件・native関連6件（実JSC名前/アクセント/同名、raw属性、古い入力、composer未保存、保存/prune/undo、通常/既定system分離とmodel切替）・型検査・bundle鮮度・Catalyst build成功を再利用。ログ /tmp/weavelet-native-prompt-usage-{catalyst-build,catalyst-tests,web-tests,tsc,freshness,diff-check}.log。parentでは並行CSV修正との結合build成功（/private/tmp/weavelet-prompt-union-build.log）、生成hash/差分確認成功。

独立AstraのP2「queryをSwift Stringの同値性でtask識別し、分解形e+combining accentから合成形éへ変えた時に再検索しない」はbb18b7f3でtask IDをUTF8 bytesへ修正。実match-sorter/JSCではcaféに対する両queryの結果が異なるため、同じ表示文字でも変更を見逃さない。該当検索testだけ追補・再実行成功（/private/tmp/weavelet-prompt-query-identity-test.log）、final appの再compileを含む。限定再監査は前回P2解消・新規P2以上なし。未変更領域のテスト/監査は反復していない。

match-sorter/remove-accentsのMIT本文と固定入力hashを配布bundleへ同梱した。license出力だけCRLFを正規化し入力hashは元bytesを保持、最終bundle増分22,935 byte（アプリ全体/圧縮配布/速度ではない）。native adapterは未知partも読取り保持するが、既存保存境界の未対応type拒否を緩めていない。対応typeの未知属性/精密値の保存を確認した結果を、全未知typeの編集対応へ拡張しない。

実画面/IME/VoiceOver・Airへの今回版導入は未確認。Air lockStateは改めてpasscodeRequired=trueを確認し実機処理を再開していない。built-in systemプリセットと残るGeneral操作は後続範囲。origin/mainをfetchし7a0a383aが統合branchの祖先で追加差分0件と確認した。
## 外観とMarkdown表示の設定（2026-10-14）

48074d3fでtheme（light/dark）、markdownMode、inlineLatex、streamingMarkdownPolicy（auto/always/never）を一般設定へ接続した。既定値は既存Web import defaultsから読み、既存MarkdownTextViewのsnapshot消費とOS preferredColorSchemeを使う。native独自のsystem theme値をWebデータへ保存せず、未知/不正な元値も明示的に選び直すまで保持する。ChatStyleのstream/bubble選択は別設定のまま。

変更した一fieldだけを既存syncInputSnapshot/applySnapshotで原子的に保存する。raw値・他root/順序・共有既定値・不正alias拒否・保存失敗/再起動を確認したCatalyst関連3件とbuildが成功（/tmp/weavelet-native-display-settings-catalyst-tests.log）。親統合のbundle鮮度/差分確認成功、独立Astraは新規P2以上なし。表示/共有/同期基盤は変更せず既存成功を再利用、同じ業務ruleを両環境へ複製していない。

実画面の色/数式/生成中表示切替・最大文字サイズ/VoiceOver・Air導入は未確認。enterToSubmit、branch swipe/animation、chat size、advanced mode、language等のGeneral機能は後続範囲であり、この4項目を全設定完成とはしない。
## built-inシステム文プリセット（2026-10-14）

4cc42c7eでWebのSYSTEM_PROMPT_PRESETSと同じraw Markdown本文を共有bridgeから読み、既定systemMessage/非auxiliaryのconfig.systemPromptへ接続した。原文をSwift/別JSONへ複製せず、限定text loaderで実MD pathを解決して定数/MD両方のhashを記録する。選択前にname/description/概算token数を表示し、community由来や約30k tokens/requestという既存情報を維持する。性能向上や評価品質を保証するものではない。

実Web applyPresetのECMAScript trimによる置換確認条件をpure共有元へ切り出し、Webとnativeで共用。nativeはactorで選択内容/確認要否を取得し、結果公開/確定時に入力・保存元・会話・生成を再検証、取消/離脱後は反映しない。変更はlocal draftだけで、保存の既存経路を維持する。

新しい共有predicate8case・native実JSC2件（MD本文のtrim後全byte一致、確認条件と保存境界）・型検査・Catalyst build・鮮度/差分確認が成功。ログ /tmp/weavelet-native-system-presets-{tsc,web-tests,catalyst-tests,freshness,diff-check}.log。親統合のhash/差分確認成功、独立Astraは新規P2以上なし。bundle実file増分121,821 byteはapp全体/圧縮配布/速度の測定ではない。新依存は追加していない。未変更領域のテスト/監査を反復していない。

実メニュー表示/説明の収まり・IME/最大文字サイズ/VoiceOver・Air導入・実クラウド相互運用は未確認。

## 会話一覧のサイズ表示（2026-10-14）

b19399bbでWeb一覧の3箇所のサイズ計算と既存formatNumberをpure chatSizeへ接続し、native一覧のcaptionとdisplayChatSize設定から共用した。text判定を先に行い、それ以外はimage_urlの存在によってURL長を数える実Webの規則を維持する。nativeはactive messages/delta投影のUTF16長だけを渡し、本文やbase64をJSCへ再転送しない。表示offでは投影自体を省き、取消/古い結果を公開しない。ゼロのcaptionは出さず、一行titleと44ptの操作領域を保つ。

共有3件・native4件、型検査、Catalyst build、bundle鮮度と差分確認の成功を再利用。ログ /tmp/weavelet-native-chat-size-{web-tests,catalyst-tests,tsc,freshness,diff-check}.log。独立Astraは新規P2以上なし。delta fixtureの初期期待値26は、実Web投影と従来式で14文字の本文2つを数える28と確認し、期待値だけを訂正した。比較条件を緩めていない。実表示/最大文字サイズ/VoiceOver・Air導入は未確認。

## 本文操作の配置（2026-10-14）

d05f4805でMessageViewの既存操作menuをheaderから本文footerへ移し、実Web ContentActionsと同じく分岐切替と並べた。summary/evaluation/omit/protectはheaderに保持し、時刻を追加せず、role iconと本文の端を維持する。狭幅用ViewThatFitsで水平/垂直を選ぶ。handler/保存/生成guardは不変更、44ptを維持。担当Catalyst buildと差分確認成功（/tmp/weavelet-native-message-actions-{build,diff-check}.log）、独立Astraは新規P2以上なし。

FAKE隔離Catalyst実画面でユーザー/アシスタントの本文下部への移動と操作menu全項目の到達を確認。先行b19399bb cloneでも一覧上部検索・下端共通操作・設定→外観と本文→戻る→完了の遷移を確認した。設定値の変更/実生成/実通信は実行せず、通常storeを使わない。各cloneを終了しprocess消失を確認。実機/狭幅/最大文字サイズ/VoiceOverは未確認、Web配置の全差分を解消したとは扱わない。

## 孤立UTF16のI/O境界（2026-10-14）

実Web import/JSCはescaped lone surrogateを含む未知値・キーを受理し、既知chat IDも共有元で再採番する。一方、nativeのJSONDecoder Stringは全取込を拒否していた。d9048acaで既存OrderedJSONへ孤立UTF16専用値とexact JSONStringキーを追加し、値・path・rootOrder・保存・opaque復元で保持した。通常文字列は既存decode、必要なtokenだけ既存JSC JSON.parseからcode unitsを取り出す。新parser依存/Swift再採番規則は追加せず、無効JSON/UTF8/重複キー/深さ制限の拒否を維持する。表示用repairを星変更・未変更会話名/フォルダー名の保存へ戻さない。4851391eでサイズ投影もraw UTF16長へ接続した。

関連Catalyst99件のうち98件成功。新testのpreview取込rootOrder期待値1件は実commitImportがbase順序を保持するため誤りと確認した。未知rootはsidecarとexport/restart bytesで保持済みで、直接V3取込の実rootOrder保存を確認するtestへ訂正後、限定1件が成功した（/private/tmp/weavelet-lossless-{tests,import-rerun}.log）。codec/path/取込/保存失敗/再起動/JSON export/Google records-wire/CloudKit mergeの隔離確認を含む。サイズ接続5件も成功（/private/tmp/weavelet-chat-size-utf16-tests.log）。無関係な全業務suiteは再実行しない。

独立Astraの新P2「raw prompt CSVがopaqueとなり[object Object]へ」「raw systemPromptが空欄扱いされlibrary挿入で消失/preset確認省略」は49612d69で修正。CSVは既知文字列をrawのまま共有元へ渡し、最終UTF8化だけ実Web Blob相当のrepairを行う。修正前22byte対44byteの失敗を再現し、修正後plain/gzip一致と元JSON不変を確認した。systemPromptは当該fieldのnative編集/挿入/置換を明示拒否し、他設定保存ではrawを維持する。通常Unicode/NFC/NFD/日本語/emojiを拒否しない。関連16件成功（/private/tmp/weavelet-utf16-prompt-config-tests.log）、限定再監査は前P2解消・新規P2以上なし。

孤立UTF16を含む本文とsystemPromptのnative編集は未対応で、情報を失う操作を明示拒否する。表示/Markdown・CSVのOS UTF8変換とJSONのexact保全を区別する。実機・実クラウド・大入力性能は未確認。Air lockStateはpasscodeRequired=trueのため今回版の実機実行を再開していない。

## 入力欄・添付入口の配置（2026-10-14）

b3cc6abbでcomposerの空欄3行の固定高さを1...8行・最低44ptへ変更し、実Webの配置を元に添付/slash/設定を左、送信/停止を右へ並べた。常時表示されていた画像ファイル/写真の別行を既存ImageInputViewのpopoverへまとめ、OS file/photos/PasteButton入口を保持する。picker完了の監視は常時存在する外側に置き、宛先delivery/読込/追加/エラー/生成guard/preview取消/local prefillは既存のまま。

担当Catalyst build/差分確認成功（/tmp/weavelet-native-composer-placement-{build,diff-check}.log）、独立Astraは新規P2以上なし。親のUTF16修正との統合Catalyst buildも成功（/private/tmp/weavelet-ui-utf16-union-build.log）、bundle鮮度と差分確認成功。FAKE隔離実画面で入力欄の高さ削減・操作順・添付popover開閉、OSファイル選択の起動/取消後にパネルへ戻ることを確認、clone終了とprocess消失を確認した。通常store/実送信/私的画像選択は行わない。

写真picker起動/画像読込・貼付け・狭幅/最大文字サイズ/VoiceOver・Air導入は未確認。UI配置変更だけのため、未変更の画像変換/業務rule/全同期suiteを反復しない。

## 分岐のスワイプ方向・本文移動の設定（2026-10-14）

7a41a609でbranchSwipeDirectionを実Web resolveBranchSwipeDirectionのscalar共有呼出へ接続した。nativeは本文選択/縦scrollを妨げないよう本文下の分岐番号44pt領域だけでOS横操作を受け、既存siblings/selectSibling/branchSwitchへ渡す。gesture中の会話/node/兄弟順/設定変更を照合し、取消時に状態を解除する。左右の設定意味をSwiftで再実装しない。animateBubbleNavigationは実Webのsmooth/autoスクロールに対応するnavigationFocusのscrollToへ接続し、Reduce Motionではアニメーションしない。

担当Catalyst buildと新規境界2件、型検査、bundle鮮度、差分確認成功（/tmp/weavelet-native-branch-display-{build-test,tsc,freshness,diff-check}.log）。既定/未知値保持/保存失敗/再起動とactualJSC方向を確認。独立Astraは新規P2以上なし。FAKE実画面で既定左swipe→2/2・右swipe→1/2、縦操作で切替なしを確認。設定UIでright-nextへ変更後は右swipe→2/2・左swipe→1/2を確認し、元のleft-nextへ戻した。設定値変更とgestureの接続を、表示だけから推定していない。clone終了とprocess消失を確認した。

実iPhone touch・本文選択との実併用・狭幅/最大文字サイズ/VoiceOver・スクロールanimationの実表示は未確認。Catalystのwindow幅縮小は操作しても達成できず、狭幅成功と扱わない。本文全体でswipeできるとは記載しない。

## Enter入力の共有元・native接続（2026-10-14）

510dd989/a035c86b/34112ff6で実Web useEditViewLogicのEnter条件をpure enterSubmissionへ切り出し、Web callerと固定native bridge、General設定、composer/本文editorへ接続した。Ctrl+Shift生成・設定とShift/Ctrlによる保存/生成・IME/229/mobile除外は同じ元を使用する。stickyは実callerのoptional型をそのまま受け、undefinedは従来どおり非stickyとして扱う。最初の親tscは末尾diff-checkのexit0を成功と誤認したが、logからsticky型エラーを回収・修正し、最終単独tscのexit0/空logを確認した。誤った中間結果を再利用しない。

nativeはmarkedTextRangeを読むため標準UITextView adapterを使い、hardware入口とソフトinsertTextを分離する。画面キーボードのReturnは標準改行、hardware判定だけ共有元へ渡す。選択範囲・外部draft・Dynamic Type・生成disabledと既存handlerを保持。editor生成は既存共有replaceAndPruneで全後続を扱い、保護tailなら適用前に拒否、atomic保存成功後にfresh draftへ更新して既存生成へ接続する。保存失敗前は元データ、生成開始失敗後は保存済本文とfresh sourceを保持する。挿入draftの生成キーは未対応として明示拒否し、保存後の生成操作へ案内する。

共有13件、native4境界、型検査/鮮度/差分確認の成功を再利用（/private/tmp/weavelet-enter-{webtest,test-final,tsc,bundle}.log）。独立AstraのP2「Swift String同値性でNFC→NFD外部更新が反映されず次入力で旧表現を書き戻す」は9be9aa18でUTF8完全一致へ修正し、該当1件成功（/private/tmp/weavelet-enter-unicode.log）。親の新General設定と代表OS境界2件も成功（/private/tmp/weavelet-enter-integrated-tests.log）、限定再監査はP2解消・新規P2以上なし。

FAKE実画面では本文のfocus/貼付け・Shift+Return後の続き入力を2行として確認した。普通Return1回は改行となり、送信成功を確認できなかった。IME確定/入力モード/Responder入口の原因は確定していない。直後にMacがロックされ追加Return再試行とアプリ終了は未実施。5aec5a60で標準UIKeyCommand入口を補い、共有action有りのReturnだけ登録、IME中の登録/実行を拒否する。e4fef0e4でmain actor内のSessionを再利用した。macOS JSC bundle初期化probeはcold67.86ms/steady14.88–14.95msで、4回のResponder判定ごとの初期化を避ける根拠とし、Catalyst UI遅延の実測とは区別する。Responder dispatchの既存境界1件成功（/private/tmp/weavelet-enter-session.log）、最終統合Catalyst build成功（/private/tmp/weavelet-enter-final-build.log）、追加限定Astraは新規P2以上なし。

最終UIKeyCommand版の実Return送信・IME確定・二重発火・狭幅/最大文字サイズ/VoiceOver・Air導入は未確認。最新版隔離clone /private/tmp/weavelet-layout-shell-ui-proof/WeaveletEnterCommandsCheck.app は準備のみ。前版WeaveletEnterCheckはPID18416でロック時点の起動を確認、終了済みとは記録しない。未送信合成draftが残り、通常store/Keychain/実通信は使用していない。Airは今回もpasscodeRequired=true。未変更の全業務/全同期suiteは反復せず、実操作の再確認を残件とする。

## advanced表示と挿入本文の生成（2026-10-14）

f3c46f5bでadvancedModeを一般設定と先頭systemの表示・役割編集・追加/挿入・生成設定入口へ接続した。実Web ChatContentとDownloadChatの表示条件をpure advancedDisplayへ切り出し、両Web callerとnativeで共用する。DownloadChatのこのfilterは画像captureだけであり、Markdown/JSONのfileExportには適用されていない。nativeも表示用配列だけを制限し、書出し・保存・生成要求・同期のsystemを保持する。native headerの役割操作は既存editorへ接続し、非advancedでも設定sheetから現在会話の生成設定へ到達できる。既定値/未知値保持/onefield atomic保存は既存経路を使う。通常composerのinputRoleは引き続き残件。

共有1件・native新2件、型検査、鮮度/差分確認、最終Catalyst build成功（/tmp/weavelet-native-advanced-display-{shared-tests,build-test,tsc,freshness,diff-check,build}.log）。actualJSC表示順とID、非表示systemのMarkdown/V3/syncInputSnapshot保持、既存role上書き/Undoのmultipart metadata/contentStore保持を確認。独立Astraは新規P2以上なし。実表示・role編集sheet・非advanced時設定入口・VoiceOverはMacロックで未確認。

116fe122で挿入draftの生成を明示拒否する残件を解消した。実Web NewMessageButton100/branch-slice454で挿入の返却nodeIdを編集対象にし、useEditViewLogic384-398で後続整理する経路に従う。nativeは既存共有insertNodeStateとreplaceNodeAndPruneStateの2操作・2段Undoを使い、返却IDからfresh draftへ接続する。Swiftで再採番/枝整理を作らず、opaque/historyの既存境界を維持する。native挿入sheetは未保存draftのため1atomic applyとし、保護後続や保存失敗では途中挿入も履歴も公開しない。Webは先に空挿入を保存するというUI lifecycle差を、成功後のデータ互換と区別する。

新挿入と既存通常生成の関連2件が成功（/private/tmp/weavelet-insert-test-final.log）。branch/flat、NFD/精密値/未知属性/非表示・未参照データ、古いdraft、保護tail、保存fault、Undo2段を含む。初期testの「empty remote credentialなら同期throwする」という期待は実処理上成立せず、同期境界を確認できるmissing local modelへ訂正した。型検査/鮮度/差分確認成功、独立Astraは新規P2以上なし。親統合後は新bundleで代表2件のみ確認成功（/private/tmp/weavelet-advanced-insertion-union-tests.log）、050f8704に生成成果物を保存。未変更の全同期/全業務suiteは再実行しない。実UI・実機・実オンライン同期は未確認。

provider抽出の補足：CohereはWeb provider-config41-46にendpointが列記される一方、現行submitRuntime797-812/1172以降はchoices形式、remoteResponse45-52もOpenAI系messageを扱う。列記と生成支持を混同しない。native ProviderModels65-69はCohere固有形式を明示拒否している。今回の抽出だけではWebのCohere実動を証明しておらず、Cohere parserを「既存共有処理」として再利用可能とは記録しない。追加SDK/通信実行/独自変換を今回導入していない。

## composerの役割とcompact上部の配置（2026-10-14）

078a66afで通常composerのinputRole残件を接続した。実Web input-slice8–19と同じruntime global・初期user・非永続とし、役割は常時表示、advanced時のみ44ptの選択menuを出す。選択roleを既存MessageEditing.saveの共有appendからgeneration/submitContextへ渡し、Swiftに役割結合ルールを追加しない。送信buttonとEnterは既存sendComposerを共用し、legacy startGeneration(input/parts)のuser既定を保つ。生成中の変更は拒否する。

Catalyst buildと追加境界2件成功（/tmp/weavelet-native-composer-role-verified-build-test.log）。assistant本文と生成placeholderを分けた保存、実共有submitContextによる連続assistantのwire結合、正式parts/画像/reasoning/精密値/未知属性/非active枝保持、runtime roleの非永続、保存失敗時のdraft/source/disk保持を確認。初期testの未知future_partは既存closed validationで拒否されるため、成功入力を正式partsへ直し、未知型拒否時のraw draft保全を別途確認した。本文参照は実WebExchangeのparts、生成開始後のUndoは既存共有generationPlanによる履歴無効化を根拠として期待を訂正した。比較条件を弱めていない。独立Astraは新規P2以上なし。

3eeccaabでcompact toolbarの常設7操作を5操作へ減らした。実Web MobileBar/ChatViewTabsのモバイル配置を確認し、既存「その他」にファイル/設定をまとめ、会話一覧・履歴・表示・検索の入口、sidebar下端の共通操作、regular/detailOnlyの配置を維持する。handler/保存/disabledは変更しない。最終統合Catalyst build成功（/private/tmp/weavelet-native-role-toolbar-build.log）、追加App差分の独立Astraは新規P2以上なし。共有元/TSの変更はなく、既存成功結果を再利用し、全同期・全業務suiteは反復しない。bundle鮮度と差分確認も成功。

実compact画面・役割menu・IME/実Enter・最大文字サイズ/VoiceOver・Air導入・実オンライン同期は未確認。CUAは既存隔離アプリのwindowを取得できず、inventoryでは起動中のため終了済みと扱わない。未知新part型の送信は既存どおり未対応で、入力を保持して明示拒否する。Web配置全差分の解消とは扱わない。

## 複数会話の分岐表示とcompactの分割適応（2026-10-14）

54cf4743で実Web BranchEditorView31–44に従い、選択2件以上では選択順のentries、0/1件では現在会話を既存共有branchLayoutへ渡す。選択はWebと同じ一時状態で、保存・同期rootを増やさない。会話ごとのheader、全entriesに対する世代確認、会話とnodeを指定した既存navigation/menu/同会話比較へ接続した。raw inputのnode ID/parent/pathは変更しない。nativeの描画identityだけをchatIndexとraw UTF8 IDで区別し、共有edgeには最小のchatIndex metadataを追加する。152e6cf1でcompactのsplit表示は実Web mobileと同じくchat表示へ適応し、選択viewとregularの分割を維持する。

共有/worker関連10件成功、Catalyst関連11件のうち10件成功後、追加fixtureのcreatedAt欠落を実node仕様に従って補完し残る1件が成功（/private/tmp/weavelet-multiview-{test-final,navigate}.log）。単一の最終11件runではない。跨会話の同node ID/NFC/NFD、正しい移動先、古いkey拒否、非永続選択、flat変換時の保存失敗保全を確認。独立AstraのP2「孤立surrogate titleで会話自体を落とす」を67bae591でdisplayStringの表示投影だけへ修正し、raw snapshot bytes保持と会話/header保持の該当1件成功（/private/tmp/weavelet-multiview-surrogate.log）。限定再監査はP2解消・新規P2以上なし。

親統合Catalyst build成功（/private/tmp/weavelet-multiview-integrated-build.log）。後述のTS更新後のbundleでも代表1件成功（/private/tmp/weavelet-multiview-new-generator-test.log）。変更のない業務・全I/O・全同期suiteは再実行しない。実UI・大規模graph・VoiceOver・実機は未確認。Web側の既存ReactFlow跨会話raw ID衝突は今回変更しておらず、nativeの描画ID分離とWeb側の完了を混同しない。

## 分類器の採用前セキュリティとWeb依存更新（2026-10-14）

a78972ccでHF4.3.0/対応ORT、TS5.4.5とprotobufjs7.6.6を限定固定した。[計画の採用境界](web-native-commonality-roadmap.md#2026-10-14local分類器の採用境界と限定更新)に公式修正・代替方式・未確認範囲を記録した。npm側の変更48packageを公式metadata/integrityと公開advisoryへ照合した。独立AstraのP2「npmだけprotobufjs修正版、Yarn/installedは旧版」を対象resolution/overrideと関連4依存の更新で解消、限定再監査は新規P2以上なし。関係のないnpm lockの既知jose/workers-types欠落を今回の更新へ混ぜず、npm ci成功とは扱わない。npmのYarn全optional削除も回収して正式Yarn生成へ戻した。

最終TS型検査、Web production build、既存runtime6件、Yarn frozen install成功（/private/tmp/weavelet-transformers-{final-types,web-build,runtime-tests,final-frozen}.log）。runtime testはworker facadeの確認であり、実classifierの成功とは扱わない。TS4.9は新依存型の構文で失敗し、TS5.9 probeは既存大buffer型を広く変える必要があったため採用せず、TS5.4と既存map型の明示だけでstrict条件を維持した。

同期generatorのTS版差により最初の鮮度確認は失敗したため再生成した。initialDefaults bytesは同一で、bundle差は生成時の依存path comment/CommonJS labelだけと原artifact比較で確認し、最終鮮度確認成功。新bundleのSHA256は32e77def3cfb948c48fd3cc3a5fe6b0f4d7afa326b58dc49fb828b8818bbe07b。共有業務を変更したとして全suiteを反復しない。

WK分類器は実証中。既存Web workerのallowLocalModels=falseとlocal_files_onlyの組合せが新旧HFでcustomCache前に拒否される根本原因を確認し、共通workerで修正を進めている。実分類・任意モデル・Local/Hybrid UI・実機・実オンライン同期は未確認。Airの最新lockStateはpasscodeRequired=trueで、実機導入を成功扱いしない。


## Web配置へのUI調整と分類器・モデルフォルダーの境界（2026-10-14）

bd77e18e/45294bb4で会話タイトル下にWeb ChatViewTabsと同じ左モデル・右チャット/分岐/レイアウトの行を設け、既存設定sheetとsetChatActiveViewへ接続した。モデル未選択を明示し、モデル値を変更しない。streamは役割tileと本文の左右insetを12ptに揃え、本文と末尾操作を角丸の面へまとめた。狭幅では評価・文脈除外・保護を同じhandlerのMenuへ集約し、44pt操作領域を維持する。composerは役割・本文・操作を一つの面にまとめ、共用UITextViewを透明にした。時刻、強制カプセル、固定84pt本文高は追加しない。吹き出しの任意設定と既存IME処理を保持する。

独立AstraのUI機能一式監査は新規P2以上なし。Catalyst統合test/buildで接続を確認し、FAKE隔離実画面では本文と役割tile左端、本文面、composer面、チャット→分岐→チャットの選択・モデル設定を開く/取消を確認した。実画面で空モデルの表示欠落を見つけ表示のみ補正。通常store/Keychain/実通信は使用しない。ウィンドウ縮小dragは変化せず、狭幅・最大文字サイズ・VoiceOver・iPhoneの確認とは扱わない。モデル選択は既存設定sheet入口であり、Webのモデルdropdown全操作が同位置に揃ったという証明ではない。上部の直接戻る/進む/新規入口など配置差は残る。

分類器foundationはaab533d9で実Web workerのallowLocalModelsを修正、75d8e5b2でnested OPFSを標準directory traversalへ修正した。418088caでnativeモデルフォルダーI/Oを接続し、required以外の最終ファイルとmetadataを保持する。独立AstraのP2は3aed0417の共有required part判定とb96a475eのboot取消epoch確認で解消、限定再監査は新規P2以上なし。元WK4件/取消修正1件、directory8件/marker修正1件、Web storage/download13件/marker関連2件の別run成功を再利用する。全件を単一runで成功したとは扱わない。

62c6214cで単一WKClassifierHostへ昇格し、callerのorigin/filesをscheme経由で実Web Workerへ供給する。299Bの合成constantモデルはテストbundle専用へ分離、全label/scoreを返す。Task.cancelからWorker終了と待機拒否、Worker到達時のUTF8/UTF16を確認。112757dfで既存Transformers.js multi-file定義からOSフォルダーpickerへ接続し、背景でinspect/stage後、MainActorでrawモデル・取消・busyを照合してawaitなしでatomic publishする。旧targetとmetadataを保持し、フォルダー存在表示をモデル内容の検証済み表示にしない。

担当Catalyst host7件・folder接続6件の成功を再利用、昇格/接続一式の独立Astraは新規P2以上なし。親統合はfoundation代表2件成功（/private/tmp/weavelet-native-ui-placement-union-test.log）、新host Task.cancel代表1件成功（/private/tmp/weavelet-native-ui-placement-final-test.log）、folder登録/再起動代表1件成功（/private/tmp/weavelet-native-folder-ui-union-test.log）。最初のfolder指定名誤りは0件として回収し、正しい名前の1件を別runで確認した。3generator鮮度は各exit0。未変更の全業務・同期suiteを反復しない。

本番Local/Hybrid consumerは未接続。constantモデルは任意モデルの精度・tokenization内容同値・省電力を証明せず、OS異常終了はdelegate境界の確認に留まる。実OS folder picker、実browser OPFS、大容量モデル、実機、実オンライン同期は未確認。

最終UI Catalyst build成功（/private/tmp/weavelet-native-ui-placement-final-build.log）。45294bb4版の隔離cloneで「モデル未選択」のAX表示も確認した。検証cloneは終了後にprocess消失を確認、旧Enter cloneも終了した。cloneを終了済みとする根拠はinventoryの遅延表示ではなく実process不在。元作業ツリーは保全し、今回origin/mainはincoming 0件。


## iPhone Airの前段導入と分類器実行（2026-10-14）

現在のlockStateを再確認しpasscodeRequired=falseを得たため、監査済み前段を署名ビルド・インストール・起動した（/private/tmp/weavelet-air-ui-classifier-{build,install,launch}.log）。最初のbuildは6439da7d時点で79306cfb前に完了。続く実機testでは79306cfbまでのnative側をビルドし、WKClassifierHostTests/testOfflineWorkerPipelineWithTrustedSyntheticFixtureが1件成功（/private/tmp/weavelet-air-classifier-runtime-test.log）。シミュレータは使わない。test後の通常起動も成功（/private/tmp/weavelet-air-ui-classifier-after-test-launch.log）。

同テストは実Web Worker・HF pipeline・local WASM資産を使い、英語/日本語+emoji+NFD/空白/長文の4入力に対し2labelとscore、Worker到達時のUTF8/UTF16、unload後のWorker終了を確認する。299B constantモデルのためtokenizer内容同値、任意モデルの精度・メモリ/省電力を証明しない。テストstoreはnilで通常データを書き換えない。実機の見た目・IME/VoiceOver・実クラウド同期をこの実行から推定しない。本番auto Local/Hybrid consumerは別の進行中機能一式として未完了。


## 自動Local/Hybrid安全性判定の本番接続（2026-10-14）

6439da7dで実Web runLocalModeration/useEvaluationのanalysis優先→moderationの既存選択をpure helperへ抽出し、同じevaluation bridgeをnativeで使用した。空ID、無効設定、未知metadataを変えない。GGUF analysisがmoderationを隠す既存仕様をnativeだけで変更しない。665b6ac4ではWebのmodel preparation失敗がlocalSafety catchの外へ飛び共有fallback policyへ届かない原因を修正。準備失敗時にlocal分類/qualityを再試行せず、Local/Hybridの既存remote safety fallbackを使用し、取消/古いticketは通信・保存しない。qualityの勝手なremote代替やmanual経路の変更はない。

a9c2cadaでNativeLocalModerationから既存WKClassifierHost→共有localModeration/localPolicy→autoApplyへ接続した。モデルbytesは背景directoryEntries、snapshot/modelファイル世代を読込/推論の前後で照合する。Task取消・古い入力・ファイル変更はfallbackを拒否。Local結果をatomic保存後に共有policyでremote要否を決め、必要時だけOpenAI credentialを取得する。Local保存失敗時にremoteを開始せず、remote失敗後も保存済みLocal結果は保持する。UIの方式Picker/Hybrid safe時のremote設定は既存setterへ接続し、未知方式を表示保持。79306cfbで宣言taskを持つ既存multi-file定義も2roleの選択候補へ出す。manual safetyは実Webどおりremote、quality規則は既存のまま。

共有6件・Web関連18件・単独型検査成功を再利用（/private/tmp/weavelet-moderation-selector-{test,tsc}.log、/private/tmp/weavelet-evaluation-fallback-{test,tsc}.log）。担当Catalyst新境界5件と既存evaluation15件成功、最初のsource全体不変assertはapplySnapshotが評価rootもsourceへ投影する実処理に反していたため、変更対象evaluationResults以外の全fieldを厳密比較へ訂正し新5件を最終runで確認した（/tmp/weavelet-native-auto-local-boundary-final.log）。親統合では成功/保存失敗代表2件のみ成功（/private/tmp/weavelet-native-auto-local-union-test.log）。境界testは推論注入であり、実WK7件とAir1件の実行証拠とは区別する。

独立Astraの機能一式監査は新規P2以上なし。最終親bundle鮮度2件・差分確認成功。未変更の全業務・全暗号・全同期suiteを反復しない。実分類モデル精度、任意モデル取得・選択の全UI、実オンラインprovider/クラウド、実機の本consumer使用はこの時点では未確認。旧Google native OAuth client未登録、CloudKit実機DevelopmentとWebProductionの相互運用未証明を残す。全体ゴールを完了扱いしない。


51e82374の新代表1件は推論注入を使用せず、テストbundleの299B→端末model directory→本番runAutoSafety/classifier:nil→実WK→共有localModeration→autoApply保存→store再読込→SyncRecords往復を通した。Catalyst担当1件成功（/tmp/weavelet-native-auto-local-real-wk-test.log）。Localのblock-candidateでも共有policyどおり認証読込/remote要求なし、rawScoresの全label順/score/Local情報とその他roots/sourceを保持した。ローカル保存の精密値は厳密保持し、recordsでは既存Web Number変換による丸めを明示assertし、records canonical往復の一致も確認する。精密値が同期でも完全byte保持されるという証明へ拡張しない。

本consumer a9c2cada版もAir署名build・install・通常launch成功（/private/tmp/weavelet-air-auto-local-{build,install,launch}.log）。設定PickerのCatalyst隔離実画面はcgWindowNotFoundで未取得。起動したWeaveletLocalSettingsCheck cloneはprocessを確認したため、終了済みとは扱わない。通常storeを使わないFAKE cloneで、今回UI操作・生成は行っていない。

同代表経路のAir実機1件も成功（/private/tmp/weavelet-air-auto-local-real-path-test.log、Executed 1/0 failures）。実WKから保存・再読込・recordsまでの本consumer接続を実機で確認した。test後の通常launch成功（/private/tmp/weavelet-air-auto-local-final-launch.log）。精密値のrecords期待はSyncRecords.swift:25の標準JSON.parse/stringifyと実Web src/store/storage/google/records.ts:83–87のNumber化に基づく。丸めをローカル保存の期待へ持ち込まず、外部同期の既存制約として区別した。


## Web OPFS nested資産の実ブラウザ境界（2026-10-14）

変更のない75d8e5b2/3aed0417の成功結果と独立Astraを再利用し、実ブラウザAPIの未確認だけを追加した。専用localhost originで実storage.tsのsaveFile/openDownloadWriter/verifyStoredModel/commitTempFile/listFiles/OpfsFileProvider/getFileEntries/readFile/deleteModelを呼び、nested final・required markerのpartial判定・commit後saved・optional finalの列挙・3byte内容・合成model削除を確認した。Codex In-app BrowserのAXでPASSを確認しtabを閉じ、専用Vite processの終了を確認。実iCloud folder権限・任意モデル実行の証明へ拡張しない。

ログ /private/tmp/weavelet-opfs-browser-result.log、再現HTML /private/tmp/weavelet-opfs-browser-proof.html。HTMLは事前にactualproviderのtuple返却を確認してentry[0]を使用し、常設管理基盤へ追加しない。元作業ツリー内の一時HTMLは取り除いた。通常ユーザーデータ・Google/CloudKit・iPhoneを操作せず、Web source変更や全suiteの反復はない。

## 承認済みiPhone配置への機能接続・第1群（2026-10-16）

既存ChatViewの状態・handlerを再利用し、標準bar、モデル選択、chat/branchアイコン、メッセージ操作、本文内編集、末尾composerを承認済みmockの配置へ合わせた。編集/分岐保存/生成要求/モデル切替は既存共有処理へ接続し、Swiftで業務規則を複製しない。MessageInputViewの既存Enter/IME境界に任意focus Bindingとinsetを追加。親所有draftと元会話照合、保存成功後だけ閉じる動作を維持する。機能未接続mockは別ルートで保持した。

再利用可能な成功結果は編集/保存失敗・保護/モデルraw保持/遅延composer境界4件（`/private/tmp/weavelet-ui-connected-test.log`）と、focus時raw保持・OS入力・編集生成の入力3件（`/private/tmp/weavelet-ui-connected-input-test.log`）。最初の存在しないEnterSubmissionTests指定は0件であり、後者の正しい3件とは区別する。その後のUI配置調整では同じ業務suiteを再実行せず、最終Catalyst build成功（`/private/tmp/weavelet-ui-connected-viewport-build.log`）と差分確認を行った。全I/O・暗号・同期suiteの重複確認は省略する。

隔離clone `com.weavelet.nativepilot.connectedui` はRemoteFixture storeとURLProtocolのFAKEだけを使用した。本文編集中に別会話へ移動してdraft保持/保存無効→元会話へ復帰して保存→再起動後の復元、chat/branch切替、オンラインmodel picker入口を実画面確認。FAKE送信後のuser本文/assistant結果はdiskへ保存され、元の他3会話は全field不変。編集保存の証拠は `/private/tmp/weavelet-ui-connected-20261016/edit-save-result.json`。通常store/Keychain/実クラウドは使用していない。

独立Astraが表示filterで編集対象が消えた際の到達不能をP2として指摘し、実DisplaySettings投影とsummary hidden判定を使うdraft回復欄へ修正。限定再監査はP2解消・新規なし。モデルsheetの状態所有とviewport縮小時scrollの限定確認も新規なし。

CUAの初回click直後typeTextでは先頭欠落を2回観測し、focus確定後の入力は全量保持した。viewport scroll変更ではこの自動操作の欠落は解消せず、修正成功と扱わない。独立Astraは同期draft更新/focus delegate経路に再現可能な古い本文上書きを認めず、原因は未確定。実端末の通常入力・IME・画面keyboardの押上げ/toolbar、最大文字サイズ、VoiceOverは未確認。この群をアプリ全画面の移植完了や実オンライン接続成功とは扱わない。iPhoneへの導入は今回実施せず、指示時のみ行う。

## LAN接続時の導入運用と補助操作群（2026-10-17）

ユーザー指示でAirのLAN接続時は検証済み変更を導入する運用へ変更。前段接続版は署名build/install/launch成功、localNetworkとPID27714を確認（`/private/tmp/weavelet-air-connected-{build,install,launch}.log`）。最初のdevice detailsは接続失敗したが、後続installと接続情報取得が成功したため、一覧のcached availableだけで判断していない。

今回の追加は末尾の上下scroll、既存state.styleへ接続する吹き出しToggle、既存ImageInputView/プロンプト要求のkeyboard toolbar再利用。新業務処理は追加しない。Catalyst実画面で先頭/入力欄移動、吹き出し表示と復帰、既存prompt picker開閉を確認した。keyboard画像pickerがfocus解除で破棄されない条件へ限定修正し、独立Astraは新規なし。前段7件の成功を再利用し、未変更の全業務/I/O/同期suiteを反復しない。実画面keyboard上でのpicker復帰、IME、先述のCUA初回入力欠落の原因は未確認。

限定修正後の最終Catalyst/iOS署名build、署名検証、Air install/launch成功。PID27732と最終install先の一致を確認し、本番connected指定も完成Infoで確認した（`/private/tmp/weavelet-ui-controls-final-build.log`、`/private/tmp/weavelet-air-controls-final-{build,install,launch,processes}.log`）。通常データを使う実機での操作テストは行わず、目視確認はユーザーへ委ねる。隔離Catalyst cloneは終了しprocess不在を確認した。

## 会話内検索・tokenizer取消分離・最新main同期履歴（2026-10-17）

検索は承認済み配置のbar直下へ移し、既存ChatSearchViewの検索/結果行を共用する。現在会話の表示経路/全分岐/スターを既存共有ChatSearchへ渡し、選択は既存navigateへ接続。全体検索sheetの対象切替は保持する。Catalyst関連2件成功、隔離FAKE実画面で入力→2結果→対象遷移と検索帯終了を確認。検索表示中はcomposerのkeyboard補助を出さず、本文draftを変更しない。独立Astraは新規なし。ログ `/private/tmp/weavelet-inline-search-test.log`。

前段tokenizerの未完監査を回収し、一callerの取消が共有host全体をshutdownして他の要約等まで停止するP2を確認。75b12f2b（担当112d7c9f）で要求IDだけを取消し、遅い応答を無視する。共有load待機/NativeTokenCountingの個別取消ではshutdownせず、明示全体shutdown/timeoutは維持。担当Catalystの計数8件とhost4件が別runで成功。初回host2件失敗は空messagesのcountを>0とした誤期待で、実Webの空入力countに従い訂正し4件を再確認した。独立Astraの限定再監査はP2解消・新規なし。ログ `/private/tmp/weavelet-tokenizer-request-cancel-{xcodebuild,host-test}.log`。

origin/mainのc0ee5d05（長い同期履歴の再帰撤去）をmergeし、Web実処理をnative共有bundleへ再生成した。履歴・競合処理は共用し、taskを譲る箇所だけ既定Web timer/native Task.yieldへ分離。nativeのrequest/settleと既存取消境界を維持する。Web replay/worker/progress/暗号化同期83件と追加scheduler1件、型検査、bundle鮮度が成功。Catalyst代表3件でWeb multipart履歴→pack公開→再起動、未知metadata競合/両枝保持、取消outbox保全を確認。未変更の全I/O/暗号/全機能suiteは反復しない。独立Astraの同期群限定監査も新規なし。

最初の生成/テスト起動は部分欠損node_modulesにより実行前失敗。Yarn frozen installで既存lockどおりに復元し、package/lockは変更していない。成功ログは `/private/tmp/weavelet-main-history-{generate-final,web-test-final,yield-test,types,freshness,native-test}.log`。実クラウド・Google OAuth登録・CloudKit環境差・全UI完成などの残条件は維持し、ゴール完了とはしない。

本群の最終署名iOS build・署名検証・Air install/launch成功、PID27757と導入先の一致を確認。導入前のtransportはlocalNetwork。ログ `/private/tmp/weavelet-air-search-history-{build,device,install,launch,processes}.log`。実機の通常データを使う操作テストは行っていない。

## 視覚的統一感の局所修正（2026-10-17）

独立AstraのWeb比較候補1–8/10に対し、会話土台と本文/入力面の明度差、graph Material→中立色、繰返す見出しの文字階層、Button内の名称/補足色、inline子画面title、focus時だけの編集枠、保存不可時の中立色を反映。保存可否の式・Dynamic Type・44pt判定・配置・handler・共有業務処理は維持する。候補9のprompt Editor高さと11の同期説明階層は未変更。

独立Astraのassistant吹き出しが土台と同色になる指摘をtertiary面へ修正し、限定再確認は新規なし。実画面でinline footerも外側本文面に包まれることを発見し、inline時は外側本文面を描かず自前入力面だけにした。初回のprimary/secondary指定ではPromptPickerのtintが青として残ったため、動的UIColor.label/secondaryLabelへ限定修正。最終Catalyst隔離実画面で明暗両モードの名称/補足が中立色になること、本文の可読性、graph面、編集の保存不可→可の外観、取消後の元本文保持を確認した。数値contrast比の測定や全画面の視覚完成とは扱わない。

最終Catalyst build成功（`/private/tmp/weavelet-ui-neutral-label-build.log`）、最終署名iOS build/署名検証成功（`/private/tmp/weavelet-air-neutral-label-build.log`）。今回の可逆な見た目変更に業務testを複製せず、前段の成功結果を再利用する。追加依存/保存形式/外部I/O/同期の変更はない。最終Air導入前のdevice照会/listでunavailableを確認したため今回は更新未実施（`/private/tmp/weavelet-air-neutral-device.log`）。Air導入済みは前群PID27757の版。LAN接続時の導入方針は維持する。検証cloneは終了しprocess不在確認済み。実機目視・IME・最大文字サイズ・全UI/実クラウド互換性の残条件は維持する。

## 分岐図のnative表示窓・拡縮操作（2026-10-17）

共有Web branchLayoutからの座標/ID/edgeは変更せず、UIScrollView/子UIHostingControllerでnative pan/pinch/zoomへ接続した。初期fit、±、全体表示、現在経路の末尾nodeへ移動を追加。Webのfit余白0.2・zoom範囲0.1–2を参照し、ボタンは独立44pt。表示会話のraw UTF8 IDとchatIndexで表示窓の所有を分け、同じ会話の非同期再描画中は旧図を保持してHosting内部もdisabledとする。共有ルール・保存・同期・外部I/O・依存は変更していない。

Catalyst BranchEditorTests14件成功（`/private/tmp/weavelet-graph-viewport-test.log`）。実画面で初期fit/±を確認したが、最初の末尾node移動は下端へ寄ってtoolbarと重なった。setZoomScaleとoffsetの別animationおよび末端を中心に置ける余地の不足を、標準zoom(to:rect,animated:)とviewport半分のinsetへ修正した。修正範囲のnative3件（animated edge focus追加を含む）が成功（`/private/tmp/weavelet-graph-viewport-focus-test.log`）。14件と3件は重複があり、単一17件runとはしない。既存の共有graph/属性/保存検証は成功結果を再利用する。

独立Astraの機能一式・指摘影響範囲の限定確認は新規なし。最終Catalyst実画面で通常animation付きの末尾node中央表示とtoolbar非重複、fitへ戻す操作、nodeタップ→既存chatの正しい枝への遷移と戻るを確認。タップは既存のchat遷移を起こすため、その後もgraph表示窓が残るという手動証拠にはしない。controllerの内容更新時zoom保持は自動testで確認した。検証は専用FAKE storeで、通常保存/Keychain/実同期を操作していない。検証cloneは終了しprocess不在を確認。

最終Catalyst build成功（`/private/tmp/weavelet-graph-viewport-final-build.log`）、署名iOS build成功（`/private/tmp/weavelet-air-graph-viewport-build.log`）。Airは導入前照会でunavailableのため更新未実施（`/private/tmp/weavelet-air-graph-viewport-device.log`）。実端末のpinch/回転/VoiceOver、大規模図、range選択/drag配置/mini map、全機能/実cloud互換性の残条件を維持する。


## 本文の一括折畳・展開（2026-10-17）

WebのCollapseAllButtons→chat-slice.setAllCollapsed→setChatNodeMapStateの実経路を確認し、既存共有nodeOptions入口へcollapseAllを追加。Swiftは共有結果の差分を元OrderedJSONへ適用し、既存applyLibraryで保存成功後に公開する。Webと同じく折畳は保存activePathのIDだけのmapへ置換し、非activeの古いmapも除く。展開はmapを空にする。flatはdecimal indexのままで木へ変換しない。本文・木・他属性を作り直さず、表示経路と編集履歴の既存規則を維持する。末尾左の補助Menuに一括操作と既存undo/redoを接続し、44pt判定と中立色を維持。UIの固定隅配置などU21全体の完了ではない。

Web実store callerとのflat/tree比較を含む既存契約suite10件成功（`/private/tmp/weavelet-bulk-collapse-web-test.log`）。Catalystの追加接続test1件で保存失敗時のメモリ/disk保全、他会話・本文store・未知field保持、再起動書出し一致、sync records往復を確認（`/private/tmp/weavelet-bulk-collapse-native-test.log`）。型検査、bundle鮮度、差分確認成功。既存個別node mapの暗号化同期testは経路が変わらないため再実行しない。独立Astraの機能群限定監査は新規なし。

Catalyst実画面の確認を試みたがMacロックによりCUAが操作不可と回答したため、今回の一括Menuの手動受入は未確認。テスト専用cloneを終了した。Airもdevice detailsでunavailableのため未導入（`/private/tmp/weavelet-bulk-collapse-device.log`）。実CloudKit/Google接続・全UI・全機能の残条件を維持し、本群だけで全体完成とはしない。


## 分割表示の比率・入替（2026-10-17）

Web SplitView/config-sliceの実処理を基準に、既存20–80%制限をsrc/utils/splitPanel.tsへ切り出してWeb setterとnative bridgeから共有した。nativeは既存splitPanelRatio/Swappedのraw設定を読み、左右/上下分割のdivider drag・均等復帰・表示入替・VoiceOver調整を接続。drag中はGestureStateだけ、終了時に一度保存する。native最小pane幅/高さは表示上だけの制約で、読取時に保存値を書き換えない。compactの単一chat適応中も分割設定は保持。ZStack内のchat/graphを移動するため、入替で親の編集中本文を作り直さない。

独立Astraがdrag中と保存時の比率制限差による跳ね戻りをP2指摘。drag中にも共有clampを適用し、限定再監査で解消・新規なし。既存applySnapshotでは表示だけの変更でも要約等がcancelされるため、今回のsplit設定はsetChatActiveViewと同じ軽量atomic保存を共用し、保存成功後だけdocument/exchangeを更新。業務データ・履歴・他ジョブを変更しない。

Web関連4件、Catalyst DisplaySettingsTests8件成功。保存経路修正後は影響する追加split test1件だけ再確認して成功（8+1は重複）。保存失敗時のdisk/メモリ保全、raw他root/再起動保持、Google/フォルダー暗号化同期recordsへの設定送信除外を確認。CloudKitは既存の全snapshot保存であり、この除外と混同しない。型検査、bundle鮮度、最終Catalyst build、差分確認成功。ログは`/private/tmp/weavelet-split-layout-{web-test,native-test,final-test,types,freshness,final-build}.log`。既存全I/O/暗号suiteの反復は省略。

今回のdrag/入替の実画面操作は未確認（前群でMacロックによりCUA不可）。Airはdevice detailsでunavailableのため未導入。UI手動受入、iPad touch/回転、最大文字サイズ、U14の残るリンク挙動を含む全体完成は未達。


## split中のチャット→分岐図連動（2026-10-17）

Web Message.tsx:152–166とBranchEditorCanvas.tsx:613以降を確認し、「リンク」は別chat/pathの独立選択ではなく、split中の本文clickからgraph focusへの一方向の自動連動と整理した。OFFでもgraphからchatへの明示移動は有効。設定はWeb同様runtimeだけで保存/同期へ加えない。nativeはshared navigation historyへchat-click/current path/focused node/split view contextを渡し、本文/保存sourceを変更せずtoken付きfocus要求を出す。分岐図は既存native viewportへ渡し、非同期配置後もraw chat/node ID・key鮮度を確認して適用。新要求を古いconsumeで消さず、表示chat変更や対象消失時に古い要求を残さない。

表示レイアウトMenuに連動Toggle、本文表示面にsimultaneous tap、同じ操作の44pt scopeボタンを追加。inline編集では有効にせず、連動closureがない場合gesture maskもnone。独立Astraがcompact単一表示でも履歴だけ増えるP2を指摘し、実際に両paneを表示するregular条件へ修正。限定再監査で解消・新規なし。保存済split設定は維持する。

Catalyst BranchNavigationTests6件（追加2件を含む）が成功。OFF/非split no-op、source/snapshot/disk不変、共有履歴の前後移動、旧tokenでの新要求消去防止、再起動時runtime初期化を確認。最終Catalyst build/差分確認成功（`/private/tmp/weavelet-split-link-{test,final-build}.log`）。保存・暗号化同期の基盤は変更せず、既存成功suiteを再実行しない。本文tapとWKリンク/テキスト選択の実干渉、非同期配置中の画面操作は未確認。先述のMacロック後、今回の実画面操作は実施していない。Airはdevice detailsでunavailable、未導入（`/private/tmp/weavelet-split-link-device.log`）。全機能/全UI完成の判定ではない。


## sidebar/graph内検索の接続（2026-10-17）

既存ChatSearchViewをsidebar内の名前/全本文検索とgraph上部のnode検索へ再利用。現在会話の検索帯は維持し、graph単独時の上部検索はgraph側へ接続する。scope/star controlsは狭幅で段分け。graph検索は表示chat IDsだけを既存searchBranchNodesへ渡し、結果選択後も検索欄を保つ。Web search-slice→navigateToNode(selectChat:false,focus:editor)に合わせ、共有navigate/historyで対象chatのpathを更新し、現在選択chat/viewを変えずgraphへfocusする。保存失敗ではsource/disk/focus要求を公開しない。検索文字の入力だけで最初の結果へ自動遷移するWeb挙動、前後結果移動・検索履歴は今回未接続。

独立Astraの非表示sidebar検索がkeyboard補助を消すP2を、compactの選択列/regularのdetailOnlyを判定する条件へ修正。追加source照合ではWeb BranchEditorCanvas:387–400がchatIndicesの表示順でentriesを作り、branchSearchがその順で検索することを確認。初回adapterのSet filterはstore順となり、最初のtest期待も誤っていたため、表示順に元indexed entryを取り出す方式へ修正し、元chatIndexは保持。期待変更の根拠コメントをtestへ残した。初回の誤順序test成功は互換性の証拠に使わない。限定再監査は新規なし。

Catalyst初回関連7件のうち変更のない6件の成功を再利用し、正しい順序の新testと保存失敗/他chat遷移の影響2件を再確認して成功（重複あり）。型検査・bundle鮮度・最終Catalyst build・差分確認成功。ログ`/private/tmp/weavelet-context-search-{test,order-test,types,freshness,final-build}.log`。未変更のI/O/暗号化同期基盤suiteは反復しない。実画面確認はCUAがMacロックを回答したため未完了、検証cloneは終了。Airはdevice detailsでunavailableのため未導入。全検索UX/全機能の完成とはしない。


## 検索履歴・結果の前後移動（2026-10-17）

Web search-slice/grep-sliceのtrim・厳密重複除去・先頭追加20件制限、結果選択保持、前後循環をsrc/utils/searchState.tsへ切り出し、実Web callerとnative bridgeで共有。履歴はgraph searchHistory、sidebar sidebarSearchHistory、chat本文 chatFindHistoryの既存3rootを混ぜず保存する。履歴Menu/消去、Enter/前後44pt操作、index読み上げ、graph結果更新時の初回自動遷移へ接続。close/結果操作/画面離脱で履歴を保存し、重複/no-changeでは既存atomic保存が省略する。離脱時の失敗は親画面へ通知。本文や他rootを変えず、3rootとも既存同期対象のまま維持。

独立Astraのlibrary/legacy grepでnodeIDなしの選択indexが先頭へ戻るP2を、既存resultID+chatIDの補助identityで修正。実nodeID経路とgraph自動遷移判定は元Web規則のまま。追加native testでlibrary3件の2件目保持→3件目、同chatの別legacy結果を区別することを確認し、限定再監査は解消・新規なし。Webの3種実caller分離を含む6件成功、native新2件成功後に修正影響1件のみ再確認して成功（重複）。raw UTF16/履歴順・再起動・SyncRecords往復・保存失敗のdisk/メモリ保全も代表testで確認。型/鮮度/差分確認成功。ログ`/private/tmp/weavelet-search-navigation-{web-final-test,native-test,native-final-test,types,freshness}.log`。Catalyst test内のbuildも成功し、未変更の全I/O/暗号suiteは反復しない。

手動のkeyboard/タップ/VoiceOverは未確認。Airは今回もdevice detailsでunavailableのため導入していない。Web ChatFindBarのDOM内の一致箇所ごとの強調・前後移動（nativeは現在node単位）などの残条件は維持し、全検索UX・全機能・実cloud互換性の完成とはしない。


## 残件照合・復旧用の保存ファイル書出し（2026-10-17）

origin/mainをfetchしてHEADとの差分追加なしを確認。A/B主要操作は現UIからhandlerまで接続済みと再確認し、Cの中断生成復旧と直前送信条件での再試行は実Web入口がある一方native未接続と特定した。これらは未完了のまま維持する。今回はI/O保全側の未対応である復旧用書出しを先に追加した。

Web recoveryExportのversion:1/exportedAt/sources envelopeと必須4sourceキーを保持。nativeではliveStoreにメモリstateをraw OrderedJSONで残し、browser固有3sourceはavailable:false、追加nativeLocalStateに元ファイルの全bytesをbase64で回収する。原ファイルをparse/修正せず、非UTF8・通常load失敗でも書出し可能。未作成だけavailable:false、他の読取失敗はavailable:true/error。既存fileMenu/fileExporterへ接続し、読取/エンコードはTask.detached。native保存形式とOS読取の境界であるため、共通VMでデータを再解析せず、既存lossless codecを利用する。復旧用形式は通常importと別であり、自動復元・旧iOS移行の完成を意味しない。

Catalyst代表2件成功後、存在確認を前置せず読取errorで未作成を区別する修正範囲1件を再確認して成功（重複）。精密数値/UTF16/順序、元bytes不変、破損fileから実ChatState入口で回収、通常保存guard継続、未作成/読取失敗を確認。独立Astraは新規なし、差分確認成功。ログ`/private/tmp/weavelet-native-recovery-export-{test,final-test}.log`。保存/同期形式・Keychain・通信に変更はなく、既存成功suiteを反復しない。Catalyst実画面はMacロックで未確認、検証cloneを終了した。ユーザーの後続指示により以後しばらくAirチェック/導入を行わず、Catalystのみで進める。


## 生成失敗後の再試行（2026-10-17）

Web useSubmit.handleRetryの実処理（appendでは末尾assistant、中間では元insertIndexのassistantだけ除去して通常再送）を基準に、対象位置の判定を既存generationPlanへ切り出しWeb/nativeで共有した。nativeはshared planに元submitMode/insertIndexを保持し、共通removeNodeState→removeMessageAtIndexStateとinsertAssistantPlaceholderを利用する。composer送信やcontinueの代用ではなく、userを追加せずregenerate:falseで再送する。append後の自動title条件も元の値を維持する。空placeholder/部分本文のどちらも置換対象とし、後続node/別枝の取扱いは既存Webの削除・挿入規則を保つ。

nativeの失敗contextは結果を保存できた場合だけruntimeに保持。選択chat/保存済chatの一致と共有planのtarget ID/requestPathを照合し、編集等で無効化する。生成結果の保存待ちは送信再試行を許可せず、保存失敗では元source/disk/contextを保つ。通常停止は失敗扱いにしない。既存error表示の隣に44ptの「生成を再試行」を接続し、既存の「生成結果の保存を再試行」と区別した。保存・同期形式、新規依存は変更していない。

共有契約6件成功。Catalyst関連5件のうち初回4件成功を再利用し、append retryの期待修正後は該当1件だけ再確認して成功。初回はwire末尾userの最初のpartが送信文であると誤認した。実Web submitContext.ensureRoleAlternationは連続userのcontent配列を順に結合するため、期待を全文字parts [Next,Merged,Retry once]の順序・単一出現へ修正し、根拠コメントを残した。情報欠落の許容や実装の迂回ではない。空/partial retry、composer下書き保持、中間の後続node/未知精密数値保持、変更後の拒否、準備保存失敗時保全、再起動、既存regenerate/continueと保存再試行を確認。ログ `/private/tmp/weavelet-generation-retry-{native-test,native-final-test,types,freshness}.log`。Catalystテスト用build、型検査、bundle鮮度、差分確認成功。独立Astraの限定静的監査は新規なし。

今回の手動UI確認はMacロックにより未確認。Airはユーザー指示により照会・導入とも未実施。Webのproxy stream復旧(useStreamRecovery)は通常の再送とは別で未接続、全機能完成とはしない。


## nativeのプロキシ生成通信（2026-10-17）

Web submitRuntimeの /api/stream とproxyClientの /api/request・cancel・ack、および実Workerのenvelopeを確認した。proxyClient内のparseProxySseを純粋proxyProtocolへそのまま移し、Webのimportはre-exportで維持。native用proxyStream bridgeも同じparserと既存parseEventSourceを使い、outer cursor/partialとinner partial/DONEを一緒に更新する。重複cursorは適用せず、完了はinner [DONE]とouter complete/非overflowの両方を要求する。通信は既存URLSession、生成本文/上流header/secretの結合は既存native経路を再利用し、共有generationRequestへviaProxyを渡す。新しい依存はない。

native remote生成設定へチャット生成用の任意proxy設定を追加。上流認証はJSON envelope内、proxy tokenは外側headerに分離。HTTPS・user/passwordなし・query/fragmentなし・header改行なしを検証し、通常clientのredirect拒否を保つ。設定は既存Keychain recordのoptional fieldとし、旧record decode/無効時の直接通信を維持する。取り込んだWebのproxyEndpoint/tokenはraw stateとして引き続き保持するが、端末認証として暗黙利用しない。Web側のproxyEnabledだけGoogle同期除外、endpoint/tokenは対象という既存仕様は変更していない。

成功した主snapshot保存後だけACKを送る。保存失敗では出力とreceiptを保持し、既存保存再試行の成功後にACK。停止は既存部分保存を通し、別通信でbest-effort cancelを送る。partial/不正完了/停止でACKせず、未完thinkタグも既存flushで部分本文に保持する。OpenRouterのproxy metadataは適格な上流originの場合だけ既存観測stateへ結合する。

共有parser/bridge22件とremoteOutput5件成功。Catalyst関連5件成功後、raw envelopeの精密数値/孤立UTF16/認証分離assertを追加した1件のみ再確認して成功（5+1は重複）。stream/nonstream、部分切断/停止cancel、保存失敗→保存再試行後ACK、再起動後の保存結果、旧Keychain形式、危険な設定拒否を確認。型検査・bundle鮮度・差分確認成功。独立Astraの限定静的監査は新規なし。ログ `/private/tmp/weavelet-proxy-transport-{native-test,native-final-test,web-output-test,types,freshness}.log`。実proxy/実Keychainの設定変更はしていない。

これは生成通信の接続であり、Web useStreamRecovery相当の永続checkpoint・GETrecover・再起動/復帰復旧、補助生成/評価のproxy経路、provider-level cancelは未接続として続ける。画面手動確認は未実施（直前のMacロック状態で操作不可）、Air照会/導入はユーザー指示により行っていない。保存済結果の再起動確認を、中断streamの再起動復旧成功とは扱わない。

## プロキシの永続checkpoint・再起動復旧（2026-10-17）

WebのresolveRecoveryTarget/Statusを純粋streamRecoveryへ移し、既存hookのimportを維持。nativeは同じID・role・checkpointHash/appliedHash照合を共有bridgeで利用し、既存generationPlan.finalizeで本文を適用する。flush前のthink状態・内側SSE途中・outer cursor・本文/reasoningを同じatomic journalへ保存。outerイベントごとに保存し、同じcursorでの行単位書込は省略する。再接続ではWeb同様outer途中を捨て、内側の途中とthinkを継続する。主データ形式・オンライン同期方式は変更しない。

journalはlibrary横のproxy-stream-recovery.jsonで、key/tokenやrequest headerは含めない。再取得先は現在の端末Keychain設定と完全一致する場合だけ使い、ファイルのendpointへ認証を自動送信しない。初回・foreground・ファイルMenuから復旧でき、停止は取得だけを止めて記録を保持。明示停止済み生成は再取得しない。主保存前に現hashと予定hashをjournalへ残し、主保存成功後だけ整理/ACK。観測metadataは既存共有処理でmergeし、利用量を二重加算しない。変更のない主snapshotは保存を反復しない。破損journalは上書きせず、復旧用書出しに原bytesのnativeStreamRecovery sourceも追加した。

独立AstraのP2二件（部分保存Aから再取得Bの保存失敗でAのhashが失われる点、照合nodeIdとplan.targetNodeIdの不一致）を修正。現AのcheckpointHashと予定BのappliedHashを保持し、planの対象はUTF8厳密一致を取得前・書込前に確認する。回帰testを追加し、限定再監査は解消・新規なし。

Catalyst関連11件と最終build成功。再起動復旧、think/内側SSE分割とcursor重複排除、初回・二回目の主保存失敗後の復旧、並行編集拒否、未認証endpointへの送信禁止、checkpoint保存失敗時の旧bytes/メモリ保持、停止、ACK順序、破損journal書出しを確認。共有側は関連52件とremoteOutput6件成功（fixture補完後の対象2件再確認は重複）。初回native compileのtry欠落と型検査の新fixture不足fieldは修正済み。旧primary-save testはjournalと主保存を区別するため、directory全体の権限変更から主保存writeだけの失敗注入へ変更し、journal自体の失敗は別testで保全を確認した。ログ `/private/tmp/weavelet-proxy-recovery-{native-test,native-final-test,web-output-test,web-final-test,final-types,final-freshness,final-build}.log`。未変更の全I/O/暗号化同期suiteは成功結果を再利用。

実proxy、OSによる実background中断/復帰、手動画面は未確認。Air照会/導入は未実施。補助生成/評価のproxy経路、provider-level cancel、Webのcache-miss/通信失敗時の短時間自動再試行policyは残る。実cloud互換性や残るUI条件を含む全体完成とはしない。

## 補助生成・評価のproxy経路と復旧再試行（2026-10-17）

タイトル・要約・手動/自動の品質評価・安全性評価・hybridのremote fallbackに、端末global proxy設定を接続した。選択providerの鍵は既存認証検証と共有要求構築を通し、その後に既存の非streaming envelopeへ包む。共有transportへviaProxyを渡すため、補助要求のOpenRouter response cache禁止も既存Web規則による。moderationも検証済みの要求を/api/requestへ送り、/api/moderation専用に本文や認証を作り直さない。localのみの評価は従来の遅延準備を維持し、既存の保存・stale照合は変えない。

Webの復旧再試行判定を純粋proxyRecoveryPolicyへ切り出し、Web loopとnative bridgeから共有。通信失敗またはcache-missは最大3回再試行し、既定500ms、Retry-Afterは0〜5000msに制限する。通常partialやinterrupted/errorでは再試行せず記録を保持。待機中の取消、対象変更、checkpoint保存失敗は取得を続けない。再取得ごとにflush前のcheckpointを復元するため、途中thinkタグやcursorを重複適用しない。

Catalyst初回関連11件成功。親がinner応答decode失敗時にcursorだけ先行する例外経路を追加で確認し、応答とcursorをcandidateへまとめて適用して成功時だけ公開する方式へ修正。新しい例外保全1件と影響する正常retry1件が成功（再実行を含めたuniqueは12件）。補助要求の認証分離・非streaming応答・既存direct経路、manual/auto/hybrid評価、精密数値、cache-miss/503からの復旧、回数上限、待機取消、保存失敗保全を確認。Web関連29件、型検査、bundle鮮度、差分確認も成功。独立Astraの本群監査と追加例外経路の限定確認は新規なし。ログ `/private/tmp/weavelet-proxy-aux-retry-{native-test,native-final-test,types,freshness}.log`。保存/暗号化同期の未変更suiteは反復しない。

実proxyやOSによるbackground中断/復帰と手動画面は未確認。Airは照会・導入とも行っていない。provider-level cancel、実cloud/残るUI等の全体完成条件は維持する。

## プロバイダー側の生成取消（2026-10-17）

Webの取消鍵保持・送信判定をopenrouterCancelへ切り出し、native bridgeと共有した。provider ID=openrouter、HTTPSのcanonical openrouter.ai、既定port/443、gen-形式のIDが揃う場合だけ取消先を返す。Webでも実URLのorigin/portを照合してから鍵を保持・利用する。regional hostや別portへ渡した鍵をcanonical APIへ転送しない。shared remoteOutputはheader/応答の最初のgen- IDを保持し、後続IDで置き換えない。

nativeの停止は既存の部分本文保存を維持し、Task取消時に別の短時間通信でbest-effort provider cancelを送る。directは共有先をさらにsame-origin照合し、proxyは既存/api/cancelのproviderCancel内へIDと上流鍵を入れる。proxy外側の認証は従来どおりproxy tokenのみ。鍵は要求のruntime内で使い、共有VM・本文・journalへ追加しない。ID未取得・非対象provider/originではprovider鍵を送らず、proxyのupstream abortだけを行う。

Catalyst関連4件成功。direct/proxy双方の停止、部分本文と再起動保持、ACKなし、provider認証の分離、別provider/host/portへの鍵送信拒否、既存proxy停止/復旧を確認。Web関連41件成功後のport追加対象2件は重複。未設定provider IDの型エラーは空の不適格値として修正し、型検査・bundle鮮度・差分確認成功。独立Astraは新規なし。ログ `/private/tmp/weavelet-provider-cancel-{native-test,types,freshness}.log`。実OpenRouter取消・regional API対応は未確認であり、regionalへはprovider cancelを送らない。Catalyst手動画面は再照会したがMacロックで未確認、Airは照会・導入とも未実施。実cloud/全UI等の残条件は維持する。


## OpenRouter残高の共有処理とnative接続（2026-10-17）

実Web useOpenRouterCreditBalance/API/表示2箇所を基準に、5分stale・3秒cooldown・in-flight、応答の有限数値検証、残額の0下限/通貨表示、credits endpointを既存Web経路からpure helperへ切り出した。nativeも同じshared bridgeを呼び、端末Keychainのprovider別credentialと同originである場合だけ、既存RemoteClient/URLSessionでGETする。キーを共有VM/保存/syncへ渡さず、新規依存も追加しない。Webの既存鍵resolverにはsubstring一致とcustom provider endpointからcanonical APIへ鍵を渡す問題があったため、URL解析によるHTTPSのcanonical origin・標準port・userinfoなしの条件に限定した。

残高・取得状態・error・credential identityはruntimeだけに保持し、保存snapshot/再起動/同期の対象にしない。nativeの認証変更はcache policyより先に検出し無効化する。await後はrequest nonce、現在credential、provider設定を照合し、旧accountの応答・error・終了処理が後続request/残高を消さない。手動更新は44pt操作と中立色の専用行で、既存モデル/表示切替の横幅を圧迫しない。

共有helper/鍵境界8件とWeb型検査・bundle鮮度・差分確認が成功。Catalyst初回2件中、通常残高testが失敗：provider設定が省略されデフォルト補完される場合、読取側nullと再照合側optional nilを誤比較していた。実装の再照合を同じnullへ揃え、期待値は変更しない。旧nonceが新requestを無効化する問題も修正し、最終関連3件が成功した（初回late-key成功1件と重複）。GET/Bearerのnative構築、shared残額表示、fresh cache、壊れた応答時の既存残高保持、account変更中の遅延応答排除、別port鍵の不送信、旧request後着による新account残高の非破壊、source/snapshot/disk不変、再起動後残高なしを確認した。追加のcustom provider設定＋一致する別port credentialでもcanonical APIへ送信しない実行確認は該当1件だけ再実行して成功（重複）した。

独立Astraの機能一式source監査は新規なし。ログ `/private/tmp/weavelet-credits-{shared-test,types,native-test,native-final-test,origin-test,freshness}.log`。保存/同期基盤は変更しておらず、全I/O/暗号化同期の成功結果を再利用する。実OpenRouterへの接続、実画面の狭幅/文字サイズ確認は未実施。iPhone Airの検出/導入はユーザー指示で停止中。verifiedStats/pendingVerificationsのnative操作・表示は別の未完機能として維持する。

最後の入口調整は、選択chatだけでなく同chatのprovider/modelSource/OpenRouter endpoint変更でもopen policyへ接続し、localモデルでは表示・通信を除外した。該当差分の独立Astra限定確認は新規なし、最終Catalyst buildも成功（`/private/tmp/weavelet-credits-final-build.log`）。このUI入口変更で業務/同期suiteを最初から反復していない。

## 一時停止時点の整理（2026-10-17）

ユーザー指示により実装・追加検証を停止。実行中だったCatalyst/型検査の終了結果だけ回収した。未コミット変更・生成artifact・失敗testをそのまま保全し、stash/reset/削除/commitは行っていない。作業先はcodex/shared-main-integration、HEAD 75b12f2b。サブエージェントは全員終了済み。iPhone Airの照会/導入停止も継続する。

### 受入済みの主な範囲

本文/属性/record変換や会話・枝・フォルダー操作等の共有化、要約・評価・タイトル生成・tokenizerの接続、各保存I/OとGoogle/CloudKit/フォルダー同期の隔離互換性検証、承認済みiPhone UIを基礎とする機能接続、検索履歴/分岐移動/分割連動、失敗生成の再試行、proxy通信/永続checkpoint/復旧再試行/補助処理経路、provider取消、OpenRouter残高は前掲の機能群ごとの成功結果・監査結果を維持する。各群の限定受入であり、全UIの手動受入・実オンライン相互運用・全Web機能の完成を意味しない。歴史的な「残件」は後続章で完了したものがあるため、単独引用しない。

### 進行中：OpenRouter確定統計（未受入）

verifiedStats/pendingVerificationsのWeb状態遷移・50件eviction・取得予定・API変換・起動時fetching復旧をpure helperへ切り出し、実Web slice/hook/API/hydrationで利用。nativeは同じbridgeへ接続し、通常生成結果と確認queueの同時保存、native認証付きGET、遅延応答のpending/credential/provider/node照合、保存失敗保全、起動/foreground/scheduler、設定画面の表示と再確認を実装した。API要求/応答の参考はOpenRouter公式 https://openrouter.ai/docs/api/api-reference/generations/get-generation 。

Web関連30件成功と型検査成功を回収。その後bridgeのundefinedがpatchのvalue欠落を生む不具合を修正し、対象4件成功。最終の型検査・bundle鮮度・差分確認も成功。初回native fixtureのflat/tree・stream形式の不整合は実ensureBranchTreeForEditor/SSEへ修正した。期待値を緩めて成功扱いにはしていない。

最新Catalystは4件中3件成功・1件失敗。成功はproxy再起動復旧、旧generationの遅延統計が新pendingを上書きしないこと、最終保存失敗時のdisk保全→再起動recover→再確認。失敗は `RemoteGenerationTests.swift:454`：通常生成queue→GET→確定値保存→既存未知stats保持→再起動まで進んだ後、`exportWebData()`→新storeへimportした結果にverifiedStatsがない。書出し形式が意図的に会話だけを対象にする仕様か、情報欠落かは停止時点で未判定。実Webのexport/import経路と形式仕様を確認してから原因を判断し、根拠なく期待値を変更しない。停止後の修正・再実行はしていない。

独立Astraの静的監査は新規なし。ただし、その後のbridge undefined正規化とproxy復旧→queueの追加差分は限定再監査が未実施。実API・実画面は未確認。この一式を完了扱いにしない。証拠は `/private/tmp/weavelet-verified-stats-{compile,native-test,native-final-test,native-boundary-test,types,freshness}.log`。

### 再開時の優先残件

1. 上記statsのexport/import失敗を実Web仕様で切り分け、必要な実装修正と該当I/O確認、最終差分だけ独立Astra監査を行う。
2. 現行Webとの残機能差：現在会話の本文内一致箇所ごとの強調/前後移動（現nativeはnode単位）、Cohere固有生成形式・tool callsの対応境界、旧iOS保存形式の移行可否などを完了条件と照合する。全機能同等は未証明。
3. 実オンライン互換性：GoogleはiOS OAuth未登録で隔離検証先行、CloudKitは旧container利用の実Web/native相互運用とDevelopment/Production境界、フォルダー/iCloud Driveは実配信・placeholder・offline/競合の確認が残る。
4. UI/OSの手動受入：狭幅/文字サイズ/VoiceOver、IMEとkeyboard押上げ、分岐図/分割/本文操作の干渉、OS background中断/復帰、実モデル精度/性能等。Macロック後の実画面確認は未完了。iPhone確認は再開指示があるまで実施しない。

未変更の共有元・保存・暗号化同期の成功結果は再利用し、小変更ごとの全suite再実行や監査循環は追加しない。

## 再開：OpenRouter確定統計のI/O保証範囲確定（2026-10-20）

プッシュ済み300902faを基点に、新しい管理worktreeのcodex/web-ios-continuationへ復元して再開した。従来worktreeとルートcheckoutの未保存変更は変更していない。依存物はlockfileと既存native build手順から復元し、共有bundleの鮮度確認が成功した。

前回失敗は実装の情報欠落ではなく、通常V3会話書出しへ端末ローカル統計の保持を要求した期待値の誤りだった。根拠はWeb実caller `ExportChat.tsx:20-27` が会話・フォルダー・contentStore・評価rootのみをfileExportへ渡すこと、`importService.ts` が永続化設定rootのV3追加root混入を拒否すること。`persistence.ts` のFULL_PERSIST_KEYSは両統計rootを保存する一方、`storage/google/settings.ts` のSYNC_LOCAL_SETTINGSはverifiedStats/pendingVerificationsをrecord同期から除外する。通常会話I/O、全state保存、record同期を同じ保証として扱わない。CloudKitのfull-state契約は変更していない。

既存native境界testの誤ったV3期待値を訂正し、非空pendingを持つ状態でのV3取込み後保持・record往復での非送信・受信適用後のローカル保持を追加した。確定統計の未知巨大数・数値表記・孤立UTF16保持、再起動、古い応答の拒否、保存失敗保全、recovery書出しは引き続き確認する。比較方法や値保持assertは緩めていない。業務処理や外部形式の変更はない。

Webの統計/同期58件、fileExport/importService契約75件が成功。Catalystの関連4件が成功し、監査で網羅性の限界として挙がった非空pendingのI/O確認を追加後、変更した1件だけ再実行して成功（合計uniqueは4件）。独立Astra Lowの未監査だったundefined正規化、proxy復旧からqueue、native認証/遅延応答失効、保存成功前の非公開と今回の期待値根拠の監査は新規なし。ログ `/private/tmp/weavelet-stats-io-{web-test,native-test}.log`、`/private/tmp/weavelet-stats-export-contract-web-test.log`、`/private/tmp/weavelet-stats-nonempty-io-native-test.log`。以前の本群の未受入理由はこの隔離確認範囲で解消した。

実OpenRouter通信、実CloudKit/Google/iCloud Drive相互運用、実機UI/OS条件は未確認のまま。iPhone Airの接続照会・導入は再開していない。次はWebのChatFindBarの実処理を基準に本文内一致位置と移動の共有化・native表示接続へ進む。全体goalは未完了で、mainへの統合は行わない。


## 本文内検索の共有処理とWK接続（2026-10-20）

実Web ChatFindBarのliteral・大文字小文字無視・Textノード境界ごとの検索をchatFind/chatFindDomへ切り出し、Web実callerとnative Markdown hostから共用した。重なる一致は本文を複製せず共通segmentにmarkを付け、lowercaseで長さが変わる文字は元UTF-16位置へ対応させる。React所有のText nodeを置換せず、更新・削除・clear後の本文を保持する。検索状態はruntimeだけで、保存・書出し・同期形式は変更しない。

native WK接続はrequest ID付きのquery/index入力と、件数・選択位置・本文内rectの返却を実装した。遅延した別requestの結果は受け取らない。独立Astraが検出したprops-only更新で強調が戻らない問題はcommit後のuseLayoutEffect再検索で修正した。WebのCopy code等のDOM変更で強調だけ消え件数とRangeが残る問題も、共有helperの無効化通知から再検索して修正した。Web表示中検索は件数と選択を更新し、全ノード検索はノード件数を維持する。DOM追随では履歴とスクロールを追加せず、条件変更・unmountで監視と遅延処理を解除する。最終差分の独立Astra限定再確認は新規なし。

担当の実Chrome 6件・共有Vitest 2件・型検査成功を回収した。親は型検査・bundle鮮度、実WKの既存Catalyst接続test 1件を確認した。監査修正後の初回はtest側でlet inputを代入してコンパイル失敗し、Representable全体の更新へ訂正した。最終の再生成bundleでも同じ1件が成功。日本語/重なり一致、rect、props-only更新、React本文更新、clear後本文保持、stale拒否を既存の描画/HTML非実行/copy/fallback確認と同じ経路で検証した。ログ `/private/tmp/weavelet-chat-find-integrated-native-test.log`、`/private/tmp/weavelet-chat-find-final-types.log`、`/private/tmp/weavelet-chat-find-integrated-freshness.log`。変更のない全I/O/暗号化同期の成功結果は再利用した。

これは検索機能全体の完成ではない。iOS検索バーの一致箇所ごとの件数・前後移動、外側scrollとの接続、原文表示と未mount行を含む集計は未完了。raw sourceの一致数を整形後の件数として代用しない。実クラウド/実機条件は引き続き未確認、iPhone Air照会・導入は未実施。main統合も行っていない。


## iOSの表示中経路の本文一致検索（2026-10-20）

検索バーを一致箇所ごとの件数・前後移動・強調・外側スクロールへ接続した。原文範囲は既存の共有findTextMatchesから取得し、UIKitはUTF-16範囲の描画と選択矩形だけを担当する。整形本文は同じMarkdownRenderer/chatFindDomで索引を作り、raw sourceの件数へ置き換えない。未mount行も単一の非永続WKで逐次処理し、各行のWebViewを一斉生成しない。索引用WKは既存tokenizer/classifierと同じcontent ruleによってhttp/ws通信を遮断する。250msの取消可能な待機で連続入力時の不要な解析を抑制する。

実描画と索引でMessageBodyItemの本文選択を共用し、選択要約、折りたたみ、label、tool本文、詳細表示、スター絞り込み、編集中本文の除外へ接続した。整形失敗時は実際の原文fallbackを索引へ反映する。キーは会話とnodeのUTF-8を分けてbase64化し、同名nodeや正規化等価なIDを混同しない。会話をまたいで保持中の編集draftの判定は既存MessageDraft.targetsを編集表示と索引除外で共用する。検索・表示mode・geometryはruntimeの状態で、保存形式・I/O・暗号化同期の契約は変更していない。全ノードscopeの既存node単位の結果表示は維持し、そのscopeの本文強調接続は別の残件。

独立Astraで同一選択の再scroll通知不足、Markdown失敗後の索引不一致、別会話にある同名nodeの誤除外、DOM件数変化時の意図しない自動scrollを検出し修正した。実WKからの件数変化も反映し、索引対象外・staleの結果を拒否する。DOM更新のrevisionと明示移動のrevealを分け、同じbody/indexの位置が変わる場合も自動scrollしない。指摘修正と最後の限定差分に対する独立Astra確認は新規なし。

Catalystは関連unique 10件の成功結果を機能群内で回収した（複数run合算であり、最終全10件の一括runではない）。共有索引の原文/整形/Text境界/Unicode/NEL、未mount本文、遅延query拒否、表示選択と会話ID、UIKitの範囲/本文保全・font/幅・選択矩形、原文/整形それぞれの長文末尾への実ScrollViewReader移動と1件wrap、実WK process終了からの原文再索引、既存Markdown描画接続を確認した。初回のSwiftUI testはwindow未接続、scroll fixtureは更新後layout未確定だったため、標準windowと実layout確定で確認するよう直した。font>17の期待はCatalyst標準Text/ScaledMetric/UIFontがaccessibility3でも17である独立実測を根拠に、同じ環境のUIFont標準値との一致へ訂正した。根拠 `/private/tmp/weavelet-font-probe.{swift,txt}`。UI/layout/整形/fallback/境界/最終移動ログは `/private/tmp/weavelet-conversation-find-{ui-layout,rendered-ui,boundary,final-reveal}-test.log`。型検査・bundle鮮度・手書き差分検査も成功。変更のないWeb共有テスト・全I/O/暗号化同期は既存の成功結果を再利用した。

通常画面の手動受入、大規模会話での実測、全ノードscopeの強調、実オンライン相互運用等は未確認/未完了のまま。iPhone Air照会・導入とmain統合は行っていない。


## 全ノード検索の本文強調接続（2026-10-20）

既存の共有chatSearchによるnode単位の件数・前後移動を維持し、全ノードscopeもConversationFindの同じ共有本文索引・強調・scrollへ接続した。Web ChatFindBarの実callerと同様に、新しいquery/scopeでは先頭nodeへ移動し、その後に表示経路の先頭本文一致を強調する。同じ経路でのnode移動もnonceで再索引する。スター条件はnode検索に適用し、全ノードscopeの本文強調は表示経路を対象とする。node件数と本文一致数を置換せず、終了・scope変更時は旧要求を失効させる。

実標準UITextFieldを使うCatalyst追加caseで、入力から自動node移動、Returnから非表示分岐への移動、同経路の再強調要求、node 2件と表示本文1件→展開後3件の分離、mode切替/解除を確認した。初回はReturn delegateの可否問い合わせだけを実行していたためsubmitされず、UIControlのeditingDidEndOnExitへ訂正。次の失敗はio-corpusのcollapsedNodes.n-inactive=trueの見落としであり、既存Web由来の展開操作を通して折畳時1件・展開後3件の両方を検証した。件数のassertを削除していない。

同じ実入力caseでUnicode正規化等価なqueryの切替が状態更新されない不具合を検出した。標準入力を維持し、query状態とtask識別をUTF-8 DataにしてWebのliteral一致と同じ区別を保持する。éとe+combiningの入力切替をbyte一致で確認した。最終の追加1case成功 `/private/tmp/weavelet-node-find-ui-final-test.log`、最初の群で成功した既存raw長文scroll/遅延query拒否2caseを再利用する（unique 3件）。独立Astraの機能差分とUnicode/fixture期待根拠の限定監査は新規なし。手書き差分検査成功。保存・同期形式と共有JSを変更しておらず、未変更の全I/O/同期・Web検索テストの成功結果を再利用した。

今回で前章の全ノードscope強調の残件を解消した。通常画面の手動受入・大規模会話の性能、旧iOS保存データの移行可否、実クラウド等は残る。iPhone Air照会・導入とmain統合は行っていない。

## 旧iOS JSONの共有インポート（2026-10-20）

旧ios2のAppState（version1）とSyncSnapshot（version無し・snapshotVersion1）の明示的JSON取込みを、既存V3 import/preview/planへ接続した。Webの即時取込み・previewとnativeが同じlegacyIOSImportを使用する。Swiftに変換規則を複製せず、共有inspectのversion/省略parentId差分をOrderedJSONへ適用してからopaque参照化する。通常Web V1/V2の経路は維持する。旧sandbox、同期record、入力ファイルへ自動書込みしない。

legacy-ios-app-state.json/legacy-ios-sync-snapshot.jsonは旧DomainのChatTypes/MessageTypes/BranchTypes/ProviderTypes/CloudSyncTypes/ContentStore/PersistenceServiceを変更せずswiftcでコンパイルし、実JSONEncoderで生成した合成fixture。生成driverは /private/tmp/weavelet-legacy-ios-writer/main.swift。非表示分岐、flat会話、全旧ContentItem、未参照store、階層folderとcurrentChatIDを含む。nativeでは未知巨大整数・小数表記・孤立UTF16を追加し、preview非公開、raw保持、replace、再起動・V3書出し、未来snapshot/不正storeの拒否を確認した。currentChatID等は拡張metadataとして保持し、旧画面の選択状態再現を保証したものではない。append時の未参照store除外は既存の選択import仕様、全store保持はpreview/full replaceで確認する。

共有/Web関連102件と型検査成功を担当から回収し、親はbundle再生成・鮮度確認、Catalyst関連unique3件を確認した。既存save失敗再試行・stale拒否2件は初回成功を再利用、新規writer接続1件は修正後成功。最初の期待値はstore同一とflat messageのkey順同一を要求して失敗した。実Web fileImport.mergeChats→normalizeSystemPromptがconfig用system本文を追加し、flatChatToBranchTreeがflat本文を追加するため、元全entryのbytes保持＋追加exact2件/参照先本文に訂正した。materializeActivePathがrole/content順に再構築する根拠でflat message期待を同順にし、本文配列順・全値・未知rawのassertを維持した。製品挙動をテストに合わせて変更していない。独立Astraの機能監査・期待訂正の限定確認は新規なし。

ログは /private/tmp/legacy-ios-{vitest,tsc}.log、/private/tmp/weavelet-legacy-ios-native-{test,final-test}.log。共有exchangeReadの既存6失敗はgetInitialState mock不足として担当がbaseline同一を確認し、成功扱いに含めない。未変更の全I/O/暗号化同期の成功結果は再利用した。

binary圧縮containerと旧CloudKit record移行は未完了。旧writerのmagicはUInt32LE 0x57564C54で実bytesがTLVWとなり、コメントのWVLTとは区別する。zstd decoderは今回追加しない。将来AppState version2は通常WebV2と識別できず、この変更で対応済みとはしない。実オンライン・UI手動・大規模性能とmain統合は残件。iPhone照会/導入は実施していない。

## 旧iOS圧縮ファイルの共有読取（2026-10-20）

前章のbinaryファイル読取残件を解消した。旧SnapshotContainer.encode/ZstdCompressorと旧vendored C1.5.6を変更せずコンパイルし、合成snapshotから991byteのlegacy-ios-sync-snapshot.wvltを生成した。生成driverは /private/tmp/weavelet-old-zstd-writer/main.swift。実magic TLVW、version1/codec1、予約値、長さの検査をlegacySnapshotContainerへ置き、Web/native双方で使用する。nativeはJSC経由で同じheader検査を呼び、OS上のCで展開する。Webは.wvlt選択時だけWASMを読み込み、展開したJSONを既存の即時/preview経路へ渡す。通常JSON/gzip、現在の外部書出し・暗号化同期protocolは変更していない。

依存境界は公式facebook/zstd v1.5.7 commit f8745da6ff1ad1e7bab384bd1f9d742439278e99のdecompress-only amalgamation CをnativeとWASMで共用する。第三者codec実装や新npm runtime依存を追加しない。固定archive SHA、公式生成手順、Emscripten4.0.20と出力hashをshared/zstdに記録し、担当が再生成後のSHA一致を確認した。WASMは50,881byte、通常のWeb主bundleとは分離される。nativeはZstd BSD LICENSEを同梱、Web配布はZstdと静的リンクされたEmscripten/musl/compiler-rt等の全文noticeをpublic/licenses/weavelet-zstd.txtへ同梱する。公式license由来の末尾空白は原文を保持する。依存Astraの公式由来・保守・license・公開advisoryの限定監査は新規なし。公開advisory不掲載を未発見問題の不存在とは扱わない。

取込は圧縮payload・展開後とも128MiB以下に制限し、単一frame、辞書無し、frame宣言長と実展開長の一致を確認する。超過・未来version/codec・予約値不明・破損・余剰frame/bytesは元ファイルと保存状態を保持して拒否する。新形式の圧縮書出しや旧クラウドの自動上書きは追加しない。

担当のNode/実Chromiumの14 codecケース、入力上限・並行再利用、旧writer実payload、同Cのnative known/unknown-size展開とchecksum破損拒否の成功を回収した。親は関連Web92件、型検査、Vite build、bundle鮮度、実ChromeのreadImportFile→preview接続1件、Catalyst3件（圧縮旧writer/旧JSONwriter/既存gzip→append）を確認した。旧snapshot全項目のJSON一致、未参照store保持、破損/切詰/サイズ超過/複数frameでの未公開・disk不変、成功後の保存/再起動、入力bytes不変を確認する。app接続の独立Astra監査も新規なし。Chrome初回はheadless-shell未配置で起動失敗し、既存インストール済みChromeを使う隔離設定で成功した。WebKitの確認は行っていない。

ログは /private/tmp/weavelet-zstd-{build,test}.log、/private/tmp/weavelet-legacy-container-{web-test,types,build,final-build,browser-test,native-test}.log。未変更の業務規則・全I/O・暗号化同期は既存成功を再利用した。旧CloudKit/Googleのrecord/file探索からの実移行、実オンライン互換性、UI手動・大規模性能、将来AppState版の識別とmain統合は残件。iPhone照会/導入は行っていない。

## 旧CloudKit recordのreadonly取込み（2026-10-20）

旧writerのweavelet-ios-snapshot/WeaveletSnapshotを、現canonicalのweavelet-default-snapshotとは別に読み取り、既存の確認・選択取込みへ渡す入口をWeb/iOSへ追加した。locatorと対応版1はlegacyIOSSyncで共有し、nativeは固定bundleから取得する。通常同期のtarget/etag/metrics/baseline/statusは変更しない。移行時にも旧recordへsave/deleteしない。

nativeは原本payloadとrecord既知metadataを既存CloudKitSyncStoreへ原子的に保存してから版・内容を解釈する。保存失敗はpreview前に中断、破損や未来版でも原本を書き出せる。Webは既存fetchCloudKitRecord/cloudKitSessionGuardを使い、同じ接続のtoken回転だけ反映し、raw Fileを保持して原本保存と既存prepareImportPreview/useImportPreviewSessionへ接続する。接続変更・解除・unmount後の遅延結果は採用しない。データのdecodeに成功することを原本保存の条件にしない。

独立AstraでWebの外側record.snapshotVersion確認不足を検出した。metadataをraw結果に保持し、preview開始前/完了後に数値1との厳密比較を追加した。未来版・欠落・文字列版でも原本保存を残し、previewだけを拒否する。指摘解消後の限定確認は新規なし。native接続・保全と下記mock修正にも新規指摘なし。

担当の関連Web4files42件・型検査成功を回収し、親は統合後の型検査/Vite build/bundle鮮度とCatalyst3件を確認した。nativeは旧圧縮record→原本保存→preview/選択commit/再起動、既存canonicalの期待record保持、破損・未来版・不在・原本保存失敗・接続変更時の未公開/既存disk保持、raw原本の再起動後exportと既存full Web snapshot受信を確認した。Webは実API helperのlookup形とtoken/session境界、隔離hook hostによる多重操作/preview失敗/unmountを確認したもので、実ブラウザ画面・実CloudKitの確認とは区別する。

以前baselineでも失敗していたexchangeRead.contractのmockへ、実importServiceが参照するgetInitialStateを補った。期待値・比較assertを変更せず既存10件が全成功し、従来6件のmock起因失敗を解消した。ログ /private/tmp/weavelet-exchange-read-mock-test.log、/private/tmp/weavelet-legacy-cloudkit-{native-test,types,build}.log。変更のないcodec/全I/O/暗号化同期の成功結果は再利用した。

origin/mainをfetchしa4d83db6へ28commitの追加を確認した。指定範囲の差分棚卸しではweavelet-sync-delta(version1)、commit manifest3/pack2、WLCACHE、Google事前採番とproxyの永続復旧・status/storage管理等が増えている。この時点では最新版とのオンライン互換性を完了扱いにせず、次節でmain→featureの取り込みと共有接続を確認した。mainへの統合・push・iPhone照会/導入は行っていない。

## 最新mainの同期形式を共有実行へ統合（2026-10-20）

main a4d83db6をfeatureへ取り込み、未知属性・未参照content entry・全ノード列挙の保持と、mainのwire delta/commit manifest3/pack2・cache・Google事前採番を両立した。iOSはWebのEncryptedSync実クラスを既存JSC bundleで実行し、Swiftに別の同期protocolを追加しない。wireDeltaの書込既定値はWeb同様falseを維持する。Web workerとnative adapterは同じwire結合/復号関数を使い、cache codecはブラウザstream APIがない環境で既存fallbackを利用する。native HTTP境界は構造化された400 fileIdエラーだけを共有判定へ渡し、既存engineのID再採番へ接続する。応答本文を利用者向けerrorへ露出しない。

同じ本文でもremote entryのmetadataが変わった場合やbaseがremoteで保持されなくなった場合、以前のlocal delta entryを復活させない。record digest回数の期待値3→5は、本文ID2・metadata entry ID2・共有image ID1という実処理に対応する。opaqueなmessage属性はWebのmessages投影を削除する前に捕捉する。

mainの表示用resolveContentは破損deltaを空表示へ落とすため、取込み境界では既存validateDeltaIntegrityによりmissing/cyclic deltaを拒否する。旧exchangeRead fixtureの履歴的な空表示成功を入力受入の保証とは扱わず、strict拒否・元workspace/入力不変へ期待を修正した。正常入力と既存workspaceの壊れた参照は区別する。独立Astraでimmediate replaceが検証前にAIを取り消す問題を発見し、同じ検証を取消前にも実行した。共有変換入口の検証は残し、正常時は取消完了後のstateを取得する既存順序を維持する。append/replace双方で未取消・未公開・未保存と全state/入力不変を確認し、限定再監査は新規なし。

実Web engine/WebCryptoが生成したmanifest3 multipartとpack2をCatalystで読み込み、全records照合、native更新/保存/再起動を確認した。そのnative暗号化出力2本を実Web readerで読み戻し、全キーとrecord文字列が一致した。JSONにはprototypeがないため、比較時に外側辞書だけObject.fromEntriesで揃え、record内部のキー順・値・未知属性を正規化しない。認証が通る暗号化payload内のdelta hashだけを破損させた入力は拒否され、accepted snapshotを公開しない。fixtureは合成データ/FAKE passphraseのみ。

確認結果：初回Web関連242件中241件成功、残る破損取込の期待差は上記根拠で修正した。取込境界100件成功後、Astra指摘修正に関係する2files81件成功（前結果と重複、追加replace2件を含む）。proxy mergeのWeb79件とWorker43件成功。既存Catalyst同期25件、HTTP/ID回復境界2件、新wire境界2件成功を回収し、最終bundleではMarkdown接続1件と新wire境界2件が成功した。型検査・Vite build・共有bundle/Markdown再生成と鮮度確認成功。Markdownから不要になったWeb状態store依存が除去されたため、それらだけのnoticeも生成結果から除かれる。

ログは /private/tmp/weavelet-main-{integration-web-test,import-boundary-test,import-final-test,proxy-merge-test,proxy-worker-test,integration-native-test,invalid-id-native-test,wire-delta-native-test,wire-delta-web-read,final-native-test,final-types,final-build,final-freshness,final-markdown-freshness}.log。未変更の全業務規則や旧移行suiteを一律再実行していない。実Google/CloudKit、ブラウザ実権限、実iCloud配信、手動UI/性能は未確認。mainへ追加されたproxy状態/保存データ管理と永続node状態のnative表示接続、旧Google保存の読取等は次の機能群として残す。feature→mainの統合・push・iPhone照会/導入は行っていない。

## プロキシ状態・保存データ管理の共有接続（2026-10-20）

Web proxyClientの状態要求/応答、単体/全削除要求、固定before・昇順cursorの継続、失敗件数の扱いをpure proxyManagementへ切り出した。Webとnative JSCは同じ処理を使う。表示labelと受信位置/保存範囲のgap判定もWebから共有し、Swiftで同じ業務規則を作らない。共有元は既知の診断fieldの型・counter安全整数と削除累積の安全整数を確認し、未知fieldを保持する。HTTP失敗本文は解釈/表示しない。

nativeは既存remote設定から標準NavigationStack/Formへ接続し、全記録の20件ページ/前後移動、ID照会、5秒更新、能力に応じた確認付き単体/全削除を提供する。通信と資格情報は既存HTTPS検証・redirect拒否・ephemeral URLSessionへ置き、tokenを共有VMへ渡さない。owned sessionは終了し、注入sessionは保持する。解除/画面終了/照会先変更で取消し、古い結果を公開しない。loading flagの旧task残留を防ぐ。復旧は既存journalの対象変更判定・保存処理を使い、選択sessionだけを処理できるようにした。remote一覧をlocal journalへ自動登録せず、remote削除でlocal会話/journalを削除しない。

共有Web20件成功（初回18→既知field検証19→gap追加20は重複、最後の累積超過assertは対象6件だけ再確認）。Catalyst固有4件が成功した。全一覧/個別ID/複数ページ削除、単体path escape/取消前未送信、HTTP失敗時非成功と秘密非露出、全削除後の実snapshot・未知数値/孤立UTF16を含むjournalのbytes/state不変、選択復旧後の他journal全情報保持と再起動を確認した。error整形修正の1件と共有gap接続追加の1件は限定再確認で重複。型・Vite build・最終Catalyst build・共有bundle鮮度・差分確認成功。保存/同期schemaは変えておらず、全I/O/暗号化同期は直前の成功を再利用する。

実Catalyst画面で設定→状態、ID欄、エラー表示、戻る経路を確認した。戻ると未保存設定が再読込で消える問題を発見し、初回読込成功時だけdidLoadを立てて修正。修正後のdraft保持と、誤ったV3 JSON文言が状態エラーに付かないことを再確認した。既存debug fixture storeとFAKE通信だけを使い、下書きは取消、正常終了後にprocess不在とbuilt Info.plistの原本復元を確認した。実proxyの正常一覧/削除、狭幅/VoiceOverの全行、実cloud、iPhoneは未確認。永続node状態のnative表示、旧Google保存のreadonly移行等の残件は維持する。

独立Astraの機能一式監査と指摘外の実画面修正の限定確認は新規なし。ログは /private/tmp/weavelet-proxy-management-{web-test,web-final-test,shared-final-test,shared-check,native-test,native-final-test,ui-fix-native-test,shared-native-test,final-types,final-build,final-catalyst-build,freshness}.log。main統合・push・iPhone照会/導入は行っていない。

## 永続stream状態の共有判定・native保存/表示（2026-10-20）

Webのstream-end-status-store、StreamStatusIndicator、submitRuntime、useStreamRecoveryから、既存streamState更新・7理由の表示・7日保持・終了理由・復旧理由の優先順位をpure streamStatusへ抽出し、元のWebも同じ関数へ接続した。transient通知のTTLとWeb配色は維持する。未知のfuture reasonは表示を省略して原本を保持し、新要求開始時だけはWebと同じく旧要求状態を解除する。nativeは既存generationPlanの差分適用を使い、開始のstreaming/requestId/proxy/createdAt、終了のcompleted/max_tokens/interrupted/error、復旧結果を本文と同じatomic保存へ含める。暗号/HTTP/保存はnative境界のままである。

SharedWebProjectionはstreamStateの既知fieldを共有へ渡し、未知fieldは既存opaque参照で保持する。これにより共有resolveRecoveryTargetのrequestId照合もnativeで有効になる。表示は元レイアウトのcaptionと既存復旧操作を使い、生成中と要約表示中には終了状態を出さない。資格情報を共有VMへ渡さず、復旧ボタンは同じ要求のlocal journalと既存stale照合が通る場合だけ接続する。複数バブルを一律「復旧中」に置き換えず、進行状況は既存の全体表示を利用する。

独立Astraで、空出力の状態を主保存した後にjournal更新が失敗すると再保存できなくなるP2を発見した。journalのupsert準備を主保存前へ、成功後removeを独立catchへ移した。準備失敗ではdisk/base/generationを維持して保存再試行でき、主保存後の整理失敗では保存済みstateとjournal原本を保ち、未保存生成として扱わない。修正確認で他の新規P2以上はない。

Web関連6files48件成功。Catalystでは関連RemoteGenerationの固有9件と、射影変更の影響するMessageEditing30件が成功した。local生成の既存接続2件でも、資格情報を読まずに終了状態を保存することと、停止時の保存失敗から再試行してinterruptedを保存することを確認した。最初はMainActor指定不足でcompile失敗し修正。新IO fixtureはflat会話だったため既存Web prepare経路でtree化してから検証した。保存済みstreamStateの未知大数/数値表記/孤立UTF16の保持、異なるrequestId拒否、初期状態/length終了/停止/通信失敗/復旧、保存失敗と再試行、再起動、export/importを確認する。成功済みの変更無関係なケースは再実行せず、41件を一括実行した結果とは区別する。

新IO確認の最初のrecords再構築比較では、外側record辞書の列挙順だけが変わった。実WebのdiffRecordsはkeyとrecord文字列で照合し、既存SyncRecordsTestsも件数＋全キーのUTF8文字列一致を用いる。実Web engineでも104キー全ての文字列一致を確認した上で、この同じ比較へ訂正した。node順序を表すrecordやrecord内部のキー順・値は正規化しない。nativeが出力した今回のsnapshotと104recordsを実Web reader/writerでも照合し、全record文字列が一致した。既存の全I/O/暗号化同期経路は直前の成功を再利用し、同期形式自体は変更していない。

型検査・Vite build・最終Catalyst build・共有bundle/Markdown鮮度・差分確認成功。ログは /private/tmp/weavelet-stream-state-{web-test,types,native-test,native-final-test,preservation-test,io-final-test,local-test,web-read,build,final-build,freshness,markdown-freshness}.log。Catalyst実画面では既存debug fixture storeに合成会話を追加し、外部通信しないFAKE生成→停止→部分本文と「中断されました」の表示を確認した。AX click/typeで入力されなかったため表示位置からpasteで入力し直した。通常データ/実Keychainは使用せず、終了後にprocess不在とbuilt Info.plist復元を確認した。全理由/復旧ボタンの手動画面、狭幅/文字サイズ/VoiceOver、実cloud、旧Google保存のreadonly移行等は残る。main統合・push・iPhone照会/導入は行っていない。


## 旧Google appData保存のreadonly取込み（2026-10-20）

旧iOS GoogleDriveSyncProviderの固定名 `weavelet-canvas-sync.wvlt`、`appDataFolder`、`modifiedTime desc` を共有legacyIOSSyncへ定義した。nativeは共有locator/選択検査を呼び、最初の対象が見つかるまでGETのみで取得する。新しい通常同期形式や旧writerを追加しない。既存のPKCE認証を移行専用 `drive.appdata` とメモリ内credentialで再利用し、通常の `drive.file` / Keychain recordには触れない。新SDK・依存は追加していない。Web認証/BFFのscopeも変更せず、Webでの旧ファイル読込は既存 `.wvlt` importを利用する。

取得後は原bytesを接続オブジェクトに保持し、既存ChatState.prepareImport / FileImportViewへ接続する。確認前は会話/保存/同期先/accepted/cacheを変更しない。壊れた旧ファイルでも取得原本を書き出せる。原本の保持は接続オブジェクトの存続中で、永続アーカイブではない。旧remoteファイルは変更しない。取得できない場合に空データを作ったり通常同期先へ切り替えたりしない。

初回はWeb関連4件とCatalyst関連22件が成功。独立AstraでnextPageToken未取得により途中の空ページを未検出と誤判定するP2を指摘され修正した。[Google files.list仕様](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list)の継続tokenを根拠に、次ページ取得と空/反復cursor拒否を追加。修正後は共有2件とnative影響2件のみ再確認して成功（前結果と重複、新しいpaginationケース1件を含む）。限定再監査は新規P1/P2なし。nativeの既存sync fileに選択先/cache/acceptedを用意し、正常・破損の取得後とも全bytesと主保存state/diskが不変であることを確認。通常認証、401 refresh、取消、保存失敗・refresh競合などの既存成功を再利用し、変更のない全I/O/暗号化同期suiteは反復しない。

型検査・共有bundle鮮度・差分確認が成功し、Catalyst test用buildも成功。ログ `/private/tmp/weavelet-legacy-google-{web-test,web-final-test,types,native-test,native-final-test,generate,freshness}.log`。実Catalystで同期→Google同期→旧データ取込みの表示、説明、OAuth未設定時のボタン無効と正常なシート開閉を確認した。既存debug fixtureのみを使い、終了後にprocess不在とbuilt Info.plistの原本復元を確認。取得後の実画面操作・実OAuth・旧アプリのappData可視性は未確認。[Google appData仕様](https://developers.google.com/workspace/drive/api/guides/appdata)では作成したアプリのみアクセス可能であり、新nativeクライアントと旧アプリのGoogle設定の関係を実接続時に確認する必要がある。iPhone照会/導入・main統合・pushはしていない。全機能完成・実オンライン相互運用の完成とは扱わない。


## PNG書出しとサイドバー書出し入口（2026-10-20）

実Web DownloadChatの画像書出しに対応するnative入口を既存ChatExportViewへ追加し、画像は現在の表示枝だけを対象とした。先頭systemの表示判定は既存DisplaySettings/messageDisplayIndexes、要約によるhidden・選択中要約・折りたたみ・ラベルは既存summaryInfo/MessageBodyItemを再利用する。保存元の本文を別のルールで再構築しない。Markdownは既存ContentBody/MarkdownRendererを同じ配布物から使い、Web既存callerのlazy既定値は維持。nativeのPNGだけ描画器のimport完了後に注入して最終DOMを確定する。WebKitの最終画像decodeとfonts完了後にsnapshotし、横overflow・高さ16,384超・添付PNG単体12MiB/合計32MiB超では切捨てず失敗する。PNGは幅1024実画素の表示用出力で、保存・同期の形式は変更しない。新ライブラリは追加していない。

画像作成は取消可能で、完了後に会話ID/経路/全snapshot/要約presentationを照合して古い出力を公開しない。ラベル/注記/折りたたみ文字列はplainとしてReactテキストノードで出力し、MarkdownやHTMLとして解釈しない。構造化添付は既存native ImageLoaderを再利用する。Markdown内のHTTPS画像は既存rendererと同じCSP/nonpersistent WebKitで取得し、認証や独自headerを渡さない。取得失敗や破損画像は欠落PNGとして成功させない。top-level navigationは既存bundle resource内に限定する。

独立Astraの初回P2は、外部Markdown画像の遮断/失敗済み画像の成功扱い、遅延renderer完了前の確定、長いコードの横切れの3件。固定のDOM静止待ち/rAFを除去し、明示import・image.decode・fonts完了、export専用折返しCSSと内部scroll領域の横overflow検査へ修正した。続く限定確認のplain label再解釈P2も前述のplain種別で解消。修正範囲の限定再監査は新規なし。最初のcompileではconfiguration変数の重複、その後summary比較のtry不足を修正した。最初の実描画testはwindow未接続でrAFが進まず停止していたため、該当xcodebuildを明示中断し、時間待ちではない完了判定へ修正した。

Catalyst関連11件が成功し、その後plain修正に対する新1件とPNG1件だけを確認して2件成功（前結果と重複）。固有12件の成功であり最終一括12件のrunとはしない。画像の実幅・Markdown/添付/推論/tool本文、長いコードの折返し、過大画像拒否、破損Markdown画像拒否、取消、plainラベルの完全保持と選択要約/折りたたみ、全raw snapshot/disk/export/restart不変、既存Markdown表示の接続を確認した。Web関連6件、型検査、Vite build、共有bundle/Markdown鮮度、最終Catalyst buildが成功。未変更の全暗号化同期suiteは既存成功を再利用した。生成JS内の既存highlight grammar文字列由来の末尾空白警告は文字列の意味を変えず保持し、手書き差分の空白検査を成功させた。

サイドバーの選択中会話行に既存書出し画面への入口を追加した。実Catalystで初回範囲が全件になるSwiftUI bool+別scopeの不整合を見つけ、optional Scopeをsheet(item:)に直接渡す形へ修正。限定Astraは新規P1/P2なし。再起動後、行からは「選択した会話」、通常ファイルメニューからは「全件」を確認。PNG選択→表示枝→標準保存panel→一時folderへのPNG保存を完了した。実ファイルは1024×372のdark PNGで、文字/背景/余白/両roleと本文を目視確認。別の合成PNGでもMarkdown・推論・添付・tool本文の実描画を目視確認した。AX popupの初回click未確定はEnd/Returnで選択し直し、保存panel復帰後の古いAX IDはfull tree再取得で訂正した。製品の保存処理変更ではない。通常store/実Keychainを使わず既存debug fixtureだけを使用し、終了後にprocess不在とbuilt Info.plistの原本復元を確認した。

ログ `/private/tmp/weavelet-png-export-{native-test,native-final-test,native-corrected-test,native-render-test,native-label-test,types-final,web-test,web-build,freshness,sync-freshness,ui-final-build,renderer-generate}.log`。確認画像 `/private/tmp/weavelet-png-export-proof.png` と `/private/tmp/weavelet-png-export-ui-proof.png`。外部HTTPS画像の実取得、狭幅/VoiceOver、実cloud、iPhoneは未確認。main統合・pushはしていない。

残機能差の追加照合では、Cohere固有生成形式とtool実行は現Webにも実装がなく、provider選択肢だけを生成対応と数えないことを確認した（Web api/requestBody/submitRuntimeとshared generation/remoteOutput）。nativeだけの不足として無条件に機能追加しない。別途Web会話行にある生成停止はnative sidebarでは未接続であり、既存stopGenerationへの接続を次の限定範囲として残す。実オンライン相互運用・UI/OS/性能の受入も継続する。


## サイドバー会話行からの生成停止（2026-10-20）

Web ChatHistoryの対象会話行からの停止に合わせ、nativeの生成中会話行へ既存stopGenerationを接続した。全Listの一律disabledを、通常行操作・検索・フォルダheaderのdisabledへ移し、対象行の停止だけを有効にする。保存失敗でgenerationが残る場合も通常操作を無効のまま保つ。表示時のgeneration UUIDと現在値を照合し、古いボタンで後続の生成を止めない。停止・本文保存・失敗時再試行・同期protocol自体は変更しない。新しい業務rule/依存/テスト基盤は追加していない。

独立Astra Lowの限定差分/接続先監査は新規P1/P2なし。Catalyst build成功（`/private/tmp/weavelet-sidebar-stop-build.log`）。変更のない既存serviceの成功結果は再利用し、RemoteGenerationTests.testStopKeepsPartialAndRejectsDelayedResult（`/private/tmp/weavelet-stream-state-native-final-test.log`）とLocalGenerationTests.testLocalStopKeepsPartialOutputOnSaveFailureThenRetries（`/private/tmp/weavelet-stream-state-local-test.log`）の成功ログを再確認した。停止処理の同じ単体試験・全I/O/暗号化同期suiteを反復していない。

実Catalystでは既存debug fixtureに合成New Chat 3を作り、FAKE生成中の対象行に停止ボタンがあり、他行/検索/フォルダ操作がdisabledであることを確認。サイドバー停止→部分本文FAKE partial・中断caption・通常操作復帰を確認した。正常終了とprocess不在を確認して再起動し、部分本文/中断captionの保存を確認、再び正常終了してbuilt Info.plistを原本復元した。AXの入力focusが付かなかった初回操作は画面位置からpasteし直したもので、製品変更ではない。通常store/Keychain/実通信、iPhone、main統合/pushは使っていない。

次の実機能差として、Webの別会話remote並行生成を確認した。Web useSubmit/isChatGeneratingは同一chatのみ拒否し、chat-slice.generatingSessionsとsubmitRuntimeのsession-id別Mapは別chatを保持する。nativeは単一ActiveGeneration/generationTaskで全体を拒否し、完了時の全source一致guardも別chat更新で失効する。この差はOS制約として除外せず未完了とする。単にdisabledやguardを外さず、既存Webの対象判定/要求/結果適用を共有し、nativeのTask・資格情報・保存接続をchat/session別にする範囲から続ける。local推論の資源排他はremote並列とは分けて扱う。実オンライン相互運用・全UI/OS/性能受入は引き続き未完了。


## 別会話remote並行生成の共有接続（2026-10-20）

Web aiTaskLifetimeの既存fingerprintをpure aiTaskTargetへ移し、実Web callerとnative bridgeで同じ依存判定を使う。本文参照・role・omitted・configと要求先の存在を確認し、nativeは追加で自分のstreamState requestIdを照合する。nativeはUTF8 bytesの会話キーとUUIDの要求キーで生成・Task・停止・保存待ち・失敗再送・評価・タイトル・live計測を分離した。結果は最新sourceへ適用し、背景完了で選択会話を変えず、別会話の保存や未知raw値を上書きしない。高頻度の対象確認には既存Session方式を再利用し、通知ごとのJSContext再構築を避ける。新しい言語・依存は追加していない。

sidebarの会話移動と新規作成を許可し、停止は行のchat/要求UUIDへ接続。graph操作は対象chatの生成を確認する。全置換・同期・global設定等は背景の保存待ちも含むhasGenerationsで従来の保護を維持する。local推論は既存の資源排他を維持し、普通の会話移動を妨げない。全生成のlive利用量は既存Web mergeTotalTokenUsedで合算し、Swiftの別計算を作らない。

独立Astraは生成中新規作成が同期用guardへ入る問題、完了した接続contextの未解放、計測ON時に背景生成が再開されない問題を指摘し修正。限定確認は新規P1/P2なし。関連テストでは既存proxy復旧の別endpoint指定時に、通信なしでもbuffered結果で保存内容を変更する問題も発見。明示された検証済みendpointがjournalと不一致なら記録を保持して処理を見送る。設定なしのローカル復元と、一致した完了cacheは維持する。これは従来コードにも存在する構造で、並行化が原因とは断定しない。Astraがこの境界を限定確認した。

共有Web11件、型検査、Vite build、最終bundle鮮度、差分確認成功。Catalyst関連83件の初回実行では78件成功。新しい並行4件はMessageNode.contentが旧sample用であり、正式なWebExchange投影のpartsを参照するよう訂正した。比較値を空に合わせたのではなく、元のreply-A/B期待を維持する。残りの既存proxy1件は上記実装修正を行った。最終は影響14件だけ成功（4並行・3remote・4local・3利用量、前成功と重複）。変更のない評価16件等は初回成功を再利用し、最終83件一括runとはしない。その前にテストsubscriberの$generation移行漏れ、追加テストのtry/optional記法のcompile失敗を修正している。

4並行ケースはNFC/NFDの別chat ID、生成中の新規作成、同chat再送拒否、逆順完了と選択不変、停止後の遅延通知、片方だけの通信失敗、A保存失敗→B保存→A再試行と再起動/exportを確認した。未知大数と孤立UTF16を含むraw値を保持する。既存remoteの停止/保存失敗/proxy/利用量、local/evaluation接続も関連範囲で確認。sync schema/暗号/recordsは変更せず、直前の全項目実Web→native→Web暗号化同期・全I/O corpus成功を再利用し反復しない。ログ /private/tmp/weavelet-parallel-{shared-final,types-final,web-build,native-corrected-test,native-affected-test}.log。

Catalyst test用buildと隔離native接続は成功したが、今回は並行2件の実画面操作、実API・実cloud・消費電力/大規模性能は未確認。iPhone照会/導入・main統合・pushは行っていない。全Web機能再現と実オンライン相互運用・全UI受入の最終完成とは扱わない。


## chat paneのフローティング移動・編集ショートカット（2026-10-20）

実Web getBubbleNavigationTargetsの算出部分をbubbleScrollへ切り出し、WebはDOM測定、nativeはSwiftUI座標測定を担当する。先頭・前のバブル・次のバブル・入力欄への既存ScrollViewProxy移動と、undo/redo・全折畳/全展開の既存handlerを、pane左右下の44pt操作へ接続した。末尾の重複toolbarを除き、composerは引き続きscroll末尾に置く。入力欄が画面に入るとその上へ操作を退避し、編集/focus中や配置余地がない場合はoverlayを表示しない。色は中立、移動animationは既存設定とReduce Motionを守る。native LazyVStackの未描画前後行だけは、計測済み行と既存の表示ID順から補完する。

共有Web12件と型検査成功。Catalyst初回3件成功後、独立Astraのviewport/ID変更時の再計算漏れと未描画の前行へ戻れないP2を修正し、影響4件のみ成功（初回と重複、固有4件）。限定再監査は新規P1/P2なし。UTF8別ID、座標入力の不変、長い行/未描画の前後行、短いcontentと削除ID、viewport変更を確認した。保存・同期schemaや業務handlerは変更せず、全I/O/暗号化同期・折畳/編集履歴の既存成功結果を再利用した。ログ /private/tmp/weavelet-scroll-controls-{native-test,native-final-test,types,web-build,generate}.log。

隔離FAKE Catalystの実画面で先頭→次→前、移動可否の切替、全折畳→全展開を確認し、composerより上の操作配置を目視した。通常データ/実Keychainを使わず、検証後はprocess不在とbuilt Info.plist復元を確認した。最初のQuit後のAX取得でprocessが残ったため再度終了操作を行い、terminalで不在を確認するまで終了扱いにしていない。監査後の座標補完/再計算は自動境界確認までで、狭幅・文字拡大・実keyboard・全行操作の重なりは未確認。iPhone照会/導入・main統合・pushは行わない。

U21の操作入口は接続したが、実Web recordExplicitScrollNavigationにあるスクロール位置の履歴capture/復元と、行左端の独立折畳入口（U22）は残る。これらを単なるボタン配置の完成から推定せず、次の接続範囲とする。全UI/OS・実オンライン互換の最終受入は引き続き未完了。


## スクロール位置の履歴capture・復元（2026-10-21）

Web captureVisibleAnchorとChatContentの位置取得/復元式を既存bubbleScrollへ切り出し、Web実callerとnativeで共用する。最初のbottom>viewportTop、offset=-top、下端0.5の境界、node ID優先と欠損時のscrollTop fallbackを維持。DOM測定は従来どおり最初の可視行までに限定する。nativeはSwiftUI座標を渡し、既存ScrollViewProxyで未描画nodeを表示した後、public UIScrollViewのcontentOffsetへ共有計算の差分を適用する。新しい依存や独自の履歴規則は追加していない。

履歴は既存BranchNavigation.historyのcapture/push/back/forwardを利用し、会話ごとのcacheはUTF8 Dataキー、復元要求はUUID tokenで所有する。Web同様runtimeのみで、スクロール通知は主保存/同期stateを書き換えない。会話切替と明示scroll操作の離脱位置を捕捉し、戻る/進むは表示文脈とデータを同じatomic保存に含め、保存成功後だけ位置復元を公開する。未知raw値・内部保存形式・同期schemaは維持。全置換後の古いcacheを破棄し、明示focusは古い復元を取消す。1.2秒のlayout収束期間はWebに合わせ、手動scroll・入力focus・別要求で旧復元を止める。geometryも会話contextを付け、同じnode IDを使う別会話の古い座標を適用しない。

Web関連32件、型検査、bundle鮮度・差分確認成功。初回型検査のanchorRef optional nodeId推論差は戻り型を明示して解消。Catalyst初回19件中18成功、残る1件はruntime座標123.50が共有JSで123.5に直列化される表記差の期待だった。実WebもNumberの座標をJSON化するため入力を実際の123.5表現へ揃え、異なる前後位置123.5/456.25を復元するassertへ強化した。外部state/diskの全bytes不変の確認は維持し、外部I/O数値を丸める変更は行わない。表示文脈のatomic保存/失敗保持を追加し、最終はhistory4+controls5の9件のみ成功。変更のないBranchNavigation7件と並行生成4件は初回成功を再利用する。固有20件の関連成功であり最終20件一括runではない。

独立Astraで入力focus/keyboard対応のscrollを復元が打ち消すP2を確認し、編集開始/復元開始/継続時に自tokenを取消すよう修正。限定再監査は新規P1/P2なし。Native境界は共有計算→UIScrollView位置と上下限/横位置保持、node欠損/Lazy行/viewport、Unicode別ID、古いtoken拒否、保存失敗時のstate/diskと履歴非公開、runtime非永続を確認した。保存/暗号/recordsの基盤は変更せず全項目I/O・実Web暗号化同期の既存成功を再利用した。ログ /private/tmp/weavelet-scroll-history-{web-test,types,types-final,native-test,native-final-test,generate-final,web-build}.log。

隔離FAKE Catalyst実画面で、スクロール途中（先頭user本文の下端が残りassistant見出しが約406px）→次バブル→戻るで同じ配置を復元し、進むで移動先へ戻ること、別会話→元会話でも位置を復元することを確認した。AX containerへのscrollはnoValueだったため、取得した画面内の本文座標で操作し直した。通常データ/実Keychainは使わず、終了後のprocess不在とbuilt Info.plistのbyte一致復元を確認。狭幅/文字拡大、実keyboardとの同時操作、長時間の動的layout、VoiceOverの全操作、実API/cloudは未確認。iPhone照会/導入・main統合・pushは行わない。U22の行左端折畳入口、全UI/OS/性能と実オンライン互換の最終受入は引き続き残る。


## 行左端の本文折畳・展開（2026-10-21）

U22の入口を操作Menuから行左端へ移し、既存NodeOptionsの共有更新・保存を再利用した。見出し/本文を同じ44pt領域の右へ配置し、生成中と対象行編集中も領域を保持してボタンだけ無効化する。readonly比較表示には領域を追加しない。

最終Catalyst buildと差分確認成功。隔離FAKE画面で折畳→展開、本文再表示、対象行編集中のdisabled状態と整列を確認し、編集は取消した。終了後のprocess不在とbuilt Info.plistのbyte一致復元を確認。独立Astraは新規P1/P2なし、同一差分の前回監査結果を再利用した。業務規則・保存/同期形式は未変更で、NodeOptionsと全項目I/O・暗号化同期の既存成功を再利用する。ログ /private/tmp/weavelet-row-collapse-final-build.log。

狭幅・文字拡大・実keyboard・VoiceOver全操作、生成中の実画面確認は未実施。iPhone照会/導入・push・main統合は行わない。次はWebの生成中スクロール追従とnative接続を実callerで照合する。実オンライン相互運用と全機能/UIの最終受入は未完了。


## 生成中の末尾追従と操作欄の高さ保持（2026-10-21）

WebのstreamFollowAfterScroll/shouldFollowStreamをbubbleScrollへ抽出し、Web実callerとnative JSCが同じ追従判断を使う。実Webの0.5境界、短いcontentだけでは追従を選ばないこと、layoutだけでは選択を変えないこと、編集/分岐swipe/対象会話の生成がない場合の抑止を保持した。DOM observerはWeb、SwiftUI geometryとUIScrollViewの操作はnativeに残す。nativeはpublicのtracking/dragging/decelerationをユーザー操作として渡し、単なるLazy layoutのoffset変化を手動離脱と混同しない。明示的な末尾ボタンは追従を選び、他の移動は解除する。終了時はWeb同様に最小content高さを保ち、手動移動や会話/表示行変更で解放する。

実画面では生成中のhandler nil化で各行のfooter実体が縮み、完了時に再拡大する問題を確認した。既存の行全体disabledを維持しながらhandlerと操作配置を保持する修正で解消した。最初に試した終了anchor補正はこの原因を直さないため撤去し、新しい復元taskや保存fieldを残していない。独立Astraの途中指摘（補正位置の上書き）はこの撤去範囲であり、最終の配置保持とinteraction境界の限定監査は新規P1/P2なし。

Web関連16件・型検査・Vite build・共有bundle鮮度は成功。Catalyst controls6/history4の固有10件が成功し、共有判定の引数/結果とnative offset接続、手動離脱、編集時抑止、横位置保持、既存履歴/保存失敗保全を確認した。反復した同じ10件を加算しない。最終UI修正後はCatalyst buildと実画面の関連経路を確認し、未変更suiteは再利用した。保存/同期schemaと共有業務規則は未変更で、全項目I/O・実Web→native→Web暗号化同期の既存成功も再利用する。ログ /private/tmp/weavelet-stream-follow-{web-test,types,web-build,freshness,native-test,native-corrected-test,interaction-build}.log。

隔離FAKE Catalystでは長文送信/再生成の末尾追従、生成中の操作ボタンdisabled、前バブルへの明示移動後の位置保持を確認した。最終では生成中にユーザー見出し約260pxの位置へ移動し、完了後も同位置だった。通常scrollも本文外側の座標で操作し、段落5が約292pxの位置から完了後も動かないことを確認した。本文内のAX scrollはnoValueとなり、外側で操作し直した。これは短い2イベントのFAKE出力であり、実ハードウェアのwheel/trackpad慣性、長時間の多段階出力で行高が増え続ける場合、狭幅/文字拡大/実keyboard/VoiceOverを証明するものではない。終了後のprocess不在とbuilt Info.plistのbyte一致復元を確認した。実API/cloud・iPhone・push・main統合は行っていない。全Web機能/UIと実オンライン相互運用の最終受入は未完了。


## 表示経路外の生成先を分岐図へ表示（2026-10-21）

Web CollapseAllButtonsの同chat・activePath外session選択とstartedAt降順をorphanGenerationSessionsへ抽出し、実Webと既存aiTaskTarget bridgeへ接続した。存在しないtargetを新たに除外せず、元の条件と同時刻の安定順序を維持する。nativeは表示中経路を渡し、1chat1生成の制約によりsessionは1件だけ。生成先の選択をSwiftで再実装しない。左下に44pt入口を追加し、会話/表示行/生成の変更で更新、押下時にも対象を再取得する。

分岐図への移動は既存共有履歴とapplyLibraryのatomic保存を使い、広幅splitを維持、単一表示/compactではbranch-editorへ切り替える。生成対象・依存・通信は変更せず、保存成功後だけfocusを公開する。経路外やgraph表示中にも保持した生成結果を保存できるよう、既存の再試行Buttonを行内からactiveContentの直前へ移動し、重複元を削除した。新しい保存方式や同期fieldは追加していない。

担当の共有元/ChatContent関連14件、親の型検査・Vite build・bundle鮮度は成功。Catalyst初回5件中4件成功、新caseは再生成前の応答が残るという不正な前提で失敗した。実Web prepareRegenerateStateは対象応答をremoveNodeStateで削除するため、実共有branch保存で別の兄弟を作り、その兄弟を再生成して元の応答へ移動する経路に修正した。assertを緩めず新caseだけ成功し、さらにgraph focus後の生成結果保存失敗/再試行まで延長して同caseを限定再確認した。固有5件の成功であり最終5件一括実行ではない。

新caseはfocus保存失敗時のsnapshot/disk不変・未公開focusと生成要求ID保持、成功後の元source/表示経路保持・wide split維持、生成結果保存失敗時の出力保持とsnapshot/disk不変、既存handlerによる再試行、再起動後export一致・未知大数/孤立UTF16保持を確認する。未変更の全項目I/O・実Web→native→Web暗号化同期の成功は再利用する。独立Astraの機能群監査と保存再試行入口移動の限定確認は新規P1/P2なし。ログ /private/tmp/weavelet-orphan-generation-{generate,types,web-build,freshness,native-test,native-final-test,preservation-test}.log。

隔離FAKE Catalystでは別分岐へ履歴移動中も生成を続け、左下の経路外1件入口からgraphへ移動、target cardが中央に表示され、その後FAKE partial completeへ更新されることを確認した。終了後のprocess不在とbuilt Info.plistのbyte一致復元を確認。保存失敗UIそのもの、狭幅/文字拡大/VoiceOver全経路、実API/cloudは未確認。origin/mainをfetchし追加commitなし。iPhone照会/導入・push・main統合は行っていない。全Web機能/全UIと実オンライン相互運用の最終受入は未完了。

## 分岐図の生成途中プレビュー共有と表示領域の修正（2026-10-21）

実Web useBranchEditorLayoutのlive previewをcontentPreviewへ切り出し、Web実callerとnative branchLayout bridgeで共有した。resolveContentTextと同じtext部のみ・半角空白連結・80 UTF-16単位の省略を維持する。native表示境界では既存nativePreviewで切断surrogateを置換する。既存workerの一時preview処理は変更せず、実hookの表示規則を共有する範囲に限定した。

nativeはchat/nodeのUTF8一致と既存共有fingerprint・request IDの現行性を確認し、既存graphの対象cardへ出力だけを重ねる。チャット表示も同じ対象lookupを利用する。parts一致時のpreview cacheと既存JSC Sessionを再利用し、生成出力をlayout keyや保存sourceへ追加しない。完了・取消等のgeneration除去時にはcacheも破棄する。新規依存・保存/同期fieldは追加していない。

狭幅では通常表示の入力欄を行の44pt折畳領域の右へ揃え、吹き出し表示の余白は維持した。既存DEBUG connected previewをbuilt Info指定でも起動でき、実viewport内に収めた。実Catalyst分割表示で右pane全体が空白になる不具合も発見した。offset前の半幅ZStackへclipしていたため、clip前に全viewportのframeを指定する1行で両paneの描画領域を確保した。

Web関連6件・型検査・Vite build・最終bundle鮮度、Catalyst BranchEditor16＋ParallelGeneration5の21件が成功。共有text選択/空白、Unicode境界、chat/node接続の混線拒否、保存失敗後のpreviewと元source/disk保持・再試行・再起動/exportを確認した。split frame修正後は影響する実画面と最終buildのみ再確認し、未変更の21件を反復していない。保存/同期基盤は未変更で、全項目I/O・実Web→native→Web暗号化同期の既存成功結果を再利用した。ログ /private/tmp/weavelet-live-preview-{generate,web-test,types,web-build,freshness,native-test,final-build}.log。Viteの既存chunk容量警告は残る。

独立Astraの機能一式監査とsplit frameのみの限定再監査は新規P1/P2なし。隔離FAKE Catalystで393pt制約の本文/入力欄整列・編集/取消、左右分割の生成中FAKE partialから完了本文へのcard更新と位置維持、左右入替、上下分割、境界dragで50→41%の領域変化を確認した。狭幅previewは実iPhoneではなくCatalyst上の制約表示である。終了後にprocess不在とbuilt Info.plistのbyte一致復元を確認。長時間streamの性能、実keyboard/文字拡大/VoiceOver全経路、実API/cloudは未確認。iPhone照会/導入・push・main統合は行っていない。全機能/全UIと実オンライン相互運用の最終受入は未完了。

## 分岐図のミニマップと複数ノード選択（2026-10-21）

Web ReactFlowの実callerを調べ、MiniMap pannable/zoomableと範囲選択は有効、node dragは任意配置の永続化ではなく別会話へのcopy/move入口であることを確認した。任意座標の保存機能は追加しない。今回はミニマップと範囲選択を接続し、会話間drag/dropは次の残件とする。

Webの選択順の最初/最後を範囲とし、最後をpaste先とする処理をbranchSelectionへ抽出し、Web keyboard/context menuとnative bridgeで共用した。単一chatIdしか表現しない既存SequenceRangeへ異なる会話の選択を混ぜない。Webでも選択時のchat ID/indexを保持し、再解決で一致する場合のみ操作する。nativeは標準的な選択モードで複数cardを指定し、graph順の対象を既存BranchClipboardViewへ渡す。始点/終点・親子関係・copy/cut/paste/保護/未知属性の処理は既存共有元を使う。矩形ドラッグ選択そのものをSwiftへ再現する方式ではない。会話・layout変更時はruntime選択を解除する。

UIKitの既存viewportへ104x76ptのミニマップを右下に追加した。shared layoutの矩形・会話色・active状態を描画し、表示窓の矩形はUIKitの座標変換で追随する。tap/panは既存中心移動、pinchは既存0.1–2倍の拡縮へ接続する。手動操作後は自動fitを解除し、SwiftUI stateをscroll callbackごとに更新しない。左下の直接操作と読み上げ説明も保持する。保存/sync fieldや依存ライブラリは追加しない。

独立Astraは、無関係な会話の生成中にも既存範囲sheetの保存ボタンが無効になるP2を指摘した。source/targetの生成判定branchClipboardIsBusyを保存とUIの双方で共用し、対象生成中の拒否と別会話生成中のコピー成功を確認。限定再監査（対象判定とミニマップ）は新規P1/P2なし。初回Catalyst compileのCGRect initializer誤記とcatchのerror変数shadowは修正済み。テスト期待値は変更していない。

Web関連8件、型検査、Vite build、共有bundle鮮度、Catalyst最終関連28件（BranchEditor18・MessageEditing5・ParallelGeneration5）が成功。共有選択順/混在chat/Unicode、橋渡し、未知raw属性とmaps、保存失敗/再試行、古いdraft拒否、再起動/export/paste、他会話生成との両立、minimap座標と既存viewportの拡縮上下限/手動zoom保持を確認した。読み上げ要素の明示追加後は最終Catalyst buildと実画面を確認し、未変更28件を反復していない。保存/record/暗号/同期基盤は変更しておらず、全項目I/Oと暗号化同期の既存成功を再利用した。ログ /private/tmp/weavelet-graph-selection-{generate,types,web-test,web-build,freshness,native-test,native-final-test,final-build}.log。

隔離FAKE Catalystの393pt制約表示で選択mode/2件の表示と操作列の非重複、menu-root→menu-leftの始点/終点prefill、コピー後のsheet終了と隔離保存ファイルのnodeIds完全一致を確認した。ミニマップのnode/表示窓描画、tapで上方へ・dragで下方へ移動、全体表示への復帰も実画面で確認。終了後process不在とbuilt Info.plist byte一致復元を確認した。実touch pinch、Web browserの実keyboard/mouse操作、文字拡大/VoiceOver全操作、実API/cloudは未確認。iPhone照会/導入・push・main統合は行っていない。全機能/全UIと実オンライン相互運用の完成とはしない。


## 会話間の範囲操作接続・ドラッグ操作は未受入（2026-10-21）

実Web BranchEditorCanvasのdrop経路を確認し、既存buildPathToLeafの最後を終点とする範囲選択と、既存共有branchClipboardのcopy/move/pasteをnativeへ接続した。祖先を含むpath全体を転送範囲には使わず、始点はドラッグ元nodeのまま。任意node座標の保存、独自tree算法、新規依存、保存/sync fieldは追加していない。今回のWeb sourceと共有bundleは未変更。

copyはWeb同様にcopy成功後だけpasteする。独立AstraのP2（copy拒否後に以前のclipboardを貼る可能性）はstatus判定で修正し、実Webがnot-ancestorを返す範囲で元clipboard不変を確認した。copy後のpaste保存失敗では新clipboardを保持し、両会話本文は維持する。moveは既存原子的保存を使う。古いsnapshot、対象会話の生成中、raw UTF8 ID違いを既存境界で拒否する。

Catalyst固有24件（BranchEditor19、MessageEditing4、暗号化同期clipboard1）が成功。共有経路への引数/結果、未知巨大整数・範囲外の枝・maps/parts、copy拒否、move書込失敗、copy後のpaste書込失敗、古いdraft、生成途中出力、再起動/export/record往復、暗号化同期後のpasteを確認した。初回compileのJSONString参照誤記を修正して再実行した。UTI宣言追加後は重複するtoken境界1件のみ再確認し成功（固有件数に加算しない）。bundle鮮度確認も成功。保存/record/暗号/sync基盤を変更していないため、全項目I/Oと実Web→native→Web暗号化wireの既存成功を再利用し、全領域の反復は省略した。ログ /private/tmp/weavelet-branch-drop-{native-test,native-final-test,type-test,freshness,uikit-build}.log。

ドラッグ用providerはownProcessのUUIDのみで、本文・node/chat IDは渡さない。受信後にtoken・現行layout・snapshotを再検証する。SwiftUI onDragで開始を確認できなかったためUIKit UIDragInteractionへ接続し、同一アプリに制限した。最終Catalyst build成功。モデル/status修正とUIKit差分の独立Astra限定監査は新規P1/P2なし。card280×80とmenu44ptは維持したが、handle22ptの実touchの掴みやすさは未確認。

隔離FAKE Catalystでは複数会話、handleの描画/AX、メニューから会話間移動画面と始点/終点のprefillを確認した。一方、handle中心から他会話cardへの自動pointer dragでconfirmationは出ず、ドラッグ開始/完了は確認できていない。これは完了や互換性成功の証明に含めない。標準APIの開始接続はsource上欠落を確認していない。現SDKのUIDragInteraction.h:57–64はmacOSのpointer開始にlift delayを待つ既定動作を明記しているが、CUA dragには押下後の待機指定がなく、この操作での原因確定や実動作成功とは扱わない。未受入を維持する。終了後process不在とbuilt Info.plist byte一致復元を確認した。実cloud、実touch、全UI/OS/性能受入は未完了。iPhone照会/導入・push・main統合は行っていない。


## 分岐図メニューのコピー・切取り範囲を共有末端へ接続（2026-10-21）

実Web NodeContextMenuのcopy/cutは選択nodeからbuildPathToLeafの最後までを対象とする。nativeのgraph menuは単一nodeが初期値だったため、graph callbackだけthroughLeaf指定を渡し、既存共有branchPathから末端IDを得て既存範囲draftへ接続した。会話間移動も同じ範囲を使う。通常chat入口は従来の単一node、paste先も押したnodeを維持する。Swiftで子探索/時刻sortを複製せず、共有コード・保存・同期基盤・Web sourceは変更していない。

Catalyst追加1case testBranchClipboardDraftThroughLeafUsesSharedLatestForkPath成功。createdAt最新fork末端、始点祖先の除外、copy/cut/moveの範囲、通常入口とpasteの単一node維持を確認した。これはbridge接続の検証で、共有探索の全業務テストをnativeへ複製していない。test実行のCatalyst buildも成功。既存範囲保存・保全・全項目I/O・暗号化wireの成功は再利用した。ログ /private/tmp/weavelet-branch-menu-leaf-test.log。独立Astraの機能群監査は新規P1/P2なし。

隔離FAKE Catalystでmenu-leftの範囲コピーからsheetを開き、始点menu-leftと別IDの末端が初期選択されることを確認。コピー実行後は隔離保存clipboardの5nodeとその順序、先頭menu-left、表示された末端ID、menu-rootの除外を確認した。終了後process不在とbuilt Info.plist byte一致復元を確認。前節のdrag開始/完了は未受入のまま。実API/cloud、全UI/OS受入は未完了。iPhone照会/導入・push・main統合は行っていない。


## 分岐図の表示会話をまとめて非表示枝整理（2026-10-21）

実Web ConversationEditMenuの非表示node判定をbranchPruning.hasHiddenBranchNodesへ切り出し、Webの表示/実行callerとnative branchLayoutのpruneTargetsで共用した。選択は表示entries順、削除本体とpin/protected/参照解放は既存pruneHiddenNodesStateのまま。nativeは同じ対象と保存済みactivePathをdraft化し、既存MessageEditing.removeと共有履歴を順にメモリ上で適用した後、一回だけnative atomic保存する。各会話のundo履歴はWebと同じ順に保持し、現在の選択会話を変えない。対象生成中、古いsource、対象重複を適用前に拒否する。新しい依存・保存/sync fieldは追加しない。

分岐図の表示会話menu横へ44ptの編集menuを配置し、一括確認、既存undo/redoへ接続した。取消/画面離脱/layout変更では確認を破棄する。Web関連15件、型検査、Vite build、共有bundle鮮度は成功。Catalyst固有5件（新batch2件、既存生成保全1件、履歴/単体prune1件、暗号化同期clipboard1件）成功。二会話の保護/pinとactivePath、対象外会話と未知巨大数、保存失敗で全source/disk/history不変→retry/stale拒否、各会話順のundo、再起動/record往復と暗号化同期接続を確認した。全項目I/Oと実Web→native→Web暗号化wireの既存成功は、未変更のschema/record/暗号/sync基盤について再利用する。

初期native testは新testのtry? Bool?の誤記でcompile失敗。その修正後も新UIのcatch errorと表示state errorの名前衝突でcompilerがtimeout/assertを起こした。self.error明示で修正し、切り分け用のview/task分割は撤去した。期待値やテスト条件を緩めた結果ではなく、成功件数は最終runの5件のみ。ログ /private/tmp/weavelet-graph-pruning-{generate,web-test,types,web-build,freshness,native-test,native-final-test,native-menu-test,native-separated-test,native-content-test,native-load-test,native-fixed-test}.log。Viteの既存chunk容量警告は継続。独立Astraの機能群監査と、catch修正後のエラー提示/確認dialogのみの限定再確認は新規P1/P2なし。

隔離FAKE Catalystで同じ分岐を持つ合成二会話を表示し、一回の確認で両方が7→2nodeになること、activePath・対象外会話・clipboardの不変を保存ファイルでも確認した。取消時の永続state完全不変、整理後の再整理disabled、undo一回で後の会話のみ7nodeへ、二回で両会話の元node map復元も確認。終了後process不在とbuilt Info.plist byte一致復元を確認した。実touch/文字拡大/VoiceOver、前節のdrag開始/完了、実API/cloudと全機能/UI最終受入は未完了。iPhone照会/導入・push・main統合は行っていない。

## 分岐図のノード詳細と対象会話の属性操作（2026-10-21）

Web Canvas onNodeClick/MessageDetailModalに合わせ、headerはchat移動、本文は詳細sheetへ接続した。共有navigation/historyで対象pathを更新し、選択会話とviewを維持、focusを発行しない。既存branch searchの保存接続を小helperで共用した。詳細は原文text/imageのみを順に表示し、reasoning/tool等は保存データから削除しない。画像loaderと生成対象検証は既存処理を使う。

star/pinは明示chatIDのfresh draftを既存共有setterへ渡す。対象会話の生成中は拒否し、他会話の生成は維持する。card280×80、menu44ptを保持し、本文48pt/header32ptへ分けた。headerは44ptメニューでも操作でき、選択modeは従来の一ボタンを維持する。

Catalyst固有7件の成功範囲を確認（最終一括runではない）。新detailの他chat path/選択/split/focus・保存失敗保全・再起動/record往復、明示chat属性とraw UTF16/巨大数/未知項目、既存search、属性保存失敗/stale、暗号化Driveの新受信、生成対象/非対象の属性操作と部分出力保持を確認した。初回6成功・新options1失敗は、実corpusのstarred:trueをfalseと誤認した期待値だった。OFF時は実Web branch-slice.setNodeStar/shared nodeOptionsがfieldを削除するため、raw削除とtyped falseを両方検証するよう修正。同1caseだけ再確認して成功し、他6件は再利用した。V3 projectionとsnapshot wrapperの不適切な比較も実行前に既存全record往復比較へ修正した。情報欠落を許容する変更ではない。ログ /private/tmp/weavelet-node-detail-{native-test,options-test,options-final-test,final-build,close-build}.log。

隔離FAKE Catalystでtext→data URI画像→text、原文Markdown記号、star OFF/pin ON保存、全contentStore/config/pathと選択会話の不変、再起動後の属性、header→chatを確認した。UI用省略fixtureはvalidatorが拒否したため実corpus形状へ戻した。非foregroundで入力できなかった操作はwindow Raiseと実focusで入力値を確認してやり直し、商品コードを自動操作のために変更していない。

詳細内の画像拡大sheetはdetached presenterを記録して閉じるため、Webと同じ直接表示にした。AttachmentImageViewのallowsExpansion既定trueを保ち、新detailだけfalseで384pt上限の非Button画像を使う。既存chatの拡大経路とloaderは未変更。暗背景のclose textを標準toolbarの44pt xmarkへ変更し、白いiconとdismissを実画面で確認した。最終Catalyst build成功。独立Astraの機能群と画像/close境界の限定監査は新規P1/P2なし。描画修正後は影響UI/buildだけ再確認した。

別会話Copyを選択したまま元会話の生成node詳細を開き、FAKE partial→complete更新、生成中star/pin disabled→完了後enabled、starの元会話への保存とCopy選択保持を確認した。選択modeの一node押下→1件表示も確認。終了後process不在・built Info byte一致復元済み。共有Web/bundleと保存/sync基盤は未変更で、全項目I/O・実Web→native→Web暗号化wire・bundle鮮度の既存成功を再利用した。実cloud、実touch/狭幅/文字拡大/VoiceOver全経路、前節dragと全機能/UIの最終受入は未完了。iPhone照会/導入・push・main統合はしていない。
