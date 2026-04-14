# wllama-lowbit-q — lowbit-Q Inference Backend for wllama

wllama (llama.cpp WASM) に 1-bit 量子化推論カーネルを追加するためのパッチセット。

## ディレクトリ構成

```
wllama-lowbit-q/
├── README.md               ← このファイル
├── WLLAMA_VERSION           ← 対象 wllama バージョン (2.3.7)
├── setup.sh                 ← セットアップスクリプト (clone → patch → build)
├── cpp/lowbit-q/            ← 独自 C ソース (新規ファイル、パッチではない)
│   ├── lowbit-q-mul-mat.h   ← カーネル API 宣言
│   ├── lowbit-q-mul-mat.c   ← lowbit-Q matmul カーネル実装
│   ├── lowbit-q-model-builder.h  ← モデルローダーヘルパー宣言
│   └── lowbit-q-model-builder.c  ← lowbit-Q テンソル検索
└── patches/                 ← 既存ファイルへの変更 (git apply 可能)
    └── 0001-cmake-add-lowbit-q-sources.patch  ← CMakeLists.txt への差分
```

### 設計方針

- **独自ソース (`cpp/lowbit-q/`)**: wllama/llama.cpp の既存ファイルを一切変更しない独立モジュール。
  upstream のアップデートと衝突しない。
- **パッチ (`patches/`)**: CMakeLists.txt にビルドターゲットを追加する最小差分のみ。
- **ggml.h 変更不要**: `ggml_map_custom3_inplace` API を使用し、op enum の追加なしで
  カスタム演算を登録。upstream llama.cpp の更新に追従しやすい。

## セットアップ手順

### 前提条件

- git
- Docker (Docker ビルド時のみ)

### 自動セットアップ

```bash
# クローン + パッチ適用のみ
./wllama-lowbit-q/setup.sh

# クローン + パッチ適用 + WASM ビルド (Docker)
./wllama-lowbit-q/setup.sh --build
```

`setup.sh` は以下を実行する:

1. wllama v2.3.7 を `.wllama-fork/` にクローン
2. llama.cpp サブモジュールを初期化
3. `cpp/lowbit-q/` のソースをフォークにコピー
4. パッチを適用 (0001: CMakeLists, 0002: ローダー, 0003: グラフビルダー)
5. (--build 指定時) Docker 経由で WASM をビルド

### 手動セットアップ

```bash
# 1. wllama をクローン
git clone --depth 1 --branch v2.3.7 https://github.com/nicekid1/Wllama.git .wllama-fork
cd .wllama-fork
git submodule update --init --depth 1

# 2. lowbit-Q ソースをコピー
mkdir -p cpp/lowbit-q
cp ../wllama-lowbit-q/cpp/lowbit-q/* cpp/lowbit-q/

# 3. CMakeLists.txt を編集 (パッチ参照または手動)
#    - LOWBIT_Q_SRC 変数を追加
#    - include_directories に cpp/lowbit-q と llama.cpp/ggml/include を追加
#    - add_executable に ${LOWBIT_Q_SRC} を追加

# 4. WASM ビルド (Docker)
bash scripts/build_wasm.sh
```

## ローカルビルド (Emscripten)

Docker を使わずローカルの Emscripten でビルドする手順。

### 前提条件

- git
- cmake (`brew install cmake`)
- python3
- Emscripten SDK (emsdk) **4.0.3**

> **重要**: wllama v2.3.7 は emsdk 4.0.3 でビルドされている。
> バージョンが異なると `-fwasm-exceptions` の ABI 非互換などにより実行時エラーが発生する。

### emsdk のインストール

```bash
# emsdk をクローン
git clone https://github.com/nicekid1/emsdk.git ~/emsdk
cd ~/emsdk

# バージョン 4.0.3 をインストール・有効化
./emsdk install 4.0.3
./emsdk activate 4.0.3

# 環境変数を設定 (毎回のシェル起動時に必要)
source ~/emsdk/emsdk_env.sh
```

### ビルド手順

```bash
# 1. セットアップ (クローン + パッチ適用)
./wllama-lowbit-q/setup.sh

# 2. Emscripten 環境を有効化
source ~/emsdk/emsdk_env.sh

# 3. ローカルビルド (4 バリアントすべて)
./wllama-lowbit-q/build-local.sh
```

### ビルド出力

`build-local.sh` は以下の 4 バリアントを `vendor/wllama/` に出力する:

| ファイル | アドレッシング | スレッド | 用途 |
|---------|-------------|---------|------|
| `single-thread.wasm` | Memory64 (64-bit) | シングル | モデル >2GB 対応、SharedArrayBuffer 非対応ブラウザ |
| `multi-thread.wasm` | Memory64 (64-bit) | マルチ | モデル >2GB 対応、標準構成 |
| `single-thread-compat.wasm` | 32-bit | シングル | Memory64 非対応ブラウザ向け (最大 ~2GB) |
| `multi-thread-compat.wasm` | 32-bit | マルチ | Memory64 非対応ブラウザ向け (最大 ~2GB) |

`wllamaWorker.ts` がブラウザの `WebAssembly.Memory({ memory64: true })` サポートを検出し、
自動的に Memory64 / compat バリアントを切り替える。

### ⚠️ WASM と JS グルーコードの整合性

**これは最も重要な制約**。WASM バイナリと `vendor/wllama/index.js` 内の JS グルーコードは
Emscripten が同時に生成するペアであり、必ず一致させる必要がある。

```
vendor/wllama/
├── index.js              ← WLLAMA_SINGLE_THREAD_CODE / WLLAMA_MULTI_THREAD_CODE を含む
├── single-thread.wasm    ← index.js の JS グルーと対応
├── multi-thread.wasm     ← index.js の JS グルーと対応
├── single-thread-compat.wasm
└── multi-thread-compat.wasm
```

- `.wasm` ファイルだけを差し替えると、**モデル読み込みがハングする**。
- WASM を再ビルドした場合は、`index.js` 内の JS グルーコード
  (`WLLAMA_SINGLE_THREAD_CODE`, `WLLAMA_MULTI_THREAD_CODE`) も
  Emscripten が出力した新しいものに更新すること。
- 現在リポジトリにコミットされている Memory64 WASM (`single-thread.wasm`, `multi-thread.wasm`) は
  wllama upstream が提供するビルド済みバイナリ。compat バリアントのみローカルビルド。

## カーネル実装の詳細

### 演算: OneBit 分解 matmul

```
out[batch][i] = a[i] * Σ_j( sign[i,j] * b[j] * x[batch][j] )
```

| テンソル | 型 | 形状 | 説明 |
|---------|------|------|------|
| `a` | fp16 | (out_features,) | 行スケーリングベクトル |
| `b` | fp16 | (in_features,) | 列スケーリングベクトル |
| `sign` | uint8 | (⌈out×in/8⌉,) | パックド符号ビット (MSB first) |
| `x` | f32 | (in_features[, batch]) | 入力活性化 |

### 最適化

1. **x の b 前乗算**: `x_scaled[j] = x[j] * b[j]` を各バッチで 1 回だけ計算
2. **条件付き加減算**: 内部ループは乗算なし（ビット判定 → 加算 or 減算）
3. **バイトアラインド高速パス**: 行ビットオフセットがバイト境界の場合、8 要素を一括展開
4. **WASM SIMD**: `__wasm_simd128__` 検出時にバイト単位で 8 要素処理
5. **スレッド並列化**: 出力行を ggml スレッド間で分割

### ggml 統合方式

`ggml_map_custom3_inplace` を使用:

```c
result = ggml_map_custom3_inplace(ctx, a, b, sign, callback, GGML_N_TASKS_MAX, NULL);
result->src[3] = x;  // 入力活性化を src[3] に格納
```

この方式は ggml.h の変更が不要。`ggml_map_custom3_inplace` は既存の public API。

## wllama バージョン更新時の手順

1. `WLLAMA_VERSION` を新バージョンに更新
2. `setup.sh` を実行して新バージョンにパッチが適用されるか確認
3. CMakeLists.txt のパッチが適用できない場合:
   - 新しい CMakeLists.txt を確認
   - `patches/0001-cmake-add-lowbit-q-sources.patch` を更新
   - または `setup.sh` 内の `sed` コマンドを調整
4. `ggml_map_custom3_inplace` API の互換性を確認
5. WASM をリビルド

独自ソース (`cpp/lowbit-q/`) は wllama/llama.cpp の内部実装に依存しないため、
通常はバージョン更新時に変更不要。
