#!/usr/bin/env bash
#
# setup.sh — vendor/wllama-src/ をセットアップし、ビルド準備を行う。
#
# フロー:
#   1. wllama を vendor/wllama-src/ にクローン
#   2. vendor/wllama-patches/*.patch を適用 (ファイルがあれば)
#   3. lowbit-Q パッチを適用 (vendor/wllama/lowbit-q/setup.sh --patches-only)
#   4. (--build 指定時) WASM をビルド
#
# Usage:
#   bash scripts/wllama/setup.sh [--build]
#
# Prerequisites:
#   - git
#   - python3 (for lowbit-Q patches 0002 and 0003)
#   - Docker (only if --build is passed)
#
# Output:
#   vendor/wllama-src/    — patched wllama source tree, ready to build
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FORK_DIR="$REPO_ROOT/vendor/wllama-src"
PATCHES_DIR="$REPO_ROOT/vendor/wllama-patches"
LOWBITQ_SETUP="$REPO_ROOT/vendor/wllama/lowbit-q/setup.sh"
WLLAMA_VERSION="$(cat "$REPO_ROOT/vendor/wllama/lowbit-q/WLLAMA_VERSION" | tr -d '[:space:]')"
WLLAMA_REPO="https://github.com/ngxson/wllama.git"
WLLAMA_COMMIT="5e63e3b226a077b33dc7c608f1fe630f3d21f539"
if [ "$WLLAMA_VERSION" != "2.3.7" ]; then
  echo "ERROR: expected WLLAMA_VERSION 2.3.7." >&2
  exit 1
fi

echo "=== scripts/wllama/setup.sh ==="
echo "  wllama version:    v$WLLAMA_VERSION"
echo "  source directory:  $FORK_DIR"
echo "  patches directory: $PATCHES_DIR"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Clone wllama at pinned version
# ---------------------------------------------------------------------------
if [ -e "$FORK_DIR" ] || [ -L "$FORK_DIR" ]; then
  existing_commit=$(git -C "$FORK_DIR" rev-parse HEAD 2>/dev/null || true)
  echo "ERROR: source already exists (HEAD: ${existing_commit:-unknown}; expected: $WLLAMA_COMMIT)." >&2
  echo "Preserving existing patches; use a separate checkout for setup." >&2
  exit 1
fi

echo "[1/3] Cloning wllama v$WLLAMA_VERSION into vendor/wllama-src/ ..."
git clone --depth 1 --branch "v$WLLAMA_VERSION" "$WLLAMA_REPO" "$FORK_DIR"
if [ "$(git -C "$FORK_DIR" rev-parse HEAD)" != "$WLLAMA_COMMIT" ]; then
  echo "ERROR: cloned revision does not match $WLLAMA_COMMIT; source preserved for inspection." >&2
  exit 1
fi

cd "$FORK_DIR"
if [ -f ".gitmodules" ]; then
  echo "      Initializing llama.cpp submodule..."
  git submodule update --init --depth 1
fi

# ---------------------------------------------------------------------------
# Step 2: Apply base patches from vendor/wllama-patches/
# ---------------------------------------------------------------------------
echo ""
echo "[2/3] Applying base patches from vendor/wllama-patches/ ..."
PATCH_COUNT=0
for patch in "$PATCHES_DIR"/*.patch; do
  [ -f "$patch" ] || continue
  echo "      applying: $(basename "$patch")"
  git -C "$FORK_DIR" apply "$patch"
  PATCH_COUNT=$((PATCH_COUNT + 1))
done

if [ "$PATCH_COUNT" -eq 0 ]; then
  echo "      (no .patch files found — skipped)"
fi

# ---------------------------------------------------------------------------
# Step 3: Apply lowbit-Q patches
# ---------------------------------------------------------------------------
echo ""
echo "[3/3] Applying lowbit-Q patches ..."
if [ "$#" -gt 0 ]; then
  WLLAMA_SKIP_CLONE=1 bash "$LOWBITQ_SETUP" "$@"
else
  WLLAMA_SKIP_CLONE=1 bash "$LOWBITQ_SETUP"
fi

echo ""
echo "=== Setup complete ==="
echo "  vendor/wllama-src/ is ready."
echo ""
echo "Next:"
echo "  bash scripts/wllama/build.sh              # compat WASM"
echo "  WLLAMA_BUILD_WEBGPU=1 bash scripts/wllama/build.sh   # + WebGPU"
echo "  See: docs/build/wllama.md"
