# Sandbox data plane and isolation (v2)

Status: design for `fix/sandbox-data-plane`, replacing the X2 "project mirror".
Nothing here has shipped to Store users yet, so the sandbox contract may change.

## What was wrong

1. **Eager full-project mirror.** Every sandboxed extension, whatever it did,
   deep-copied the live `PM.proj` (hand-written walker plus a `TextEncoder` per
   string), stringified it to check size, and `postMessage`d it to its runtime
   and each open view on every `project:changed`, `selection`, `time` and
   `transport` event. Playback emits `time` every frame, so one extension cost
   ~46 ms of main thread per frame on a 1.4 MB project (walk 29 ms, size check
   7 ms, structured clone 10 ms, receiver walk 6 ms). Two extensions doubled it.
2. **Reads were not a permission.** Every Store extension received the whole
   project, including the edit log.
3. **One process for all extensions.** Chromium puts sandboxed iframes of one
   site in one process, so every Store extension shared a renderer. An
   infinite loop or OOM in one froze or crashed all of them. (The editor itself
   was already in a different process.)
4. **No liveness check.** A spinning extension burned a core forever; removing
   its iframe does not stop the process.

## Design

### 1. One process per extension

- Each Store extension's documents (runtime and panel views) load from its own
  host: `app://<sandboxHost(id)>/host/ext-sandbox.html?id=…&perms=…[&view=…]`.
  `sandboxHost(id)` (`src/shared/sandbox-origin.ts`) is `x-<slug>-<hash>`, a DNS-safe,
  lowercase label (≤ 49 chars): a readable slug (≤ 20 chars) plus the leading
  130 bits of the id's SHA-256 in base32 (26 chars), so no one can craft an id
  that lands on another extension's host. The hash is a synchronous pure-JS
  SHA-256 (`src/shared/sha256.ts`) so main and the renderer agree. Different
  hosts = different sites = different processes (verified: two extensions →
  two pids, editor a third).
- The extension's bundle is served from its own host only:
  `app://<host>/ext/<id>/bundle.js`. A sandbox host serves exactly: its
  `host/ext-sandbox.html` (id must hash to the host; perms must match the
  manifest), the static chunks that document needs (`host/*.js`, `assets/*`,
  fonts), and `ext/<its own id>/…`. Everything else is 404. Main fails closed
  on a collision: a host that no installed id, or more than one, hashes to
  serves nothing, and `sandboxTerminate` kills nothing there.
- CSP of the sandbox document is derived from the manifest as today, with the
  extension's own origin: `script-src app://<host>/host/ app://<host>/ext/<id>/`.
  The editor's own CSP allows `frame-src app:`; the navigation guard allows
  sub-frame navigations only to a sandbox document on a matching host.
- `powermove serve` (browser host) keeps a single origin; process isolation
  there is whatever the browser gives. Documented limitation. Without a process
  of its own an extension cannot be blamed for missed pings (a spinning sibling
  starves them all) nor stopped, so no watchdog runs there (§2).

### 2. Watchdog

- The kernel pings each runtime (`ping` call) every 2 s. If a ping has been
  outstanding for 8 s of host time, the extension is declared unresponsive. A
  check that was itself delayed (sleep, timer throttling) sends a fresh ping
  instead of firing; if that ping is still outstanding at the next check, late
  or not, the extension is unresponsive (a live sandbox answers within
  milliseconds of the host waking). Under intensive throttling, where every
  check is late, a spin is still caught within two checks.
- Unresponsive → the kernel asks main to terminate it (`sandboxTerminate(id)`).
  Main finds frames on that extension's host across editor windows, and
  SIGKILLs each OS process only if every frame in that process belongs to that
  host and it is not an editor process. The kernel disposes the runtime and
  reports a runtime error with `code: 'sandbox_fatal'`, which the loader treats
  as an immediate disable (no windowed count): the extension shows
  "runtime-error" health and a toast.
- A crashed process (OOM) looks the same: pings stop answering.
- The watchdog runs only when the extension has its own process and main can
  end it: an Electron `app://<host>` document and a bridge with
  `sandboxTerminate`. Under `powermove serve` there is none.

### 3. Data plane: small state push, pull the project

**State.** Every document (runtime and each view) holds a small state object:

```ts
interface SandboxState { time: number; playing: boolean; revision: number; generation: number; selection: Selection | null }
```

`selection` is `null` without project read access. `init` carries `state`
(no project). Afterwards the host sends at most one `tick` notification per
microtask flush: `tick(delta: Partial<SandboxState>, events: [name, payload][])`.
The document applies the delta, then dispatches the events to local listeners
in order. Nothing is sent to a document whose state did not change and which
has no subscribed event pending.

**Events.** `events.on(name, fn)` keeps listeners inside the document. The
document registers *interest* in a name with the host (`register('events', token,
{ event })`, ref-counted: first listener registers, last one disposes). No
callback handle crosses, and there is no per-event round trip. The host
forwards occurrences of subscribed names in the next `tick`. Coalescing within
one flush: `time` and `selection` keep the last value; duplicate
`project:changed` with the same `kind` collapse; everything else is kept in
order. `project:changed` and `selection` require project read access.

**Project reads.** `api.project.get()` returns `Promise<Project>` in the
sandbox (all apiVersions; apiVersion ≤ 2 gets the `watchPromise` misuse report).
It requires `project:read` (or `project:write`, which implies it). The
document caches the parsed snapshot by `generation`: if `state.generation`
equals the cached one, it resolves at once without a message. Otherwise it
calls `project-snapshot` (one call in flight, shared by concurrent callers),
`JSON.parse`s the string, deep-freezes it, and caches it. Too large → rejects
with a clear error. The kernel sends each document (keyed per runtime or view
document, so a fresh one gets a full copy) at most one full copy per
generation; asking again for the generation it was already sent returns
`{ generation, unchanged: true }`, and the document keeps its copy.

**Snapshots on the host.** One `ProjectSnapshots` per kernel, shared by every
sandboxed extension and view in the window:

- `generation` increases on every kernel `project:changed` (any kind) and when
  `proj.revision` or the project object identity differs from the last build.
- `read()` returns `{ generation, json }` or `{ generation, tooLarge: true }`,
  building the JSON lazily **once per generation** with native `JSON.stringify`
  over a sanitized shallow view of `PM.proj`: `edits` is omitted, assets drop
  keys matching `/blob|source/i` at any depth, `library` and `notes` drop keys
  matching `/token|secret|password|key$/i` at any depth, each comp gets the same
  project rules, functions drop out. The limit is 8 Mi characters of JSON.
  The redacted copies are kept by identity of the live objects and reused
  until a `project:changed` of kind `library`, `assets`, `project` or
  `replace` (or any unknown kind) or a replaced project; `values`,
  `structure` and `history` changes pay only the native `JSON.stringify`.
- The pushed `selection` is copied and stringified once per kernel
  `selection` or `project:changed` (or project object / revision change), and
  that copy is shared by every document; a `time`-only flush does no work
  proportional to it.
- Counters for tests: `globalThis.__powermoveSandboxStats = { snapshotBuilds,
  snapshotMs, ticks, selectionBuilds }`.

Cost model: an extension that never calls `project.get()` costs one tiny
`tick` per frame it is subscribed to or whose `time` changed (microseconds). N
extensions that read on every change cost one `JSON.stringify` per change,
not N deep walks.

**Trust direction.** Messages from the kernel to a sandbox document are
trusted: the document's RPC for the kernel port skips size and rate limits
(`trusted: true`). Limits on messages *from* the sandbox stay as they are.

### 4. Permissions

`project:read`: "Reads your project". Needed for `project.get`,
`project.selection`, and the `project:changed` and `selection` events.
`project:write` implies it. `time`, `playing`, `revision`, `transport` and
`time` events need no permission. The publish-time scan and the Sandbox check
flag undeclared reads.

## Acceptance

- Playback with a Store extension that does not read the project (panel open
  or closed): no snapshot builds, host cost per frame < 0.2 ms, playback rate
  within noise of no extension.
- 1.4 MB project, an extension calling `get()` on each `project:changed`: one
  build per change, shared across extensions.
- Two Store extensions run in two processes, neither the editor's. A spinning
  extension is killed within ~12 s, turned off, and the other keeps working;
  editor frames are unaffected throughout.
- `network` keeps working (HTTPS/WSS fetch, remote images and media).
