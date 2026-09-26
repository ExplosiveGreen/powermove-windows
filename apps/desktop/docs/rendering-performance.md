# Shared rendering performance and reliability — 2026-09-26

The preview, frame capture/export, and browser player share the compositor in
`src/renderer/src/legacy/gl/compositor.ts`. The final change removes redundant
CPU work. Shaders, color formats, quality, codecs, frame sampling, GPU allocation,
and pixel conversions retain their established paths.

## Implemented

- **Linear group flattening.** Ordinary groups previously filtered the complete
  layer stack recursively. A pass now builds a membership index only when it
  first needs to flatten a group. Flat scenes do not build an index. The index
  is local to the pass, so edits, nested compositions, and time-dependent group
  boundaries cannot reuse stale membership. With 2,000 groups and 2,000 children,
  membership reads fall from 8,004,000 to 8,000. A deterministic unit test enforces
  the linear bound and compares ordering with the previous traversal.
- **Skip unused transition work.** A layer without either transition no longer
  computes a group span or transition timing on every pass.

## Measured result

The hidden Electron fixture renders 180 groups and 180 translucent shapes at
640×360. Each timing includes `gl.finish()` to measure completed GPU work; this
synchronization is test-only. Each run warms five frames and samples 120 distinct
frame times. Three isolated runs of each version produced these ranges in ms:

| Path | Before median | After median | Before p95 | After p95 |
| --- | ---: | ---: | ---: | ---: |
| Grouped preview | 0.70 | 0.40 | 0.90 | 0.50–0.60 |
| Opaque capture | 3.70 | 3.40–3.50 | 3.90–4.30 | 3.90–4.10 |

Preview time fell about 43%; opaque capture medians improved about 5–8%. Timing
varies with machine load. These measurements do not establish a universal
speedup or end-to-end video encoding throughput. Full metrics and matching
pixel hashes are in
[`rendering-performance-evidence.json`](rendering-performance-evidence.json).

An experimental pooled RGBA8 readback target eliminated all 120 per-frame
renderbuffer allocations, but did not provide a dependable additional timing
benefit and one run had a worse capture p95 (6.60 ms). That experiment was
removed. Its measurements are retained in the evidence file. Reliability and
predictable performance take precedence over a lower allocation counter.

## Reliability checks

Twelve complete pixel buffers were recorded with the original compositor and
compared by SHA-256 after the change. All are byte-identical: ordinary groups,
opacity/blending/motion blur, float readback, resized capture, backward seek,
masks, solo, transparent backgrounds, group effects, transitions, mattes, and
nested compositing boundaries. The ordinary-group case also compares against
an equivalent ungrouped scene on every test run without an external baseline.

New real-GPU tests cover readback failure and buffer cleanup, framebuffer budget
eviction, resizing, and recovery after forced GPU context loss. Recovered pixels
and project data must match exactly. Existing real-app checks cover 3D group
ordering, group effects, adjustments, video synchronization, MP4/AAC and WebM
exports, ProRes alpha, retiming, precompositions, and preservation of the visible
preview. The final focused suite passed 26 tests; one private-project check was
skipped because its fixture is unavailable.

The full unit run passed 2,834 tests; four unrelated failures reproduced with
the original compositor (timeline locked-selection fixture, project-screen DOM
fixture, and two Codex instruction-golden/size checks). Renderer Svelte/TypeScript
checking and extension boundary checks passed; desktop and player builds passed.
The full typecheck script is blocked before renderer checking by missing
Cloudflare worker types and `worker-configuration.d.ts`. The broader e2e
TypeScript project also has existing errors outside the changed files.

## Native export follow-up

The follow-up removes the opaque Canvas2D readback and redundant small-buffer
IPC copies while retaining sequential delivery and the original alpha conversion.
Complete native MP4 exports improved about 13–16% in the HD/4K fixtures, with
byte-for-byte parity and explicit GPU-loss/cancellation coverage. See
[`native-export-performance.md`](native-export-performance.md) for the changes,
measurements, and reliability evidence.

Remaining large costs are synchronous GPU readback, transport, and encoding.
Bounded overlap would require further frame-order, backpressure, cancellation,
audio synchronization, cleanup, and context-loss validation. Hardware encoding
and lower-resolution previews remain separate quality/compatibility decisions.

## Reproduction

From `apps/desktop`, record with the original compositor, then compare with the
optimized compositor, using the same test fixture and machine:

```sh
PM_RENDER_BASELINE=/tmp/pm-render-baseline.json PM_RECORD_RENDER_BASELINE=1 \
  bun run test:e2e -- rendering-performance.spec.ts
PM_RENDER_BASELINE=/tmp/pm-render-baseline.json \
  bun run test:e2e -- rendering-performance.spec.ts
```

The test attaches `rendering-metrics.json` with hashes, timings, and allocation
counts. Without the environment variables, pixel equivalence to an ungrouped
scene, failure cleanup, memory accounting, and GPU recovery remain enforced.
Run timing comparisons without concurrent builds or checks.
