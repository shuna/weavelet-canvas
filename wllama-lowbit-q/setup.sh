#!/usr/bin/env bash
#
# setup.sh — Prepare a wllama fork with lowbit-Q kernel for WASM build.
#
# This script:
#   1. Clones wllama at the pinned version
#   2. Copies the independent lowbit-Q C sources into the clone
#   3. Applies CMakeLists.txt patch (0001)
#   4. Applies lowbit-Q patches to llama.cpp submodule:
#      0002: make projection weight tensors optional in loader
#      0003: add SVID dispatch in llm_build_llama graph builder
#   5. Optionally builds the WASM binaries (requires Docker)
#
# Usage:
#   ./wllama-lowbit-q/setup.sh [--build]
#
# Prerequisites:
#   - git
#   - python3 (for patches 0002 and 0003)
#   - Docker (only if --build is passed)
#
# Output:
#   .wllama-fork/           — patched wllama clone, ready to build
#   .wllama-fork/esm/       — WASM binaries (only with --build)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FORK_DIR="$REPO_ROOT/.wllama-fork"
WLLAMA_VERSION="$(cat "$SCRIPT_DIR/WLLAMA_VERSION" | tr -d '[:space:]')"
WLLAMA_REPO="https://github.com/ngxson/wllama.git"

echo "=== wllama-lowbit-q setup ==="
echo "  wllama version: v$WLLAMA_VERSION"
echo "  fork directory: $FORK_DIR"
echo ""

# -----------------------------------------------------------------------
# Step 1: Clone wllama at pinned version
# -----------------------------------------------------------------------
if [ -d "$FORK_DIR" ]; then
  echo "[1/5] Fork directory exists, cleaning..."
  rm -rf "$FORK_DIR"
fi

echo "[1/5] Cloning wllama v$WLLAMA_VERSION..."
git clone --depth 1 --branch "v$WLLAMA_VERSION" "$WLLAMA_REPO" "$FORK_DIR" 2>/dev/null \
  || git clone --depth 1 "$WLLAMA_REPO" "$FORK_DIR"

# wllama uses llama.cpp as a submodule
cd "$FORK_DIR"
if [ -f ".gitmodules" ]; then
  echo "    Initializing llama.cpp submodule..."
  git submodule update --init --depth 1
fi

# -----------------------------------------------------------------------
# Step 2: Copy independent lowbit-Q sources
# -----------------------------------------------------------------------
echo "[2/5] Copying lowbit-Q kernel sources..."
mkdir -p "$FORK_DIR/cpp/lowbit-q"
cp "$SCRIPT_DIR/cpp/lowbit-q/lowbit-q-mul-mat.h"      "$FORK_DIR/cpp/lowbit-q/"
cp "$SCRIPT_DIR/cpp/lowbit-q/lowbit-q-mul-mat.c"      "$FORK_DIR/cpp/lowbit-q/"
cp "$SCRIPT_DIR/cpp/lowbit-q/lowbit-q-model-builder.h" "$FORK_DIR/cpp/lowbit-q/"
cp "$SCRIPT_DIR/cpp/lowbit-q/lowbit-q-model-builder.c" "$FORK_DIR/cpp/lowbit-q/"
cp "$SCRIPT_DIR/cpp/lowbit-q/lowbit-q-metadata.h"      "$FORK_DIR/cpp/lowbit-q/"
cp "$SCRIPT_DIR/cpp/lowbit-q/lowbit-q-metadata.c"      "$FORK_DIR/cpp/lowbit-q/"
echo "    Copied 6 files to cpp/lowbit-q/"

# -----------------------------------------------------------------------
# Step 3: Apply CMakeLists.txt patch (patch 0001)
# -----------------------------------------------------------------------
echo "[3/5] Patching CMakeLists.txt (patch 0001)..."

cd "$FORK_DIR"
if ! grep -q 'LOWBIT_Q_SRC' CMakeLists.txt; then
  # Insert lowbit-Q sources before the include_directories block
  sed -i.bak '/^include_directories.*cpp)/i\
# lowbit-Q quantization kernel (independent from ggml core)\
set(LOWBIT_Q_SRC\
    cpp/lowbit-q/lowbit-q-mul-mat.c\
    cpp/lowbit-q/lowbit-q-model-builder.c\
    cpp/lowbit-q/lowbit-q-metadata.c)\
' CMakeLists.txt

  # Add lowbit-Q include directory
  sed -i.bak '/include_directories.*llama\.cpp\/include/a\
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/cpp/lowbit-q)\
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/llama.cpp/ggml/include)' CMakeLists.txt

  # Add LOWBIT_Q_SRC to the executable
  sed -i.bak 's/add_executable(wllama ${WLLAMA_SRC})/add_executable(wllama ${WLLAMA_SRC} ${LOWBIT_Q_SRC})/' CMakeLists.txt

  rm -f CMakeLists.txt.bak
  echo "    CMakeLists.txt patched successfully"
else
  # Ensure lowbit-q-metadata.c is in LOWBIT_Q_SRC (added in Phase 1a)
  if ! grep -q 'lowbit-q-metadata.c' CMakeLists.txt; then
    sed -i.bak 's|cpp/lowbit-q/lowbit-q-model-builder.c)|cpp/lowbit-q/lowbit-q-model-builder.c\n    cpp/lowbit-q/lowbit-q-metadata.c)|' CMakeLists.txt
    rm -f CMakeLists.txt.bak
    echo "    CMakeLists.txt: added lowbit-q-metadata.c to LOWBIT_Q_SRC"
  else
    echo "    CMakeLists.txt already patched (skipping)"
  fi
fi

# Verify patch
if grep -q 'LOWBIT_Q_SRC' CMakeLists.txt && grep -q 'lowbit-q-mul-mat' CMakeLists.txt; then
  echo "    Verification: OK"
else
  echo "    ERROR: Patch 0001 verification failed!"
  exit 1
fi

# -----------------------------------------------------------------------
# Step 4a: Apply llama.cpp loader patch (patch 0002)
#          Makes projection weight tensors TENSOR_NOT_REQUIRED so that
#          SVID_1BIT layers (which have no .weight tensor) load without error.
# -----------------------------------------------------------------------
echo "[4/5] Patching llama.cpp (patch 0002 — optional weights)..."

LLAMA_MODEL_CPP="$FORK_DIR/llama.cpp/src/llama-model.cpp"
if [ ! -f "$LLAMA_MODEL_CPP" ]; then
  echo "    WARNING: $LLAMA_MODEL_CPP not found — skipping patch 0002"
  echo "    (llama.cpp submodule may not be initialized)"
else
  python3 "$SCRIPT_DIR/patches/0002-llama-loader-optional-weights.py" "$LLAMA_MODEL_CPP"
  echo "    Patch 0002 applied"
fi

# -----------------------------------------------------------------------
# Step 4b: Apply llama.cpp graph builder patch (patch 0003)
#          Adds lowbit-Q SVID dispatch in llm_build_llama constructor.
# -----------------------------------------------------------------------
echo "    Patching llama.cpp (patch 0003 — lowbit-Q dispatch)..."

LLAMA_MODELS_CPP="$FORK_DIR/llama.cpp/src/models/llama.cpp"
if [ ! -f "$LLAMA_MODELS_CPP" ]; then
  # Older llama.cpp layout: models/ was not a separate directory
  LLAMA_MODELS_CPP="$FORK_DIR/llama.cpp/src/llama-model.cpp"
  if [ ! -f "$LLAMA_MODELS_CPP" ]; then
    echo "    WARNING: graph builder source not found — skipping patch 0003"
    echo "    (expected: src/models/llama.cpp or src/llama-model.cpp)"
  else
    echo "    Using fallback path: $LLAMA_MODELS_CPP"
    python3 "$SCRIPT_DIR/patches/0003-llama-build-lowbit-q-dispatch.py" "$LLAMA_MODELS_CPP"
    echo "    Patch 0003 applied (fallback path)"
  fi
else
  python3 "$SCRIPT_DIR/patches/0003-llama-build-lowbit-q-dispatch.py" "$LLAMA_MODELS_CPP"
  echo "    Patch 0003 applied"
fi

echo "[4/5] llama.cpp patches complete"

# -----------------------------------------------------------------------
# Step 5: Build WASM (optional)
# -----------------------------------------------------------------------
if [[ "${1:-}" == "--build" ]]; then
  echo "[5/5] Building WASM binaries (requires Docker)..."
  cd "$FORK_DIR"
  if [ -f "scripts/build_wasm.sh" ]; then
    bash scripts/build_wasm.sh
    echo ""
    echo "=== Build complete ==="
    echo "  Single-thread WASM: $FORK_DIR/esm/single-thread/wllama.wasm"
    echo "  Multi-thread WASM:  $FORK_DIR/esm/multi-thread/wllama.wasm"
    echo ""
    echo "To use in weavelet-canvas, copy the WASM files:"
    echo "  cp $FORK_DIR/esm/single-thread/wllama.wasm  <project>/vendor/wllama/"
    echo "  cp $FORK_DIR/esm/multi-thread/wllama.wasm   <project>/vendor/wllama/"
  else
    echo "    WARNING: build_wasm.sh not found. Manual build required."
    echo "    See: https://github.com/nicekid1/Wllama#building-from-source"
  fi
else
  echo "[5/5] Skipping WASM build (pass --build to build)"
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "Fork is at: $FORK_DIR"
echo ""
echo "Patches applied:"
echo "  0001: CMakeLists.txt — lowbit-Q sources added to WASM build"
echo "  0002: llama-model.cpp — projection weights marked TENSOR_NOT_REQUIRED"
echo "  0003: models/llama.cpp — lowbit-Q SVID dispatch in llm_build_llama"
echo ""
echo "Next steps:"
echo "  1. cd $FORK_DIR"
echo "  2. Review changes in llama.cpp/src/{llama-model.cpp,models/llama.cpp}"
echo "  3. Run: bash scripts/build_wasm.sh  (requires Docker)"
echo "  4. Or:  ./wllama-lowbit-q/build-local.sh  (requires emsdk 4.0.3)"
echo "  5. Copy output WASM to vendor/ or update vite config"
