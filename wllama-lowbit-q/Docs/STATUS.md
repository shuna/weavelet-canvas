# lowbit-Q v2 実装ステータス

最終更新: 2026-04-09

## 概要

lowbit-Q v2 統一フォーマットの TypeScript 側パイプラインが実装完了。
同一 GGUF 内に PASSTHROUGH・Q4_0・SVID_1BIT が混在する mixed-bit モデルを
ブラウザ内で変換・出力できる状態。

## Phase 1: 統一フォーマット設計 — 完了

### メタデータスキーマ (GGUF KV)

| キー | 型 | 説明 |
|---|---|---|
| `lowbit-q.version` | uint32 | フォーマットバージョン (= 2) |
| `lowbit-q.source_model` | string | 変換元モデル名 |
| `lowbit-q.size_budget` | float32 | allocator のサイズ予算 (0.0–1.0) |
| `lowbit-q.tensor_alloc` | string | 全テンソル割当の正本 (JSON) |
| `lowbit-q.sign_packing` | string | サインビットのパック順序 |
| `lowbit-q.layers` | uint32[] | SVID 適用レイヤーインデックス |
| `lowbit-q.kv_cache.k_method` | string | K キャッシュ量子化方式 |
| `lowbit-q.kv_cache.k_bitwidth` | uint32 | K キャッシュビット幅 |
| `lowbit-q.kv_cache.v_method` | string | V キャッシュ量子化方式 |
| `lowbit-q.kv_cache.v_bitwidth` | uint32 | V キャッシュビット幅 |
| `lowbit-q.quality.nmse_mean` | float32 | 変換時 NMSE 平均 |
| `lowbit-q.quality.nmse_max` | float32 | 変換時 NMSE 最大値 |

### テンソル識別設計

識別子の配置方針:

- **SVID_1BIT**: ggml に存在しない独自テンソル型 → **独自名で識別**
  - `prefix.lowbit_q_a` / `prefix.lowbit_q_b` / `prefix.lowbit_q_sign`
- **Q4_0 / Q8_0 / F16 等**: ggml ネイティブ型 → **元の `.weight` 名を維持**
  - GGUF テンソルヘッダの GGML type コードで native kernel にディスパッチ
- **正本**: `lowbit-q.tensor_alloc` JSON metadata が全テンソルの割当記録

C++ ディスパッチ:

```
1. SVID 独自名を探す (lowbit_q_lookup)
2. なければ標準の .weight を引く → GGML type に応じて native kernel
```

### 型定義 (`types.ts`)

- `LowbitQQuantType` enum: `PASSTHROUGH | Q4_0 | Q8_0 | SVID_1BIT`
- `KVCacheQuantMethod` enum: `NONE | PER_CHANNEL | PER_TOKEN`
- `TensorAllocRecord`: 割当の正本レコード (name, quantType, family, layerIndex, ...)
- `LowbitQV2Metadata`: v2 GGUF メタデータ構造体
- `BitwidthAllocatorConfig`: allocator 設定 (sizeBudget, 各ファミリーの quant type)

## Phase 1a: C++/WASM ローディング — 完了 (2026-04-09)

### 実装内容

llama.cpp/wllama 側で lowbit-Q v2 GGUF を読み込み、SVID_1BIT と Q4_0/PASSTHROUGH の
mixed-bit モデルをクラッシュなく動作させるための C++ 実装を追加。

**新規 C++ ファイル**

| ファイル | 説明 |
|---|---|
| `cpp/lowbit-q/lowbit-q-metadata.h` | `lowbit-q.tensor_alloc` 読み込み C API |
| `cpp/lowbit-q/lowbit-q-metadata.c` | 手製 JSON パーサ、`llama_model_meta_val_str()` 使用 |

**API 変更 (`lowbit-q-model-builder.h/c`)**

`lowbit_q_lookup()` のシグネチャを変更:
```c
// 旧: ggml_context * → GGUF 読み込み後に単一コンテキストしか見えない問題
// 新: llama_model * → llama_get_model_tensor() で全コンテキストを検索可能
struct lowbit_q_layer_tensors lowbit_q_lookup(
    const struct llama_model * model, const char * prefix);
```

**パッチスクリプト**

| ファイル | 対象 | 内容 |
|---|---|---|
| `patches/0002-llama-loader-optional-weights.py` | `llama-model.cpp` | 7 投影テンソルを `TENSOR_NOT_REQUIRED` に変更。SVID 層は `.weight` テンソルを持たないため必須 |
| `patches/0003-llama-build-lowbit-q-dispatch.py` | `models/llama.cpp` | `llm_build_llama` に SVID ディスパッチを追加 (Q/K/V/O/FFN gate・up・down) |

**ディスパッチ方針 (patch 0003)**

各投影ごとに `lowbit_q_lookup()` で SVID テンソルを探し、
見つかれば `lowbit_q_build_mul_mat()`、なければ `build_lora_mm()` にフォールバック。

FFN は gate/up/down のいずれかが SVID の場合、`build_ffn()` をバイパスして
SiLU-gated MLP を手動で構築する。attn_output は `build_attn()` に `wo = nullptr`
を渡し、その後 SVID カーネルを適用する。

**setup.sh 更新**

- 6 ファイルをコピー (旧: 4 ファイル)
- CMakeLists.txt パッチに `lowbit-q-metadata.c` を追加
- Step 4a/4b として patch 0002/0003 を適用

**テストファイル**

`src/local-llm/lowbit-q/lowbit-q-v2-dispatch.test.ts` (新規):
- Suite 1: テンソル命名規約 (SVID → `.lowbit_q_a/b/sign`、Q4_0 → `.weight`)
- Suite 2: allocator → 命名の対応確認
- Suite 3: `tensor_alloc` JSON 形式と C パーサ定数との整合性
- Suite 4: mixed GGUF 構造不変条件 (同一プレフィックスに `.weight` と `.lowbit_q_sign` が共存しない等)

## Phase 2: 統一変換パイプライン — TypeScript 側完了・C++ 側未着手

### 実装済みコンポーネント

| コンポーネント | ファイル | 状態 |
|---|---|---|
| Bitwidth allocator | `allocator.ts` | 完了 (26 テスト) |
| Q4_0 RTN 量子化 | `q4_0Quantize.ts` | 完了 |
| v2 変換パイプライン | `convert.ts` (`convertToLowbitQV2Streaming`) | 完了 |
| v2 GGUF writer | `ggufWriter.ts` (`writeLowbitQV2GGUF`) | 完了 |
| Web Worker ルーティング | `lowbitQConversionWorker.ts` | 完了 (v2 デフォルト) |
| C++ SVID lookup | `lowbit-q-model-builder.c/h` | 完了 (Phase 1a 完了) |
| C++ メタデータ読み込み | `lowbit-q-metadata.c/h` | 完了 (Phase 1a 完了) |
| llama.cpp ローダーパッチ | `patches/0002` | 完了 (Phase 1a 完了) |
| llama.cpp ディスパッチパッチ | `patches/0003` | 完了 (Phase 1a 完了) |

### Bitwidth Allocator 詳細

3 つのプリセット設定:

| プリセット | sizeBudget | attnQK | attnVO | FFN | 推定比率 |
|---|---|---|---|---|---|
| DEFAULT | 0.27 | Q4_0 | SVID_1BIT | SVID_1BIT | ~25-30% |
| AGGRESSIVE | 0.20 | SVID_1BIT | SVID_1BIT | SVID_1BIT | ~20% |
| CONSERVATIVE | 0.38 | Q4_0 | Q4_0 | SVID_1BIT | ~35-40% |

全プリセットで共通: 第1層/最終層 → Q4_0、embedding/norm → PASSTHROUGH。

サイズ予算超過時の greedy 最適化 (3段階、5% トレランス):
1. attnVO → SVID_1BIT
2. attnQK → SVID_1BIT
3. 第1/最終層 → SVID_1BIT

### アーキテクチャ対応

`general.architecture` → `${arch}.block_count` による動的解決。
Llama, Qwen2, Gemma, Phi3 等に対応 (ハードコード排除済み)。

### Worker ルーティング

- デフォルト: v2 (mixed-bit) パイプライン
- v1 フォールバック: `convertMode` が明示設定かつ `allocatorConfig` 未設定の場合のみ

## Phase 1a 既知制約

### アーキテクチャ制約 (Phase 1b で対応予定)

C++ パッチ 0002/0003 は **LLAMA アーキテクチャのみ** を対象としている。
Qwen2, Gemma, Phi3 等の非 Llama モデルは `llm_build_X` グラフビルダーが別ファイルにあり、
パッチが当たっていない。

これによる問題を防ぐため、TypeScript 側 (`convertToLowbitQV2Streaming`) に
arch ガードを追加した (2026-04-09):
- `general.architecture === 'llama'` → SVID 割当を許可
- それ以外 → SVID → Q4_0 に強制オーバーライド (ローダーエラー防止)
- arch 不明 (メタデータなし) → 元の config を使用 (Llama GGUF の可能性が高い)

非 Llama への SVID 対応は各アーキ別に patch 0002b/0003b を書く必要あり。
Phase 1b のスコープとして扱う。

### メタデータキャッシュの単一モデル前提 (Phase 1b で要検討)

`lowbit_q_get_quant_type()` の静的キャッシュ (`s_cache`) は最後に見た
`llama_model *` のみを保持する。wllama プロトタイプ (同時に 1 モデルのみロード)
では問題ないが、マルチモデルセッションでは呼び出し順によって別モデルの
quant type を返す可能性がある。コード内に警告コメントを記載済み。

## 未実装 (Phase 1b: WASM ビルド検証)

- `setup.sh --build` による実際の WASM ビルド (Docker 必須)
- patch 0002/0003 が最新 llama.cpp に適用できることの実機確認
- `llama_get_model_tensor()` が期待通り SVID テンソルを返すことのブラウザ確認

## 未実装 (Phase 2 C++ 側)

- WebGPU ビルド有効化 (`-DGGML_WEBGPU=ON`)
- WGSL シェーダ (lowbit-Q カスタム型用)
- KV cache 量子化ランタイム (attention カーネル内)

## 未実装 (Phase 3)

- 回転前処理 (Hadamard, `applyRotation: true` は未実装エラー)
- TinyLlama-1.1B 品質検証
- サイズ vs 品質マップ
- 2-3 bit SVID 拡張

## 未実装 (Phase 4)

- Activation quantization (W4A8 → W4A4)

## テスト状況

108+ テスト (6 ファイル):
- `allocator.test.ts`: 26 テスト (固定ルール + 予算最適化)
- `lowbit-q.test.ts`: 32 テスト (変換 E2E)
- `tensorFilter.test.ts`: 22 テスト
- `qualityMetrics.test.ts`: 20 テスト
- `validation.test.ts`: 8 テスト
- `lowbit-q-v2-dispatch.test.ts`: Phase 1a C++ ディスパッチ契約テスト (Phase 1a 新規)

`tsc --noEmit` エラーなし。

## 既知の制約

- E2E 統合テスト (ブラウザ内変換 → WASM 推論) は未実施
- Q4_0 NMSE は変換時に未計測 (dequantize → requantize → dequantize が必要)
- KV cache パラメータはメタデータスキーマのみ (ランタイム未実装)
