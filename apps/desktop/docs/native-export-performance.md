# Native export copies and reliability — 2026-09-26

Opaque native MP4 and ProRes export now delivers the composited RGBA pixels
directly to the encoder. Previously it uploaded each frame to a new Canvas2D
surface and read the full image back before sending it through IPC.

The capture conversion lives in `legacy/core/frame-capture.ts` and is shared
with the existing canvas capture API. It retains the same render options, motion
blur sampling, bottom-up to top-down conversion, opaque alpha over black, and
quality restoration. Native export uses one reusable canvas solely for its
progress preview and releases that surface on completion, cancellation, or
failure. Fully owned buffers that fit within the existing 4 MiB IPC limit are
sent without an extra chunk copy. Larger frames retain separate, bounded chunks;
small views into larger backing buffers still get copied.

There is one frame in flight and one awaited chunk write at a time. Encoding
formats, codec parameters, frame timestamps, audio mixing, and transport remain
unchanged. Transparent delivery retains its Canvas2D round trip because its
premultiply/unpremultiply rounding is part of the established pixel output.
Both opaque and alpha capture now reject invalid frames or GPU context loss
before sending any bytes from that frame. A new export succeeds after recovery.

## Measured complete-export time

Three runs at each resolution use real Electron IPC, the existing libx264
encoder, and a temporary output file. Each project is a rotating translucent
shape on a solid background, with no audio, draft bitrate, full resolution,
and motion blur disabled. The HD fixture exports 24 frames; 4K exports 12.
Measurements include destination selection, frame preparation, rendering,
preview updates, IPC, encoding, and final file delivery.

| Fixture | Before median | After median | Reduction |
| --- | ---: | ---: | ---: |
| 1920×1080, 24 frames | 729.7 ms | 632.4 ms | 13.3% |
| 3840×2160, 12 frames | 1319.2 ms | 1105.4 ms | 16.2% |

All full-frame Canvas2D readbacks disappeared from opaque delivery: 24 to zero
at HD and 12 to zero at 4K. One 4K RGBA readback is 33,177,600 bytes, so the
12-frame fixture avoids 398,131,200 bytes of pixel readback plus its allocations.
An earlier independent optimized run measured 621.2 ms and 1108.8 ms respectively.
Timings depend on scene, encoder workload, and hardware; these are fixture
results, not a universal throughput guarantee. Detailed stage timings and all
runs are in [`native-export-performance-evidence.json`](native-export-performance-evidence.json).

## Reliability evidence

- Real main-process IPC receives bytes identical to an independent implementation
  of the original capture/canvas route for six animated opaque frames and six
  transparent frames, including translucent overlapping shapes and antialiasing.
- Actual MP4 and WebM files decode into the expected 20 distinct video frames in
  order, even when the editor playhead starts at a different time.
- GPU loss injected during native capture aborts both opaque and alpha export,
  sends zero bad-frame bytes, cancels the native job, and permits a successful
  retry after GPU recovery.
- Unit coverage enforces bounded chunk backing buffers, sequential backpressure,
  cancellation while a frame is being written, resource cleanup, and retry after
  capture, encoder-write, and finish failures. Capture tests verify row order,
  alpha, motion blur options, and quality restoration on failure.
- Existing checks cover MP4/AAC and WebM/Opus playback, queued ProRes alpha and
  fractional rate, destination cancellation, still/sequence exports, preview
  preservation, and frame-buffer memory pressure.

The focused real-app runs passed 25 checks. The full unit suite passed 2,844
tests with the same four previously verified unrelated failures. Renderer
Svelte/TypeScript checking passed with zero errors or warnings, as did extension
boundary checks and the player build. The broader e2e typecheck retains its
existing errors outside the changed files. See the shared-renderer report for
the repository-wide unit/typecheck limitations.

## Reproduction

From `apps/desktop`, use the same test fixture on the prior and optimized
exporter versions. The baseline switch permits the old full-frame readbacks;
normal runs require zero readbacks for opaque delivery.

```sh
PM_NATIVE_EXPORT_BASELINE=1 PM_NATIVE_EXPORT_METRICS=/tmp/native-before.json \
  bun run test:e2e -- native-export-performance.spec.ts
PM_NATIVE_EXPORT_METRICS=/tmp/native-after.json \
  bun run test:e2e -- native-export-performance.spec.ts
```

Keep performance runs isolated from builds and other CPU/GPU tests. Remaining
large costs are synchronous GPU readback, native transport, and encoding. Any
future overlap needs bounded memory and the same ordering, cancellation,
backpressure, pixel-equivalence, and GPU-recovery checks before adoption.

## Follow-up: GPU orientation and opaque alpha

The RGBA8 capture pass now optionally reads source texels in reverse row order
and writes opaque alpha. `renderOpaqueFrame` wraps its readback buffer directly
as `ImageData`, eliminating the second full-frame allocation, CPU row copy, and
alpha loop. Raw and transparent capture keep their existing layout. This saves
33,177,600 bytes of CPU allocation per 4K frame; capture remains sequential.

Exact comparison passes at 97×65, 1920×1080, and 3840×2160 with and without
motion blur, alongside native opaque/alpha pixel parity and GPU recovery checks.
The top-down path also passes injected readback failure, resize, and memory
pressure checks. See `opaque-capture-parity.spec.ts` for the independent old-row
conversion reference.

Batching two or four native chunks showed only small throughput gains while
increasing buffering; neither was retained. Replacing the per-frame timer yield
with `scheduler.yield()` did not improve the measured result and was also
rejected. Original sequential backpressure and cancellation remain intact.
The `gpuConversion` section of the evidence file retains all experimental runs.

For the GPU-conversion follow-up, a fresh baseline versus the final repeat
measured 616.9 → 583.2 ms at HD (5.5% lower) and 1095.4 → 1092.0 ms at 4K
(0.3% lower). An initial 4K result was 1042.3 ms, so that larger 4K speed gain
was not repeatable. The full-frame CPU allocation removal is deterministic;
no additional 4K throughput improvement is claimed.
