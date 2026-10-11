# Web版の機能設計と段階的リファクタリング計画

Web版を、会話を蓄積・整理・編集し、外部APIとローカルLLMを使って作業するアプリとして整理する。設計の順序は **大機能の責務 → 状態とAPIの契約 → 機能をまたぐ処理と移行戦略 → コードの統合・削除** とする。個別ファイルの削除や分割を先に実施して、そこから全体設計を組み立てる進め方は採らない。

対象はWebとそれを支える保存・同期・Service Worker・認証・Proxyの接点。iOSは凍結中で対象外。Electron固有処理も対象外。現在の機能は維持し、利用経路や失敗時の挙動を明示したうえで重複を減らす。フォーク元は増加量の比較基準であり、設計の正解ではない。初回は計画・契約書と基準測定資料のみを作成した。承認後の実装状況は[実装記録](../../reports/web-refactor/README.md)を参照する。

S0/S1の具体化は[現状整理と内部API契約](web-s0-s1-contracts.md)、検証結果は[Web S0基準](../../reports/web-s0/README.md)を参照する。具体的な例外・操作単位は契約書を優先する。

## 1 大機能の区分

| 大機能 | ユーザーが行うこと | 責務の終点 |
| --- | --- | --- |
| A 会話ライブラリと探索 | 会話を作成・整理・複製・削除し、検索して目的の位置へ移動する | どの会話・ノードを、どの表示位置で開くか |
| B 会話編集と表示 | 本文・添付・分岐を編集し、チャット/グラフ/分割表示で読む | 会話内容・分岐構造・編集履歴の整合性 |
| C AI処理の実行 | 送信・再生成・補助生成・評価を、選択したモデルと設定で実行する | 入力の確定、実行先の決定、処理の終了と結果の適用 |
| D ローカルモデル運用 | モデルを探し、取得・インポート・変換・検証・ロード・削除する | モデル資産とWorker・端末資源の安全な管理 |
| E データ保存と同期・交換 | 再起動後に復元し、同期・インポート・エクスポートする | データ形式、耐障害性、外部データの適用 |

設定画面やWorkerは独立した大機能にしない。設定値は利用する機能に所属させ、UIはそれらを編集する入口とする。provider接続・モデル別生成設定・評価方針はC、ローカル資産・実行資源設定はD、同期認証・保存設定はE、表示設定はA/Bが所有する。テーマ・言語などのアプリ共通設定は既存config-sliceに残す。

この区分は責務の分類であり、5個の巨大クラスや新しいパッケージを作る指示ではない。既存Zustand、branch-domain、runtime、storageを使い、実際の重複がある入口だけを統合する。

## 2 全機能でそろえる設計とAPIの原則

以下のAPI名は契約を説明する仮称。既存関数に契約を持たせることを優先し、全APIを新設する意味ではない。ここでのAPIは主にWeb内部の関数・store操作であり、新しいHTTPサーバを導入しない。

| 契約 | 方針 |
| --- | --- |
| 識別 | 機能間はchatId/nodeId/modelId/requestIdで対象を渡す。配列indexは描画内の位置情報に限定。モデルの実行先はlocalかremoteかを区別し、remoteはproviderIdとmodelIdの組で識別する |
| 状態の所有 | 同じ状態の書込み責任は一箇所。別機能はselectorで読み、操作APIを通して変更する。派生キャッシュは許すが、正本との個別二重更新を外側に要求しない |
| 更新と保存 | 会話操作の成功と永続保存の成功は区別する。既存store内で整合した変更を一度に反映し、保存失敗はEが通知・回復する。全アプリ用transaction基盤は導入しない |
| 非同期 | 開始時に対象ID、実行設定、対象内容の識別情報を固定する。適用直前に対象を再確認し、削除・編集・新規要求で失効した結果を上書きしない |
| 結果と失敗 | 成功、取消、対象失効、実行/保存失敗を区別する。部分成功のある操作は成功対象と失敗対象を返す。結果形式は処理ごとの型とし、汎用Resultやイベントバスを必須にしない |
| 外部形式 | 会話の内部モデル、provider要求、保存snapshot、import形式を区別する。互換変換を境界へ寄せ、内部の全型をAPI要求形式へ合わせない |
| 能力差 | streaming、画像、reasoning、分類、chat template等の差を明示する。localとremote、wllamaとTransformersを無理に同じ万能インターフェースへ押し込まない |

保持する状態を4種に分ける。A/Bの会話とCの設定・結果などの業務データ、C/Dの実行中状態、A/Bの表示・draft、Eの保存・同期進捗である。各値をどこまで保存・同期・exportするかはEの明示的な選択規則に従う。設定画面から保存形式へ直接依存させない。

## 3 大機能ごとの設計

### A 会話ライブラリと探索

**責務と範囲。** 会話一覧、タイトル・フォルダ・順序、複数選択と一括整理、作成・複製・削除、全体/会話内検索、検索結果・分岐への移動、戻る/進む、表示モード・viewportを扱う。ノード本文やcontent参照数の操作はBへ渡し、ファイル形式はEへ渡す。検索の種類やUIを一つに減らすことは目的にしない。

**状態と設計。** 会話の識別はchatId、ノードへの移動先はchatId/nodeId。表示位置・履歴・検索ハイライトは会話本文から分ける。検索結果は移動先IDを返す。描画用indexは最後に求め、並べ替え後に別の会話を選ばない。既存branchSearchを検索の共通処理として使う。

| 操作API | 入力と出力 | 保証すること |
| --- | --- | --- |
| create / rename / move / removeChat | chatIdまたは作成設定 → 対象ID・次の選択 | フォルダ・順序・選択を整合させる。削除はCの要求失効とBの内容解放を含む |
| editFolder / moveChats | folderId、編集内容、chatId集合 → 整理結果 | フォルダの作成/名称/色/展開/削除と所属変更を扱い、一括処理もID基準にする |
| duplicateChat | chatId、全分岐/表示分岐 → 新chatId | 元会話不変、名称衝突回避、本文参照・評価関連ID・選択の規則を一箇所で維持 |
| searchConversations | query、既存の検索範囲 → chatId/nodeIdを持つ結果 | 非active分岐・ラベル等の現行検索範囲を維持 |
| navigate / back / forward | 目的ID、表示先、履歴方針 → 到達/対象消失 | path切替・focus・viewportを一操作で整合。通常移動と履歴復元の違いを保持 |

**移行戦略。** 一覧・チャット・検索・canvasの入口を同じ操作へ順に移す。既存storeの配列構造を一括正規化しなくても、公開入口をID基準にできる。UIはmodal開閉やハイライトを持ち、複製や移動の手順は持たない。

**コード最適化。** CloneChatとChatHistoryの複製処理、useBranchNavigation/search-slice/GrepResults/ChatFindBar/Canvasの移動手順を統合。検索エンジンの作り直しはしない。

**受入。** すべての入口から同じノードへ到達し、履歴追加は一回、戻る/進むでsplitとviewportを復元。並べ替え・削除後も別chatへ誤移動しない。全分岐/表示分岐の複製が元データと独立し、共有本文の参照が保たれる。フォルダ削除は会話削除ではなく所属解除とし、空フォルダ、色・展開、一括選択、最後の会話削除後の初期化を保持する。

### B 会話編集と表示

**責務と範囲。** 本文・role・画像添付（ファイル/URL/paste）、分岐作成・選択・prune、コピー/移動、star/pin、保護・送信除外・折り畳み、undo/redo、draft、Markdown表示を扱う。Chat、Branch Editor、splitは同じ会話に対する複数の表示とし、複数会話表示・分岐比較も維持する。一般文書添付への拡張は含めない。生成の実行はC、保存codecはEが担当する。

**状態と設計。** 分岐ツリーとContentStoreが会話内容の正本。activePathから得るmessagesは表示・要求作成用の派生値。既存messagesキャッシュは段階移行中も残せる。生成途中のバッファと編集draftは、確定本文と分離する。node属性はchat内を正本とし、読み取り用indexを残す場合もchatIdを基準にする。

| 操作API | 入力と出力 | 保証すること |
| --- | --- | --- |
| readConversation / readPath | chatId、pathまたはnodeId → 内容・構造の読み取り値 | 複数表示が同じ正本を読み、API形式への変換はしない |
| edit / insert / branch / prune | chatId/nodeId、変更内容 → 更新結果・対象ID | 本文・tree・参照数・属性・system prompt・履歴を一つの更新境界で整合 |
| copy / paste / moveSequence | sourceChatId、ノード範囲、targetChatId、挿入先 → 対象ID・更新結果 | 会話間移動は移動元/先の本文・参照数・履歴を一括更新。clipboardの共有本文を保持 |
| setNodeAttributes | chatId/nodeId、既存属性の変更 → 更新結果 | 非activeノードも保持し、保護・除外の意味を維持 |
| commitGeneratedContent | 対象ID、requestId、開始時の対象情報、結果 → 適用/失効 | Cからの完了・中断・復旧を同じ規則で適用し、新しい編集へ上書きしない |
| undo / redo | 現行操作履歴の直前/次操作 → 関係する会話の復元状態 | 会話別履歴に変えず、操作単位で複数chatの本文・分岐・属性・参照数を一緒に復元 |

**移行戦略。** branch-domainを既存の更新境界として、上位層のmessages/tree個別更新を吸収する。最初は保存形式を変えない。streaming中は毎tokenで全treeを再構成せず、表示バッファを更新し、既存のsnapshot確定時にも同じ整合性規則を使う。途中編集を上書きする現行動作と、明示分岐する動作を保持する。

**コード最適化。** 生成確定・復旧・通常編集の重複を削り、indexキー属性mapの二重更新を整理。sticky入力と既存bubble編集は共通の編集ロジック・配線を使い、focus/resize/IME/draftの違いは残す。到達しない旧ContentView等の削除は、この責務整理の下位作業とする。

**受入。** 編集・prune・undo/redo・非active分岐への生成後に内容、activePath、messages、参照数が整合。会話間移動のundo/redoで移動元と先が同じ操作として復元され、途中の片側だけの状態を残さない。添付、role、system prompt、保護・除外・折り畳みを維持。IME、キーボード、スクロール、編集draftを保持し、大きな会話とstreaming中の再描画コストが許容範囲に収まる。

### C AI処理の実行

**責務と範囲。** 通常送信・途中再生成、タイトル生成、送受信前後と手動の品質・安全性評価、および設定画面のローカル要約/整形/分析テストを扱う。要約テストを会話本文へ自動適用する新機能は追加しない。provider接続、モデル選択・能力、プロンプト・設定の解決、token budget、streaming、取消、復旧、使用量・観測を含む。処理ごとの目的や結果形式は保持する。評価を通常生成の文字列へ無理に統一しない。

**状態と設計。** 実行要求はrequestIdで識別し、モデル参照・有効設定・入力内容・適用先を開始時に固定する。prompt library/default/chat/model別設定の優先順位は既存動作を表にして一箇所で解決する。provider固有body/headerと認証はremote経路で扱い、local経路はDへ実行要求を渡す。UIは接続情報やfallbackの手順を組み立てない。

| 操作API | 入力と出力 | 保証すること |
| --- | --- | --- |
| configureProvider / listModels / updateTaskSettings | 接続・モデル・prompt/評価設定 → 設定/利用可能モデル | 既存provider接続、custom/favoriteモデル、prompt library、設定継承を維持。API key等を表示用モデル情報へ混ぜない |
| resolveExecution | task種別、対象、選択モデル、設定 → 実行先・入力・有効設定 | 除外ノード・system prompt・画像/reasoning・budgetを反映。非対応能力と設定制約を黙って落とさない |
| startTextTask / startEvaluation | 確定した要求 → requestIdと進捗/型付き結果 | 共通化はモデル解決・寿命・通信に限定し、評価軸やpromptの意味はtaskごとに維持 |
| cancelRequest | requestId → 取消状態 | 関連stream/Worker要求を止め、遅れて届く結果を新要求へ適用しない |
| recoverRequest | 保存記録 → 適用可能な結果/要確認/失敗 | 対象IDと要求の同一性を確認し、会話生成の結果本文はB、評価結果はC、タイトル変更はAへ反映し、設定画面のテスト結果はその画面に返す |
| readExecution / readResult | requestIdまたは対象ID → 状態・結果・usage | 実行中状態、評価結果、確定本文を区別し、二重完了・二重usage計上を防ぐ |

**実行戦略。** `submitRuntime`を中心に要求準備・実行・適用の責務を明確にする。remote streaming/non-streaming/Proxy/SWとlocal生成に共通の終了・対象確認を持たせるが、transportやengineを無理に一本化しない。補助処理にもモデル選択・通信制約を適用し、途中で設定を再読取りして別モデルへ変わらないようにする。local/remote/hybridの既存評価方針を棚卸しし、local失敗時のremote fallbackも現行挙動として明記する。任意の処理へ新しい自動fallbackを追加しない。

**復旧戦略。** SW要求・streamDb記録・適用先をchatId/nodeId/requestIdで結ぶ。proxy待機後に再解決し、削除・途中編集・新規生成で失効した結果を自動上書きしない。旧index記録は読めるように残し、同一性を証明できないものは本文を保持して要確認にする。旧新SW/画面の混在を契約テストに含める。SSE fixtureを先にそろえてから記録を変更する。

**コード最適化。** 解決処理・確定処理の重複を減らし、API層からのstore読取りは要求準備側へ必要な範囲で寄せる。API仕様の違いは消さず、共通処理とprovider変換を区別する。Web/SWのparserはまず同一fixtureで保証し、物理的な共有はビルド変更の効果が見合う場合に限る。

**受入。** 通常/途中生成、streaming/non-streaming、local/remote、評価の手動/自動が現行設定で成立。取消・二重完了・復旧待機中の並べ替え/削除/編集で誤適用しない。モデル設定の優先順位、OpenRouter制約、system prompt、画像、reasoning、usageを保持。補助処理の入力・評価結果が対象の内容と対応する。設定画面の試行は会話・履歴を書き換えず、評価のpending/軸別進捗は成功・失敗・取消のいずれでも解消する。

### D ローカルモデル運用

**責務と範囲。** カタログ/Hugging Face検索、download・再開・ファイルimport、shard/manifest、量子化・変換・検証、モデル一覧・タスク割当、load/unload、端末能力・メモリ・WebGPU/WASM選択、削除を扱う。通常chat・評価の目的と本文適用はC/Bが担当する。量子化・診断は現行の製品機能を支えるものとして維持する。

**状態と設計。** OPFSの資産状態saved/partial/invalid/none、runtimeのloading/ready/busy/error、保存済みmetadata、タスク割当を別のものとして扱う。Workerの所有者はLocalModelRuntime、ファイルの所有者はstorage。orchestratorは必要モデル集合と資源方針を決め、runtimeと別のWorker寿命管理を持たない。

| 操作API | 入力と出力 | 保証すること |
| --- | --- | --- |
| discover / acquire / importModel | 検索条件・取得元・ファイル → 候補またはmodelId/進捗 | manifest・partial状態・重複排除・取消を統一。取得途中をsavedとしない |
| inspectStored / convertModel | modelId、既存変換条件 → 検査結果/変換結果 | shard・GGUF検証、元ファイル保持方針、一時ファイル掃除を守る。アクセス不能を欠損と同一視しない |
| prepareModels / ensureReady | requestIdまたは実行単位ID、必要モデルID、既存資源方針 → readyまたは理由付き失敗 | 同一モデルのloadを共有し、所有者ごとに必要モデルを予約。準備から全処理終了まで退避から保護 |
| generate / classify / release | モデルと予約所有者ID・requestId、能力別入力 → 結果/終了 | wllama生成とTransformers分類は別契約。成功・失敗・取消・対象失効の全終了経路で所有者の予約を解放 |
| unload / removeAssets | modelId、モデル/ファイル/全体の範囲 → 対象ごとの結果 | load・推論・download・変換と削除が競合しない。部分成功を返し、実ファイルに合わせてmetadata更新 |

**実行・移行戦略。** Settings・通常submit・評価・OPFS Browserを同じ管理入口へ移す。モデル単位の進行中操作と世代をruntimeで管理し、キャンセルを長いload完了待ちに閉じ込めない。WebGPU→CPU fallbackの再入を保持する。複数モデルの逐次/並列ロードと退避は既存orchestrator/deviceを使う。予約はgenerate前のready待機と評価の段階間も保護する。終了時はその所有者の予約だけを解除し、他の所有者が使うモデルをunloadしない。自動退避は予約中モデルを除外する。ユーザーの明示unload/削除は対象を予約する要求の取消、実行/書込み停止確認、予約解放を経て実施し、停止失敗なら資産削除へ進まない。汎用lease基盤は追加せず、既存runtime/orchestrator内の所有者追跡で実現する。

起動時は軽量metadataを復元し、必要モデルを開く直前に既存verifyStoredModelで検査する。Settings訪問を利用条件にしない。巨大ファイルの全hashを毎submit計算せず、OPFS-direct/SyncAccessHandleを保持する。検査後に他タブが変更する場合も実読み込み失敗として扱い、未確認状態でmetadataや割当を消さない。

削除は単一モデル・単一ファイル・全削除・重複排除を含む。書込み終了と新規操作の割込み防止を確認してから削除する。全削除の途中失敗は成功したIDのみ反映し、失敗を表示。単一ファイル削除はmanifestから資産状態を再検査する。変換処理自身の一時ファイル掃除は同じ操作へ機械的に置き換えず、所有する処理の終了条件を確認する。

**コード最適化。** UIごとのload/unload/delete手順と、Settingsだけの復元処理を解消。未到達adapterと未使用prompt helperを削除し、実Workerのprompt/template/prefixを検証する。量子化方式・engine選択・診断を大きいという理由で削らない。

**受入。** Settings未訪問で保存済みモデルが動作。二重load、準備完了からgenerate開始までの退避競合、評価段階間の予約保持、全終了経路の予約解放、生成と評価の競合、load中削除、download中ファイル削除、abort直後の再load、fallback、全削除途中失敗が整合し、Worker・promiseが残らない。モデル資産を全量コピーせず、shard・partial・破損を識別。実ブラウザでload時間・peak memory・最初の出力までの時間を測る。

### E データ保存と同期・交換

**責務と範囲。** localStorage/IndexedDBへの保存と起動復元、圧縮、migration、Google/CloudKit同期と認証・競合、全体/会話/分岐import-export、復旧exportを扱う。ローカルモデルの巨大ファイルはDが管理し、会話snapshotへ混ぜない。同期providerは通信・認証・固有競合を担当し、会話内容の直接修復処理を各UIに持たせない。

**状態と設計。** Bのtree/contentとA/C/Dの保存対象設定からversion付きsnapshotを作る。完全snapshot、local設定、export対象の選択規則を共通の定義から組み立てるが、秘密情報の取扱いは形式ごとに明示する。既存の保存・export範囲を無断で変えない。保存済み状態と同期済み状態は区別する。

| 操作API | 入力と出力 | 保証すること |
| --- | --- | --- |
| buildSnapshot / persistLocal | 確定した状態・保存目的 → snapshot/保存結果 | streaming確定、設定選択、IDB移行前safety netを維持。保存失敗を成功扱いにしない |
| decode / migrate / validate | 外部/旧データと形式 → 検証済み状態または理由付き失敗 | 旧形式・欠損content・未知モデル・ID衝突を境界で処理し、適用前に検証 |
| applyImported / applyRemote | 検証済み状態、append/replace/競合方針 → 適用結果 | A/B/Cの関連ID・結果・履歴を整合させる。UIごとのmigration/hydrate手順をなくす |
| sync / connect / disconnect | providerと操作 → 同期/認証状態 | Google/CloudKit固有の競合・暗号化・token世代を維持し、古い接続の応答を適用しない |
| exportData / exportRecovery | 形式・範囲 → 出力 | 全分岐/表示分岐、評価・設定の既存選択規則、旧形式互換を維持 |

**移行戦略。** まず出力同値のsnapshot設定組立てとリモート適用処理を集約する。次に認証aliasのreaderをprovider mapへ移す。保存形式変更は独立段階とし、旧readを残したwrite-new、再読込み、失敗時の元データ保全を確認してからwriterを切り替える。起動読取り失敗時に空storeを保存しない既存ブロックを保持する。

異なる媒体の圧縮・暗号化形式を一律に統合しない。同期競合を「最後の応答で上書き」に単純化しない。import/remote replace時はCの進行中要求を失効させ、適用済みデータへ古い生成結果が戻らないようにする。永続書込みとメモリ反映が途中で失敗した場合の回復順序は既存実装とfixtureで固定する。コードをrevertするだけでは保存形式を戻せない場合がある。

**コード最適化。** full/local設定コピー、CloudKit手動pull/server-wins適用の重複を削減。cloud-authはprovider mapを正本にしてalias更新を減らす。未使用Google providerを削除する。import-exportのcodecと会話への適用を区別し、各形式の互換decoderは残す。

**受入。** 保存→再起動、旧snapshot→migration→再保存、自前形式の全体/会話/分岐export-importの往復で、その形式が保持する内容と関連IDを保持。V1/V2/V3/legacy/OpenAI等は保持できる画像・reasoning・分岐・評価が異なるため、形式別の保持/変換/欠落の対応表で確認し、外部形式へ新しい情報保存能力を要求しない。同期競合・認証更新・容量不足・破損・起動読取り失敗で元データを失わない。進行中生成とreplace/pullが競合しても誤上書きしない。接続先・秘密情報の保存/export範囲が意図せず変わらない。

## 4 機能をまたぐ主要フロー

| フロー | 責務の受け渡し | 境界で検証すること |
| --- | --- | --- |
| 検索から編集 | A検索 → A移動 → B読取り/編集 → E保存 | 同じIDに到達し、履歴を二重追加しない |
| 会話の複製・削除 | A操作 → B内容/参照更新 + C関連要求・結果処理 → A選択 → E保存 | 元会話不変、削除済み対象への遅延結果を拒否、関連ID整合 |
| chat生成と評価 | Bから入力読取り → C設定/モデル解決 → remote通信またはD準備/実行 → C評価 → B本文確定/C結果格納 → E保存 | 自動評価の実行順は既存設定を維持。モデル・対象内容・取消・結果の対応を固定 |
| 中断後の復旧 | E/stream記録読取り → C再接続と対象検証 → B適用または復旧内容保持 → E保存 | 旧記録を読めることと自動適用できることを区別 |
| モデル取得・変換・利用 | D取得 → D検査/変換 → D登録/割当 → C利用要求 → D準備/実行 | partialをreadyにしない、利用中の資産を削除しない |
| import/同期replace | E復号/検証/変換 → C旧要求失効 → A/B/C状態の一貫した適用 → E保存 | metadataだけ先に成功扱いにせず、失敗時は旧データから回復 |

複数機能にまたがる処理は既存store操作やsubmit/import orchestrationが順序を担当する。責務別の関数を無制限につなぐ汎用workflow機構は作らない。UIから各storeを個別更新する手順をなくすことが目的である。

## 5 実装戦略と完了判定

### 設計をそろえる段階

**S0 現状と受入を固定する。** 並行中のBranchEditor変更が着地したcommitを基準に、A〜Eごとに利用入口、状態の書込み元、機能設定、テストと代表データを対応付ける。既存の設定優先順位・評価fallback・import/export範囲を記録する。Web install/build/型検査/関連テストを再現可能にし、PR検査を整える。ここで現状の性能を測る。

**S1 API契約を確定する。** 各大機能について「入力/出力、正本、ID、取消・失効、失敗/部分成功、永続化対象、隣接機能への呼出」をそろえる。上のAPIを既存symbolへ対応付け、複数の実行入口が同じ規則を通ることを確認する。機能差を保てない共通化案は採らない。新しい層を追加するだけで既存入口が残る案は未完了とする。

S1完了までは、個別削除やファイル分割を先行するリファクタリングを開始しない。S0/S1はこの計画に基づく詳細設計・基準固定であり、機能を追加する工程ではない。

### 機能単位で移行する段階

| 実装単位 | 前提 | その単位で揃える範囲 | 完成条件 |
| --- | --- | --- | --- |
| B 会話更新の共通境界 | S1 | 通常編集・分岐・属性・履歴・派生messages | 通常編集が一つの正本を通り、保存形式は維持 |
| A ライブラリと探索 | Bの更新契約 | 複製・削除・検索先移動・履歴・表示の全入口 | 同じ操作が入口ごとに別手順を持たない |
| D ローカルモデル運用 | S1、Cとの実行/取消契約 | 取得/検査/寿命/資源/削除の全入口 | Workerと資産の所有権、部分失敗が受入を満たす |
| C AI処理の実行 | Bの適用契約、Dの実行契約 | 要求解決・remote/local・補助処理・取消/復旧 | 全経路が同じ対象確認と終了規則を通る。SW変更前にSSE fixtureを通す |
| E 保存と同期・交換 | S1、A/B/Cの状態契約 | snapshot・apply・認証alias・import/export | 旧データと競合・失敗時回復を維持。保存形式変更は別PR |

Bの段階では生成・復旧用の既存互換入口を残し、Cの移行でそれらを閉じる。DはA/Bとは独立に実装できるが、同じ共有ファイルを複数担当が同時に変更しない。Eの出力同値の設定コピー整理は先行可能だが、外部snapshot適用と形式変更はA/B/Cの契約に合わせる。機能単位は一つの巨大PRを意味せず、既存呼出を移して検証できる小さな変更に分割する。

### コード最適化と効果の判定

各機能の呼出移行が終わった時点で、旧入口・重複状態・未使用実装を削除する。分割は責務が分かれた場合だけ行い、ファイル行数の上限を目的にしない。新依存・新状態管理・汎用repository・共通HTTPサーバは導入しない。

成功指標は、(1)機能操作の所有者と更新経路が明確、(2)同じ規則を複数UIで修正しなくてよい、(3)入力から保存/結果までの受入が成立、(4)純減と性能を実測できること。LOCはWeb製品、テスト、vendorを分ける。ファイル移動やテスト削除を製品削減と数えない。未検証の「全体20%削減」は目標として固定しない。

| 機能 | 保守性の検証 | 性能・動作の検証 |
| --- | --- | --- |
| A | 複製・移動の手順と履歴方針が各一箇所 | 大きなライブラリの検索/移動、戻る/進む |
| B | 内容/属性更新が一正本を通る | 大きなtree、編集、undo、streaming中描画 |
| C | 全taskのモデル解決・終了・対象検証がそろう | 初回応答、取消、復旧、usage、補助処理 |
| D | 全入口でWorker/資産の所有権を確認 | load/peak memory/初回出力、競合・部分削除 |
| E | snapshot選択・外部適用・互換変換の所有者が明確 | 起動、保存量/時間、round-trip、失敗からの回復 |

S0で同じfixture・モデル・端末・ブラウザに対する基準と許容差を定める。実装後に関連Vitest、必要なPlaywright/実ブラウザ、型検査・build・差分確認をまとめて行う。mock成功と実端末の性能確認は区別する。保存形式変更は旧データを保全し、旧アプリへ戻せるかも明示する。iOSのbuild/testは行わない。

## 6 根拠と下位のコード整理候補

この表は設計を実装へ結び付ける索引であり、上位の作業順ではない。行番号は初回調査時点の目安。並行変更があるため実装時にsymbolと呼出元を再確認する。

| 所属 | 確認した根拠 | 設計に従って行う整理 |
| --- | --- | --- |
| A | CloneChat.tsx:24 / Menu/ChatHistory.tsx:165 | 複製の状態操作を一つにする |
| A | useBranchNavigation.ts:14、search-slice.ts:94、GrepResults.tsx:175、ChatFindBar.tsx:257、BranchEditorCanvas.tsx | 移動先IDと履歴方針を一操作へ集める |
| B | types/chat.ts:125/129、branch-domain.ts:125、chat-slice.ts:11 | tree/messagesとnode属性mapの二重更新を解消 |
| B | EditView.tsx:51 / UnifiedMessageView.tsx:203、MessageContent.tsx:74 | 編集配線を共有し、未到達ContentView・旧branchUtils関数を削除 |
| C | submitRuntime.ts:444、useStreamRecovery.ts:492、utils/streamDb.ts:5、swBridge.ts:75、public/sw-stream.js:395 | 生成/復旧の確定と対象IDをそろえる |
| C | api/api.ts:45、hooks/submitHelpers.ts、hooks/useEvaluation.ts、api/localGeneration.ts、api/evaluation.ts | モデル解決・設定・処理寿命と、task固有処理を分ける |
| C | utils/proxyClient.ts:153 / public/sw-stream.js:291 | SSE契約fixtureを共有し、物理共有は効果を確認して判断 |
| D | local-llm/runtime.ts:525/674、orchestrator.ts、LocalModelSettings.tsx:288/474 | 既存寿命管理と資源方針を整理、Settings訪問依存を解消 |
| D | useModelDeletion.ts:32、OpfsFileBrowser.tsx:82/106/138、storage.ts:748 | 全削除入口・書込み停止・部分成功をそろえる |
| D | lowbit-q/convert.ts:1289、lowbitQManager.ts:175、LowbitQValidationPage.tsx:323 | 変換・検証のファイル掃除も所有権条件を確認 |
| D | src/vendor/wllama/runtime-adapter.ts、workers/prepareChatPrompt.ts | 未到達stub/旧helperを削除し、実Workerのpromptを検証 |
| E | persistence.ts:94/217/282/369、useAppBootstrap.ts | 設定コピーを統合し、起動書込みブロックとsafety netを保持 |
| E | CloudKitSync.tsx:58/233、storage/cloud/providers/cloudkit.ts:101 | 手動pull/server-winsの共通適用 |
| E | cloud-auth-types.ts:24/89、api/google-auth.ts:27、ImportExportChat/importService.ts | auth正本と外部適用境界を整理、認証世代・import互換を保持 |
| E | storage/cloud/providers/google.ts:39 | 現用暗号化同期を残し、未使用providerだけ削除 |

初回調査の明確な製品コード削除候補はContentViewと旧branchUtils関数264行、prompt helper58行、旧Google provider49行の計371行。adapter81行はvendor、専用test138行はテストとして別集計。これは付随する削減見込みであり、全体設計の効果を表す数値ではない。追加検証コードを含む純減は実装後に測る。

## 7 調査基準と監査

初回調査日: 2026-10-11。比較HEADは `02d5e8e78c03d77004a1a24d90d5874cdc030742`。直接の親 `animalnots/BetterChatGPT-PLUS` のHEAD `c7b730471a1423de06474d642273b190dee73888` がmerge-baseであることを確認した。以下は当該コミットの数値で、並行中の作業ツリーの現在値ではない。

| 集計対象 | 親コミット | 比較HEAD |
| --- | ---: | ---: |
| src製品コード vendor/test除外 | 11,373 | 65,838 |
| Web関連テスト vendor/iOS除外 | 0 | 21,392 |

Git追跡のts/tsx/js/jsx/swift/c/h/cpp/m/mm/cjs/mjsの物理行数（空行・コメント込み）。vendorとtestを別分類し、JSON、翻訳、lockfile、WASMバイナリ、追跡外ビルドツリーを含めない。親のtest 0はこの集計規則での値。機能追加分やテストを不要コードとみなさない。

初回はSol 6.1 Medium（会話/UI）、Terra High（保存/同期）、Terra Medium（ローカルLLM等）が分担調査した。独立Sol 6.1 Mediumの初回監査で指摘された復旧先ID、削除入口・部分失敗、検証段階の不足は、本案のC/D/S0へ引き継いだ。本改訂は大機能・API・戦略の整合性を同じ独立Sol 6.1 Mediumが新たに監査した。大機能の粒度がそろっているとの評価に加え、会話間操作のundo単位とローカルモデル予約の所有者・解放の2点を指摘。B/DのAPIと受入へ反映した。修正箇所の再監査では2指摘とも解消、追加の重大指摘なし、改訂計画は受入可能との判定を得た。静的な計画監査であり、実装・テスト・性能の成立を保証するものではない。前案の受入判定をそのまま流用していない。

初回計画作成時点では製品コード・依存関係・保存形式への変更はなかった。並行中のBranchEditor変更はこの計画作成の変更ではない。前段計画の作成時点では検証未実行。続くS0で型検査・build・単体/ブラウザテストと合成性能測定を実行し、失敗と未確認を基準報告に記録した。クラウド実接続は未確認。量子化/WASMの全面書換え、機能廃止、iOS/Electron固有の変更は含めない。
