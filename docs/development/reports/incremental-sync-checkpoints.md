# gzip既定化・ノードハッシュ・検証済みチェックポイント

## 実装した動作

大きな同期Commitとpackはブラウザー標準gzipを既定とする。親Commitがあり、未圧縮JSONの保守的な上限見積りが64KiB以下の場合だけ、既存の1ファイルinline LZを候補にする。実圧縮後の256KiB上限も維持する。大きいpayloadをLZで試して判定する処理は追加しない。明示・保存済みのlegacy設定、旧データの読込、準備済みoutboxのIDと暗号文は維持する。

新しいgzip・canonical hash形式は旧バイナリーでは読めないため、同じ同期先のクライアントを更新する必要がある。小更新を旧形式で送ることは、大きな更新やpackの旧クライアント互換を保証しない。

各ノードの全同期属性を正規化してSHA-256を計算し、チャット、全体のハッシュへ集約する。本文ID、親、role、ラベル、取得元generation ID等も対象とする。値署名が一致するノードではレコード展開とSHAを再利用し、本文・画像の検証済みSHAとUTF-8容量も再利用する。キャッシュは既存の64MiB LRU文字列予算を共有する。容量超過・未知の入力は再計算へ戻る。返却されたmapの変更でキャッシュが書き換わらない。

チェックポイントの状態SHAも、本文を再び巨大な文字列へ連結せず、レコードのキーと値SHAの対応表とconflictsから計算する。最終状態の一致はキー・値の直接比較でも確認する。また、同期終了時のrecordsが既に検証・復元したrecordsと完全一致すれば、そのsnapshotを再利用し、二度目の全文復元を省く。並行更新が入った場合は最終recordsを復元し直す。

チェックポイントの生成とgzip圧縮、gzip展開と完全履歴照合は、それぞれ同じWorker処理内で完結する。生成時は圧縮済みバッファをtransferし、展開済み全本文をmainへ返してからWorkerへ送り直す経路を省く。Commitのcanonical SHAも、通常のJSON値では全文のJSON stringify→parseを省いて本文文字列を共有する。Date・独自toJSON等は従来の正規化へ戻り、既存のdigest規則は変えない。完了済み同期キューはSnapshotを保持しない。

変更通知だけではundo・import・既存のin-place更新の取りこぼしを保証できないため、裸の参照一致や未検証のdirtyヒントでは省略しない。現在も全入力の値署名走査、全レコードの列挙、Workerへのsnapshotコピーは残る。全ノード走査そのものをなくした実装とは区別する。

## ローカルのチェックポイント

再生済みrecords、conflicts、取り込み済みCommit集合、先端を暗号化保存する。その暗号文のSHAと全Commitの親一覧を、同期metadataと同じIndexedDBトランザクションで保存する。起動時は指紋と構造が整合する再生済み状態を読み、そこに含まれる古いCommit本文を読み込まない。

単一先端を直接延長する非構造変更は追加適用する。別分岐、削除、activePathの修復、解決操作、旧履歴が必要なpack検証・集約では、必要な本文を読んで従来の履歴再生へ戻る。古い形式や壊れた再生キャッシュも履歴から復元する。遅延読込対象のローカルCommitが欠落・破損していれば、保持されているクラウドCommitまたはpackから取得する。baselineと未送信outboxは置換しない。

## クラウドのチェックポイント

Driveにはgzipのcheckpoint部品と、その部品を指す小さい暗号化manifestを保存する。元のCommit集合のcanonical SHA、先端、records、conflicts、状態のSHAを含む。初回、128件の新規Commit追加ごと、または`checkpointHistory()`で作成する。128は作成周期であり履歴保持の上限ではない。

受信したcheckpointの状態SHA、Commit集合、先端が一致するだけでは採用しない。**初回は実際の認証済み履歴を再生し、recordsとconflictsが完全一致することまで必須とする。** 自分で状態SHAを再計算した偽snapshotも拒否する。検証後の状態をローカルに保存してから、以後の起動を高速化する。新しい端末の最初の履歴検証は省略しない。

部品を先に送り、manifestを最後に公開する。outboxは送信前に永続化し、再開時は同じID・同じ暗号文を使う。読戻し検証後にoutboxを削除する。ACKがあっても部品が見つからない場合は保存済み暗号文で再送する。

チェックポイントは補助データであるため、自動作成の容量超過や回復不能な公開失敗で、正常なCommit同期を停止させない。準備済みoutboxは再試行用に残し、明示操作ではエラーを返す。単一payloadの256MiB展開上限を緩めない。蓄積状態がこの上限を超える場合のcheckpoint分割は、今後の拡張となる。

元の論理履歴と過去のcheckpointの物理削除、保持期間・件数上限は導入しない。既存pack集約は論理履歴を残したまま元の転送ファイルを置換する。既存のバブル分岐マージ、三者比較のbaseline、ローカル本文deltaとノード参照は維持する。

## 検証

ノード署名のmutation・undo/import・削除・並び替え・画像・通常全比較との一致、gzip/inline/legacy・中断後の同一暗号文・新旧pack混在を検証する。checkpointでは初回の完全履歴照合、指紋破損からの再生、cold履歴欠落のクラウド復旧、旧baseline維持、別分岐checkpointへのfallback、補助payloadだけの容量超過、ACK後の部品欠落と再起動を検証する。

Astraがレビューで確認した3件の停止条件（別分岐のcold参照、aggregate容量上限、ACK済み部品欠落）を修正し、再現テストへ追加した。加えて、補助処理の失敗を無視する際も既知の履歴集合を失わないよう、クラウドへの再取得が失敗したCommit IDと親情報を必ずcold状態へ戻す。最新cold本文欠落と一時的な通信失敗を組み合わせた第11回帰で、本文・集合・baseline・outboxの保持と再起動後の復旧を確認する。

### 実ブラウザー測定

Chrome 155、実Worker・AES-GCM・IndexedDBを使い、通常サイズと安全率3倍を別processで測定した。合成本文のみを使い、個人データの本文は読んでいない。Google Drive通信は行わず、遅延0のメモリ上transportを使う。各工程の時間外で、入力と受信結果の全同期レコードを完全比較する。

| 入力 | JSON容量 | チャット数 | ノード数 |
|---|---:|---:|---:|
| 通常サイズ | 61,031,396 B | 795 | 13,107 |
| 安全率3倍 | 183,056,897 B | 2,385 | 39,321 |

| 工程 | 通常サイズ（秒） | 安全率3倍（秒） |
|---|---:|---:|
| 初回同期・自動checkpoint公開と検証 | 4.154 | 13.700 |
| 変更なし | 1.358 | 4.781 |
| タイトル編集 | 1.523 | 5.086 |
| 本文編集 | 1.523 | 4.945 |
| 本文共有 | 1.507 | 5.011 |
| 通常再起動 | 0.640 | 1.775 |
| 追加checkpoint公開と検証 | 2.337 | 7.759 |
| checkpoint後の再起動 | 0.552 | 1.515 |
| pack集約と読戻し | 2.590 | 7.204 |
| 新規ローカルDBからpack・checkpoint取得 | 2.422 | 8.087 |

全20工程で完全一致、Workerは1本、ブラウザークラッシュ・OOM署名なし。checkpoint後の再起動では両サイズともCommit本文読込・履歴再生・cloud checkpoint再検証が0回となった。新規DBではcloud checkpointを2件とも完全履歴照合した。

初回送信量は通常1,453,642 B、3倍4,377,007 B。このうちcheckpoint追加分は702,995 B／2,116,550 Bで、同量を公開検証のため読戻す。タイトル編集の送信量は両方220 B、本文編集は1,242 B。新規DBでは保持しているcheckpointも読むため、受信量は2,157,883 B／6,494,798 Bとなる。初回受信量を減らす仕組みとしては評価しない。

圧縮しやすい架空本文の単発測定であり、実エクスポートと同じ圧縮率やGoogle Drive上の所要時間は保証しない。実測した最大main-thread遅延は約189ms、Workerを含むprocess全体の最大メモリは未測定。起動し直す対象はEngineと同期専用DBで、同じpage内のWorkerキャッシュは残る。

修正前は183MBのcloud checkpoint検証でV8 OOMを2回再現し、`verifyCheckpoint`開始直後の停止を記録した。上記のWorker統合・JSON正規化削減後、同じ短縮5工程と最終の全10工程が通過した。別の途中測定ではViteによるソース再読込後にWorkerが2本へ増え、本文編集でOOMとなった。この途中結果は最終測定から除外し、新しいVite process・ソース固定・module URLとWorker数の記録を追加して再測定した。

再実行:

```sh
# 別terminalで先に起動
yarn dev --host 127.0.0.1 --port 5177 --strictPort
# 測定は1件ずつ実行
node scripts/benchmark-browser-sync.mjs --scale=1 --verify-pack
node scripts/benchmark-browser-sync.mjs --scale=3 --verify-pack
```

別terminalで開発サーバーを起動し、測定中はソースを更新しない。raw結果は[通常サイズ](browser-sync-checkpoint-scale1.json)、[安全率3倍](browser-sync-checkpoint-scale3.json)、[修正前のOOM再現](browser-sync-checkpoint-scale3-checkpoint-only-oom2.json)、[修正後の短縮確認](browser-sync-checkpoint-scale3-checkpoint-only-combined.json)、[Worker重複を伴う途中結果](browser-sync-checkpoint-scale3-combined.json)を参照。

全1,375テスト成功、任意benchmark 2件はskip。Web・Cloud Functions・Proxy WorkerのTypeScript検査と本番ビルドも成功した。
