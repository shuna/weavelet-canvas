#!/usr/bin/env python3
"""
0003-llama-build-lowbit-q-dispatch.py

Patches llama.cpp/src/models/llama.cpp to add lowbit-Q SVID dispatch in
the llm_build_llama constructor.

For each projection layer (Q, K, V, O, FFN gate/up/down), the patch:
  1. Looks up SVID tensors (a, b, sign) by prefix via lowbit_q_lookup()
  2. If found: routes to lowbit_q_build_mul_mat() (custom SIMD kernel)
  3. If not found: falls through to the standard build_lora_mm() path

Dispatch rules:
  Q, K, V   — replace build_lora_mm(model.layers[il].wX, cur) directly
  O (attn_output) — pass nullptr to build_attn when SVID, apply manually after
  FFN       — bypass build_ffn entirely when any of gate/up/down is SVID;
              manually compute SiLU-gated FFN with custom kernels

The patch adds the lowbit-Q headers include and a one-time setup call.
It is scoped to the LLAMA architecture builder and does NOT touch other
model families (Qwen2, Gemma, etc.) — those require separate patches.
"""

import re
import sys
import os

# ---------------------------------------------------------------------------
# Code fragments to inject
# ---------------------------------------------------------------------------

# Header includes to add after the first #include in models/llama.cpp
INCLUDES_MARKER  = '#include "llm-graph.h"'
INCLUDES_TO_ADD  = """\
#include "lowbit-q/lowbit-q-model-builder.h"
#include "lowbit-q/lowbit-q-metadata.h"
"""

# Detect if already patched
PATCH_SENTINEL = "lowbit-q/lowbit-q-model-builder.h"

# Replace: ggml_tensor * Qcur = build_lora_mm(model.layers[il].wq, cur);
OLD_QCUR = "ggml_tensor * Qcur = build_lora_mm(model.layers[il].wq, cur);"
NEW_QCUR = """\
// lowbit-Q dispatch: try SVID first, fall back to native Q4_0 path
            ggml_tensor * Qcur;
            {
                char lq_pfx[64];
                snprintf(lq_pfx, sizeof(lq_pfx), "blk.%d.attn_q", il);
                struct lowbit_q_layer_tensors lq = lowbit_q_lookup(&model, lq_pfx);
                Qcur = lq.valid
                    ? lowbit_q_build_mul_mat(ctx0, lq.a, lq.b, lq.sign, cur)
                    : build_lora_mm(model.layers[il].wq, cur);
            }"""

# Replace: ggml_tensor * Kcur = build_lora_mm(model.layers[il].wk, cur);
OLD_KCUR = "ggml_tensor * Kcur = build_lora_mm(model.layers[il].wk, cur);"
NEW_KCUR = """\
ggml_tensor * Kcur;
            {
                char lq_pfx[64];
                snprintf(lq_pfx, sizeof(lq_pfx), "blk.%d.attn_k", il);
                struct lowbit_q_layer_tensors lq = lowbit_q_lookup(&model, lq_pfx);
                Kcur = lq.valid
                    ? lowbit_q_build_mul_mat(ctx0, lq.a, lq.b, lq.sign, cur)
                    : build_lora_mm(model.layers[il].wk, cur);
            }"""

# Replace: ggml_tensor * Vcur = build_lora_mm(model.layers[il].wv, cur);
OLD_VCUR = "ggml_tensor * Vcur = build_lora_mm(model.layers[il].wv, cur);"
NEW_VCUR = """\
ggml_tensor * Vcur;
            {
                char lq_pfx[64];
                snprintf(lq_pfx, sizeof(lq_pfx), "blk.%d.attn_v", il);
                struct lowbit_q_layer_tensors lq = lowbit_q_lookup(&model, lq_pfx);
                Vcur = lq.valid
                    ? lowbit_q_build_mul_mat(ctx0, lq.a, lq.b, lq.sign, cur)
                    : build_lora_mm(model.layers[il].wv, cur);
            }"""

# Replace: the build_attn call that passes model.layers[il].wo
# Original:
#   cur = build_attn(inp_attn,
#           model.layers[il].wo, model.layers[il].bo,
#           Qcur, Kcur, Vcur, nullptr, nullptr, nullptr, kq_scale, il);
OLD_ATTN = """\
cur = build_attn(inp_attn,
                    model.layers[il].wo, model.layers[il].bo,
                    Qcur, Kcur, Vcur, nullptr, nullptr, nullptr, kq_scale, il);"""
NEW_ATTN = """\
// lowbit-Q: check if output projection (attn_output) is SVID
            struct lowbit_q_layer_tensors lq_wo;
            {
                char lq_pfx[64];
                snprintf(lq_pfx, sizeof(lq_pfx), "blk.%d.attn_output", il);
                lq_wo = lowbit_q_lookup(&model, lq_pfx);
            }
            cur = build_attn(inp_attn,
                    lq_wo.valid ? nullptr : model.layers[il].wo, model.layers[il].bo,
                    Qcur, Kcur, Vcur, nullptr, nullptr, nullptr, kq_scale, il);
            // Apply SVID output projection if wo was SVID
            if (lq_wo.valid) {
                cur = lowbit_q_build_mul_mat(ctx0, lq_wo.a, lq_wo.b, lq_wo.sign, cur);
                if (model.layers[il].bo) {
                    cur = ggml_add(ctx0, cur, model.layers[il].bo);
                }
            }"""

# Replace: the build_ffn call (non-MoE branch)
# Original:
#   cur = build_ffn(cur,
#           model.layers[il].ffn_up,   model.layers[il].ffn_up_b,   NULL,
#           model.layers[il].ffn_gate, model.layers[il].ffn_gate_b, NULL,
#           model.layers[il].ffn_down, model.layers[il].ffn_down_b, NULL,
#           NULL,
#           LLM_FFN_SILU, LLM_FFN_PAR, il);
OLD_FFN = """\
cur = build_ffn(cur,
                    model.layers[il].ffn_up,   model.layers[il].ffn_up_b,   NULL,
                    model.layers[il].ffn_gate, model.layers[il].ffn_gate_b, NULL,
                    model.layers[il].ffn_down, model.layers[il].ffn_down_b, NULL,
                    NULL,
                    LLM_FFN_SILU, LLM_FFN_PAR, il);"""
NEW_FFN = """\
// lowbit-Q: check if any FFN tensor is SVID_1BIT
            {
                char pfx_up[64], pfx_gate[64], pfx_down[64];
                snprintf(pfx_up,   sizeof(pfx_up),   "blk.%d.ffn_up",   il);
                snprintf(pfx_gate, sizeof(pfx_gate), "blk.%d.ffn_gate", il);
                snprintf(pfx_down, sizeof(pfx_down), "blk.%d.ffn_down", il);
                struct lowbit_q_layer_tensors lq_up   = lowbit_q_lookup(&model, pfx_up);
                struct lowbit_q_layer_tensors lq_gate = lowbit_q_lookup(&model, pfx_gate);
                struct lowbit_q_layer_tensors lq_down = lowbit_q_lookup(&model, pfx_down);

                if (lq_up.valid || lq_gate.valid || lq_down.valid) {
                    // SVID FFN: manual SiLU-gated MLP
                    ggml_tensor * ffn_inp_cur = cur; // already normed above
                    ggml_tensor * up_out = lq_up.valid
                        ? lowbit_q_build_mul_mat(ctx0, lq_up.a, lq_up.b, lq_up.sign, ffn_inp_cur)
                        : (model.layers[il].ffn_up   ? build_lora_mm(model.layers[il].ffn_up,   ffn_inp_cur) : ffn_inp_cur);
                    cb(up_out, "ffn_up", il);
                    ggml_tensor * gate_out = lq_gate.valid
                        ? lowbit_q_build_mul_mat(ctx0, lq_gate.a, lq_gate.b, lq_gate.sign, ffn_inp_cur)
                        : (model.layers[il].ffn_gate ? build_lora_mm(model.layers[il].ffn_gate, ffn_inp_cur) : ffn_inp_cur);
                    cb(gate_out, "ffn_gate", il);
                    gate_out = ggml_silu(ctx0, gate_out);
                    ggml_tensor * combined = ggml_mul(ctx0, gate_out, up_out);
                    cur = lq_down.valid
                        ? lowbit_q_build_mul_mat(ctx0, lq_down.a, lq_down.b, lq_down.sign, combined)
                        : (model.layers[il].ffn_down ? build_lora_mm(model.layers[il].ffn_down, combined) : combined);
                    cb(cur, "ffn_out", il);
                } else {
                    cur = build_ffn(cur,
                            model.layers[il].ffn_up,   model.layers[il].ffn_up_b,   NULL,
                            model.layers[il].ffn_gate, model.layers[il].ffn_gate_b, NULL,
                            model.layers[il].ffn_down, model.layers[il].ffn_down_b, NULL,
                            NULL,
                            LLM_FFN_SILU, LLM_FFN_PAR, il);
                    cb(cur, "ffn_out", il);
                }
            }"""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def normalize_ws(s: str) -> str:
    """Collapse whitespace sequences for fuzzy matching."""
    return re.sub(r'\s+', ' ', s).strip()

def find_and_replace(src: str, old: str, new: str, label: str) -> tuple[str, bool]:
    """Replace old fragment in src. Tries exact match first, then ws-normalized."""
    if old in src:
        return src.replace(old, new, 1), True

    # Try whitespace-normalized search
    norm_old = normalize_ws(old)
    lines = src.splitlines(keepends=True)
    # Build sliding window of lines, try to find a match
    window_size = old.count('\n') + 2
    for start in range(len(lines)):
        end = min(start + window_size + 2, len(lines))
        chunk = "".join(lines[start:end])
        if normalize_ws(chunk).startswith(normalize_ws(old.splitlines()[0])):
            # Check longer match
            norm_chunk = normalize_ws("".join(lines[start:end]))
            if norm_old in norm_chunk:
                # Found! Rebuild the source with replacement
                new_src = src[:sum(len(l) for l in lines[:start])]
                new_src += new
                new_src += src[sum(len(l) for l in lines[:end]):]
                return new_src, True

    print(f"    WARNING: could not find pattern for '{label}' (ws-normalized search also failed)")
    return src, False

# ---------------------------------------------------------------------------
# Main patcher
# ---------------------------------------------------------------------------

def patch_file(path: str) -> bool:
    with open(path, "r", encoding="utf-8") as f:
        src = f.read()

    # Check if already patched
    if PATCH_SENTINEL in src:
        print(f"    {os.path.basename(path)}: already patched (skipping)")
        return True

    changed = 0

    # 1. Add includes
    if INCLUDES_MARKER in src:
        src = src.replace(INCLUDES_MARKER, INCLUDES_MARKER + "\n" + INCLUDES_TO_ADD, 1)
        changed += 1
    else:
        print(f"    WARNING: include marker '{INCLUDES_MARKER}' not found")

    # 2. Patch Q projection
    src, ok = find_and_replace(src, OLD_QCUR, NEW_QCUR, "Qcur dispatch")
    if ok: changed += 1

    # 3. Patch K projection
    src, ok = find_and_replace(src, OLD_KCUR, NEW_KCUR, "Kcur dispatch")
    if ok: changed += 1

    # 4. Patch V projection
    src, ok = find_and_replace(src, OLD_VCUR, NEW_VCUR, "Vcur dispatch")
    if ok: changed += 1

    # 5. Patch O projection (attn_output via build_attn)
    src, ok = find_and_replace(src, OLD_ATTN, NEW_ATTN, "build_attn wo dispatch")
    if ok: changed += 1

    # 6. Patch FFN
    src, ok = find_and_replace(src, OLD_FFN, NEW_FFN, "build_ffn dispatch")
    if ok: changed += 1

    if changed < 6:
        print(f"    WARNING: only {changed}/6 changes applied to {os.path.basename(path)}")
        print(f"    This may indicate the llama.cpp source layout has changed.")
        print(f"    Manual inspection required — see patches/0003-llama-build-lowbit-q-dispatch.py")
        # Still write what we have rather than aborting
    else:
        print(f"    {os.path.basename(path)}: all {changed}/6 changes applied")

    with open(path, "w", encoding="utf-8") as f:
        f.write(src)

    return changed == 6

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <path/to/llama.cpp/src/models/llama.cpp>")
        sys.exit(1)

    target = sys.argv[1]
    if not os.path.isfile(target):
        print(f"ERROR: file not found: {target}")
        sys.exit(1)

    ok = patch_file(target)
    sys.exit(0 if ok else 1)
