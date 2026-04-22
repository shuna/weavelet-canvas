# vendor/wllama-patches

このディレクトリは、`vendor/wllama/` を再ビルドするために必要な
「upstream に対する差分」だけを保持する場所です。

## 方針

- upstream 本体はここに置かない
- `vendor/wllama-src/` はローカル作業ツリーとして扱う（gitignore 済み）
- 再ビルドに必要な修正は、最終的にこのディレクトリへ集約する
- low-bit-q 専用差分はここではなく `vendor/wllama/lowbit-q/` 直下に置く
- パッチは**責務ごとに統合**する。番号は並び順でありカテゴリではない（責務が増えたら末尾に追加）
- パッチパスは wllama ルート基準（submodule ファイルは `llama.cpp/...` プレフィックス）

## パッチ一覧

| # | ファイル | 責務 | 主な対象 |
|---|---|---|---|
| 0001 | `worker-memory-and-exports.patch` | worker JS グルー: マルチスレッド memory 選択、wllama 直接 exports、Memory64 BigInt 対応、エラーハンドラ | `src/workers-code/llama-cpp.js` |
| 0002 | `emsdk5-compat.patch` | emsdk 5 互換: `sbrk` の uintptr 化、wasm64 向け `aligned_alloc` | `cpp/wllama.cpp`, `llama.cpp/ggml/src/ggml-backend.cpp` |
| 0003 | `persistent-threadpool.patch` | Emscripten Asyncify デッドロック回避（永続スレッドプール） | `cpp/actions.hpp` |
| 0004 | `webgpu-jspi.patch` | WebGPU + JSPI: `TimedWaitAny`、Emscripten 内蔵 `emdawnwebgpu` ポートへのフォールバック | `llama.cpp/ggml/src/ggml-webgpu/ggml-webgpu.cpp`, `llama.cpp/ggml/src/ggml-webgpu/CMakeLists.txt` |
| 0005 | `opfs-model-loading.patch` | OPFS 直接ロード: `preflightInit` / `loadModelFromOpfs` / worker 側 OPFS setup・cleanup・stats | `src/wllama.ts`, `src/worker.ts` |

## セットアップ手順

```bash
# vendor/wllama-src/ をセットアップし差分を適用してビルド準備する
bash scripts/wllama/setup.sh

# WASM をビルドして vendor/wllama/ に出力する
bash scripts/wllama/build.sh
```
