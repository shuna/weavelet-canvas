# Web S0・S1: 現状整理と内部API契約

2026-10-11。上位計画は[Web機能設計](web-maintainability-refactor.md)。対象はWebと関連Proxy/functions、iOSは凍結。既存機能を維持し、新しいHTTP層、汎用command基盤、保存形式変更は導入しない。本書のS0は観測、S1は未実装の契約であり、同じ意味ではない。

## 基準と完成範囲

[検証報告](../../reports/web-s0/README.md)にソースdigest、環境、再現コマンド、全結果を固定した。865単体テスト成功・1失敗・1skip、ブラウザ5件成功、Web/functions型検査とbundle成功。Proxy専用依存の検証、クリーンinstall、実モデル・実同期・一部DOM性能は未完了。S0の現状記録とS1設計の完成は、実装開始用の全検証ゲート通過を意味しない。

以下のパスは特記なければ`src/`からの相対。行番号は調査時の目安、symbolを優先する。BranchEditorの並行変更を含むworking treeを観測しており、着地commitとの差分は実装前に再確認する。

## 正本と共通境界

| 状態 | 所有者・現在の正本 | S1の書込み境界 |
| --- | --- | --- |
| chats/folders/選択/検索・移動履歴 | A、chat/navigation/search/grep slices。選択は現在index | 公開入口はID、内部で直前にindex解決。検索結果にもchatId付与 |
| tree/contentStore/messages/node属性 | B、branch-domainとbranch/chat slices。messagesとruntime属性mapは互換値 | treeとchat内属性を正本にし、派生値は操作内で更新。旧flat decoderは残す |
| 生成・評価・復旧 | C、submit session/stream buffer/stream DB、評価map | 非永続requestIdと対象chatId+nodeIdで適用を検証。nodeId単独は複製間で一意でない |
| モデルbinary/metadata/Worker | D、OPFS/savedModelMeta/local-model slice/runtime | 資産・定義・実行状態を混ぜず、owner予約とwriter停止を通す |
| persisted snapshot/外部適用 | E、persistenceとIDB/cloud/import | snapshot生成、外部適用、保存成功の境界を分離 |

同期操作の成功はメモリ内store反映を意味し、永続化成功ではない。想定内の消失・保護・競合は各操作の返値、想定外の例外は呼出元へ伝播する。共通Resultクラスを増やさない。計算はclone上で終えて一度反映し、失敗を空内容や成功へ変換しない。

## S0 A: 会話ライブラリと探索

| 操作 | 現行symbol・定義 | 現caller | 状態書込み | 現行関連テスト |
| --- | --- | --- | --- | --- |
| 新規会話・全削除後初期化 | hooks/useAddChat.ts:addChat:13、hooks/useInitialiseNewChat.ts:initialiseNewChat:11 | Menu/NewChat、ChatFolder、新規入力経路／ChatHistory.deleteChat、ClearConversation | chats先頭挿入・currentChatIndex・nav履歴／chats全置換・contentStore初期化 | 直接操作テスト未確認; store/navigation-slice.test.ts |
| 会話名変更 | components/Menu/ChatHistory.tsx:editTitle:69、Chat/ChatContent/ChatTitle.tsx | Sidebarの編集確定、ChatTitle | cloneChatAtIndex→setChats; 自動命名はC側submitHelpers | 直接名称操作テスト未確認 |
| 複製 | components/Chat/ChatContent/CloneChat.tsx:cloneChat:24、Menu/ChatHistory.tsx:handleClone:165 | modal、sidebarボタン | 新chat UUID・名称・chats・contentStore retain・nav・currentChatIndex | utils/chatShallowClone.test.ts、utils/chatExport.test.ts（全操作を覆わない） |
| 単独/複数会話削除 | Menu/ChatHistory.tsx:deleteChat:78 | 同componentのhandleTick | content release、chats削除、選択解除; 残存時index=0、全削除時初期化 | 直接一括削除テスト未確認; branch-slice-history/navigationテストは削除後履歴を部分検証 |
| フォルダ作成・編集・削除 | Menu/NewFolder.tsx:addFolder、ChatFolder.tsx:editTitle:62/deleteFolder:71/updateColor:89/toggleExpanded:153 | 各folder UI | folders; 削除はchat.folder解除＋folders削除、会話は残る | Menu/chatHistoryFolderUtils.test.ts（expandExistingFolderのみ） |
| 所属変更・複数選択 | ChatFolder.tsx:handleDrop:118、ChatHistoryList.tsx:handleDrop:245、ChatHistory.handleCheckboxClick/handleDragStart | drag/drop、shift等の選択 | chats[].folder、folder.expanded、component内selectedChats、multiViewChatIndices | 直接drag/一括移動テスト未確認 |
| タイトル/フォルダ名検索 | Menu/ChatSearch、ChatHistoryList.tsx:updateFolders:68 | sidebar入力 | filterと派生一覧; title/nameのcase insensitive比較 | 直接一覧検索テスト未確認 |
| 本文・ノード・label/star検索 | utils/branchSearch.ts:searchBranchNodes:25、store/grep-slice.ts:executeGrep、search-slice.ts:nextResult/prevResult | GrepResults、BranchSearchBar、ChatFindBar | grep/search結果・query履歴・focus; legacy会話はgrepのsearchLegacyChat | utils/branchSearch.test.ts、store/search-slice.test.ts |
| 目的ノードへ移動 | hooks/useBranchNavigation.ts:switchTo、search-slice.ts:pushSearchNavEntry/navigateToResult、grep-slice.ts:navigateToGrepResult:166、BranchEditorCanvas.tsx:navigateToChat:625、ChatFindBar.navigateToNodeResult | sibling switch/swipe、検索next/prev/click、canvas、sidebar会話click | nav履歴・currentChatIndex・activePath/messages・view/focus/scroll | store/navigation-slice.test.ts、search-slice.test.ts、hooks/useMessageBranchSwipe.test.ts、tests/message-branch-swipe.spec.ts |
| 戻る/進む・view変更 | store/navigation-slice.ts:navBack/navForward/restoreNavigationEntry、hooks/useNavigationHistory.ts、branch-slice.ts:setChatActiveView | NavigationButtons、ブラウザpopstate、ChatViewTabs、Chat.tsx:view effect | past/current/future・navEntryMap・restoring・view・anchor・path | navigation-slice.test.ts、split-view.test.ts、scroll-anchor.test.ts |

## S0 B: 会話編集と表示

| 操作 | 現行symbol・定義 | 現caller | 状態書込み | 現行関連テスト |
| --- | --- | --- | --- | --- |
| 平面会話のtree化・読み取り | branch-domain.ts:ensureBranchTreeState:169/materializeActivePath（utils/branchUtils.ts:17）、branch-slice.ts:ensureBranchTree:559 | 編集・canvas・NewMessageButton等 | tree生成・content refs・messages派生; ensureは履歴記録なし | store/branch-domain.test.ts |
| 保存・追加・明示分岐 | useEditViewLogic.ts:handleSave:281/handleBranchOnly:310/handleBranchGenerate:326 → branch-slice.upsertWithAutoBranch/appendNodeToActivePath/createBranch → branch-domain | EditView、UnifiedMessageViewの既存編集logic | tree/contentStore/messages; saveは上書き、branchは兄弟作成＋path短縮; draft解除 | branch-domain.test.ts:457-513、branch-slice-history.test.ts |
| 挿入・削除・順序移動 | branch-slice.ts:insertMessageAtIndex/removeMessageAtIndex/moveMessage → branch-domain対応State | NewMessageButton、UnifiedMessageView、useSubmit retry | tree parent/activePath/root/messages/content refs; 保護削除拒否、生成対象は隠れnodeを残す | branch-domain.test.ts:101-294、branch-slice-streaming/history.test.ts |
| 保存＋後続prune | branch-slice.ts:replaceMessageAndPruneFollowing → branch-domain.ts:replaceMessageAndPruneFollowingState:603 | useEditViewLogic.handleGenerate/handleGenerateNextOnly | 1編集操作で置換＋指定数削除; 保護後続があればremoveCount=0で置換のみ | branch-domain.test.ts:253、branch-slice-history.test.ts |
| branch選択/削除/prune | branch-slice.ts:switchBranchAtNode/switchActivePath/switchActivePathSilent/deleteBranch/pruneHiddenNodes | useBranchNavigation、検索、NodeContextMenu、BranchEditorCanvas | path/messages、生成buffer確定、content refs; pruneはpin subtree/保護を保持 | branch-domain、branch-slice-streaming/history、branchSearchテスト |
| copy/cut/paste/会話間move | branch-slice.ts:copyBranchSequence/pasteBranchSequence/moveBranchSequence:511、branch-domain対応State | NodeContextMenu、BranchEditorCanvasのkeyboard/context/drop | clipboard、元/先tree・content refs・messages; moveはapplyBranchState一回 | branch-domain.test.ts:76、branch-slice-history.test.ts:152 |
| node名・star/pin・折り畳み・除外・保護 | branch-slice.renameBranchNode/toggleNodeStar/toggleNodePin、chat-slice.toggleCollapseNode/toggleOmitNode/toggleProtectNode/setAllCollapsed/setAllOmitted | NodeContextMenu、MessageDetailModal、Message、MetaActions、CollapseAllButtons | tree node属性／chat内mapとruntime index map双方 | branch-domain/history、persistence、submitHelpers、useLiveTotalTokenUsedテスト（網羅ではない） |
| role/system prompt | branch-slice.updateNodeRole→branch-domain.updateNodeRoleState:736、chat-slice.setChatSystemPrompt:177 | RoleSelector、ChatTitle | role・config.systemPrompt・system bubble・messages; prompt設定変更は対象編集履歴を失効 | branch-domain.test.ts:442、branch-slice-history.test.ts:124 |
| 画像添付・draft・表示 | useEditViewLogic.handleFileChange:232/handleImageUrlChange:253/handlePaste:415、MessageContent.getEditSessionKey/primeEditSession、ContentBody/MarkdownRenderer/OverTypeEditor | sticky EditViewと既存bubble UnifiedMessageView | draft内content/image detail、edit cache; 保存後のみ確定本文へ反映 | tests/display-refresh.spec.ts、utils/markdownStreamingPolicy.test.ts; IME/draft直接テスト未確認 |
| global undo/redo | branch-slice.ts:applyBranchState:346/undoBranch:370/redoBranch:392 | UndoRedoButtons、canvas shortcut、全branch編集 | global past/future最大50、対象chat集合snapshot・refs・messages復元 | branch-slice-history.test.ts:40-197（cross-chat 1 undo、delta refs、対象外chat維持） |


## S1 A: ライブラリと探索

以下は既存slice/hookの拡張予定signature。UIの確認・名称・選択方式は維持する。

| 入力 → 出力 | 移行対象と契約 |
| --- | --- |
| `createChat({folderId?}) → {status:'created',chatId} \| {status:'folder-missing'\|'not-ready'}` | useAddChat/generateDefaultChatを再利用。既存命名、先頭挿入・選択・nav push一回。未初期化/消失folderは無変更 |
| `renameChat({chatId,title}) → updated/unchanged/chat-missing` | Sidebar/ChatTitleを同入口へ。新しいtrim・空文字禁止は加えない。branch undo外 |
| `duplicateChat({chatId,scope:'all'\|'activePath'}) → created(chatId)/chat-missing` | CloneChat/ChatHistory共通化。新chatId、現行どおりnodeIdは保持、content retain。evaluationResultsは複製しない。nav一件、branch undo外 |
| `removeChats({chatIds}) → {removedChatIds,missingChatIds,selectedChatId}` | 重複IDを除去。対象C ticketを同期的に失効・停止要求してから一回反映。遅延結果は拒否。計算失敗時はデータ無変更（停止自体は戻さない）。最終会話削除はdefault会話生成。対象編集履歴invalidate、navは既存deleted-chat skip |
| `createFolder() → {folderId}` / `editFolder({folderId,patch:{name?,color?,expanded?}}) → updated/unchanged/folder-missing` | NewFolder/ChatFolder。現行New Folder N、order=0、他order+1、expanded=false。color nullは解除 |
| `removeFolder({folderId}) → removed(detachedChatIds)/folder-missing` | 所属解除とfolder削除を一回反映。会話内容・refs・編集履歴は残す |
| `moveChatsToFolder({chatIds,folderId:string\|null,expandDestination:boolean}) → {status,movedChatIds,missingChatIds}` | status=applied/folder-missing/invalid-input。消失folderは全体拒否。存在chatだけ移動、dropはexpand=true、その他falseで現値維持。null+true拒否。成功後だけUI選択解除 |
| `searchBranchNodes(query,entries,contentStore,scope,options) → SearchResult[]` | entries/resultにchatIdを追加、chatIndexは表示互換。all/activePath/starredOnly、label、孤立tree、順序を保持。title/folder検索を無理に統合しない |
| `navigateToNode({chatId,nodeId?,view?,source,history:'push'\|'silent',focus:'bubble'\|'editor'\|'none'}) → reached/chat-missing/node-missing` | useBranchNavigation/search/grep/canvasを既存navigation sliceへ集約。消失は履歴も無変更。pushは出発anchor取得＋一履歴、silentは追加なし。既存path内検索は後続pathを変えない。highlightはUI |
| `restoreNavigationEntry(entry) → {status:'restored'\|'chat-missing',path:'restored'\|'kept'}` | navBack/Forwardを維持。pushなし、消失chat skip、invalid/reparented pathは現在path保持。anchor優先、popstate距離・PWA・restoring時間を保持 |

## S1 B: 編集と表示

| 入力 → 出力 | 移行対象と契約 |
| --- | --- |
| `saveNode({chatId,nodeId,role,content}) → updated/unchanged/chat-missing/node-missing/protected/busy` | handleSave/upsertWithAutoBranchを上書きと明示。子孫保持、自動branchなし。既存bubble保存入口のprotected/busy拒否だけ維持し、内部upsertや他操作へ一律拡張しない |
| `appendNode({chatId,role,content})` / `insertNode({chatId,beforeNodeId:string\|null,role,content}) → updated(nodeId)/chat-missing/node-missing` | 既存domain再利用。nullは末尾、無効IDはappendへfallbackしない。flat ensureは追加undoなし。成功後draft clear |
| `createBranch({chatId,fromNodeId,content?}) → created(nodeId)/chat-missing/node-missing` | 明示分岐、元と子孫保持、role継承、兄弟へpath短縮。省略content retain。busy/model確認は既存UIに残す。生成はCへの別操作 |
| `removeNode({chatId,nodeId})` / `moveNode({chatId,nodeId,direction}) → updated/unchanged/missing/protected/invalid-target` | activePath前提操作は非active対象拒否。境界move unchanged。削除保護・生成node保持・reparentを維持。moveに新しい保護制限は加えない |
| `replaceNodeAndPrune({chatId,nodeId,role,content,removeCount}) → {status,removedNodeIds,pruneBlockedBy}` | status=updated/missing/invalid-input。非負整数。保護後続ありなら全prune停止、置換だけ成功を明示。既存callerの編集可否を保ち、domainに新拒否を足さない |
| `copyBranchSequence({chatId,fromNodeId,toNodeId}) → copied/missing/not-ancestor` | 連続ancestor rangeのみ。clipboard更新、undoなし。contentはGC参照対象で保全 |
| `cutBranchSequence({chatId,fromNodeId,toNodeId}) → cut/missing/not-ancestor/content-missing` | 新規複合入口。検証・copy・正確なrange切除を一回適用。失敗時clipboard含め不変 |
| `pasteBranchSequence({chatId,afterNodeId}) → pasted(nodeIds)/missing/clipboard-empty/content-missing` | 全content検証、retain、新nodeId、一回反映。欠損hashを空本文にしない |
| `moveBranchSequence({sourceChatId,fromNodeId,toNodeId,targetChatId,afterNodeId}) → moved(nodeIds)/missing/not-ancestor/invalid-target/content-missing` | 元/先全検証、挿入先が切除集合なら拒否。copy＋正確なrange切除の計算後に一回反映。会話間もglobal undo一件 |
| `deleteBranch({chatId,nodeId})` / `pruneHiddenNodes({chatId}) → {status:'updated'\|'unchanged'\|'missing',removedNodeIds}` | deleteは明示subtree削除、pruneはpin subtree/protectedと生成確定を維持。同じ削除規則へ統合しない。複数chat pruneは現行の操作順/undo単位 |
| `setNodeStar/Pin/Label({chatId,nodeId,value})` / `setNodeCollapsed/Omitted/Protected({chatId,nodeId,value}) → updated/unchanged/missing` | deterministic値指定。前者はtree＋branch undo、後者はchat map＋派生runtime map、branch undo外 |
| `updateNodeRole({chatId,nodeId,role}) → updated/unchanged/missing` / `setChatSystemPrompt({chatId,prompt}) → updated/unchanged/chat-missing` | 既存role/config入口をID化。同期規則は次項。保存入口のprotected/busy制約をrole設定へ増やさない |
| `undoBranch()/redoBranch() → {status:'restored'\|'empty'\|'busy'\|'target-missing',chatIds}` | global最大50、会話間操作は両側一緒。対象の一つが生成中/消失なら無変更・履歴未消費。タイトル/folder/現在の選択path/対象外chat保持。生成・外部適用は対象履歴invalidate |

実変更は一件undo＋redo clear、unchangedは記録なし。clipboardとcollapsed/omitted/protectedはsnapshotに含めない。添付は画像file/URL/pasteとdetail、content配列のreasoning/tool partの保持を続ける。IME、sticky focus、仮想化によるdraft保持、Markdown/streaming表示方針を共通化の理由で変えない。

### 現行不整合と明示する修正方針

1. `NodeContextMenu.handleCutSelected`/Canvas Mod+Xはcopy失敗でもdeleteBranchを呼び得る。有限range cutと枝のあるmoveでは選択外の子孫まで消す。S1では**選択した連続pathだけを切除**し、非選択子は最も近い残存ancestorへ元の順で接続する。ancestorがなければparentId=nullのnodeとして保持する。rootIdはactivePath先頭一個を指す既存表現のまま、残存pathがあれば維持し、失われた場合は残存nodeの既存順でpathを選ぶ。rootIds配列など新schemaは導入しない。コピー/移動先には選択pathだけを入れる。明示deleteBranchはsubtree削除を維持。これは機能廃止ではなく選択外データ損失への修正契約であり、専用fixtureを先に置く。
2. `updateNodeRoleState`は先頭systemから他roleでconfig promptを解除、他roleからsystemでtext連結をconfigへ同期。先頭system本文保存も同期するが、現在のundo snapshotにconfigがなく不一致が残る。S1では本文/role編集snapshotに**影響したsystemPromptだけ**追加しtreeと同時復元する。role-only saveも同じ規則へ寄せる。他configは戻さない。
3. 設定欄のprompt変更は既存どおり対象branch履歴invalidate。treeありでは先頭system追加/更新/空ならactivePathから除外、非active枝へ勝手に波及しない。treeなしはconfigのみ。旧hash解放はlive tree・clipboard・undo参照を確認するB/E共通GCに従い、単純に削除しない。

## S0 C: AI処理と設定の選択

| 処理 | 現入口・入力優先順位 | 出力・副作用 |
| --- | --- | --- |
| 会話生成/再生成 | useSubmit→submitHelpers→executeSubmitStream/executeLocalSubmit。会話config、resolveChatModel、resolveProviderForModel | placeholder、session、stream buffer、本文確定、usage、評価・命名。前後評価は非同期であり送信のblocking gateではない |
| 新規会話・モデル変更 | generateDefaultChatはdefaultChatConfig＋defaultSystemMessage。switchConfigModelは現在設定をmodelSettingsへ保存 | 同targetなら現在値。変更先保存済設定→初期値/model default。既存chatへ新defaultを遡及しない。modelSettings keyはsource/provider/modelの組 |
| provider選択 | 明示provider→favorite一致→legacy認証fallback。resolveChatModelはfavorite→一意候補、曖昧はunmatched | favorite追加確認、OpenRouter hard routing/cache/sticky等を維持 |
| prompt構築 | getSubmitContextMessages / buildLocalChatMessages | placeholder前の履歴、omitted除外（tool call/resultは保持）、system群をconfig promptへ正規化、reasoning除外、画像/tools保持、モデルのsystem対応・交互化・token budgetを維持。PromptLibraryはdraft挿入のみ |
| ローカル生成 | executeLocalSubmit→runtime.generate、全prepared messages＋assistantPrefix | chunkは累積snapshot。60秒stall検知、停止時partial確定。旧prompt helper期待のテスト1件失敗は基準報告参照 |
| 自動安全性評価 | useEvaluation.runEvaluationForPhase、local/hybrid/remote | local失敗時remote fallback、hybridはwarning/block・remoteOnSafe・local結果なしでremote。remoteはOpenAI moderation/Proxyでchat providerではない。hard routing違反は拒否 |
| 手動安全性評価 | useEvaluation→remote moderation | 自動設定のlocal engineへ勝手に変えずremoteのまま |
| 品質評価・補助処理 | 自動/手動qualityはlocalEnabled＋analysis assignmentならlocal、他は現在remote config。下位local qualityの候補はanalysis→quality→generation | 入力/応答各400文字、axisごと400 tokens/temp .2、parse/heuristic・進捗保持。moderationはanalysis→moderation、analyze/formatはanalysis→generation、generateはgeneration。統一優先順位へ変更しない |
| 自動タイトル | generateTitleForChat | titleModel指定時titleProvider、他はchat設定、remote呼出。OR cacheoffとhard routing保持。local title fallbackは追加しない |
| 復旧/transport | useStreamRecovery、streamDb、swBridge、public/sw-stream.js、proxyClient | SW/background継続、SSE終端・usage/error・部分結果と回復。チャットindexだけの復旧先は不十分 |

## S1 C: 実行・終了・結果適用

既存`useSubmit`/`submitHelpers`/`submitRuntime`/`useEvaluation`を拡張する。全taskを同じ巨大runnerへ押し込まない。

| 入力 → 出力 | 契約と所有者 |
| --- | --- |
| `prepareSubmission({chatId,nodeId,kind}) → PreparedSubmission` | 既存prepare手順。最初のawait前にconfig/messages/prefix/providerと一時認証参照を確定し、同じ同期snapshotからbeginTaskを呼びticketを登録する。PreparedSubmissionはこのticketを含む。missing/invalid model/settingsは実行前拒否。Preparedの本文・設定を後でlive値へすり替えない |
| `beginTask({target,kind}) → TaskTicket` | prepareSubmissionの同期区間内でsubmitRuntimeに非永続requestId、datasetEpoch、対象chatId/nodeId、入力fingerprintを保持。準備のawait後と実行直前に同ticketを照合し、途中編集ならstaleで終了する。await後のlive値からticketを新規採番して準備前の入力を正当化しない。targetはchat-node/evaluation/chat-title/settings-testを区別。評価はphase/axisも保持。汎用永続schemaは作らない |
| `executeLocalSubmit(prepared,ticket,signal)` / `executeSubmitStream(prepared,ticket,signal) → completed/aborted/failed` | 実行方式固有の既存引数を保持してticketを追加。stream snapshot/delta変換、prefix、error、usageは一回。前後評価は独立child ticketとownerを持ち、親正常終了で取消しない |
| `commitGeneratedContent(ticket,{content,terminal,usage?}) → applied/stale/missing` | Bのtree/messages/refs更新を通す。pair＋requestId＋epochを照合、開始後のユーザー編集はticket失効。自分のstream更新は失効原因にしない。完了済への二度目の結果/usage拒否 |
| `cancelTask(requestId,{keepPartial:boolean}) → cancelled/already-terminal` | 同期的に後続適用を無効化してtransportへabort。partialは取消前にCが保持した最後のsnapshotから一回確定。明示Stopは対象生成と指定child groupを止める。D予約は各ownerのfinallyで解放 |
| `invalidateTasks({chatIds?,nodeIds?,replaceDataset:boolean}) → void` | 同期操作。削除/編集は対象だけ、外部dataset置換はepoch増加で全旧結果拒否。停止完了のawaitとは分離し、削除済nodeを復活させない |
| `recoverStream(record) → applied/already-applied/retained-for-recovery` | 新記録はchatId/nodeId/requestId/checkpointHashを持つ。本文checkpoint保存後にstream記録更新。別DBの原子性は仮定しない。現対象とcheckpoint一致時だけ自動適用。旧index-only記録は確証がない限り回復用に保持、近いindexへ適用しない |

取消確定は通常のWorker結果とは別の一回だけの終端操作とする。まずticketをcancellingにして外部callbackを拒否し、対象が未変更ならcaptured partialをBへ適用してterminalにする。対象削除/置換による失効ではpartialを再適用しない。外部applyがpartialを保存する場合だけ、失効処理自身が置換前にこの終端操作を行う。

titleは開始時titleが手動変更されていればstale。評価ticketは格納先chatId/assistantNodeId/phaseと、評価入力のnode ID＋content hashを別に保持する。pre-sendはuser入力のfingerprintを照合し、同じ親生成が格納先assistantへstreamを書き込むことでは失効しない。post-sendはuser/assistant両入力のfingerprintを照合する。入力編集・親生成の差し替え・格納先削除ではstale、同nodeIdの複製先へ適用しない。pending解除も自分のrequestIdだけ。失敗/取消を合格評価へ変換しない。stream bufferとSW bridgeのnodeId単独keyもpairへ移す。SWのSSE実装とTypeScriptの物理共有は必須にせず、同じfixtureで意味を固定する。

## S0 D: ローカルモデル運用

| 操作 | 入口・正本 | 現在の境界 |
| --- | --- | --- |
| 探索/download/resume/import | LocalModelSettings、useHfSearch/useModelDownload、downloadModelFiles、storage | OPFS final/partとSavedModelMeta。hash重複排除・shard検証・partialを維持 |
| 復元/verify | rehydrateSavedModels、verifyStoredModel、OpfsFileProvider | Settings訪問依存あり。none/partial/invalid/saved、GGUF magic、全shard判定 |
| lowbit-Q | lowbitQManager/conversion worker、lowbit-q | 独自allocator、OPFS target、source/temporary掃除、進捗 |
| load/実行/退避 | LocalModelRuntime、prepareModelsForExecution、evictIrrelevantModels | modelId→Worker、busy/loadingを退避しないがprepare後readyの所有が弱い |
| engine/capability | wllamaWorker/Transformers | wllama structured messages/OPFS-direct/Memory64、WebGPU→CPU、Firefox対応。Transformers classify/customCache。能力を同一視しない |
| 削除 | useModelDeletion、OpfsFileBrowser、重複import、変換掃除 | UI別の停止・削除・metadata操作。全入口の統一停止保証は未整備 |

既存テストはvariant/backend summary、lowbit-Q、storage、submitRuntime等。download/device/orchestrator/verifyStoredModel/local評価・classify専用テストは未整備。旧prepareChatPromptテストは実Workerへの入力保証ではない。

## S1 D: 所有・停止・削除

| 入力 → 出力 | 契約 |
| --- | --- |
| `prepareModelsForExecution(ownerId,requiredIds) → Promise<Reservation>` | runtimeのmodelId→ownerId集合に準備前から予約。重複ownerは冪等。途中失敗は当該ownerの取得分を解放。前処理～評価axis間～結果確定のready期間も保持 |
| `ensureLoaded(modelId,ownerId) → Promise<LoadedModel>` / `release(ownerId)` | 同model進行中load Promise共有、Worker一個。releaseは自分だけ。自動evictは予約/loading/busyを避ける。全callersにownerを渡す |
| `generate/classify(input,{ownerId,requestId,epoch,signal})` | model epochはWorker置換/unloadで更新、requestIdは実行ごと。共有load待ちの一owner取消では他ownerのloadを止めない。abortはcallerへ一度AbortError、late chunk/doneは結果に戻さない |
| `unloadModel(modelId,{force:boolean}) → unloaded/reserved/blocked` | 自動はforce=false。明示操作だけ対象ownerをcancelしWorker終了確認後unload。停止未確認はblocked。CPU fallback一回、同owner維持 |
| `beginWrite(modelId,ownerId) → WriterToken` / `finishWrite(token,outcome)` | storageに追加予定。download/import/lowbit target全入口使用。削除意図開始後の新writer拒否、既存writerを停止してから削除 |
| `removeAssets(modelId,scope) → {status,removedFiles,retainedFiles,verification,error?}` | status=removed/partial/blocked/failed。削除意図設定→owners/writers停止→Worker終了→OPFS→manifest再検証→metadata更新。file/dir/bulk全入口同契約、失敗modelを成功として解除しない |

単一runtime内のowner/tokenは別タブを排他しない。別タブOPFS lock/access failureはfailed/partialとして残し、成功と宣言しない。タブ間完全排他を実装済と扱わず、必要なら既存OPFS lockとブラウザ検証後に別途設計する。lowbit-Qが既に持つsource保持/容量順序を汎用削除で前倒ししない。正常保存済のmetadataへpartial/invalidを昇格しない。

## S0 E: 保存・同期・交換

| データ/形式 | 現行入口・正本 | 保存・互換境界 |
| --- | --- | --- |
| full snapshot | persistence.createPartializedState | chats/contentStore/clipboard/folders、provider/API key/proxy token/評価/local model/表示設定。tree chatのmessagesは保存しない |
| local設定 | createLocalStoragePartializedState、CompressedStorage | migration完了後chat3項目を除外。lz-string UTF16、旧plain JSON読取り、500ms debounce/unload flush |
| 会話 | IndexedDbStorage.saveChatData/loadChatData | meta/content/chat/clipboard、generation、content→chat/clipboard→meta→GC。inactive gzipはraw-first copy-on-write |
| 同期認証 | cloud-auth-store、cloud-auth-types | 別key cloud/version3、provider mapとlegacy alias。main snapshotとは別 |
| 通常export | ExportChat、chatExport | V3=tree/hash/folders/評価。V1=active path inline、branchTree/collapsedNodes除去。OpenAI=mapping tree/text/system、OR/LM Studio=active path text/system。形式ごとの欠落を維持 |
| import | importService、utils/import | V1/V2/legacyはflat→tree/hash変換、V3はID衝突と評価key remap。容量不足時は既存ユーザー同意経路 |
| recovery export | recoveryExport | raw Zustandを含み、API key等を含み得る。通常exportの秘匿範囲と異なる。自動共有しない |
| Google暗号化同期 | GoogleCloudStorage、google/sync・crypto、api/google-auth | passphrase非保存、AES-GCM、record three-way merge、競合両コピー保持。session/connection世代照合、401一回refresh、pending再試行 |
| CloudKit | providers/cloudkit、CloudKitSync、createCloudPersistStorage | lz codeunit→Uint16/base64、record tag/updatedAt、server-wins再適用、token rotation、空/急減/欠損upload guard |

main STORE_VERSION=18。旧mainは自動schema変換せずmigration-required/export-import導線。cloud auth version3の旧形式変換と混同しない。通常exportはglobal認証/provider/local metadataを含めないが、chat configは含む。full cloud snapshotはmain設定を含むため通常exportとは同じ境界ではない。

| import指定 | 現在維持する設定の優先順位 |
| --- | --- |
| append、includeSettings任意 | resetなし。V3評価結果merge、評価設定は適用しない |
| replace、includeSettings=true | main persisted初期値へreset後にchat/folderとV3評価設定/結果。API key/proxy/providerも初期値になり得る |
| replace、includeSettings=false | chat/folder/content/clipboardだけ空にし他設定保持。V3評価結果は既存へmerge |
| 全import | fileからglobal認証を供給しない。別cloud auth storeはresetしない |

現在importはread前snapshot→await→live変更→失敗時古いsnapshot復元のため、その間の編集を上書きし得る。Google applyにはsnapshot equalityとsession/store identity検証が既にある。CloudKitの複数適用経路も同水準へ揃える。

## S1 E: snapshot・外部適用・commit

| 入力 → 出力 | 契約 |
| --- | --- |
| `createPartializedState(state)` / `createPersistedChatDataState(state) → snapshot` | 既存選択を再利用。tree/content/clipboardと確定streamを出す。clone/finalize例外は伝播、永続先に書かない。local partial/full/chat-dataの秘密情報と用途を交換しない |
| `prepareHydratedState(base,payload) → {patch,repairInfo}` | base非変更、欠けた項目はbase保持。version検査を先行。現finishHydratedStateのlocalStorage書込み/toast副作用はcommit側へ移し、pureと偽らない |
| `applyExternalSnapshot({source,payload,observedBase,sessionIdentity}) → applied/concurrent-change/migration-required/storage-error` | 下記順序で既存GoogleのsameSnapshot/identityを再利用。独自の永続revisionや新repositoryは作らない |
| `saveChatData(data) → Promise<void>` / `loadChatData() → Promise<ChatDataLoadResult\|null>` | integrity→content/chat/clipboard→meta commit。中断時はcommitted generation、degraded時write blockとrecovery。圧縮/GC失敗でcommitted recordを捨てない |
| `importChatFromFile(file,t,options) → ImportResult` | detached parse/validate/convert後、最新baseへappend/replace planを計算。計画中live mutationなし。競合はconcurrent-change、古いsnapshot rollback禁止。既存options表を保持 |
| `unlockGoogleSync/resumeGoogleSync/flushPendingCloudSync` / CloudKit provider | 現行signature・codec維持。IDB保存→送信→成功後baseline。disconnect/lock/provider変更で古いqueue/timer/inflight適用失効。server-wins effective stateをguard baselineにも使用 |

外部適用の具体的な順序:

1. payload読取り・version/構造検査はliveを変えず行う。同期pullは開始時base/identityを保持し、現在と相違なら既存merge/requeueへ戻す。importはparse後に最新baseを捕捉する。
2. 適用対象のC ticketを同期失効し、最後のpartialを必要なら一度確定する。Dの実停止待ちは旧結果適用許可と切り離す。ここで自分のfinalizeが状態を変えるため、以後の計画baseは**finalize後に再取得**する。同期pullで旧merge結果がその更新を含まない場合は再merge/requeue、強制上書きしない。
3. `createPartializedState`のcloneをobservedBase、`useStore.getState()`参照と同期sessionをidentityとして捕捉。clone上でpatch/refs/repairを構築する。awaitがあればその後に既存`sameSnapshot`相当とidentityを再確認。失敗なら再試行可能な競合を返し、liveを戻さない。
4. 最終照合と`setState`間にawaitを置かない。A/B履歴失効と状態適用を同じ同期操作で行う。通知/local設定書込みは適用後。
5. IDB保存が成功して初めてremote baseline acceptance/成功表示へ進む。commit後保存失敗はstorage-error、メモリ状態は回復対象として残す。古いsnapshotへrollbackしない。IDB保証をlocalStorage/別stream DBまでの原子性と主張しない。

旧versionは読取り・復旧データを保持しmigration-requiredとして扱う。schemaを自動で18へ偽装して再uploadしない。既存V1/V2/V3 converterはimport互換境界に残す。

## 受入ケースと移行順

| 段階 | 実装前に固定するケース | 既存テストの置場・不足 |
| --- | --- | --- |
| A | 最後の会話削除、複製nodeId衝突と評価非複製、folder detach、複数移動、並替え後検索到達、push/silent/back/PWA | navigation/search/branchSearchはあり。create/delete/duplicate/folder複合操作fixtureは追加が必要 |
| B | 中間上書き、保護後続の部分prune、cut無効range無変更、非選択枝保持、cross-chat一undo、prompt本文/role undo、属性の履歴差、clipboard GC | branch-domain/branch-slice-history/streaming/contentStore。IME/draft/dragは実ブラウザ不足 |
| C | 全prepared履歴・system/prefixのWorker入力、取消後late done、delete/reorder/同nodeId cloneへの誤適用拒否、タイトル手編集、準備待機中編集、格納先streamで前評価が失効せず親生成完了後にも保存されること、後評価の両入力編集検知、非blocking前後評価、旧復旧記録、usage一回 | submitHelpers/submitRuntime/api/modelSettings/tokenBudget/openrouterControls/streamDb/startupRecovery。評価競合の直接テスト追加 |
| D | 共有load1本、片owner取消、予約中evict拒否、ready軸間保持、CPU fallback一回、writer停止失敗、file/bulk部分削除、shard/part/読取失敗 | fake Worker/OPFS fixtureを新規追加。lowbit/variant/storage既存。実load/TTFT/peak memoryは同checksum端末で別測定 |
| E | V1/V2/V3優先表、外部format欠落、API key境界、import中編集、C finalize後再merge、IDB途中中断/保存失敗、旧version、認証世代変更 | persistence/IndexedDbStorage/importService/chatExport/google sync/cloudkit/authテストを拡張。実認証/実同期は別確認 |

実装は上位計画のB→A、D→C、Eという依存関係に従い小分けにする。ID adapterを残してcallerを順に移し、最後に未到達入口を削除する。テスト追加やfile移動を製品LOC削減として数えない。S0の既存失敗・依存固定は基準整備で解消し、該当領域の未測定ケースはその領域の変更前に測る。全領域の実装・全性能測定を今回完了したとは扱わない。

## 独立監査

独立Sol 6.1 Mediumが本成果物を新規監査。初回はCの2点（準備入力とticket捕捉時点の不一致、評価格納先と評価入力fingerprintの混同）を指摘した。同一同期snapshotからの登録・await後照合、phase別入力fingerprintと格納先の分離を契約と受入ケースへ採用。修正箇所の再監査で2点とも解消、新たな重大矛盾なし、静的S0/S1成果物として受入可能との判定。前段計画の合格は流用していない。

監査は静的な契約・根拠の確認であり、製品実装、既存失敗解消、実モデル/実同期の検証完了を保証しない。これらは基準報告の実装開始ゲートとして残す。

## 承認後の実装対応

実装・監査・実測は[Webリファクタリング実装記録](../../reports/web-refactor/README.md)を参照。`navigateToNode`は複数canvasから開く場合の既存挙動を維持するため`selectChat?: boolean`を持ち、falseでは表示中の会話選択を変えず指定IDへ移動する。indexは境界でIDへ解決し、生成中bufferと復旧対象にもchatId/nodeIdを用いる。

外部snapshotは準備完了までlive状態へ書き込まず、直前に入力状態と接続を照合する。取消がpartialを確定して入力状態を変えた場合、旧payloadをそのまま適用しない。現行形式以外のremote snapshotは元version付きで保全し、現行形式への通常保存・同期成功には数えない。インポートは明示的な形式変換として別経路に置く。primary保存失敗は適用済みメモリを巻き戻さず、保存失敗として返す。
