# Web版を基準とした新iOS版のUI調整候補

## 2026-10-15：現行実装からWeb配置へ寄せる修正一覧

今回の基準は統合branch `7391143c`。以下はソース比較による修正計画で、最新画面の実測結果ではない。過去節は経緯として保持するが、配置については本節を優先する。**通常表示はWebの配置・読み順・操作位置・表示密度を再現する。nativeのカードやFormへ置き換えるだけでは完了にしない。** 任意の左右吹き出し表示は別スタイルとして保持する。

位置が同じでも、クリックで大きな設定sheetが開くなど、操作の粒度が異なる場合は修正対象とする。業務処理・共有API・保存形式は本UI変更で作り直さない。

2026-10-17接続状況：U01/U03/U06/U07/U10/U11は承認済みiPhone mockを基準に本番handlerへ接続。U02は既存ProviderModelsViewを選択入口として再利用。U13の現在会話検索はバー直下へ配置し、既存ChatSearch.results/state.navigateを再利用する。表示経路/全分岐/スターを選べ、全体検索sheetの既存対象切替は保持。U13全体（sidebar/graphそれぞれへの最終配置）や全UI項目の完成を意味しない。

### 寸法調整を先に行う

WebのCSS値は参照値であり、CSS pxからptへの全画面一律倍率を定めない。本文幅、左右余白、行高、アイコンの見た目、操作間隔を個別に合わせる。iPhone向けのタッチ判定とCatalystのポインタ操作は区別する。タッチ判定を残したまま余白やアイコンを調整できるが、判定領域の重なりで密度を稼がない。画面全体へのscaleEffect、文字だけの強制縮小、本文を画像化する方式は使わない。

### 2026-10-17：独立Astraによる視覚的統一感の比較

以下は現sourceとWeb counterpartの比較に基づく候補。今回の実画面・contrast比の測定結果ではなく、採用済みの配置を変える承認でもない。文字を薄くする方法ではなく、背景・面・文字階層・強調の数を調整する。上位5項目を先に明暗両モードで確認する。

| 優先 | 対象と根拠（native / Web） | 最小修正候補 |
| --- | --- | --- |
| 1 | ProviderModelsView:48、PromptPickerView:33 / ProviderModelList:240、PromptLibraryMenu:389 | 一覧Buttonの操作色が名称全体へ掛からないようタイトルprimary・補足secondary。行全体の操作を維持 |
| 2 | WeaveletPilotAppの本文・composer背景 / Message/View/UnifiedMessageView:55、EditView:19 | 会話の土台と本文/入力面を一組で明度調整。文字primaryを維持し、暗色の強すぎるカード差を抑える。実画面比較が必要 |
| 3 | BranchEditorView:242,355 / BranchEditor/nodes/MessageNode:77、ConversationHeaderNode:14 | アプリ内ノードのregularMaterialを不透明中立色へ、会話見出しをsubheadlineへ。active境界・状態表示は保持 |
| 4 | WeaveletPilotAppのConversationLibraryView / Menu/ChatHistory:19–21 | 会話名primary・検索入口icon secondary。選択背景、ellipsis、44pt判定は保持 |
| 5 | ChatSearchViewのresultRows / Chat/ChatContent/ChatFindBar:582 | 繰返す会話名をsubheadline medium、snippetをsubheadlineへ。primary/secondaryと44pt判定を維持 |
| 6 | WeaveletPilotAppのinlineEditor / UnifiedMessageView:55、EditView:19 | 青枠はfocus時のみ、非focus時は中立境界。保存主操作の強調は保持し、disabled時の見え方を確認 |
| 7 | ConversationEvaluationView:94–108、ConversationSummaryView:104 / EvaluationModal:260,583、BubbleSummaryView:20 | 繰返す種別/提案見出しをsubheadline semiboldへ。本文をcaptionへ落とさず、数値・警告・状態は保持 |
| 8 | WeaveletPilotAppのcomposer送信icon / EditViewButtons:248、main.css:270 | 描画寸法のみbody〜20pt相当へ。主操作の色と44pt判定、送信/停止の区別を保持 |
| 9 | PromptLibraryView:120–137 / PromptLibraryMenu:106,136 | 項目Sectionの余白・100pt以上Editorの最小高さを内容に応じて抑える。編集・保存構造を変えない |
| 10 | DisplaySettingsView、ChatConfigView:69,99,242 / SettingsMenu:269–294 | アプリ追加の繰返すheadlineだけsubheadlineへ。必要な子画面はinline title、Dynamic Typeと標準Form/Pickerは維持 |
| 11 | GoogleSyncSettingsView:123–152、FolderSyncSettingsView:148–182 / GoogleSync/FileSystemSync:43、GoogleSyncProgress:20 | dataset・補足・状態説明をfootnoteへ統一。競合/復旧/破壊操作の赤と主操作を弱めない |

native根拠は`ios-rebuild/WeaveletPilot/`、Web根拠は`src/components/`（main.cssのみsrc直下）。行番号は実装前監査時点。標準navigation/toolbar、認証/ファイルpicker/確認dialogのOS外観は維持し、アプリ内の内容面と区別する。Avatarの赤/緑・30ptはWebと対応するため無彩色化の根拠は薄い。アイコンタブ下線、承認済み配置と44pt判定も維持する。

後続の実装：候補1–8と10の局所的な色・文字階層を反映。本文の土台はsecondarySystemBackground、本文/入力/assistant吹き出し/graph node面はtertiarySystemBackgroundへ揃え、システムの明暗適応を使う。主文字primary・補足secondary、編集枠はfocusでaccent/非focusでseparator、保存不可の主ボタンは中立色とし、有効条件は変更しない。送信glyphはDynamic Type対応title3、判定44ptを維持。標準子画面のtitleはinlineに揃えた。候補9のEditor高さと11の同期説明の階層は未変更。全画面の最終視覚受入やコントラスト比測定の完了を意味しない。

実画面でButton内のprimary/secondaryにはtintの青/薄青が残ったため、モデル/プロンプト/検索結果/会話名の対象文字だけ動的UIColor.label/secondaryLabelへ明示修正した。全Buttonのtintは変更しない。Catalyst隔離画面の明暗両モードでprompt名と補足が中立色へ変わること、本文と背景、編集の保存可否を視認確認した。数値のcontrast比・最大文字サイズ・実機の目視は未確認。

U21の後続接続：末尾左の補助Menuへ一括折畳/展開と既存undo/redoを追加。WebのsetChatNodeMapStateを直接共有し、Swiftへ一括対象の規則を複製しない。固定隅配置・全スクロール方向を含むU21全体の完了ではない。Catalystの追加接続testとWeb実caller比較は成功、独立Astraは新規なし。今回の実画面操作はMacロックのため未確認。

U14の後続接続：左右/上下splitへ保存済み比率・入替、divider drag、均等復帰、VoiceOver調整を実装。Web setterとnativeで同一clampを共用し、pane最小寸法だけnative表示へ適応。drag終了時のみatomic保存し、編集中本文・他jobを破棄しない。Web/Catalyst関連testと独立Astraは完了、実画面のdrag/入替は未確認。リンク挙動や全UI受入の完了ではない。

U14のリンク接続：Web同様にsplit中の本文click→graph focusをruntime Toggleで制御し、OFFでもgraphからchatへの明示選択は保持。native本文tapと44pt scopeボタン、共有履歴、非同期配置後のviewport focusへ接続。compact単一表示では連動を発火させない。Catalyst関連6件と独立Astraは完了、実画面のtap/文字選択/リンク干渉は未確認。

U13の後続接続：sidebar内の名前/全本文検索とgraph上部の表示chat限定検索へ既存検索UI/共有処理を再利用。graph結果は表示順と元chatIndexを保持し、現在chatを切り替えず対象path更新とgraph focusへ接続。検索履歴・結果の前後移動・graph検索時の自動初回遷移、全UI手動受入は残る。

U13の履歴/結果移動接続：Web由来の共有helperで3種の履歴rootを分離保存し、履歴Menu/消去・前後移動・graph初回結果への自動遷移を追加。実nodeIDなしのlibrary/legacy結果も既存resultIDで選択を保持。Web/Catalyst関連testと独立Astraは完了。Web ChatFindBarのDOM内一致箇所単位の強調/移動、実画面と支援技術の手動受入は残る。

U15の後続実装：共有branchLayoutの座標は変更せず、nativeの表示窓をUIScrollViewのpan/zoomへ接続した。Webと同じ0.1–2倍の範囲とfit余白を基準に、初期全体表示、拡大/縮小、全体表示へ戻す、現在の経路末尾ノードへ移動を追加。操作列は44ptで図と独立、図は拡大できる。同じ表示会話の描画更新では表示窓を保ち、古い描画は操作不可とする。node選択後の既存chat遷移は変更しない。range選択/drag配置/mini map等を含むU15全体の完了を意味しない。

独立Astraによる現行差分の再整理では、修正済み項目を除いた残件を以下の2件とした。いずれもソース比較による懸念で、実画面での問題確定ではない。通常文字を薄くする、全画面へ一律scaleを掛ける、標準navigation/toolbarを独自部品へ置き換える方法は採らない。

| 対象 | 残る修正候補 | 保持する条件 |
| --- | --- | --- |
| PromptLibraryView.swift:120–123 / Web PromptLibraryMenu.tsx:106,136 | 独立Sectionと最小100ptのEditorが短文でも大きな面を占める。短文・非focus時の高さを抑え、編集中は必要な高さを確保する | ラベルPicker、削除、入力保持と編集のしやすさ |
| FolderSyncSettingsView.swift:149–150 / Web FileSystemSync.tsx:43、GoogleSyncProgress.tsx:20 | 通常状態のbodyとdatasetのcaptionを、補助情報としてfootnoteへ揃える | 操作ボタン、競合・復旧説明、エラーの読みやすさと意味のある強調 |

この再整理で新しい具体的な配色・コントラスト不具合は静的確認上なし。実測コントラスト比、最大文字サイズ、全画面の明暗目視を完了した判定ではない。今回の監査整理ではアプリコード変更・ビルド・端末インストールは行わない。

後続実装で上記2件を反映した。プロンプト本文は非focus時60pt・focus時140ptをDynamic Typeに追従させ、標準TextEditor内で長文をスクロールする。FormではminHeightのみだと大きく拡張されたため、実画面確認に基づきheight指定へ変更。子画面タイトルもinlineへ揃えた。フォルダー同期の通常状態・datasetはfootnote、ロック解除・競合・復旧・失敗の状態説明はbodyを維持。本文Binding、共有処理、保存・同期契約は変更していない。Catalystビルド成功、隔離した明色画面で本文欄の拡張/縮小、複数行入力のfocus移動時保持、保存せず戻った後の元本文維持を確認。独立Astra限定監査は新規なし。文字最大化・暗色の今回の2画面・実機は未確認。iPhone Airは接続状態unavailableで導入していない。

| ID・順序 | 現行nativeの差と主な根拠 | 修正方法 | 変更の種類 |
| --- | --- | --- | --- |
| U01・1 | mainの標準navigation barとconversationBarが別段。戻る/進むは「履歴」Menu内（WeaveletPilotApp.swift:80–141,336–388） | Webと同じ上部領域に履歴、会話名、左モデル・右表示選択を配置。戻る/進むを直接操作へ戻す。狭幅でのみWeb mobileの段構成へ寄せる。OSの戻る/一覧表示とアプリ内履歴は意味を区別 | 配置 |
| U02・1 | モデル名を押すとChatConfigView全体をsheet表示（同:346–357） | 同じ位置からモデル選択のMenu/Popoverへ直接到達。生成設定は隣接した独立入口へ。長いモデル名だけ省略し選択先で全文を確認 | 操作粒度 |
| U03・1 | chat/branchの独立ボタンとレイアウトMenuは各44pt（同:358–388） | Webの選択状態・左右の順序・間隔に合わせる。排他的なchat/branchは小さな選択群、分割方向/入替/リンクは隣接Menuへ。利用可能な機能だけを表示 | 寸法＋配置 |
| U04・1 | streamの外側20pt、行間20pt、最大幅900。本文にさらに左右12pt（同:435–470,1007–1040） | Webの全幅行と中央columnを分け、sidebar有無・pane幅に応じた本文最大幅へ。Webの外側左右28pxと内側16/20pxを比較の出発点にし、nativeの余白の足し方を合わせる。狭幅で読む幅が不足する場合だけ調整。本文・役割アイコン・操作列・composerの共通端を揃える | 主に寸法 |
| U05・1 | 本文は単一のsecondarySystemBackgroundの角丸16pt面。Webの全幅交互背景/行境界との階層が違う（同:1031–1040） | Webの全幅交互背景＋中央本文の角丸面という二層を再現。Web自身にも角丸本文面があるため、角丸を一律撤去しない。内側padding・薄い輪郭/陰影・省略/保護の強調を合わせる。左右吹き出しは別スタイルとして保持 | 装飾 |
| U06・1 | 役割tile30pt、役割はheadline。star/pinが役割の横（同:793–821） | Webのアバター・役割選択の比率、文字の太さ、baselineに合わせる。ヘッダー全高をアイコンの判定領域と混同しない。役割/属性の状態表示は保持 | 主に寸法 |
| U07・1 | 原文Menuと評価/除外/保護の群がViewThatFitsで複数段になる（同:825–905,987–1006） | Web同様に左役割・右表示/状態。先にアイコン寸法・群内間隔・ラベル幅を調整し、一行に収まる幅では一行を維持。次にヘッダー内の二段化。全状態を単一の…へ隠すのは最終手段。無理なカプセル化はしない | 寸法→配置 |
| U08・1 | 本文下は編集/再生成/上下移動等を一つの…Menuに収容（同:769–790,961–978） | Webの左分岐・中央主操作・右上下移動を復元。頻用の編集/再生成/コピーを直接表示し、削除や範囲操作を補助Menuへ。hover表示はtouchではタップ/選択状態へ置換 | 操作の露出 |
| U09・1 | 分岐番号が「分岐 n / m」かつ左右に44ptボタン（同:930–959） | Webに近い簡潔なn/mと矢印へ。見た目の幅と余白を詰め、判定領域は独立させる。フッター高を不必要に増やさない | 主に寸法 |
| U10・1 | composerは外側20pt、内側12pt、役割/本文/操作を積んだ独自の面（同:487–594） | Webと同じ本文幅・役割見出し・入力面・左補助/右送信停止の配置にする。空入力の高さは内容と文字サイズから決定。添付は本文に近接、キーボードにはsafe areaで追従 | 寸法＋配置 |
| U11・2 | 編集は常にFormのsheet、本文最低220pt（同:1645–1720） | 通常編集はWeb同様に対象本文内で行い、同じ位置に保存/分岐保存/生成/取消を置く。既存draft・保存handler・IME adapterを再利用。長文の拡大編集のみ明示操作でsheetへ | 表示構造 |
| U12・1 | サイドバーは標準List、44pt行、各行に常設…、作成系はOS toolbar（同:1100–1200,1270–1330） | Webの上部新規/検索、中央folder/chat、下部同期/ファイル/設定を再現。行inset・階層indent・font・選択背景を揃え、CatalystはListの余白と行高を詰める。touchはswipe/context menuと明示入口を併用 | 主に寸法＋配置 |
| U13・2 | 全体/本文/分岐検索を共通の検索sheetへ集約（ChatSearchView.swift:33–68） | Webと同じ検索文脈に欄と結果を配置。全体検索はsidebar、会話内はchat、node検索はgraphの検索帯。検索処理と到達handlerは既存を共用。狭幅で必要な結果一覧だけsheetへ | 表示構造 |
| U14・2 | 左右/上下splitはHStack/VStack＋固定Divider（WeaveletPilotApp.swift:391–414） | Webと同じ方向・pane順・入替・リンク入口と可変divider。最小pane寸法を設ける。狭幅の単一表示への適応では元の分割選択を保持。composerはchat pane内に維持 | レイアウト挙動 |
| U15・2 | graphは上部「表示する会話」とScrollView＋pinch中心（BranchEditorView.swift:152–205） | Webの隅ごとの操作群、拡縮/全体表示、選択状態・node外観・edge強調へ合わせる。グラフ自体のscaleは適用可。touchのpan/pinch・長押しを使い、ポインタと支援技術用の直接操作も設ける | 寸法＋不足UI |
| U16・2 | 評価/要約は常にNavigationStack＋Formの別sheet（ConversationEvaluationView.swift:28,ConversationSummaryView.swift:44） | Webのバブル内の状態/結果表示を先に再現。詳細は同位置にanchorしたPopover、狭幅はsheet。全設定を開かず現在の評価・候補・採用状態を把握可能にする | 操作粒度 |
| U17・3 | 設定は縦のFormカテゴリと複数sheetが中心（WeaveletPilotApp.swift:226–273,ChatConfigView.swift:182） | Webのカテゴリ順と項目群をそのまま使う。広幅はカテゴリ左/内容右、狭幅は標準NavigationStackで同カテゴリへ。モデル設定は既存fieldを2列/同一行へ組み直し、不要なForm行間を減らす | 寸法＋配置 |
| U18・3 | モデル管理・prompt管理も標準一覧/フォーム中心 | Webと同じ名前/用途/状態/主操作の読み順へ揃える。広幅の横並びを保ち、狭幅のみ縦積み。OSファイル/写真picker、共有、認証は標準UIを維持 | 寸法＋配置 |
| U19・1 | 本文WK側17pt、native body/headline/captionが混在（MarkdownTextView.swift:32,MessagePartView） | Webに合わせ本文/役割/補助文字/コード/表の比率と行間を揃える。native textとWKを同じ文字サイズ設定へ接続し、Dynamic Typeを保持。独自の一律縮小はしない | 主に寸法 |
| U20・3 | SF Symbolsの意味は対応してもWebの図形・状態色・選択面と差がある | 既存Web由来の役割/provider assetが利用可能なら再利用。OS固有操作はSF Symbols。通常/選択/除外/保護/disabledの視覚差を揃え、文字と読み上げでも状態を示す | 装飾 |
| U21・1 | Webの右下4方向移動、左下undo/redo・全折畳等と同じ固定操作群がない | 同じ隅へスクロール操作と履歴/折畳を復元。chat paneの内側に置きcomposer/キーボード/本文末尾を覆わない。Web40px丸ボタン/間隔6pxは見た目の基準、touch領域は別に調整 | 配置＋不足UI |
| U22・2 | 折畳は本文操作Menu内。Webの行左端の折畳入口がない（同:776,1023） | Web同様に行左端へ小さなchevronと判定領域を設ける。展開/折畳で本文の横位置を動かさず、状態と対象を読み上げる | 配置 |

Web照合根拠：上部は `src/components/Chat/ChatViewTabs.tsx:260,460`（min-height40px、左右8px、tab icon14px、700px未満でラベル省略）、mobileは `src/components/MobileBar/MobileBar.tsx:30`（一覧→履歴→タイトル→検索→新規）、sidebarは `src/components/Menu/Menu.tsx:81`（可変幅、mobile75%）。本文は `src/components/Chat/ChatContent/Message/Message.tsx:168` のmax-w-3xl/4xl/5xl条件と全幅背景・px-7/py-6/md:py-8、本文面は `View/UnifiedMessageView.tsx:54` のrounded-2xl/px-4/md:px-5。固定操作は `ScrollToBottomButton.tsx:17` / `CollapseAllButtons.tsx:36`、会話内検索は `ChatFindBar.tsx:461`、graphは `src/components/BranchEditor/BranchEditorCanvas.tsx:833` を参照する。

忠実な再現にも例外を明記する。現Webの最小84px本文面と末尾144px空白、hover専用操作はそのまま持ち込まない。過去のユーザー指示に従い、短文に意味のない縦空白を作らず、touchで直接到達できるようにする。Webのcomposerはscroll末尾にある。2026-10-16のユーザー指示によりiOSモックも末尾配置へ変更し、常時固定をやめる。キーボード表示時は標準safe areaとフォーカス対象へのスクロールを利用する。

### 実装するまとまりと受入

1. 上部・sidebar・stream・composer・本文操作を一式で調整する（U01–10、U12、U19、U21）。先に余白/幅/文字/アイコンを合わせ、その後に操作入口を戻す。細かい寸法変更ごとのテスト/監査は設けない。
2. 本文内編集・検索・split/graph・評価/要約・折畳を整える（U11、U13–16、U22）。モーダル化によるWebとの文脈差を減らす。既存共有処理を再実装しない。
3. 設定・資産管理・装飾を揃える（U17–18、U20）。機能の未対応はUIだけで解消したと扱わない。

比較は同じ合成会話・文字サイズ・表示幅・選択状態で行う。通常表示で上部の順序、本文端、1画面の情報量、各操作の場所と到達手数を確認する。狭幅/広幅/文字拡大/キーボードで欠落やはみ出しを確認し、差分画像のための専用管理基盤は追加しない。通常のビルドと動作確認はCatalyst。iPhoneへの導入・起動・目視確認はユーザーの明示指示がある時だけ行う。各機能一式の独立Astra監査を維持する。

本節作成ではUI実装・ビルド・端末操作は行っていない。寸法候補は実測による確定値ではない。

2026-10-12。状態は調査に基づく変更案。対象はHEAD `02d5e8e7`と調査時の作業ツリー。未コミットのWeb UI変更を含むため、実装前に対象symbolと差分を再確認する。

iOS版はUIに限らず全面的に作り直せる。旧iOSのクラス構造、画面構造、機能不足を新実装の制約にしない。Webの基本構成と操作領域の位置を基準に、その内部配置とコントロールをネイティブに合わせる。本書の初回成果物は調査と計画。以後、ユーザー承認済みの最小チャット表示からCatalystで実装を進める。

3つのサブエージェントで、バブル・入力、画面構成・探索・分岐、設定・モデル・同期を分担した。初回調査後に全面再構築の前提を全員へ伝え、各担当が再調査した。以下は静的調査であり、はみ出しや誤タップを実機で再現した不具合一覧ではない。

## 配置を判断する原則

- チャットストリームにメッセージ時刻を表示しない。OSのステータスバー時刻や保存データの日時とは区別し、データ項目の削除を意味しない。
- ユーザーとアシスタントで同じ本文領域を使う。ヘッダーのアイコン左端、本文左端、操作領域の左端を揃え、本文を役割名の下へ字下げしない。右端も同じ余白に収め、アイコン用の空列を本文の横へ残さない。
- 表示選択と評価・除外・保護の意味と位置は保つが、カプセル形状は必須にしない。ストリーム内では枠のないメニューと独立アイコンも使い、余分な囲いや縦余白を減らす。
- 維持する位置は、バブル右上、バブル下部、画面下部の入力、サイドバー、設定などの操作領域。ピクセル座標や一行の維持は要求しない。同じ領域内の段分けや関連項目の整理を許容する。
- 排他的な表示選択、独立したオン・オフ、実行コマンドを区別する。見た目が似たカプセルでも、一つのSegmentedControlに混ぜない。
- 頻繁に使う操作と現在の状態は表に残す。補助操作は同じ場所のMenuやPopoverに収め、狭幅ではSheetも候補にする。全操作を一つのメニューへ隠さない。
- 分岐選択、保存、生成、取消、削除の意味を保つ。制御をまとめても操作の違いと利用条件を変えない。
- 幅の判定は端末名でなく表示領域による。iPadの分割・ウインドウ縮小・文字拡大も狭幅として扱い、文字縮小で解決しない。
- 本計画の主要タップ操作は原則44×44 pt以上の領域を目安にし、近接操作の判定領域を重ねない。これは設計案の基準であり、現行の実測値や全コントロール共通の絶対下限ではない。
- 見た目だけの統一は必須にしない。Webの行背景とネイティブのカードなどは、読み順・状態・操作位置が一致すれば異なってよい。

Appleの[レイアウト](https://developer.apple.com/design/human-interface-guidelines/layout)、[Segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls)、[メニュー](https://developer.apple.com/design/human-interface-guidelines/menus)、[アクセシビリティ](https://developer.apple.com/design/human-interface-guidelines/accessibility)を参考とする。以下の段分けと操作優先順位は、このアプリ向けの提案である。

## ユーザーが挙げた右上の二つの表示カプセル

ユーザー提供画像「貼り付けた画像 1.jpg」により対象を確認した。ヘッダーは左にアバターと役割選択、右に「原文」と下向き矢印の選択カプセル、その隣にチェック付きバッジ・斜線付き目・盾の三アイコンをまとめたカプセルがある。文字サイズの操作群ではない。初回の「対象未特定」という整理を訂正する。

三アイコンは現在の`src/assets/icons/EvaluateIcon.tsx`、`OmitIcon.tsx`、`ProtectedIcon.tsx`と形状が対応し、評価・除外・保護に相当すると判断する。ただし画像だけでは評価の起動か結果表示か、各状態の有効/無効、左の全選択肢までは確定しない。

現在の作業ツリーでは`MetaActions.tsx:23`は除外・保護の二つ、評価は`ContentActions.tsx`側にあり、「原文」選択と同じヘッダー構成にはなっていない。`OverTypeEditor.tsx`も`toolbar: false`である。これは画像と現在のソースの差であり、画像に示されたUIが存在しないという意味ではない。配置案は今回の画像を基準にする。

| 状態 | 変更案 |
| --- | --- |
| 通常幅 | 左の役割選択、右の表示選択と状態操作の順序を維持。「原文」は現在値を示すMenu/Picker。右群は評価Buttonと、独立した除外・保護Toggle相当の三操作とし、排他的なSegmentedControlにはしない。カプセルの囲いは任意 |
| 狭幅 | 一行に無理なく収まる場合は維持し、収まらない場合だけ表示選択と状態操作をヘッダー内の次行へ移す。三アイコンの直接操作を保ち、縮小や不要な段追加を避ける |
| 文字拡大 | ヘッダー内で表示形式群と評価・状態群を別行へ分け、高さを確保。現在値と操作名を読み上げ可能にし、本文を覆わない |

表示形式が少数の排他的選択で、全選択肢と幅を確認できた場合に限りSegmentedControlも比較する。画像が示すMenuを無条件にSegmentedControlへ置換しない。右群も一つのMenuへ隠す案を既定にせず、評価の入口を本文下へ移動しない。

設計前に表示選択肢と適用範囲、評価アイコンの動作を対応する実装で確認する。編集開始は保存・取消を伴うため、原文の閲覧と同じ状態にはしない。文字サイズボタンなどは推測で新設しない。

## バブルと入力

優先度P1は最初の配置試作対象、P2は関連機能の設計時に扱う対象。Web根拠は`src/components/Chat/ChatContent/Message/`を起点とする。行番号は調査時点の目安であり、symbolを優先する。

| 対象 | 変更が必要な理由とWeb根拠 | 新iOSの変更案 | 保持する意味と受入 |
| --- | --- | --- | --- |
| M1 ヘッダー状態操作 P1 | `Message.tsx:198`のrole/右上配置、`View/MetaActions.tsx:23`の除外・保護はhover前提 | 添付画像を基準に右上へ評価・除外・保護の群を置く。除外・保護は独立状態を常時確認可能にし、狭幅・文字拡大はヘッダー内で段分けする | 除外と保護を独立して操作。状態を色だけで伝えない。VoiceOverの操作名・現在値とタップ領域を確認 |
| M2 本文下の操作列 P1 | `View/ContentActions.tsx:59`は中央カプセル、左分岐、右移動。中央はhoverで出現 | 通常幅は同位置で再生成・コピー・編集を直接表示。狭幅はフッターを二段化し、上下移動・削除等は補助Menuへ。分岐入口は左、生成取消は直接操作に残す | role別の再生成対象、保護・生成中の可否、対象ID、削除確認を保持。操作の表示条件と対象が一致すること |
| M3 分岐と評価 P2 | `View/ContentActions.tsx:60,110`は分岐選択と評価を同じメッセージ文脈で提供 | 分岐は左フッターの専用入口と現在位置/総数。評価は添付画像の右上入口から詳細へ。通常幅はPopover、狭幅はSheetなどで内容を表示 | 分岐・評価の対象が現在のノードと一致。評価の利用条件・結果表示を保持。旧iOSにないことを省略理由にしない |
| M4 保存と生成の複合ボタン P1 | `View/EditViewButtons.tsx:239`以降に生成・分岐生成・上書き・分岐保存の別経路 | 本文下の生成群・保存群と取消を維持。通常幅は主Button＋代替Menu、狭幅・文字拡大は二段配置。小さな矢印部分へタップを要求する寸法は持ち込まない | 上書きと分岐を統合しない。変更有無・role・生成状態で操作別に可否を決める。保存後の本文と分岐数で検証 |
| M5 入力と添付 P1 | `View/EditViewButtons.tsx`、`View/useEditViewLogic.ts:232,253,415`にファイル・URL・貼付けと添付操作 | 入力領域と送信/停止を保ち、補助操作は左側へ。狭幅は添付等を追加Menuにまとめ、選択済み添付は入力の近くに表示。通常幅でも主操作の幅を補助操作で奪わない | 下書き、添付の取消・削除・image detail、送信可否を保持。ファイル/写真/貼付けのOS実装は個別最適化 |
| M6 編集とキーボード P2 | `View/useEditViewLogic.ts:205`のEnter設定、`View/OverTypeEditor.tsx:96,256,306`の構文に応じた編集方式 | 本文内編集と下部保存/取消を維持。ネイティブの入力・選択・IMEを使い、Web編集ライブラリの内部モードは移植しない。文字拡大時も入力位置を維持 | 変換確定と送信を混同しない。ソフト/ハードキーボード、Enter設定、改行、編集取消、選択範囲と未保存本文を確認 |

## 画面構成と探索と分岐

Web根拠は`src/components/`を起点とする。

| 対象 | 変更が必要な理由とWeb根拠 | 新iOSの変更案 | 保持する意味と受入 |
| --- | --- | --- | --- |
| N1 上部操作帯 P1 | `Chat/Chat.tsx:51`、`Menu/Menu.tsx:76`、`Chat/ChatViewTabs.tsx:448`にsidebar・上部操作・主表示 | 通常幅はsidebar＋main、主表示上部のモデル・履歴・検索・右側表示選択を保持。狭幅はsidebarを展開式にし、上部操作帯は同領域内で段分け。長いモデル名は全文を確認できる選択入口へ | 主操作を別の画面へ散らさない。選択会話・モデル・戻る先を保持。文字拡大でも検索と表示選択へ到達可能 |
| N2 表示モードと分割 P1 | `Chat/ChatViewTabs.tsx:483`に左右・上下・入替・リンク。`Chat/SplitView.tsx:20`にdivider | 右上の表示選択と隣接Menuを維持し、左右/上下分割を候補に含める。各paneに必要な幅/高さを確保してdividerを制限。収まらない場合は同じ入口で単一表示へ切替可能にし、元の分割設定を保持 | 単一表示と同時表示を偽らない。裏側をSheetで開くだけの状態を「同時分割」とは呼ばない。リンク・入替・選択・保存範囲をWeb仕様と対応させる |
| N3 三つの検索文脈 P2 | `Menu/ChatSearch.tsx:18`、`BranchEditor/BranchSearchBar.tsx:6`、chat内検索の各入口 | sidebarは既存検索位置にタイトル/本文scope。chat/graphはそれぞれの検索入口から検索欄を展開。通常幅はscopeを隣接、狭幅・文字拡大は入力の次行へ。履歴と結果は同じ検索領域へ | 全体・会話・分岐の対象を区別。結果から該当chat/nodeへ移動し、リンク設定に従って相手paneを更新。現在件数・結果なし・次前を確認 |
| N4 グラフの操作群 P1 | `BranchEditor/BranchEditorCanvas.tsx:860`以降に左側mode・履歴・拡縮と右下minimap | 通常幅は各群の位置と役割を維持。狭幅は同じ隅の操作を段分けし、undo/redo・全体表示を直接残す。minimapは領域を奪う場合に同位置の展開式へ。拡縮はジェスチャー以外の入口も保持 | pan/selectを明示。ピンチだけに依存しない。ノード選択、Undo、戻る/進むを別操作として維持。タッチ/ポインタ/支援技術で検証 |
| N5 ノードの文脈操作 P2 | `BranchEditor/NodeContextMenu.tsx:54`以降に属性・複製移動・比較・メッセージ移動・削除 | ノード位置のcontext menuを基準に、選択時の明示的な「…」も用意。通常幅はPopover、狭幅はMenu/Sheetへ。比較の詳細は読める領域を確保 | 長押しだけを唯一の入口にしない。全操作の対象ID・保護・比較対象・確認を保持。旧iOSの空actionに合わせて機能を削らない |

## 設定とモデルとデータ操作

Web根拠は`src/components/`を起点とする。

| 対象 | 変更が必要な理由とWeb根拠 | 新iOSの変更案 | 保持する意味と受入 |
| --- | --- | --- | --- |
| S1 設定カテゴリ P2 | `SettingsMenu/SettingsMenu.tsx:63,206`のタブとカテゴリ内の密な配置 | 設定入口とカテゴリを維持。通常幅はカテゴリ＋詳細、狭幅は同カテゴリ一覧からFormへ。各値はラベル・現在値の行にし、横スクロールタブをそのまま縮めない | 既定設定と現在会話の設定を区別。即時反映/保存の既存契約を維持し、新しい一括保存を勝手に加えない |
| S2 モデルと生成設定 P2 | `ChatConfigMenu/ChatConfigMenu.tsx:119,448`のprovider付きモデル、生成値、reasoning等 | 設定内と会話上部の各入口を維持。通常幅は主要値を並べ、狭幅は縦Form。長いモデル名や高度設定は関連sectionへ展開する。数値を小さなsliderだけで操作させない | provider＋model、値の範囲、適用先、優先順位、モデル能力に応じた可否を共通化。設定から生成入力まで一致を確認 |
| S3 Provider一覧と詳細 P2 | `ProviderMenu/ProviderMenuInline.tsx:167`、`ProviderSettingsForm.tsx:28`の選択・検索・資格情報 | 同じProvider領域内で通常幅は一覧＋詳細、狭幅は選択から詳細へ。検索・フィルタ・Browse/Custom・資格情報を別行/sectionにし、chipとfooterへ詰めない | 選択providerとcredentialの保存先を一致。お気に入り・local・API version等はWeb機能対応表に含め、旧iOSの未対応を除外理由にしない |
| S4 同期の状態と詳細 P2 | `GoogleSync/CloudSync.tsx:18`、`GoogleSync.tsx:847`のsidebar入口と同期先・詳細操作 | sidebarの状態と入口を維持。通常幅はPopover等、狭幅はSheet/Formへ。接続・同期中・失敗の状態を入口にも残し、同期先や補助操作は展開 | 接続/切断、対象データ、手動操作、競合・失敗の意味を保つ。設定側の入口とも同じ状態を使い、別の同期管理を作らない |
| S5 取り込み P2 | `ImportExportChat/ImportChat.tsx:19,60`の追加・置換・設定選択・圧縮入力 | 同じImport入口からファイル選択と方式選択へ。縦Formで方式と対象を明示し、置換を小さなトグルへ圧縮しない。新規の件数プレビューは必須にしない | 追加/置換、設定範囲、形式を保持。取消・破損・失敗で元データを保全。OSのファイル選択UIに合わせる |
| S6 全件と個別の書出し P2 | `ImportExportChat/ExportChat.tsx:14,81`と会話単位の出力入口 | 全件はデータ操作側、個別は会話側を維持。Sheet内で対象範囲・形式・圧縮を別行にする。通常幅でも意味の違う選択を一つのカプセルへ混ぜない | 全件/会話/表示分岐、形式ごとの保持内容、圧縮を区別。書出し往復とOS共有の取消を確認 |

## 旧iOSから引き継がない実装上の制約

次は初回調査で確認した参考事項であり、新iOSの設計基準ではない。旧iOSパスの起点は`ios2/Weavelet Canvas/Weavelet Canvas/`。

- `Views/Chat/MessageBubble.swift:222`の26×24 pt指定、`MessageEditBar.swift:87`の26×30 pt指定にサイズを合わせない。
- `Views/Chat/MessageEditBar.swift:20,26`の分岐生成・再生成という表示と`onSave`呼出しの混同を引き継がない。
- `Views/BranchEditor/BranchEditorView.swift:365`のラベル・コピー・移動・比較の空actionや、`Views/Chat/ChatInputBar.swift:32`の未接続の添付入口を仕様としない。
- `ContentView.swift:524`のcompact時の分岐inspector固定、`ThreePaneView.swift:66,295`のペイン幅を新構成の制約にしない。
- 旧設定の不足、JSONだけのimport、全件V3固定export、同期設定への未接続経路を新iOSの機能上限にしない。ただし保存済みデータの移行は別途保証範囲を決める。

## 共通の受入確認

通常幅と狭幅、縦横回転、iPadの狭い分割領域、Dynamic Typeの大きな文字、日本語・長いモデル名、キーボード表示中を確認する。VoiceOverの読み上げ順・現在値・操作名、キーボードとポインタ、スクロールとスワイプの競合も対象とする。

操作前後で選択中の会話・ノード、本文の編集位置と未保存入力、表示モード、生成中の状態を保持する。レイアウトの切替だけで保存・生成・削除を実行しない。表示形式の切替で元の本文を書き換えない。静的契約テストだけでUI受入が完了したとはしない。

## iOSのチャット表示スタイル

ユーザー要望により、現在の整列したストリーム表示に加えて、一般的なチャットに近い吹き出し表示を選択可能にする。添付画像は左右配置と吹き出し形状の参考とし、画像内の決済・カメラ・アプリ連携などは対象に含めない。

- 「整列表示」を既定案とし、アイコン・本文・操作列を共通の左右基準線に揃える。
- 「吹き出し表示」はユーザーを右、アシスタントを左へ配置。本文量に応じた幅と角丸の背景を使い、役割は色だけに依存しない。system等は送受信のどちらかへ偽装せず、役割を明示する。
- 設定の表示項目から切り替える。初期案はiOSアプリ内共通のローカル設定とし、会話データやWeb側の表示設定を変更しない。同期・会話ごとの設定追加は今回の要求に含めない。
- 二方式で会話・本文・生成・編集・分岐・評価・除外・保護の状態と操作処理を共有し、レイアウトだけを変える。表示切替で下書き、選択ノード、生成処理、閲覧位置を失わない。
- 吹き出し表示でも時刻は追加しない。アイコンを吹き出しからはみ出させず、各メッセージ内のヘッダー・本文・操作の余白を揃える。整列表示の左右共通線は吹き出しの左右寄せには適用せず、各吹き出し内の基準線として扱う。
- 表示・評価・状態の入口はメッセージ上部、編集・再生成・分岐等は下部を基本とする。狭幅では段分けや補助メニューを使い、操作を削らない。本文選択やスクロールと競合する全面タップだけを操作入口にしない。
- 長文・コード・表・画像は吹き出しを極端に細くせず、必要な幅と局所スクロールを確保する。Dynamic Type、VoiceOver、キーボード表示中、生成中の両方式切替を受入確認に含める。

吹き出し表示の画像案と実機検証は未実施。色、尾の有無、最大幅、操作群の具体的な配置は次のデザインで確認し、参照画像の色を固定仕様にはしない。

## 現在のデザイン案と確認状況

- [バブル詳細 v2](../../../design/ios-rebuild-2026-10-12/03-ios-bubble-v2.png)はユーザーから良いとの評価があり、今回のストリーム修正では変更していない。
- [チャットストリーム v3](../../../design/ios-rebuild-2026-10-12/02-ios-chat-v3.png)と[全体構成 v3](../../../design/ios-rebuild-2026-10-12/01-ios-layout-v3.png)は、時刻削除、左右の整列、カプセルの簡素化を反映。ユーザーの了承を受け、整列表示の方向性の基準とする。実装寸法や全操作条件の確定とは区別する。
- 画像内の本文、グラフ、操作の省略や出現は生成画像の例示であり、機能契約の正本ではない。特に評価等の表示条件、分岐操作、モデル選択、設定の保存範囲はソースと契約に基づいて決める。画像中の「描画・UI部品の共通化」という例文も、ネイティブ描画を個別最適化する方針を変更しない。
- 正確なタップ領域、Dynamic Type、IME、VoiceOver、キーボード表示中の配置は、画像では検証できていない。次のUI具体化ではこの受入を対象とする。

## 段階的計画への反映

[共通化の段階的計画](web-native-commonality-roadmap.md)の段階1に、この17件と画像で確認した表示・状態操作の配置案をUI側の対応表として加える。バブルのヘッダー・本文・フッターの画像案は上記まで作成済み。表示選択の全選択肢と評価動作は、対応する実装の確認前に固定しない。機能全体の対応表と最初の共通処理の選定は[段階1成果物](web-native-stage1-map.md)で完了。デザイン画像だけで実装やUI受入が完了したとは扱わない。

段階2で共通化するのは表示状態の意味、適用範囲、操作と可否、編集・取消・保存の契約。SegmentedControlやMenuの構成、PopoverとSheetの選択、描画は新iOS側で設計する。UIのためにRustや共通描画層は導入しない。実装開始後は対象機能のUIから処理・保存までを通して検証する。


## 2026-10-13：実装の配置調整

Webのrole/avatar左・表示系/状態操作右という配置をMessageViewへ反映した。表示形式menuに原文/要約/圧縮とMarkdown/rawを集約し、評価・除外・保護・操作を隣接させる。単独の操作行を減らし、44pt操作領域とViewThatFitsの段組を使用する。streamに時刻を加えず、標準チャット表示/吹き出し表示の両方を維持。会話名はinline、入力欄はsafeAreaInsetで下端固定、設定と送信/停止を左右、画像と先頭文を近接配置する。会話追加/整理・履歴は上部menuへ移す。

CatalystのFAKE実画面で右上操作、重複行消失、本文端、固定入力欄と表示切替を確認し、独立Astra限定監査は新規なし。iPhone狭幅・最大Dynamic Type・キーボード時の収まりは未確認。サイドバー/分割表示、会話・フォルダー一覧と分岐の配置再現は次のUI対象とする。画像提案やこの局所確認だけでUI全体の受入とはしない。


## 2026-10-13：会話サイドバー

wideではWebと同様に会話/フォルダー一覧を左、チャットと固定入力を右へ配置。compactは標準NavigationSplitViewのpreferredCompactColumnで一覧/詳細に遷移する。既存の選択・作成・複製・改名・移動・削除・フォルダー処理を再利用し、0件選択の操作footerとwideの重複controlを除いた。FAKE Catalystでwide配置、タイトルと選択時controlsを視覚確認済み。compact実機・最大文字サイズ・並替え・分岐キャンバス表示は未確認/未実装として続ける。

### 2026-10-17：左右ペインとツールバー

ユーザー指定の `/Users/suzuki/Documents/XcodeProjectTahoe/3column/3column/ThreePaneView.swift` を参照し、通常幅はNavigationSplitViewのcolumnVisibilityだけで左ペインを制御、compact幅は一覧sheet、右は標準inspectorとした。preferredCompactColumnとの二重制御を除去。左の閉じる操作は一覧左端、再表示は本文左端へ配置し、自動sidebarToggleとの重複を除く。常設「選択」は削除し、会話行メニューの「会話を選択」から複数選択、選択中だけ「完了」を表示する。新規会話の重複した本文上部ボタンも除き、一覧の新規操作は維持する。

右ペインは既存chatConfigDraftを読取り、モデル/provider/実行先、最大出力/temperature/top-p/stream/推論/verbosityを表示する。未知値の再構築・保存・鍵の表示はしない。編集は既存ChatConfigViewへ接続し、compactの提示競合を避けてinspector自身からsheetを出す。一覧sheetから親の設定/import/exportを要求する場合もonDismiss完了後に提示する。独立Astraの提示元に関するP2を修正し、限定再確認は新規なし。

最終Catalyst buildと差分確認成功（`/private/tmp/weavelet-sidebar-inspector-final.log`）。実Catalyst画面で常設選択の不在と「会話」見出し、左右開閉、右を保持した左の閉→再表示、数値プロパティ表示、inspector→生成設定sheet→取消を確認した。compact sheetの実操作・回転・VoiceOverは未確認。iPhone照会/導入は行わず、元の全機能互換性goalの一時停止も維持する。

### 2026-10-17：編集時の高さとフローティング操作

WebのUnifiedMessageView/ContentActionsの実配置を参照。表示本文と非表示の操作列を寸法の基準として残し、同じ領域へ編集欄を重ねる。本文の最小高はWeb同様84ptとし、編集欄は割り当てた高さを使用、長い入力は欄内でスクロールする。編集開始・再生成・メニューと編集中の操作列は、各バブルの範囲内でチャット表示領域下端に追従する。画面全体の固定フッターにはしない。

Catalyst build、既存MessageInputTests 6件、差分確認が成功。独立Astraが指摘した、編集中だけ分岐操作を除いて基準高を変えていた条件を修正し、限定再監査は新規なし。実Catalystで表・コード・数式・画像を含むバブルの編集開始→取消の外枠と次メッセージ位置が一致し、スクロール中の操作バーが表示領域内に追従することを確認。保存は行っていない。iPhoneキーボード表示中、compact幅、Dynamic Type、VoiceOverは未確認。


### 2026-10-20：U21の操作入口接続

末尾toolbarにあった先頭/入力欄・編集/折畳操作をpane内左右下へ移し、Web共有の前後バブル移動を追加した。既存業務handlerを再利用し、composerとの退避・編集時非表示・44pt判定を適用。Catalyst4境界ケース、隔離実画面の先頭/前後/全折畳・展開、独立Astraの指摘修正を確認した。位置履歴のcapture/復元とU22は未接続であり、U21全体・全UI受入の完了ではない。詳細は完成ledgerの同日節を参照。


### 2026-10-21：位置履歴の接続

U21で残したスクロール位置のcapture/復元を、Webのpure位置計算と既存共有履歴へ接続した。会話ごとの非永続cache、戻る/進むと表示文脈のatomic保存、native UIScrollViewの精密位置反映を使い、入力開始で復元を取消す。Catalyst実画面の途中位置/前後/会話切替、関連自動確認と独立Astra指摘修正を完成ledgerへ記録した。U22と全UI条件の未受入は維持する。


### 2026-10-21：行左端の折畳と生成追従

U22は44ptの独立入口を既存NodeOptionsへ接続した。生成追従の判断はWebから共有し、nativeの計測/操作へ接続する。生成中もメッセージ操作の配置を残して行全体を無効化し、開始/終了でfooter高さを変えない。Catalystの明示移動/通常scroll後の位置保持、最終buildと独立Astra監査は完成ledgerに記録した。長時間の出力・実keyboard・狭幅/文字拡大/VoiceOver等の最終受入は残る。
