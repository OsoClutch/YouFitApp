# YouFit

A virtual try-on kiosk for the [Proto Luma](https://www.protohologram.com/) holographic
display. Someone walks up, picks a look, and sees themselves wearing it.

The whole stack runs in the cloud. There is no local toolchain to install, no
GPU to keep alive, and no machine that has to stay switched on.

---

## Status and next steps

The app is complete and tested, but **it has never made a real inference
call** — that needs a fal.ai key, which needs a card. Everything below is
what stands between this branch and a live kiosk.

### Where it stands

| | |
| --- | --- |
| Backend, frontend, art pipeline, hosting config | done |
| `npm test` — 38 unit tests | passing |
| `npm run test:e2e` — 45 headless-Chrome checks | passing |
| Real fal.ai inference | **never run** |
| Deployed to Cloudflare | not yet |
| Proto Luma hardware | not yet |

Automated checks confirm the client actually runs: the camera opens with
exactly one track, the canvas paints, MediaPipe initialises in the worker, the
confirm step does not auto-fire, and the result renders unmirrored and
letterboxed (verified by sampling canvas pixels, not by eye). Layout holds at
390×844, 1024×1366 and 2160×3840 with no overflow and no sub-44px tap targets.

### 1. Accounts

[fal.ai](https://fal.ai) for an API key — this is the only thing that costs
money, and it needs a card. A free [Cloudflare](https://dash.cloudflare.com)
account for hosting.

### 2. Deploy

Cloudflare Pages → Create project → connect this repo.

```
Build command:      npm run build
Output directory:   dist
Environment vars:   FAL_KEY = <your key>
```

Then confirm the key is bound:

```bash
curl https://<project>.pages.dev/api/health
# {"ok":true,...,"falKeyConfigured":true,...}
```

`.node-version` pins Node 22, which Pages reads automatically. Vite 8 requires
`^20.19.0 || >=22.12.0`; on anything older npm silently skips the native
rolldown binding and the build fails with a confusing missing-module error.

### 3. Run the fit check — this is the gate

**Do this before building anything else on top.** Open the deployed URL and
run all three garments against 3–4 different people. Compare against the old
IDM-VTON output.

If fit is not visibly better, stop and re-examine capture framing before
adding features. The three things that drive fit, in order, are mask quality
(solved by using a maskless model), person framing (what the silhouette guide
is for), and garment presentation (what `scripts/export_garments.py` is for).
Fine-tuning is not on that list and will not help.

> **The first real call is also the first test of the fal contract.** A bogus
> key returns 401 *before* schema validation, so the parameter names in
> `submitTryon()` have never been checked against a live request. If the first
> try-on comes back 422, that is what it means — and it is a one-line fix in
> `functions/api/[[path]].js`.

### 4. Kiosk

```
chrome --kiosk --app=https://<project>.pages.dev \
       --autoplay-policy=no-user-gesture-required
```

Camera access must never prompt, which needs the `VideoCaptureAllowedUrls`
enterprise policy. Wildcards are not supported — list the origin explicitly:

```json
{ "VideoCaptureAllowedUrls": ["https://<project>.pages.dev"] }
```

### 5. Monitoring

Point [cron-job.org](https://cron-job.org) at `/api/health` every 10 minutes
with failure email on. Keep-warm is an advertised use of their free tier.
UptimeRobot's free tier became non-commercial-only in December 2024.

### 6. Soak it

Leave the kiosk running for an hour. Watch for memory growth, confirm the idle
reset returns to the attract screen after 60s, and confirm the watchdog reloads
the page after three consecutive inference failures.

### Known gaps

- **M2-navy-blazer needs re-sourcing.** The original is 540×360 landscape, so
  the export upscales ~2.9×. Usable, but visibly soft next to W2.
- **The catalog is three garments** — two men's, one women's. Adding more is
  one PNG plus one entry; see [The catalog](#the-catalog).
- **The Luma profile is verified in software only**, at 2160×3840. The
  holographic art direction still needs the real panel.
- **The camera is not released on the idle reset.** Deliberate — re-acquiring
  costs 1–3s of black screen every timeout, and the framing guide exists so
  people are standing correctly *before* they interact. Leaks are fixed; the
  stream is just held.

---

## Architecture

```
Cloudflare Pages
  ├─ /                          Vite SPA from dist/
  ├─ /garments/*.png            committed to the repo — same-origin
  ├─ /mediapipe/*               vendored, version-pinned wasm + .task
  ├─ _headers · _redirects · _routes.json
  └─ functions/api/[[path]].js  Pages Function — holds FAL_KEY
                                     │
                                     ▼
                        queue.fal.run/fal-ai/fashn/tryon/v1.6
```

Two constraints produced this shape.

**The API key must never reach the browser**, so a server-side hop is
mandatory. Cloudflare Pages Functions is the only free option that can hold a
long request open, and static-asset requests are free and unmetered — with
`_routes.json` limiting the Function to `/api/*`, serving the SPA costs no
invocations at all.

**No single HTTP hop may exceed ~30s.** Cloudflare's proxy gives up at 100s
(Error 524, Enterprise-only to raise). fal's queue API is already job-shaped,
so the API mirrors it rather than fighting it:

| | |
| --- | --- |
| `POST /api/tryon?garment=<id>` | body is the person frame as a JPEG data URI → `{ request_id }` in under a second |
| `GET /api/tryon/:id` | `{ status, queue_position }` while running, `{ status: 'COMPLETED', image_url }` when done |
| `GET /api/health` | liveness, for the keep-warm ping |

That also gives the kiosk a real progress indicator instead of a spinner, and
keeps the whole thing portable if we ever move hosts.

### Why FASHN VTON v1.6

It is the one model whose API takes our assets as they are.

| Param | Value | Why |
| --- | --- | --- |
| `category` | `tops` | Matches the catalog; no wrong-region masking |
| `garment_photo_type` | `flat-lay` | Our garments are clean packshots on white |
| `segmentation_free` | `true` | **Maskless** — deletes the entire detectron2 / DensePose / SCHP / OpenPose stack |
| `mode` | `quality` | 864×1296 output |

Apache-2.0 weights, seconds rather than minutes, and mask quality — the
documented number-one cause of bad fit — stops being something we can get
wrong. The previous plan of record, IDM-VTON, is CC BY-NC-SA 4.0
(non-commercial) and upper-body/VITON-HD only.

---

## Quick start

The build machine has no Node, no Homebrew and no Docker. Rather than rebuild
that, develop in **GitHub Codespaces** — 120 core-hours and 15 GB/month free on
a personal account, hard-stops instead of billing, no card required.
`.devcontainer/devcontainer.json` pins Node 22 and installs everything.

```bash
npm install
npm run dev          # SPA only, on :5173 — no API
npm run pages:dev    # build + wrangler, the real thing, on :8788
npm run lint
npm run build
```

`npm run dev` is fine for UI work but has no backend: there is no proxy and
nothing listening on `/api`. Anything touching try-on needs `pages:dev`.

To point a Vite dev server at an already-deployed backend instead, use
`?api=https://<project>.pages.dev/api`.

### Secrets

`FAL_KEY` from [fal.ai](https://fal.ai). It is never committed and never
reaches the browser.

```bash
# local
npx wrangler pages dev dist --binding FAL_KEY=<key>

# Codespaces: add FAL_KEY at github.com/settings/codespaces
# production: Cloudflare Pages → Settings → Environment variables
```

`GET /api/health` reports `falKeyConfigured` so a project deployed without the
key is obvious immediately, rather than on the first try-on.

### Node version

Pinned to 22 in `.node-version` and the devcontainer. Vite 8 requires
`^20.19.0 || >=22.12.0`; on anything older npm silently skips the native
rolldown binding and the build fails with a confusing missing-module error.

### Testing

```bash
npm test        # 38 unit tests, no browser, no network — under a second
npm run test:e2e  # 45 checks in headless Chrome against a running wrangler
```

The unit tests cover the pure logic that decides what the model sees: crop
geometry, device profiling, framing verdicts, and the catalog contract shared
with the Pages Function.

The end-to-end suite needs three things running:

```bash
npm run build && npx wrangler pages dev dist --port 8788 --binding FAL_KEY=x
scripts/chrome-headless.sh     # separate terminal
npm run test:e2e               # separate terminal
```

Chrome's `--use-fake-device-for-media-stream` supplies a synthetic camera, so
`getUserMedia`, the MediaPipe worker and the canvas all run with no hardware
and no permission prompt. The try-on API is stubbed with an image that has a
red stripe down the left and blue down the right — which is how the two result
bugs stay fixed: a mirrored draw puts red on the right, and a stretched draw
has no letterbox bars. Set `SHOT=/tmp/youfit` to write screenshots.

Neither suite spends anything at fal. The one thing they cannot check is
whether the garments actually *fit* — that needs a real key and human eyes.

---

## Hosting and kiosk behaviour

The step-by-step is in [Status and next steps](#status-and-next-steps); this
is what the app does once it is up.

It serves from the root, so no `base` change is needed. `_headers`,
`_redirects` and `_routes.json` ship from `public/` and Pages applies them
automatically — including `_routes.json`, which confines the Function to
`/api/*` so serving the SPA and the 17 MB of vendored MediaPipe costs no
Function invocations.

For unattended operation the app:

- requests a **Screen Wake Lock** and re-acquires it on `visibilitychange`,
  because the browser drops the lock whenever the page is hidden — which is
  exactly the case being guarded against
- **resets to the attract screen** after 60s idle
- **reloads itself** after three consecutive inference failures
- declares `display: fullscreen` in `manifest.webmanifest` for installed use

---

## The catalog

`src/garments.js` is the single source of truth. The browser renders from it
and the Pages Function imports the same module to resolve an id into a URL —
so the client sends `M1`, never a URL, and nobody can point our inference
budget at an arbitrary image.

Everything in it is **upper-body**. FASHN runs with `category: 'tops'`; feeding
it trousers or a full-length dress makes it paint the garment across the torso.
That is what went wrong before — the old catalog had two pairs of joggers and a
midi dress in it.

### Adding a garment

1. Drop a flat-lay packshot on a white background into the source art folder.
2. Add it to `GARMENTS` in `scripts/export_garments.py` and to `src/garments.js`.
3. `npm run garments`

The script trims the garment to its bounding box, scales it to a fixed share of
an 864×1152 portrait canvas and centres it on **white** — not transparent, since
VTON encoders are trained on white packshots and an alpha channel just gets
composited onto black somewhere downstream. Output PNGs are committed, so a
fresh clone never needs to run it. It needs macOS (`sips`).

Where a cutout is genuinely required, use [BiRefNet](https://github.com/ZhengPeng7/BiRefNet)
(MIT) and composite onto white.

**M2-navy-blazer is the one asset that should be re-sourced.** The original is
540×360 landscape with the garment occupying about 270×343 of it, so the export
upscales ~2.9×. It is a clean packshot and the model will read it fine, but it
is visibly soft next to W2 in the catalog strip.

---

## Fit

Fit is not a training problem. Every current VTON model is zero-shot on
arbitrary garments, and 2025–26 SOTA has moved to explicitly training-free.
What actually moves the needle, in order:

1. **Mask quality** — handled, by using a maskless model.
2. **Person framing** — handled here, and the reason for the silhouette guide.
3. **Garment presentation** — handled by the export script.

`src/lib/capture.js` centre-crops the camera frame to the model's 2:3 and
downscales to 864×1296. Previously the raw 9:16 frame was sent and the model
squashed it, distorting the body before inference even started.

The framing guide draws the *exact* region that will be sent, and MediaPipe
pose landmarks (in a Web Worker) drive one hint at a time — step back, move to
the centre, face the camera, arms at your sides. It is cheaper and more
effective than any model change.

---

## Device profiles

`src/lib/device.js` profiles on aspect ratio and pixel budget, and exposes
`{ key, isProto, uiScale, cameraZoom, cameraOffsetY }`. Override with
`?device=luma|m2|proto|tablet` (bare `?luma` and `?proto` also work).

This replaced `window.innerWidth === 2160` and a CSS
`transform: scaleX(-1) scale(2.0) translateY(-15%)` — a magic number that took
four commits to land, was correct on exactly one panel, and was invisible to
the canvas, so the frame sent for inference never matched what was on screen.
Camera framing is now computed in JS from the profile, and everything in
`App.css` is sized in `em` against a single `--ui` scale.

---

## Cost, and the way out

Roughly **$0.075/image**. A 3-day demo at 50 try-ons/day is about **$11**.
Sustained 200/day is about **$450/month**.

If it ever runs at that volume, only `submitTryon()` and `fetchStatus()` in the
Pages Function need to change: self-hosted FASHN VTON 1.5 (Apache-2.0) fits in
~8 GB VRAM and runs on [Modal](https://modal.com)'s $30/month recurring credit.
The frontend never learns about it.

Risks worth knowing: fal.ai is a single vendor with no SLA on our tier, and
FASHN's maskless mode leaves traces on long-to-short garment transitions — so
avoid catalog items that require removing bulky sleeves.

---

## Layout

```
functions/api/[[path]].js   the backend: submit, poll, health
src/
  App.jsx                   state machine + camera + canvas
  garments.js               catalog, shared with the Function
  config.js                 API base URL, vendored MediaPipe paths
  components/               GenderScreen · GarmentBar · LoadingOverlay · FramingGuide
  lib/
    capture.js              crop geometry — preview, capture and guide agree
    device.js               device profiling
    framing.js              landmarks -> one hint (pure, unit-tested)
    tryon.js                submit + poll client
    pose.worker.js          landmarker, off the main thread (classic worker)
    useFramingGuide.js      worker driver → one stable hint
    useDeviceProfile.js     profile, re-read on resize
    wakelock.js             screen wake lock
public/
  garments/                 864×1152 packshots, committed
  mediapipe/                pinned wasm + model, ~17 MB
tests/                      unit tests (node --test)
scripts/
  export_garments.py        art pipeline (macOS)
  e2e.mjs                   headless-Chrome end-to-end checks
  chrome-headless.sh        launches Chrome with a fake camera
```

### One sizing decision worth knowing

**Only the SIMD MediaPipe build is vendored** (~12 MB). The nosimd fallback
would add another 11 MB for browsers that have not existed for years. If SIMD
is genuinely unavailable the landmarker fails to initialise, which costs the
framing guide and nothing else — the kiosk still works end to end.

(The other deliberate choice, holding the camera stream open across idle
resets, is covered in [Known gaps](#known-gaps).)
