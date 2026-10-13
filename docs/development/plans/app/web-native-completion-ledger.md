# Web / 新iOSの完成条件と証拠

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
| C 評価・命名 | safety/quality/local fallback/auto title、世代照合と各設定の一致 | 未実装 |
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
