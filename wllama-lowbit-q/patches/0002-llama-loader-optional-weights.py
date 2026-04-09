#!/usr/bin/env python3
"""
0002-llama-loader-optional-weights.py

Patches llama.cpp/src/llama-model.cpp to mark projection weight tensors
as TENSOR_NOT_REQUIRED for the LLAMA architecture.

This is required for lowbit-Q v2 GGUF files where SVID_1BIT layers do
not have a .weight tensor — they use .lowbit_q_a/.b/.sign instead.
Without this patch, llama.cpp's loader would abort with "tensor not found"
when it encounters a SVID layer that has no standard .weight tensor.

Affected tensors (LLAMA arch, non-MoE):
  wq, wk, wv, wo  (attention projections)
  ffn_gate, ffn_down, ffn_up  (FFN projections)

Logic: replace the trailing ', 0);' with ', TENSOR_NOT_REQUIRED);' for
exactly these 7 create_tensor calls within the LLM_ARCH_LLAMA branch.
The replacement is narrowly scoped to avoid modifying other architectures.
"""

import re
import sys
import os

def patch_file(path: str) -> bool:
    with open(path, "r", encoding="utf-8") as f:
        src = f.read()

    # The 7 tensor creation calls we need to make optional.
    # Each pattern is unique in the file — scoped by the tensor enum name.
    targets = [
        "LLM_TENSOR_ATTN_Q,   \"weight\", i)",
        "LLM_TENSOR_ATTN_K,   \"weight\", i)",
        "LLM_TENSOR_ATTN_V,   \"weight\", i)",
        "LLM_TENSOR_ATTN_OUT, \"weight\", i)",
        "LLM_TENSOR_FFN_GATE, \"weight\", i)",
        "LLM_TENSOR_FFN_DOWN, \"weight\", i)",
        "LLM_TENSOR_FFN_UP,   \"weight\", i)",
    ]

    # Pattern: create_tensor(<target>, {<dims>}, 0);
    # We replace ', 0);' → ', TENSOR_NOT_REQUIRED);' only for matching lines.
    changed = 0
    lines = src.splitlines(keepends=True)
    out_lines = []

    for line in lines:
        matched = False
        for target in targets:
            if target in line and ", 0);" in line:
                # Only replace if the line hasn't already been patched
                if "TENSOR_NOT_REQUIRED" not in line:
                    new_line = line.replace(", 0);", ", TENSOR_NOT_REQUIRED);", 1)
                    out_lines.append(new_line)
                    changed += 1
                    matched = True
                    break
        if not matched:
            out_lines.append(line)

    if changed == 0:
        # Check if already patched
        already_patched = all(
            any(t in line and "TENSOR_NOT_REQUIRED" in line
                for line in lines)
            for t in targets
        )
        if already_patched:
            print(f"    {os.path.basename(path)}: already patched (skipping)")
            return True
        else:
            print(f"    WARNING: {os.path.basename(path)}: no matching lines found")
            print(f"    Expected patterns like: create_tensor(tn(LLM_TENSOR_ATTN_Q, \"weight\", i), {{...}}, 0);")
            return False

    with open(path, "w", encoding="utf-8") as f:
        f.write("".join(out_lines))

    print(f"    {os.path.basename(path)}: patched {changed} / 7 tensor creation calls")
    return changed == 7

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <path/to/llama-model.cpp>")
        sys.exit(1)

    target = sys.argv[1]
    if not os.path.isfile(target):
        print(f"ERROR: file not found: {target}")
        sys.exit(1)

    ok = patch_file(target)
    sys.exit(0 if ok else 1)
