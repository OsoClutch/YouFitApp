// Runtime configuration.
//
// Two things here were previously broken in ways that only showed up outside
// the dev server, so both are worth stating plainly.
//
// 1. getApiBaseUrl() used to return '/api', which resolved only because the
//    Vite dev server proxied it to localhost:8000. On a static host that same
//    path hits the CDN and 404s. It still returns '/api' -- but now that path
//    is real: functions/api/[[path]].js is deployed alongside the SPA on the
//    same origin. Same string, entirely different reason.
//
// 2. MediaPipe was loaded from `@mediapipe/tasks-vision@latest` on jsDelivr --
//    a live third-party dependency that silently upgrades across breaking
//    versions on a kiosk nobody is watching. The wasm and the model are now
//    vendored under public/mediapipe/ at pinned versions and served from our
//    own origin. Refresh them with the commands in the README.

const config = {
  // Vendored, same-origin, version-pinned. Matches @mediapipe/tasks-vision
  // 1.0.1 in package.json -- bump both together or the ABI will not match.
  //
  // Only the SIMD build is vendored (~12MB); the nosimd fallback would add
  // another 11MB for browsers that have not existed for years. If SIMD is
  // genuinely unavailable the landmarker fails to init, which costs the
  // framing guide and nothing else -- see useFramingGuide().
  wasmUrl: '/mediapipe/wasm',
  modelUrl: '/mediapipe/pose_landmarker_lite.task',

  /**
   * Base URL for the try-on API.
   *
   * `?api=` still overrides, which is how you point a Codespaces preview at a
   * deployed Pages project instead of running wrangler locally.
   */
  getApiBaseUrl() {
    const override = new URLSearchParams(window.location.search).get('api')
    if (override) {
      return override.startsWith('http') ? override : `https://${override}`
    }
    return '/api'
  },
}

export default config
