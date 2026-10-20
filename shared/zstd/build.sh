#!/bin/sh
set -eu
DEST=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/weavelet-zstd-build.XXXXXX")
trap 'rm -rf "$WORK"' EXIT HUP INT TERM
COMMIT=f8745da6ff1ad1e7bab384bd1f9d742439278e99
ARCHIVE_SHA256=4b0bd1f0cfb25e61b9103c35f27395530ff5b4c0d2513a00fd745849e85ea52c
EMCC=${EMCC:-emcc}
"$EMCC" --version | head -1 | grep -F '4.0.20' > /dev/null || { echo 'Emscripten 4.0.20 is required.' >&2; exit 1; }
curl -fLsS "https://codeload.github.com/facebook/zstd/tar.gz/$COMMIT" -o "$WORK/source.tar.gz"
printf '%s  %s\n' "$ARCHIVE_SHA256" "$WORK/source.tar.gz" | shasum -a 256 -c -
mkdir "$WORK/source"
tar -xzf "$WORK/source.tar.gz" -C "$WORK/source" --strip-components=1
cd "$WORK/source/build/single_file_libs"
python3 combine.py -r ../../lib -x legacy/zstd_legacy.h -o zstddeclib.c zstddeclib-in.c
cp zstddeclib.c "$DEST/zstddeclib.c"
cp ../../lib/zstd.h "$DEST/zstd.h"
cp ../../lib/zstd_errors.h "$DEST/zstd_errors.h"
cp ../../LICENSE "$DEST/LICENSE"
EMCC_DIR=$(CDPATH= cd -- "$(dirname -- "$(command -v "$EMCC")")" && pwd)
{
  printf 'WASM runtime notices from official Emscripten 4.0.20.\n\n'
  printf 'emmalloc.c: Copyright 2018 The Emscripten Authors. All rights reserved.\nThe Emscripten MIT / University of Illinois/NCSA licenses below apply.\n'
  for NOTICE in LICENSE system/lib/libc/musl/COPYRIGHT system/lib/compiler-rt/LICENSE.TXT system/lib/llvm-libc/LICENSE.TXT; do
    printf '\n===== Emscripten 4.0.20: %s =====\n\n' "$NOTICE"
    cat "$EMCC_DIR/$NOTICE"
  done
} > "$DEST/WASM-RUNTIME-LICENSES.txt"
cd "$DEST"
"$EMCC" zstddeclib.c -Oz -DNDEBUG --no-entry \
  -sSTANDALONE_WASM=1 -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=1048576 -sMAXIMUM_MEMORY=536870912 -sSTACK_SIZE=65536 \
  -sMALLOC=emmalloc -sABORTING_MALLOC=0 \
  -sEXPORTED_FUNCTIONS='["_malloc","_free","_ZSTD_decompress","_ZSTD_isError","_ZSTD_findFrameCompressedSize","_ZSTD_getFrameContentSize","_ZSTD_getDictID_fromFrame"]' \
  -o zstd.wasm
chmod 644 zstd.wasm
shasum -a 256 zstddeclib.c zstd.h zstd_errors.h zstd.wasm
