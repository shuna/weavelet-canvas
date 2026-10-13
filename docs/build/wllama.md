# wllama WASM ビルド手順

weavelet-canvas の wllama WASM バイナリおよび JS バンドルを再ビルドする手順です。
プロジェクト全体の構成は [BUILD.md](../../BUILD.md) を参照してください。

## ディレクトリ構成

| パス | 役割 |
|------|------|
| `vendor/wllama-src/` | ビルド作業ツリー（gitignore 済み、`setup.sh` が生成） |
| `vendor/wllama-patches/` | upstream に対する独自差分（git 追跡） |
| `vendor/wllama/` | 配布物専用（WASM バイナリ 8 種、各種ドキュメント） |
| `src/vendor/wllama/index.js` | Web アプリが import するランタイムバンドル |

## セットアップ

初回のセットアップ:

```bash
bash scripts/wllama/setup.sh
```

このスクリプトは公式 `2.3.7` を取得し、commit `5e63e3b226a077b33dc7c608f1fe630f3d21f539` と照合してから `vendor/wllama-patches/` の差分を適用します。取得失敗時に HEAD へ切り替えません。既存 `vendor/wllama-src/` がある場合は変更せず停止します。再セットアップは既存sourceを保全した別checkoutで行ってください。lowbit-Qの単独setupも同じ制約に従います。

## WASM ビルド

```bash
# compat バリアントのみ (emsdk ローカル)
bash scripts/wllama/build.sh

# WebGPU バリアントも含める
WLLAMA_BUILD_WEBGPU=1 bash scripts/wllama/build.sh

# emdawnwebgpu をローカルパスで指定する場合
WLLAMA_BUILD_WEBGPU=1 EMDAWNWEBGPU_DIR=/path/to/emdawnwebgpu_pkg bash scripts/wllama/build.sh
```

全8バリアントとABI別JS glueを同時に更新する場合:

```bash
WLLAMA_SYNC_VENDOR_JS=1 WLLAMA_BUILD_WEBGPU=1 WLLAMA_BUILD_WEBGPU_ASYNCIFY=1 bash scripts/wllama/build.sh
```

2026-10-13の再生成は公式emsdk 5.0.5（隔離配置）、wllama `2.3.7` / `5e63e3b226a077b33dc7c608f1fe630f3d21f539`、llama.cpp `4abef75f2cf2eee75eb5083b30a94cf981587394` に追跡済みpatch 0001–0007を適用して実行しました。0007は公式commit `4e5b83b226919c146fbfa754641a6772bcb2d722` のGGUF byte-size overflow修正です。CPU compat/Memory64・WebGPU JSPI/AsyncifyのST/MT、全8 WASMと4種glueを生成し、既存 `tests/wasm-all-variants.spec.ts` のモデルパスだけを隔離コピーでtiny実モデルに差し替え、Chromiumで全8件のload・推論・exitを確認しました。モデルは配布物に含めません。Firefox/Safari・大モデル・既存OPFS実データの動作はこの再生成では未確認です。

## ワーカーコード差し替え (JS のみ更新)

`src/vendor/wllama/index.js` はプロジェクト独自拡張（`loadModelFromOpfs` 等）を含む
事前ビルド済みバンドルです。`npm run build:tsup` を `vendor/wllama-src` 内で実行して
このファイルを全体上書きすると独自拡張が失われます。

`LLAMA_CPP_WORKER_CODE` 定数のみを更新するには:

1. `vendor/wllama-src/src/workers-code/llama-cpp.js` を編集
2. 以下を実行:

   ```bash
   bash scripts/wllama/update-worker.sh
   ```

このスクリプトが `npm run build:worker` の実行と `LLAMA_CPP_WORKER_CODE` の置換を
一括で行います。

## 詳細手順

WASM バイナリのビルド、JS グルーへのパッチ適用、成果物のコピー、検証スクリプトの詳細は
[vendor/wllama/WASM-BUILD.md](../../vendor/wllama/WASM-BUILD.md) を参照してください。

設計方針と各バリアントの仕様は
[vendor/wllama/SpecAndStatus.md](../../vendor/wllama/SpecAndStatus.md) を参照してください。

## 関連ドキュメント

- [BUILD.md](../../BUILD.md) — プロジェクト全体のビルド対象一覧
- [docs/build/web.md](./web.md) — Web 版のビルド手順
- [vendor/wllama/WASM-BUILD.md](../../vendor/wllama/WASM-BUILD.md) — WASM ビルド詳細
- [vendor/wllama-patches/README.md](../../vendor/wllama-patches/README.md) — パッチ管理方針
