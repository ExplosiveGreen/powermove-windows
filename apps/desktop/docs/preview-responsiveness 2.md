# Scrubbing and playback responsiveness — 2026-09-26

The Inspector previously treated every playhead update as a document and
selection change. This rebuilt parent options, resolved selected layers once
per candidate parent, and repeated cycle checks while playing or scrubbing.

The time signal is now separate. Animated controls still evaluate at the current
time; project, selection, transport and explicit UI invalidation retain their
existing refresh behavior. When parent choices do need rebuilding, the selected
children are resolved once for the whole list. No frame cache, quality reduction,
seek approximation, or decoder change is introduced.

## Measurements

The real Electron fixture has 1,000 animated shape layers, 12 selected layers,
a visible timeline and Inspector, a 1280×720 composition at 30 fps, and adaptive
quality disabled. It plays for 2.4 seconds and makes 37 forward/backward scrub
requests. DevTools records renderer CPU samples. Measurements include the
Inspector and other UI work, not just `GL.render`.

| Measure | Before | After |
| --- | ---: | ---: |
| Sampled non-idle main-thread time, confirmation run | 1,488.8 ms | 1,011.7 ms |
| Parenting cycle checks during playback | 3,457,380 | 23,844 |
| Parenting checks during scrubbing and stopping | 858,384 | 441,114 |
| Total parenting checks | 4,315,764 | 464,958 |
| Playback frames in 2.4 seconds | 72 | 72 |
| Median scrub request-to-next-animation-frame time | 8.2 ms | 8.2 ms |

The confirmation run used **32.0% less sampled main-thread time** and **89.2%
fewer cycle checks** overall. The first before/after pair measured a 30.0% CPU
time reduction. These are processing-headroom improvements: this fixture
already maintained 30 fps, and its median scrub latency did not improve.
Compositor-only median timing varied from 1.8–1.9 ms before to 2.1–2.2 ms after;
the measured improvement is in total renderer work, not GPU drawing throughput.

The benchmark retains raw frames and `.cpuprofile` files as Playwright artifacts.
Aggregates from all runs are in
[`preview-responsiveness-evidence.json`](preview-responsiveness-evidence.json).
CPU samples are estimates and results depend on scene, selection, and hardware.

## Reliability checks

- A regression test first reproduced 156 redundant parenting checks across four
  time changes. It now requires zero such checks while checking forward and
  backward animated Rotation values. Renaming and changing selection still
  rebuilds the correct choices.
- The real-app benchmark checks the displayed animated Rotation against the
  current playhead, unchanged project data, full quality, and a bound on the
  number of parenting checks during playback.
- 18 real-app regression checks pass: GIF scrubbing, repeated cuts and loops,
  overlapping instances, animated speed, time remapping, offscreen captures,
  export frame ordering, GPU recovery, readback failure, resize and memory
  pressure. One optional private 4K video benchmark is skipped because no
  source fixture was supplied. The shared compositor's 12 pixel hashes match
  their original references.
- The full unit suite reports 2,846 passing tests and the same four known
  unrelated failures (timeline locked selection, project-library DOM mock, and
  two Codex instruction checks). A final focused run passes all 80 Inspector,
  capture, compositor and delivery tests.
- Renderer Svelte/TypeScript: zero errors and warnings. Extension boundary
  checks and player build pass. E2E TypeScript diagnostics are identical to
  the previously recorded unrelated errors.

## Reproduction

From `apps/desktop`, compare the original and modified Inspector `context.ts`
and `LayerOptions.svelte` with the same fixture. The baseline switch only
relaxes the parenting-work bound; correctness checks remain active.

```sh
PM_PREVIEW_BASELINE=1 PM_PREVIEW_METRICS=/tmp/preview-before.json \
  bun run test:e2e -- preview-responsiveness.spec.ts
PM_PREVIEW_METRICS=/tmp/preview-after.json \
  bun run test:e2e -- preview-responsiveness.spec.ts
```

Run benchmarks without competing builds or tests. Native capture findings from
the preceding investigation are recorded separately in
[`native-export-performance.md`](native-export-performance.md).
