# Shared Zstandard decoder

`zstddeclib.c` is the unmodified **decompression-only amalgamation** of official
[facebook/zstd v1.5.7](https://github.com/facebook/zstd/releases/tag/v1.5.7),
commit `f8745da6ff1ad1e7bab384bd1f9d742439278e99`.
`zstd.h` and `zstd_errors.h` are the original public headers. The bundled
`LICENSE` selects upstream's BSD 3-Clause license.

The source archive is pinned and verified before generation:

- URL: `https://codeload.github.com/facebook/zstd/tar.gz/f8745da6ff1ad1e7bab384bd1f9d742439278e99`
- SHA-256: `4b0bd1f0cfb25e61b9103c35f27395530ff5b4c0d2513a00fd745849e85ea52c`
- Official generation: `build/single_file_libs/combine.py -r ../../lib -x legacy/zstd_legacy.h -o zstddeclib.c zstddeclib-in.c`

## Rebuild

Run `EMCC=/path/to/emscripten/emcc shared/zstd/build.sh` from the repository root.
It downloads/verifies that archive, regenerates the C/header files, and builds
`zstd.wasm` from the same `zstddeclib.c`. No npm codec is used.

The checked-in WASM was built with official Emscripten **4.0.20**:
[emsdk tag](https://github.com/emscripten-core/emsdk/tree/4.0.20)
commit `e4fe26ef59168ff44f4c23c466e497bf60b3411e`, SDK release
`c387d7a7e9537d0041d2c3ae71b7538cc978104e`, compiler
`6913738ec5371a88c4af5a80db0ab42bad3de681`.
A separate emsdk checkout can use `./emsdk install 4.0.20` then
`./emsdk activate 4.0.20 --embedded`; this does not need a system installation.
Verify the outputs with `(cd shared/zstd && shasum -a 256 -c SHA256SUMS)`.

## Callers

Web callers use `await decompressZstd(payload, expectedSize)` from `index.ts`.
The WASM asset is fetched lazily on the first valid call. Input and declared
output are each limited to 128 MiB. The decoder rejects trailing data, additional
frames, dictionaries, corrupt frames and declared/actual length mismatches.
Frames with unknown content size decode into the same bounded output buffer.
The returned bytes are detached from the reusable WASM memory.

For native targets, compile `zstddeclib.c`, add this directory to header/module
search paths and `import CZstdLegacy` using `module.modulemap`. It exposes the
standard ZSTD C APIs; the host must enforce the same size, single-frame and
length checks. This library provides decompression only.

## Checks

`node shared/zstd/tests/test.mjs` exercises the real WASM in Node and Chromium,
compiles and exercises the same C on the host, and decodes the old iOS writer's
`tests/fixtures/web-native/legacy-ios-sync-snapshot.wvlt` payload in both runtimes.
It checks valid known/unknown frame sizes, zero output, corrupt/truncated input,
additional bytes/frames, size mismatches, input/output limits and repeated calls.
It requires existing project dependencies, `clang`, and Playwright Chromium
(`npx playwright install chromium`), or an installed Chrome via
`ZSTD_BROWSER_CHANNEL=chrome node shared/zstd/tests/test.mjs`.
The small synthetic `.zst` fixtures were generated from `tests/body.json` with
Zstandard CLI 1.5.7 `--check`, also `--no-content-size`; `empty.zst` is compressed
empty stdin. The actual old iOS fixture is owned by the application import tests.
