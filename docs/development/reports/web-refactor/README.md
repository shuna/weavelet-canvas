# Web maintainability refactor implementation

対象はWeb版。iOS・Electron固有機能と機能削除は対象外。基準commitは`02d5e8e78c03d77004a1a24d90d5874cdc030742`。実装は`codex/web-maintainability-refactor`で隔離し、元作業ツリーの未コミットBranchEditor変更は変更していない。

## 実装の対応

| 大機能 | 集約した責務 | 主な受入証拠 |
| --- | --- | --- |
| A ライブラリと探索 | 作成・複製・削除・フォルダ操作をchat-sliceへ、移動先をchatId/nodeId＋履歴方針へ統一 | chat-library、navigation/search。生成中複製はその時点の内容を固定 |
| B 編集と表示 | IDによる編集・属性変更、範囲cut/move、会話間undo、共通MessageEditForm | branch-slice/branch-domain、編集履歴、system prompt復元 |
| C AI処理 | 開始時ticket・モデル・入力固定、取消と結果失効、chat/node単位buffer、ID＋内容＋role付き復旧checkpoint | aiTaskLifetime/useEvaluation/useStreamRecovery/submitRuntime/streamDb。primary成功前の復旧record破棄を禁止 |
| D モデル運用 | runtime owner/共有load、writerと取得・変換操作の停止、全削除入口の結果処理、起動時再検査 | runtime/storageおよび専用ブラウザの実OPFS削除。実モデル性能とは区別 |
| E 保存と交換 | 保存対象キーを一元化、外部適用と保存を分離、detached import planを一度だけcommit、provider mapから保存alias生成 | persistence/import/applyExternalSnapshot/CloudKit/Google。旧remote形式は保全して明示移行 |

不要になったContentView、branchUtils旧操作、未使用Google provider、旧prompt helper、vendor adapter stubを削除した。prompt helper専用テストの削除は製品削減に含めない。新依存は追加していない。Proxyの依存範囲を変えず、初めてlockfileを追加し、独立installと型検査を再現可能にした。

## 監査

独立Sol 6.1 Mediumが変更を監査。最初のA/B/C/D監査ではA/Bに追加重大指摘なし、D削除失敗誤判定・取得/変換中削除競合・失敗時UI、C取消と評価モデル固定の5件を修正対象とした。E監査ではdetached importerと評価修正に追加重大指摘なし、partial確定後の外部上書き・旧version保全・既存CloudKit接続ID初期化の3件を修正対象とした。続く再監査で、streamのprimary保存前ACK、遅延開始の取消、旧remoteデータの明示移行、モデル取得/変換中の削除、部分ファイル削除順序、Worker開始失敗時の終了、取消後の遅延callbackを修正した。A/B/C/Eは追加指摘なし。Dも`1bfa76d0`の限定再監査で残件解消・追加指摘なし。以上は静的監査であり、下記の実行検証とは区別する。

## 検証環境と限界

既存Chromeとは別の空contextを使用し、利用者のデータ・認証・OPFSへ接続していない。ブラウザの実OPFS試験は数byteの専用ファイルだけを作成・削除する。iOSのbuild/testは実行しない。

基準S0は未コミットBranchEditor込みの作業ツリー測定だったため、単純なテスト総数比較はしない。元BranchEditor変更は別の一時checkoutに重ねて互換性を確認した。MessageDetailModalで新ID APIと元のcanvas内dialog実装を合わせる解決が必要。元の作業ツリーに自動適用していない。解決済みoverlayで型検査とBranchEditorの12テスト成功。

実クラウド認証・同期、Lowbit-Q実変換、複数モデル・端末の性能校正は未実施。単一モデルのCPU実行は下記の条件で確認した。mockや数byteのOPFS成功をこれらの証拠とはしない。GitHub Actionsのリモート実行も未確認。

## 同一合成fixtureの性能

S0のスクリプトを変更せず50会話×100ノードを再測定した。[全サンプル](browser.json)。同じ入力5,752,956 bytes、gzip160,093 bytes。

| 処理 | S0 p95 ms | 実装後 p95 ms |
| --- | ---: | ---: |
| 検索5,000ノード | 4.885 | 4.760 |
| activePath materialize | 0.140 | 0.135 |
| gzip | 31.905 | 22.265 |
| gunzip | 12.550 | 8.135 |

S0の退行調査閾値を超えない。短い合成測定なので、高速化の一般的な保証やDOM/起動/モデル性能の代替にはしない。

## 実モデル測定の条件

既存カタログのSmolLM2 360M Instruct Q8_0を、新規の一時ブラウザprofileで使用。取得revisionは`593b5a2e04c8f3e4ee880263f93e0bd2901ad47f`、386,404,992 bytes、SHA-256 `48ab3034d0dd401fbc721eb1df3217902fee7dab9078992d66431f09b7750201`。CPUを明示し、同じprompt・temperature 0・上限32 tokensを3回実行する。生成結果が空でないこと、最初のchunkで取消できること、unload後にロード済み扱いが残らないことを確認する。

[実行スクリプト](model-smoke.cjs)はローカルHTTPでmodelをstream供給し、利用者のブラウザprofileを使わない。RSSは専用Chromeと子processの250msごとの合計最大値であり、共有pageの重複を含み得る。厳密な固有メモリや全端末の上限ではない。

モデルfileがなかったため、一時領域へ上記revisionを取得した。初回の測定スクリプトではPlaywrightの全file応答がNodeのメモリ上限に達したため、stream配信へ修正した。これは製品のモデルロード失敗には数えない。旧実装ではunload直後のOPFS削除が1回lock errorになり、後の実行では成功した。削除失敗を成功として扱わない契約とは区別して記録する。

| 指標 | 変更前 | 変更後 |
| --- | ---: | ---: |
| load ms | 610.415 | 576.035 |
| 初回TTFT ms | 417.060 | 420.580 |
| 3回目TTFT ms | 299.635 | 301.310 |
| 取消応答 ms | 0.255 | 0.265 |
| Browser tree RSS MiB | 2206.750 | 2327.578 |

[変更前](model-before.json)、[変更後](model-after.json)。全3回で「2+3は5」の出力を確認。変更後は予約中unloadを拒否し、AbortSignal取消・予約解放後unload・Main経由の資産削除まで成功。単一runの短い測定なので性能差の有意性は主張しない。

## 最終検証と変更量

製品コードの最終commitは`1bfa76d0`。全体検証は直前の`b060b6ba`、最後の変更は取消済みdownloadの遅延error guardとその回帰テストに限定する。

| 検証 | 結果 |
| --- | --- |
| Vitest全体 | 92ファイル、966件中965成功・1skip・失敗0。skipは合成同期benchmark |
| 最終guardの関連テスト | download-lifetime 2件成功（追加回帰1件を含む） |
| Web型検査 | 最終commitで成功 |
| Functions / Proxy型検査 | 成功。後続で対象コード変更なし |
| 本番build | 成功。main chunk 1,208.53 kBの既存閾値超過警告あり |
| Chrome | 7件成功、失敗・retryなし。分岐swipe、OpenRouter設定、表示更新3件、実OPFS削除、旧remote保全→再起動→明示import |
| 実CPUモデル | 最終commitで3回生成・取消・予約保護・unload・削除成功 |
| 元BranchEditor差分との互換 | 一時checkout上で型検査・12件成功。元作業ツリーは変更しない |

変更量は基準commitから最終製品commitまでの`git diff --numstat`を集計した物理行数。移動や置換を含み、削除行数をそのまま純減とはしない。

| 分類 | 追加行 | 削除行 | 純増減 |
| --- | ---: | ---: | ---: |
| src + public製品（test/vendor除外） | 2,646 | 2,603 | +43 |
| test（src + tests） | 2,291 | 271 | +2,020 |
| vendor | 0 | 81 | -81 |

製品コードは大幅純減していない。重複UI手順・保存設定コピー・未使用実装を削減した一方、取消・復旧・資産削除・旧形式保全に不足していた契約を実装したため、製品行数はほぼ同量となった。今回の成果は更新責任の集約と失敗時の整合性であり、コード量改善の目標全体が達成されたとは扱わない。文書・CI・lockfileは上記製品集計外。

元の未コミットBranchEditor差分は統合していない。利用時にはその差分とのmergeが必要で、MessageDetailModalのID APIとcanvas内dialogの両方を残す解決を一時checkoutで確認済み。リモートへのpush/PR/mergeは実行していない。
