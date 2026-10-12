# 段階1：機能対応と最初の試行対象

2026-10-12。基準 HEAD `02d5e8e78c03d77004a1a24d90d5874cdc030742` と作業ツリーを静的確認。画面等の既存未コミット変更は保全し、完成済み実装とは数えない。[全体計画](web-native-commonality-roadmap.md)に従う。iOSは全層再構築を許容する。段階1調査時は凍結中だったが、その後ユーザーが最小チャット表示・兄弟一覧のCatalyst実装を承認。旧実装は互換性の参考であり機能上限ではない。

## 機能対応表

以下のテストは存在・内容の確認であり、今回の実行結果ではない。S1は [予定契約](web-s0-s1-contracts.md)を指し、現行保証と区別する。

| 領域 | Webの現行責務・所有者・入口・関連テスト | 新iOSの必要能力／環境境界／予定との差 |
| --- | --- | --- |
| A ライブラリ | `useAddChat.ts`、`ChatHistory.tsx`→`chat-slice.ts`のchats/currentChatIndex。複製は`chatShallowClone.test.ts` | 新規・改名・複製・複数削除。選択UIはnative。S1のIDベース統一入口は未実装 |
| A フォルダ・探索 | `ChatFolder.tsx`、`ChatHistoryList.tsx`がfolders/chatsを更新。`branchSearch.ts`→grep/search/navigation slice。`branchSearch.test.ts`、`search-slice.test.ts`、`navigation-slice.test.ts` | 所属解除、検索範囲・順序・結果到達・戻る/進む。scroll/focusは環境別。現検索結果はchatIndex中心、S1 chatIdと統一到達入口は予定 |
| B 木編集・履歴 | `branch-slice.ts`→`branch-domain.ts`がtree/contentStore/messagesとundoを反映。`useEditViewLogic.ts`が保存と明示分岐を分ける。`branch-domain.test.ts`、`branch-slice-history.test.ts` | 編集・挿入・削除・順序・分岐・後続prune・undo。現保存は中間nodeも上書き。ID入口と返値保証はS1予定 |
| B 移動・属性・本文 | `NodeContextMenu.tsx`→branch sliceのcopy/move/paste。cutはcopy後deleteBranch。system promptはchat slice、draft/添付入口はuseEditViewLogic。履歴テストに会話間undoと参照保持 | 有限path移動、属性、role/prompt、draft、添付。OS clipboard/IME/画像取得は環境別。有限range cutとprompt編集undoはS1予定 |
| C 生成入力 | `useSubmit.ts`→`submitHelpers.ts`の設定・context解決。store設定とsubmit session。`submitHelpers.test.ts`、`modelSettings.test.ts` | モデル別system/tool/image/reasoning、token budget、prefill。認証/tokenizerは接続。現処理はawait後にlive stateも読み、S1同一snapshot/ticket確定とは異なる |
| C 生成・評価・復旧 | `submitRuntime.ts`のsession/buffer→store適用。`useEvaluation.ts`→evaluation slice、命名はsubmitHelpers。`useStreamRecovery.ts`→streamDb/SW。`submitRuntime.test.ts`、`streamDb.test.ts`、`startupRecovery.test.ts` | Stop、部分本文、終端一回適用、評価/命名、復旧。S1世代照合・古い結果拒否は予定。現復旧記録chatIndex/messageIndex。通信/SW/背景実行はnative設計が必要 |
| D 資産取得 | `useModelDownload.ts`→`local-llm/download.ts`、`storage.ts`のOPFS final/partとmetadata。sliceは表示、Settings訪問時rehydrate | 探索・再開・import・検証・partial復元。保存/背景取得/容量はnative。writer tokenはS1予定。storage専用テストは未特定 |
| D 利用・削除 | `orchestrator.ts`→`runtime.ts`のWorker map、用途割当はslice。`useModelDeletion.ts`、`OpfsFileBrowser.tsx`、lowbitQManager。variant/backend、lowbit validation等のテスト | 共有load・cancel/unload・利用者とwriter停止後削除・失敗保持。S1 owner予約/統一削除は予定。engine/GPU/形式/変換性能はiOSで未確認 |
| E 保存・交換・同期 | persistence/IndexedDbStorage、contentStore、ExportChat、cloud providersが正本と変換を分担。下表に形式別根拠と検証対象 | 読取・移行・保存成功・競合の仕様を揃え、DB/暗号/鍵保管は環境別。旧iOSとの互換を成立済みとしない |

パスはWebの`src/`配下。UIは[詳細対応表](web-native-ui-adaptation.md)を併用する。iOSは時刻表示なしの整列ストリームと一般的な左右吹き出しを選べる仕様とし、同一会話処理を使う。描画やコントロールを共通コードへ押し込まない。

## 保存・同期の互換性上の懸念

| 対象 | 確認した差／根拠 | 書込み前に必要な確認 |
| --- | --- | --- |
| ローカル状態 | Web `store/version.ts`は18、`store/persistence.ts`と`storage/IndexedDbStorage.ts`。旧iOS `PersistenceService.swift`はversion 1のstate.json | バージョン番号を直接対応させず、chat/tree/content/設定の項目別読取・移行fixtureを作る |
| 差分本文・GC | Web `utils/contentStore.ts`はdeltaと保存後GC、旧iOS `ContentStore.swift`はcontent/refCountで即時解放。全経路でのデータ損失は未立証 | delta展開、基底保持、保存失敗時の元データ保持を検証 |
| 内容ハッシュ | WebはJSON.stringifyとUTF-16単位・JS数値乗算、旧SwiftはJSONEncoderとUTF-8・UInt32乗算。Swift computeHashのsortedKeys設定用encoderは実際のhelperに渡らない | 同名アルゴリズムを同一と扱わずUnicode/直列化のfixture。既存参照を自動再hashしない |
| V3 export | Web `ExportChat.tsx`は展開contentStoreとevaluationSettings/resultsを含む。旧`ExportImportService.swift`のV3は評価metadataを持たない | round tripで設定・評価・本文・参照の保持範囲を確定 |
| CloudKit | Web `cloud/providers/cloudkit.ts`はweavelet-default-snapshotとbase64/LZ系。旧Swiftはweavelet-ios-snapshotとWVLT v1/zstd。LegacySnapshotDecoderの展開は未実装 | 別record/形式であることを前提に検出・変換・戻せる範囲を設計。相互同期済みとしない |
| Google | Web GoogleCloudStorage/cryptoはweavelet-encrypted-sync v1、PBKDF2 SHA256 600000、AES-GCM256。旧SwiftはappDataFolderのWVLTファイル | 暗号envelope・ファイル探索・鍵・競合・誤鍵・部分失敗を別途確認。native暗号APIを優先 |
| recovery export | Web `store/recoveryExport.ts`は複数保存元を含む専用形式。旧通常importの専用readerは未確認 | 通常exportと区別し、復旧元を潰さず抽出できる経路を設計 |

関連Webテスト：`store/persistence.test.ts`、`store/storage/IndexedDbStorage.extended.test.ts`、`utils/chatExport.test.ts`、`store/storage/google/sync.test.ts`、`store/storage/GoogleCloudStorage.test.ts`、`store/recoveryExport.test.ts`。旧Swiftサービスは`ios2/Weavelet Canvas/Weavelet Canvas/Domain/Services/`配下。ここでは既存データの変換・通信・書込みを行わない。

これらの差はEの契約・fixtureを次の優先調査とする根拠であり、旧版が互換であるとの仮定を禁止する。今回の小さな読取り試行は永続状態に影響しないため並行して進める。既存ユーザーデータへの未検証上書き・本番同期書込みは行わない。隔離した合成データでI/O・保存・同期を実装する段階へ進んでおり、最新状態は完成条件と証拠の台帳を参照する。

## 最初の対象：兄弟一覧の読み取り

`src/utils/branchUtils.ts:getSiblingsOf`だけを対象とする。本文、I/O、乱数、保存、生成を必要としない。所有者はstoreのchat.branchTree、直接callerは`src/hooks/useBranchNavigation.ts`だけ。間接callerは`BranchSwitcher.tsx`（ContentActionsから）と`useMessageBranchSwipe.ts`（Messageから）。現在位置・全数・前後操作は自分を含む結果に依存する。

- 現行Web：対象欠損は空配列。親が通常IDなら同じparentId、nullならroot一覧。自身も含む。createdAtではsortせずObject.valuesの列挙順。新配列だがnodeは元参照で、結果経由の書込みは契約対象外。
- 旧Swift `Domain/Models/BranchTypes.swift:siblingsOf`：自分を除きcreatedAt降順。新iOSの正解として再利用しない。呼出元は今回の検索で未確認。
- 境界：switchToのnavigation登録、switchBranchAtNodeのstream確定とpath変更、buildPathToLeaf、編集/undo/保存は対象外。
- 関連検証：`useMessageBranchSwipe.test.ts`はgestureのみ。`tests/message-branch-swipe.spec.ts`はa→b→a・端で停止・後続path・ボタンを間接検証。getSiblingsOf直接テストは追加が必要。
- 段階2で確定：正常ID/nullと、空文字等の不正親を区別。正常入力の順序は明示したnode key順からWebの列挙順を再現し、Swift辞書順に依存しない。整数様keyもfixtureに含む。不正入力でWeb既存挙動を観測しても新仕様に強制しない。
- 受入：欠損・単独・兄弟・複数root・自分包含・時刻と異なる順序・整数様key・入力不変を同じJSON fixtureで実行できる。iOS未実行を明示する。

Sol Medium 2体でA/BとC/Dの責務を、Luna MediumでEの形式・入口・テスト根拠を分担。Terraは利用可能モデルにないためSolで代替。独立Astra監査はこの成果物と試行選定を対象とし、合格前に段階2へ進まない。

## 段階1監査結果

2026-10-12、独立Astra Lowが文書と対象ソースを静的監査。新規指摘なし、段階1受入・段階2着手可。実行検証とデータ互換性の証明は含まない。
