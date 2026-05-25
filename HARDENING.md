# Hardening / Performance / QA pass — review notes

Branch: `chore/hardening-perf-qa` (off `main` @ 96dde87). **Not merged, not in prod.**
Everything here is for your review. Prod (`gfs-lab.vercel.app`) is untouched.

Run `npm test` → **243 static asserts + 12 model asserts, all green.**

---

## 🔒 Security

### 1. SSRF fix in the AR model route (`api/model/[id].js`) — important
**Before:** the function fetched the artwork using the client-controllable
`X-Forwarded-Host` / `Host` header:
```js
const host = req.headers["x-forwarded-host"] || req.headers.host;
fetch(`https://${host}/fragments/${id}.webp`)
```
An attacker could spoof the host to make the server fetch from an arbitrary
origin (SSRF — e.g. cloud metadata endpoints).

**After:** pinned to the deployment's own host via `process.env.VERCEL_URL`
(platform-set, not client-controllable):
```js
const selfHost = process.env.VERCEL_URL || req.headers.host;
fetch(`https://${selfHost}/fragments/${id}.webp`)
```

### 2. Permissions-Policy tightened (`vercel.json`)
We had temporarily granted `camera`, `xr-spatial-tracking`, `gyroscope`,
`accelerometer`, `magnetometer` to `self` for the in-page WebXR path. That path
was removed (AR is now native Scene Viewer / Quick Look, which run outside the
page). These are now back to `()` — the page requests no camera/sensor perms.

### 3. CSP `connect-src` — flagged, NOT changed (needs browser verify)
`connect-src` still allows `blob: data:`. With native AR + no client-side GLB
blob, `data:` is likely unneeded and `blob:` may be too. I did **not** tighten
it to avoid breaking model-viewer's preview without a browser to test against.
**Action for you:** after confirming AR still works, try removing `data:` (then
`blob:`) from `connect-src` and re-test the "View in your room" preview + AR.

---

## ⚡ Performance

1. **`modulepreload` for three.js** (`index.html`) — the ~600KB core now starts
   downloading in parallel with HTML parse instead of waiting for `app.js` to
   execute. Faster first render of the frame.
2. **model-viewer is no longer idle-prewarmed** (`app.js`) — it's ~300KB and
   only ~1% of visitors open AR. It now loads lazily on first AR-modal open, so
   everyone else saves the bandwidth. Matters at viral scale.

(Static assets were already edge-cached + immutable; the SW is network-first for
code so releases land immediately. No change needed there.)

---

## 🧪 Testing (deeper + more integral)

1. **Extracted the GLB builder** to `api/_lib/build-glb.js` (pure, no network) so
   it's unit-testable. The route now just does I/O + delegates.
2. **New deep test** `tests/model.test.mjs` (`npm run test:model`): builds a real
   GLB from a pre-baked fragment (sharp webp→jpeg → gltf-transform) and validates
   it with the **Khronos glTF validator (0 errors)** + asserts structure (2
   meshes, embedded jpeg, POSITION min/max that Scene Viewer requires, scale).
   This exercises the exact bytes Scene Viewer downloads.
3. **New `[11]` static asserts** for the SSRF guard, perms lockdown, modulepreload,
   lazy model-viewer, and the desktop AR-button fallback.
4. `npm test` now runs both suites; `test:static` / `test:model` run them apart.

---

## 🧹 Quality / bug fix included

- **Desktop "View in AR" button** (the bug you parked): added a CSS-only fallback
  — `@media (hover: hover) and (pointer: fine) { #arLaunch { display: none } }`.
  This hides it on desktop regardless of JS/service-worker cache state (the JS
  `AR_SUPPORTED` check stays as the precise mobile detector). Belt-and-suspenders.
  **Verify** it disappears on desktop and still shows on mobile.

---

## ✅ Suggested review checklist before merging
- [ ] `npm test` green locally (243 + 12).
- [ ] Deploy this branch as a **preview**, then on the preview:
  - [ ] AR still works on iOS (Quick Look) + a healthy-Scene-Viewer Android.
  - [ ] "View in AR" hidden on desktop, shown on mobile.
  - [ ] 3D preview still renders in the modal.
- [ ] (Optional) try tightening `connect-src` (drop `data:`, then `blob:`) and re-test AR.
- [ ] Remember `gfs-lab.vercel.app` is a pinned alias — re-point it after merging,
      or set it to track Production in Vercel → Settings → Domains.
