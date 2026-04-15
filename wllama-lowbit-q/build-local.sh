#!/usr/bin/env bash
#
# build-local.sh — Build lowbit-Q-patched wllama WASM using local Emscripten.
#
# Prerequisites:
#   - emsdk installed and activated (source emsdk_env.sh)
#   - .wllama-fork/ prepared by setup.sh
#
# Usage:
#   ./wllama-lowbit-q/build-local.sh
#
# Output:
#   vendor/wllama/single-thread-compat.wasm
#   vendor/wllama/multi-thread-compat.wasm
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FORK_DIR="$REPO_ROOT/.wllama-fork"
VENDOR_DIR="$REPO_ROOT/vendor/wllama"

# ---------------------------------------------------------------------------
# Validate environment
# ---------------------------------------------------------------------------
if [ ! -d "$FORK_DIR" ]; then
  echo "ERROR: .wllama-fork/ not found. Run setup.sh first:"
  echo "  bash wllama-lowbit-q/setup.sh"
  exit 1
fi

if ! command -v emcc &>/dev/null; then
  echo "ERROR: emcc not found. Activate emsdk first:"
  echo "  source /Users/suzuki/emsdk/emsdk_env.sh"
  exit 1
fi

# Upstream wllama uses emsdk 4.0.3 — must match to avoid ABI mismatch
# (-fwasm-exceptions changed ABI between 4.x and 5.x)
REQUIRED_EMSDK="4.0.3"
ACTUAL_EMSDK=$(emcc --version | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
if [ "$ACTUAL_EMSDK" != "$REQUIRED_EMSDK" ]; then
  echo "WARNING: emsdk version mismatch (have $ACTUAL_EMSDK, need $REQUIRED_EMSDK)"
  echo "  Install correct version: cd /Users/suzuki/emsdk && ./emsdk install $REQUIRED_EMSDK && ./emsdk activate $REQUIRED_EMSDK"
  echo "  Then: source /Users/suzuki/emsdk/emsdk_env.sh"
  exit 1
fi

echo "=== wllama-lowbit-q local build ==="
echo "  emcc: $(emcc --version | head -1)"
echo "  fork: $FORK_DIR"
echo ""

# ---------------------------------------------------------------------------
# Shared compiler flags (matches docker-compose.yml from upstream)
# ---------------------------------------------------------------------------
SHARED_EMCC_CFLAGS_BASE="--no-entry -O3 -msimd128 -DNDEBUG -flto=full -frtti -fwasm-exceptions -sEXPORT_ALL=1 -sEXPORT_ES6=0 -sMODULARIZE=0 -sALLOW_MEMORY_GROWTH=1 -sFORCE_FILESYSTEM=1 -sEXPORTED_FUNCTIONS=_main,_wllama_malloc,_wllama_start,_wllama_action,_wllama_exit,_wllama_debug -sEXPORTED_RUNTIME_METHODS=ccall,cwrap -sNO_EXIT_RUNTIME=1"
SHARED_EMCC_CFLAGS_COMPAT="$SHARED_EMCC_CFLAGS_BASE -sINITIAL_MEMORY=128MB -sMAXIMUM_MEMORY=2048MB"
NPROC=$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)

cd "$FORK_DIR"

# ---------------------------------------------------------------------------
# Build 1/2: single-thread compat (no Memory64)
# ---------------------------------------------------------------------------
echo "[1/2] Building single-thread WASM (compat, no Memory64)..."
rm -rf wasm/single-thread-compat
mkdir -p wasm/single-thread-compat
cd wasm/single-thread-compat

export EMCC_CFLAGS=""
emcmake cmake ../.. 2>&1 | tail -3
export EMCC_CFLAGS="$SHARED_EMCC_CFLAGS_COMPAT"
emmake make wllama -j"$NPROC" 2>&1

cd "$FORK_DIR"

# ---------------------------------------------------------------------------
# Build 2/2: multi-thread compat (no Memory64)
# ---------------------------------------------------------------------------
echo ""
echo "[2/2] Building multi-thread WASM (compat, no Memory64)..."
rm -rf wasm/multi-thread-compat
mkdir -p wasm/multi-thread-compat
cd wasm/multi-thread-compat

export EMCC_CFLAGS=""
emcmake cmake ../.. 2>&1 | tail -3
export EMCC_CFLAGS="$SHARED_EMCC_CFLAGS_COMPAT -pthread -sUSE_PTHREADS=1 -sPTHREAD_POOL_SIZE=Module[\"pthreadPoolSize\"]"
emmake make wllama -j"$NPROC" 2>&1

cd "$FORK_DIR"

# ---------------------------------------------------------------------------
# Copy to safe destinations
# ---------------------------------------------------------------------------
echo ""
echo "=== Copying safe outputs ==="
mkdir -p "$VENDOR_DIR"

cp wasm/single-thread-compat/wllama.wasm "$VENDOR_DIR/single-thread-compat.wasm"
cp wasm/multi-thread-compat/wllama.wasm  "$VENDOR_DIR/multi-thread-compat.wasm"

echo ""
echo "=== Build complete ==="
ls -lh "$VENDOR_DIR/"
echo ""
echo "Compat WASM installed to: $VENDOR_DIR/"
echo ""
echo "NOTE:"
echo "  - build-local.sh no longer overwrites vendor/wllama/{single,multi}-thread.wasm"
echo "  - Memory64 variants are intentionally not built by this script"
echo "  - Keep vendor/wllama/{single,multi}-thread.wasm on upstream binaries"
