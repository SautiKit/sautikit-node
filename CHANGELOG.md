# Changelog

All notable changes to `@sautikit/node`. This file reconciles the npm
registry history with the repo, because several early preview versions were
published to npm without a matching commit.

The format loosely follows [Keep a Changelog](https://keepachangelog.com/);
this package is pre-1.0, so any release may change the public API — pin your
version.

## 0.2.1 — unreleased (in repo)

### Fixed

- **ESM output was unloadable by Node.** 0.2.0 emitted extensionless relative
  specifiers (`export * from "./verbs"`). Node's ESM resolver requires explicit
  extensions, so `import "@sautikit/node"` failed with `ERR_MODULE_NOT_FOUND`
  under plain Node — the package only worked if a bundler resolved it. Source
  specifiers now carry explicit `.js` extensions.

- **`dial` fan-out was unreachable.** `DialParams` modelled a two-way XOR
  (`number` XOR `sip`), but the runtime's `DialAction` is a **three**-way XOR —
  `number` | `numbers` | `sip` (`ErrDialTargetXOR`). The `numbers` fan-out list
  (rendered into the `<Dial phoneNumbers="…">` attribute) had no typed path, so
  callers migrating multi-destination dials had to hand-patch the emitted
  action. `DialParams` is now a three-way union:

  ```ts
  dial({ numbers: ["+254700000001", "+254700000002"], callerId: "+254712345678" })
  ```

  Mixing `number` with `numbers` (`ErrDialNumberNumbers`) or omitting all three
  destinations is now a compile error, matching the runtime's rules.

### Added

- **Dual CommonJS + ESM build.** 0.2.0 was ESM-only (`"type": "module"` with an
  import-only `exports` map), so `require("@sautikit/node")` failed with
  `ERR_PACKAGE_PATH_NOT_EXPORTED` and CommonJS consumers had to bundle the
  package (e.g. webpack `transpilePackages`) to use it at all. The package now
  ships both:
  - ESM at `dist/` (`import` condition, unchanged paths)
  - CJS at `dist/cjs/` (`require` condition), scoped by a generated
    `dist/cjs/package.json` (`{"type":"commonjs"}`)
  - Per-condition `types`, so both `node16`/`nodenext` and legacy TypeScript
    resolution get correct declarations
  - `main` now points at the CJS entry for pre-`exports` resolvers; `module`
    points at the ESM entry

  Consumers that added a bundler allowlist for this package can drop it.

  Built with a second `tsc` pass (`tsconfig.cjs.json`) — no bundler added, so
  the package keeps zero runtime dependencies.

### Verified

Both entry points exercised against a packed tarball installed into throwaway
projects: `require("@sautikit/node")` and `import "@sautikit/node"` each
construct a client, perform a stubbed `calls.create`, and build verbs.

## 0.2.0 — 2026-07-17

Published to npm as `latest`. **Note:** ESM-only and, due to extensionless
emit, loadable only through a bundler — both fixed in 0.2.1.

### Added

- **Transport layer — `SautikitClient`.** The package now ships a server-side
  API client alongside the voice-action verb builders:
  - `new SautikitClient({ apiKey?, baseUrl?, fetch? })` — bearer auth with a
    `SAUTIKIT_API_KEY` environment fallback; dependency-free (uses the
    runtime's global `fetch`, injectable for tests/proxies).
  - `client.calls` — `create`, `get`, `list`, `stats`, `hangup`, `recording`.
    `create` auto-generates an `Idempotency-Key` (override supported) and
    supports `control: "mcp"` calls. `recording` handles the 302/202 redirect
    contract, returning a `{ status: "ready", url }` | `{ status: "pending",
    retryAfterSeconds }` union.
  - `client.webrtc.mintToken` — server-side WebRTC token minting to hand to
    `@sautikit/webrtc` in the browser (keeps the API key off the client).
  - `SautikitError` — typed `{ status, code, message, requestId }`, parsed
    from the API error envelope.

### Notes

- Wire shapes track `docs/openapi.public.yaml` as aligned with the live
  handlers (repo commit `76d2d0d`): `POST /v1/calls` returns
  `{ call_id, session_id, status }` (201); hangup returns
  `{ call_id, status: "hung_up" }` (200).
- The verb builders (`say`, `getDigits`, `voice()`, `sauti`, …) are unchanged.

## 0.1.4 — 2026-07-02

Builder-only preview. **Dist byte-identical to 0.1.2** — an untracked local
version bump with no code change. Was the npm `latest` tag until 0.2.0.

## 0.1.3 — 2026-07-02

Builder-only preview. **Dist byte-identical to 0.1.2** — an untracked local
version bump with no code change.

## 0.1.2 — 2026-07-02

Builder-only preview (verb builders: `verbs`, `builder`). Last version whose
`package.json` was committed to the repo (commit `6e6c0c8`).

## 0.1.1 — 2026-07-02

Builder-only preview. Was (mis)pointed to by the npm `next` dist-tag, which
sat older than `latest`; that tag has since been removed — see Registry
reconciliation.

## 0.1.0 — 2026-07-02

Initial preview publish. Voice-action verb builders only.

---

## Registry reconciliation (2026-07-17)

The npm registry ran ahead of the repo: versions **0.1.0–0.1.4** were all
published on 2026-07-02, but git only ever committed `0.1.2`. Inspecting the
published tarballs, **0.1.2, 0.1.3, and 0.1.4 have identical `dist/`** — the
extra bumps carried no code, so no published work is missing from the repo.

Resolution:

- The repo moves to **0.2.0** (minor bump for the new transport feature),
  which is greater than the registry's `latest` (0.1.4) and therefore
  publishes cleanly with no collision.
- npm publishes are immutable and 0.1.3/0.1.4 are outside the unpublish
  window; they are left as-is and superseded by 0.2.0.
- ✅ **Done (2026-07-17):** 0.2.0 published as `latest`, and the stale `next`
  dist-tag (stuck at 0.1.1) was removed. Registry dist-tags are now just
  `{ latest: 0.2.0 }`.
- Going forward, bump the version **in a commit** (and tag it) before
  `npm publish`, so the registry and repo never diverge again.
