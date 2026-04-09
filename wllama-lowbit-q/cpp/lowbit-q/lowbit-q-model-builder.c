/**
 * lowbit-q-model-builder.c — lowbit-Q tensor lookup for graph construction.
 *
 * Uses llama_get_model_tensor() from the public llama.cpp C API, which
 * searches all model weight contexts. This is safe for split models and
 * avoids the limitation of ggml_get_tensor() which only searches one context.
 */

#include "lowbit-q-model-builder.h"

#include <string.h>
#include <stdio.h>

/* Suffix constants matching the GGUF tensor naming convention */
static const char * SUFFIX_A    = ".lowbit_q_a";
static const char * SUFFIX_B    = ".lowbit_q_b";
static const char * SUFFIX_SIGN = ".lowbit_q_sign";

/* Legacy suffixes for pre-rename GGUF files (onebit → lowbit-q) */
static const char * LEGACY_SUFFIX_A    = ".onebit_a";
static const char * LEGACY_SUFFIX_B    = ".onebit_b";
static const char * LEGACY_SUFFIX_SIGN = ".onebit_sign";

/* Projection names for debug logging */
static const char * PROJ_NAMES[] = {
    "attn_q", "attn_k", "attn_v", "attn_output",
    "ffn_gate", "ffn_up", "ffn_down",
    NULL
};

struct lowbit_q_layer_tensors lowbit_q_lookup(
    const struct llama_model * model,
    const char * prefix)
{
    struct lowbit_q_layer_tensors result;
    memset(&result, 0, sizeof(result));

    /* Build full tensor names — try current suffixes first */
    char name_a[280], name_b[280], name_sign[280];
    snprintf(name_a,    sizeof(name_a),    "%s%s", prefix, SUFFIX_A);
    snprintf(name_b,    sizeof(name_b),    "%s%s", prefix, SUFFIX_B);
    snprintf(name_sign, sizeof(name_sign), "%s%s", prefix, SUFFIX_SIGN);

    /* Use llama_get_model_tensor() — searches all weight contexts.
     * The const cast is required because the C API takes non-const model. */
    result.a    = llama_get_model_tensor((struct llama_model *)model, name_a);
    result.b    = llama_get_model_tensor((struct llama_model *)model, name_b);
    result.sign = llama_get_model_tensor((struct llama_model *)model, name_sign);

    /* Fallback: try legacy onebit suffixes for pre-rename models */
    if (result.a == NULL || result.b == NULL || result.sign == NULL) {
        snprintf(name_a,    sizeof(name_a),    "%s%s", prefix, LEGACY_SUFFIX_A);
        snprintf(name_b,    sizeof(name_b),    "%s%s", prefix, LEGACY_SUFFIX_B);
        snprintf(name_sign, sizeof(name_sign), "%s%s", prefix, LEGACY_SUFFIX_SIGN);

        result.a    = llama_get_model_tensor((struct llama_model *)model, name_a);
        result.b    = llama_get_model_tensor((struct llama_model *)model, name_b);
        result.sign = llama_get_model_tensor((struct llama_model *)model, name_sign);
    }

    /* All three must be present for a valid lowbit-Q SVID layer */
    result.valid = (result.a != NULL && result.b != NULL && result.sign != NULL) ? 1 : 0;

    return result;
}

void lowbit_q_log_model_tensors(
    const struct llama_model * model,
    int n_layer)
{
    /* Check if this is a lowbit-Q model */
    char version_buf[16];
    if (llama_model_meta_val_str(model, "lowbit-q.version", version_buf, sizeof(version_buf)) < 0) {
        return; /* Not a lowbit-Q model */
    }

    fprintf(stderr, "@@INFO[lowbit-q] Scanning %d layers for SVID tensors...\n", n_layer);

    int svid_count  = 0;
    int other_count = 0;

    for (int il = 0; il < n_layer; il++) {
        for (int pi = 0; PROJ_NAMES[pi] != NULL; pi++) {
            char prefix[128];
            snprintf(prefix, sizeof(prefix), "blk.%d.%s", il, PROJ_NAMES[pi]);

            struct lowbit_q_layer_tensors lq = lowbit_q_lookup(model, prefix);
            if (lq.valid) {
                svid_count++;
                /* Only log SVID hits to keep output concise */
                fprintf(stderr, "@@INFO[lowbit-q]   %s → SVID_1BIT\n", prefix);
            } else {
                /* Check if standard weight exists */
                char weight_name[136];
                snprintf(weight_name, sizeof(weight_name), "%s.weight", prefix);
                struct ggml_tensor * w = llama_get_model_tensor(
                    (struct llama_model *)model, weight_name);
                if (w) {
                    other_count++;
                } else {
                    fprintf(stderr, "@@WARN[lowbit-q]   %s.weight — NOT FOUND\n", prefix);
                }
            }
        }
    }

    fprintf(stderr, "@@INFO[lowbit-q] Summary: %d SVID, %d native (Q4_0/passthrough)\n",
            svid_count, other_count);
}
