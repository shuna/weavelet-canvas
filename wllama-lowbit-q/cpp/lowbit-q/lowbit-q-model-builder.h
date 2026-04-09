/**
 * lowbit-q-model-builder.h — lowbit-Q model graph construction.
 *
 * Provides helpers that intercept the llama.cpp model graph builder
 * to substitute build_lora_mm with lowbit_q_build_mul_mat for layers
 * that have lowbit-Q SVID tensor triplets (a, b, sign).
 *
 * Integration with wllama's action_load:
 *   After llama_model_load completes, call lowbit_q_detect_format()
 *   to check if the model is lowbit-Q (returns version > 0).
 *
 * Since llama.cpp does not expose a graph-builder hook, the integration
 * strategy is to patch the model's build function (llama.cpp/src/models/
 * llama.cpp, llm_build_llama constructor) and add lowbit-Q dispatch there.
 * This file provides the helper functions that the patched builder calls.
 *
 * See patches/0003-llama-build-lowbit-q-dispatch.patch for the exact changes.
 */

#ifndef LOWBIT_Q_MODEL_BUILDER_H
#define LOWBIT_Q_MODEL_BUILDER_H

#include "ggml.h"
#include "llama.h"
#include "lowbit-q-mul-mat.h"

#ifdef __cplusplus
#include <string>
extern "C" {
#endif

/**
 * Tensor name patterns for lowbit-Q SVID layers.
 *
 * For a layer like "blk.0.attn_q" the lowbit-Q SVID tensors are:
 *   blk.0.attn_q.lowbit_q_a
 *   blk.0.attn_q.lowbit_q_b
 *   blk.0.attn_q.lowbit_q_sign
 *
 * Q4_0 / PASSTHROUGH layers retain the standard name:
 *   blk.0.attn_q.weight   (GGML type Q4_0 or F16/BF16)
 *
 * The authoritative record of which type was assigned to each layer is
 * the "lowbit-q.tensor_alloc" JSON metadata (see lowbit-q-metadata.h).
 */

/**
 * Per-layer lowbit-Q SVID tensor triplet.
 * Resolved from the model during graph construction via lowbit_q_lookup().
 */
struct lowbit_q_layer_tensors {
    struct ggml_tensor * a;    /* fp16, (out_features,) — row scales */
    struct ggml_tensor * b;    /* fp16, (in_features,)  — column scales */
    struct ggml_tensor * sign; /* uint8, packed bits MSB-first, (ceil(out*in/8),) */
    int valid;                 /* 1 if all three tensors were found */
};

/**
 * Look up lowbit-Q SVID tensors for a given layer projection.
 *
 * Uses llama_get_model_tensor() which searches across all model weight
 * contexts — safe for split models and multiple ggml contexts.
 *
 * @param model   The loaded llama_model (read-only)
 * @param prefix  Tensor name prefix, e.g. "blk.0.attn_q"
 * @return        Struct with the three tensors, or valid=0 if not found
 *
 * v2 dispatch pattern (patched model builder):
 *
 *   // Q projection: try SVID, fall back to standard
 *   struct lowbit_q_layer_tensors lq;
 *   {
 *       char pfx[64];
 *       snprintf(pfx, sizeof(pfx), "blk.%d.attn_q", il);
 *       lq = lowbit_q_lookup(&model, pfx);
 *   }
 *   ggml_tensor * Qcur = lq.valid
 *       ? lowbit_q_build_mul_mat(ctx0, lq.a, lq.b, lq.sign, cur)
 *       : build_lora_mm(model.layers[il].wq, cur);
 *
 * Identification rules (from "lowbit-q.tensor_alloc" metadata):
 *   .lowbit_q_sign exists       → SVID_1BIT (this function returns valid=1)
 *   .weight exists, type=Q4_0   → Q4_0 re-quantized (ggml native kernel)
 *   .weight exists, other type  → PASSTHROUGH (ggml native kernel)
 */
struct lowbit_q_layer_tensors lowbit_q_lookup(
    const struct llama_model * model,
    const char * prefix);

/**
 * Log all lowbit-Q SVID tensors found in the model to stderr.
 * Format: "@@INFO[lowbit-q] blk.N.proj_name: SVID / Q4_0 / not found"
 * No-op if model has no lowbit-Q metadata.
 *
 * @param model   The loaded llama_model
 * @param n_layer Number of transformer layers to check
 */
void lowbit_q_log_model_tensors(
    const struct llama_model * model,
    int n_layer);

#ifdef __cplusplus
}
#endif

/* C++ convenience overloads using std::string prefix */
#ifdef __cplusplus
inline struct lowbit_q_layer_tensors lowbit_q_lookup(
    const struct llama_model * model,
    const std::string & prefix)
{
    return lowbit_q_lookup(model, prefix.c_str());
}
#endif

#endif /* LOWBIT_Q_MODEL_BUILDER_H */
