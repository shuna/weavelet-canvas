#!/bin/bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
out="$repo/ios-rebuild/.build/local-llama"
pin=4abef75f2cf2eee75eb5083b30a94cf981587394
mkdir -p "$out/include" "$out/lib"
[[ $# == 0 || ( $# == 1 && "$1" == --verify ) ]] || { echo "No probe reuse: build the pinned security-patched source" >&2; exit 1; }
source="$out/source"
build="$out/build"
fingerprint="$(python3 - "$repo" <<'PYHASH'
import hashlib,sys
from pathlib import Path
root=Path(sys.argv[1]); h=hashlib.sha256()
h.update(b'wllama:5e63e3b226a077b33dc7c608f1fe630f3d21f539;llama:4abef75f2cf2eee75eb5083b30a94cf981587394')
files = [p for p in (root/'vendor/wllama-patches').glob('*.patch') if p.name[:4] in ('0001','0002','0003','0004','0005','0007')]
files += [root/'vendor/wllama/lowbit-q'/name for name in ('0002-llama-loader-optional-weights.py','0003-llama-build-lowbit-q-dispatch.py')]
for p in sorted(files):
    if p.is_file(): h.update(str(p.relative_to(root)).encode()); h.update(p.read_bytes())
print(h.hexdigest())
PYHASH
)"
source_digest() {
    { git -C "$source" diff --binary HEAD; git -C "$source/llama.cpp" diff --binary HEAD; } | shasum -a 256 | cut -d' ' -f1
}
if [[ -d "$source" ]]; then
    [[ -f "$source/.native-fingerprint" ]] && [[ "$(cat "$source/.native-fingerprint")" == "$fingerprint $(source_digest)" ]] || { echo "Source/patch fingerprint mismatch; existing source preserved: $source" >&2; exit 1; }
else
    [[ "${1:-}" != --verify ]] || { echo "Prepare the native library with NativeLlama/build.sh first" >&2; exit 1; }
    git -c http.followRedirects=false clone --depth 1 --branch 2.3.7 https://github.com/ngxson/wllama.git "$source"
    [[ "$(git -C "$source" rev-parse HEAD)" == 5e63e3b226a077b33dc7c608f1fe630f3d21f539 ]]
    git -C "$source" config submodule.llama.cpp.url https://github.com/ggml-org/llama.cpp.git
    git -c http.followRedirects=false -C "$source" submodule update --init --depth 1
    [[ "$(git -C "$source/llama.cpp" rev-parse HEAD)" == "$pin" ]]
    for n in 0001 0002 0003 0004 0005; do git -C "$source" apply "$repo"/vendor/wllama-patches/"$n"-*.patch; done
    # 0006 is WASM memory64-only, not a native compilation patch.
    python3 "$repo/vendor/wllama/lowbit-q/0002-llama-loader-optional-weights.py" "$source/llama.cpp/src/llama-model.cpp" "$source/llama.cpp/src/llama-model.h"
    python3 "$repo/vendor/wllama/lowbit-q/0003-llama-build-lowbit-q-dispatch.py" "$source/llama.cpp/src/models/llama.cpp"
    git -C "$source" apply "$repo/vendor/wllama-patches/0007-gguf-byte-size-overflow.patch"
    printf '%s %s\n' "$fingerprint" "$(source_digest)" > "$source/.native-fingerprint"
fi
[[ "$(git -C "$source" rev-parse HEAD)" == 5e63e3b226a077b33dc7c608f1fe630f3d21f539 ]]
[[ "$(git -C "$source/llama.cpp" rev-parse HEAD)" == "$pin" ]]
if [[ "${1:-}" == --verify ]]; then
    [[ -f "$out/artifacts.sha256" ]] || { echo "Native build did not finish" >&2; exit 1; }
    (cd "$repo"; shasum -a 256 -c "$out/build-inputs.sha256")
    (cd "$out"; shasum -a 256 -c artifacts.sha256)
    exit
fi
rm -f "$out/artifacts.sha256"
    mkdir -p "$out/input"
    cp -R "$repo/vendor/wllama/lowbit-q/cpp/lowbit-q" "$out/input/"
    cat > "$out/input/CMakeLists.txt" <<CMAKE
cmake_minimum_required(VERSION 3.14)
project(catalyst_llama C CXX)
add_subdirectory("$source/llama.cpp" llama)
target_include_directories(llama PUBLIC \${CMAKE_CURRENT_SOURCE_DIR}/lowbit-q)
target_sources(llama PRIVATE lowbit-q/lowbit-q-mul-mat.c lowbit-q/lowbit-q-model-builder.c lowbit-q/lowbit-q-metadata.c)
CMAKE
    cmake -S "$out/input" -B "$build" -DCMAKE_SYSTEM_NAME=Darwin -DCMAKE_OSX_SYSROOT=macosx -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_C_COMPILER_TARGET=arm64-apple-ios17.0-macabi -DCMAKE_CXX_COMPILER_TARGET=arm64-apple-ios17.0-macabi -DCMAKE_ASM_FLAGS=--target=arm64-apple-ios17.0-macabi -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DGGML_BLAS=OFF -DGGML_OPENMP=OFF -DGGML_NATIVE=OFF -DLLAMA_BUILD_COMMON=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_TOOLS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_SERVER=OFF -DGGML_RPC=OFF -DGGML_BACKEND_DL=OFF -DLLAMA_CURL=OFF -DLLAMA_HTTPLIB=OFF
    cmake --build "$build" --target llama -j 4
cp "$source/llama.cpp/include/"*.h "$source/llama.cpp/ggml/include/"*.h "$out/include/"
cp "$build/llama/src/libllama.a" "$build/llama/ggml/src/"*.a "$build/llama/ggml/src/ggml-metal/libggml-metal.a" "$out/lib/"
echo "Catalyst arm64 llama $pin prepared in $out"

# Compile the pinned wllama sampler as a small C ABI archive; reuse the verified engine libraries.
sdk="$(xcrun --sdk macosx --show-sdk-path)"
objects=()
for unit in "$repo/ios-rebuild/NativeLlama/Sampling.cpp" "$source/cpp/helpers/wsampling.cpp" "$source/cpp/helpers/wcommon.cpp" "$source/cpp/helpers/wlog.cpp"; do
    object="$out/$(basename "$unit").o"
    xcrun clang++ -target arm64-apple-ios17.0-macabi -isysroot "$sdk" -std=c++17 -O3 -I "$repo/ios-rebuild/NativeLlama" -I "$source/cpp/helpers" -I "$out/include" -c "$unit" -o "$object"
    objects+=("$object")
done
xcrun ar rcs "$out/lib/libweavelet-sampling.a" "${objects[@]}"

(cd "$out"; shasum -a 256 include/*.h lib/*.a > artifacts.sha256)
(cd "$repo"; shasum -a 256 ios-rebuild/NativeLlama/build.sh ios-rebuild/NativeLlama/Sampling.h ios-rebuild/NativeLlama/Sampling.cpp vendor/wllama/lowbit-q/cpp/lowbit-q/* > "$out/build-inputs.sha256")
