# Web S0 検証基準

2026-10-11 JST。既存機能維持を前提とした現状記録。製品コードは変更せず、Webのソースコピーに対して検証した。全検査が成功した基準ではなく、既存失敗と未確認を含む基準である。

## 基準の固定

- HEAD: `02d5e8e78c03d77004a1a24d90d5874cdc030742`。
- 作業中のBranchEditor変更4ファイル、新規BranchStepEdge本体とテスト、MessageDetailModal/layoutテストも含めた768ファイルのコピー。
- source manifest digest: `d127ad43698894b4c9d36d128f284a5d72c370b6c8e27765551abe1eb531b9da`。各パスとSHA-256をキー順JSONへ並べ、再度SHA-256を計算した。
- iOS、docs、README画像、Git管理外の環境変数・生成物はコピー対象外。node_modulesは既存インストールを参照し、依存を再installしていない。
- コピー、全manifest、生ログは `/var/folders/1r/xtsjvqk90yzdyjq5jfjn9phw0000gn/T/weavelet-s01-v35nrtrx/`。一時保存であり恒久アーカイブではない。数値と検査要約は[baseline.json](baseline.json)に保存。
- これは作業ツリーの検証基準。並行変更が統合されたcommitのリリース基準ではない。実装開始前に着地先commitと差分を比較し、変わった範囲だけ検証し直す。

環境: Apple M4、16 GiB、macOS 27.0.1、Node 26.7.0、TypeScript 4.9.5、Vite 4.1.4、Vitest 4.0.18、Playwright 1.59.1、Chrome 154。個人のブラウザデータは使わず、新しい一時browser contextを使用。

## 実行結果

| 検査 | 結果 | 限界 |
| --- | --- | --- |
| 全Vitest | 86ファイル、867件中865成功・1失敗・1skip、8.095秒 | 失敗を除外して再実行する操作はしていない |
| Web `tsc --noEmit` | 成功、3.892秒 | 現在インストールされた依存による |
| functions `tsc -p functions/tsconfig.json --noEmit` | 成功、0.240秒 | 実認証接続は含まない |
| Proxy `tsc -p proxy-worker/tsconfig.json --noEmit` | 実行環境不適合 | root TS4.9では`moduleResolution: bundler`を解釈不可。Proxyは別packageでTS5.3系を要求し、そのnode_modules未導入 |
| `vite build` | 成功、6.024秒 | `/tmp`側へ出力。prebuildの`yarn install`は実行していない |
| Playwright 3ファイル | 5件成功、0失敗、13.677秒 | swipe、表示更新、OpenRouter設定。推論/実同期/全UIの検証ではない |

失敗は `src/hooks/submitRuntime.test.ts:931` の `builds the local prompt from the full prepared context`。旧 `buildLocalPromptFromContext` の呼出を期待しているが、現実装 `submitRuntime.ts:606` は `buildLocalChatMessages` と構造化messagesを使用する。観測は「呼出回数0による失敗」。テスト更新時は単に期待を消さず、Workerへ渡る全履歴・system prompt・assistantPrefixを検証する。現在の失敗だけから、その全履歴保証が実動作で成立しているとは結論しない。

skipは`SYNC_BENCH`で有効化するGoogle同期の32 MiB合成ベンチマーク（fake IDB/Drive transport、模擬遅延）で、今回は未実行。実接続を伴う大容量同期も別途未確認。Proxyの型検査失敗は製品の型エラーと区別し、専用依存を固定してから確認する。

## 検証の再実行

既存依存を用いた今回のコマンド。`npm run build`はprebuildで依存を再installするため、型検査とbundleを分離した。

```sh
node_modules/.bin/vitest run
node_modules/.bin/tsc --noEmit
node_modules/.bin/tsc -p functions/tsconfig.json --noEmit
node_modules/.bin/vite build --outDir /tmp/weavelet-s0-dist
```

別terminalで同じソースに対し `node_modules/.bin/vite --host 127.0.0.1 --port 5175 --strictPort` を起動する。既存の5175 listenerを停止しない。

```sh
PLAYWRIGHT_CHROME_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node_modules/.bin/playwright test tests/message-branch-swipe.spec.ts tests/display-refresh.spec.ts tests/openrouter-settings.spec.ts --workers=1 --reporter=json --output=/tmp/weavelet-s0-playwright
node docs/development/reports/web-s0/browser-baseline.cjs /tmp/weavelet-s0-browser.json
```

クリーンinstall/CIの確定方針はルート`packageManager: yarn@1.22.22`に合わせ、Yarn 1.22.22のfrozen-lockfileを使用する。Proxyは別packageの依存/lockを使う。Node版は今回の26.7.0を測定環境として記録するが、現在のdesktop workflowのNode20から無検証で切り替えない。PR workflow追加、lockfile片方の削除、Node更新は今回行っておらず、実装前の基準整備でクリーンinstallを通して版を固定する。依存更新をリファクタリングと混ぜない。

## ブラウザ内マイクロベンチマーク

合成50会話×100ノード、計5,000ノード。各本文は識別子と`synthetic text `の64回反復、50件だけneedleを含む。外部API・モデルdownload・実データを使わない。各処理を1回warm-up後、検索とmaterializeを20回、gzipを10回実行した。検索件数、path長、gzip往復一致をassertしている。

| 対象 | p50 ms | p95 ms |
| --- | ---: | ---: |
| 全5,000ノード検索 | 4.270 | 4.885 |
| 全50会話のactivePath materialize | 0.115 | 0.140 |
| snapshot gzip | 20.875 | 31.905 |
| snapshot gunzip | 6.155 | 12.550 |

入力5,752,956 bytes、gzip160,093 bytes。これは関数単位の目安であり、DOM描画、IndexedDB保存、起動、モデルload、TTFT、peak memoryを測った値ではない。再現用ソースは[browser-baseline.cjs](browser-baseline.cjs)、全サンプルは[baseline.json](baseline.json)。小さい標本のため絶対性能保証には使わない。

同条件の実装前後を比較し、検索/materializeはp95増分が`max(基準の20%, 1ms)`、codecは`max(基準の20%, 5ms)`を超えた場合だけ追加切り分けする。これは退行調査を始める閾値であり、機能の合否を遅くても許容する基準ではない。

## 実装前の残るゲート

1. 既存の全履歴テスト失敗を実Worker入力の意味で直す。旧期待の削除だけでは解消扱いにしない。
2. 並行変更が着地したcommit、クリーンinstall、Proxy専用TS、Web PR検査を固定する。現在の作業ツリー基準と混同しない。
3. A/Bの直接操作、Cの評価・復旧競合、Dのruntime/OPFS競合には未整備テストがある。[S0/S1契約書](../../plans/app/web-s0-s1-contracts.md)の受入ケースを実装単位ごとに追加する。
4. IME/draft/drag、巨大treeのDOM描画、モデル実load/TTFT/peak memory、実同期は未測定。対象の実装を始める前に同じfixture・端末・モデルchecksumで基準を取り、変更後と比較する。モデルの新規downloadや有料API呼出をこの調査のために追加していない。

S0の現状・再現手順とS1の静的設計を監査することと、これらの実行ゲートが全て通ることは別である。
