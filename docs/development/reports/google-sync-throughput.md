# Google Drive sync measurements — 2026-09-29

## Scope and method

Baseline: main `ebd2e380` with timing-only instrumentation. Changed implementation: this PR.
Node/Vitest, fake IndexedDB and mock Drive; synthetic 30 MiB repeated text plus 2 MiB random base64 image, 33,554,663 bytes total. The mock waits 20 ms per API call plus payload / 5 MiB/s per upload. Request counts include ID acquisition, folder creation, upload, listing and changes calls. Bytes below are uploaded application payloads, excluding HTTP/multipart headers. Images are freshly randomized per run, so compressed payloads differ slightly. These are single samples, not statistical or physical-device measurements; CPU load and warmup affect total time. Raw numeric results are in `google-sync-benchmark.json`.

Run the new benchmark with:

```sh
SYNC_BENCH=1 SYNC_BENCH_PART=1048576 SYNC_BENCH_CONCURRENCY=2 \
  yarn vitest run src/store/storage/google/benchmark.test.ts
```

The benchmark is skipped in ordinary test runs. `SYNC_BENCH_BASE` may point to an instrumented pre-change module directory; the measured baseline copy was `/tmp/weavelet-sync-baseline`.

## Before / after

| Operation | Before | After (1 MiB, 2 uploads) |
|---|---:|---:|
| Initial elapsed | 383.612 s | 14.663 s |
| Initial API calls | 26 | 11 |
| Initial uploaded bytes | 1,973,819 | 1,973,352 |
| Initial compression time | 380.712 s | 13.880 s |
| Initial cumulative compression input | 909,337,891 B | 33,557,754 B |
| Initial cumulative cache writes | 72,082,362 B | 3,947,948 B |
| Title edit elapsed | 292.632 s | 0.256 s |
| Title edit API calls | 6 | 4 |
| Title edit uploaded bytes | 260 | 192 |
| Title edit compression time | 290.338 s | 0.0015 s |
| Title edit cumulative cache writes | 27,863,582 B | 3,158 B |

The dominant measured delay was recompressing the entire private sync cache after uploads. The initial compressed data must still be processed once. Browser execution now moves large commit compression to a Worker so this CPU work does not block the dialog/editor. The Node benchmark executes the same compression directly; it does not measure browser Worker startup/structured-clone overhead. AES-GCM encryption took 101 ms before and 4.4 ms after for the initial operation, versus hundreds of seconds of repeated compression before.

## Chunk and concurrency comparison

| Part size | Parallel uploads | Total elapsed | Upload window* | API calls | Payload bytes |
|---|---:|---:|---:|---:|---:|
| 256 KiB | 1 | 21.090 s | 574 ms | 17 | 1,973,635 |
| 1 MiB | 1 | 15.697 s | 442 ms | 11 | 1,973,503 |
| 256 KiB | 2 | 14.184 s | 311 ms | 17 | 1,973,683 |
| 1 MiB | 2 | 14.663 s | 242 ms | 11 | 1,973,352 |

*First data upload start through management-file response, including local acknowledgement handling. The preceding initial compression is excluded. The mock gives each simultaneous upload its configured rate, so this is not a claim about shared mobile bandwidth. Adopt 1 MiB / at most 2 uploads because it reduced both measured upload-window time and API calls. Overall CPU variation is larger than the network difference; the 0.48 s difference between the two parallel total times is not evidence that 256 KiB is preferable. Small normal deltas remain one encrypted file, independent of the large-part setting; title edits do not resend the image.

## Durability, compatibility and UI checks

- Prepared ciphertext and encrypted metadata are persisted in one sync-private IndexedDB transaction before upload. Per-file encrypted acknowledgements do not rewrite retained commits or payloads.
- Reopening an old v1 local cache migrates pending ciphertext without changing IDs/bytes. Completed files are skipped. Missing acknowledgements cause safe retries with the same ID/ciphertext; Drive 409 responses are verified against exact bytes.
- Independent uploads are bounded to two, and all outstanding uploads settle before a failed operation returns. The management file is published only after every part succeeds. Local completion and outbox cleanup are atomic.
- Existing v1 remote multipart commits remain readable. New small commits use v2 inline changes; readers must use this version of the app to read newly written inline commits. Legacy JSON remains an import source. App IndexedDB/localStorage formats and AES-GCM/key wrapping are unchanged.
- Tests cover interrupted/lost part or commit responses, reload, acknowledgement-save failure, incomplete publication, legacy cache migration, unchanged images, damaged ciphertext, multiple-device conflicts and stale tabs.
- Browser tests cover closing/reopening the progress dialog, editing during the first upload and the subsequent delta, reload/unlock, and real Worker compression with a live main-thread timer.
- Progress percentage applies only to a known upload stage. Checking, verification and local saving remain unfinished stages without invented totals. Throughput uses completed encrypted payload bytes and the union of successful transfer intervals, so overlapping requests do not double-count elapsed time. Compression and local storage are separate diagnostic metrics; logs contain only fixed metric names and numeric counts/times/sizes.

## Real Google Drive observation (not a benchmark of the fix)

Computer Use inspected the user's Firefox production tab and Drive folder. The app showed 59.4 MB of local data and remained in the creating/syncing state. Drive showed 256 KiB files created roughly one to two minutes apart. That observation alone cannot attribute latency to Drive. The running old-code operation was not cancelled or reloaded. No post-change real Google Drive throughput measurement has been obtained; the comparisons above use mocks exclusively.
