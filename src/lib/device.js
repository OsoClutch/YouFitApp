// Device profiling for the Proto holographic lineup.
//
// This replaces two magic numbers that between them took four commits to land:
// `window.innerWidth === 2160` for "is this a Luma", and a CSS
// `transform: scaleX(-1) scale(2.0) translateY(-15%)` stacked on top of
// `object-fit: cover` to frame the camera. Both were correct on exactly one
// panel and wrong everywhere else.
//
// Detection is continuous -- aspect ratio plus pixel budget -- with named
// presets available as an explicit override:
//   ?device=luma | m2 | proto | tablet
// Bare flags (`?luma`, `?proto`) also work; the old app accepted `?luma` and
// the kiosk shortcut may still carry it.
//
// The camera framing that used to live in CSS is now `cameraZoom` /
// `cameraOffsetY` here, consumed by lib/capture.js. Keeping it in JS matters
// for more than tidiness: the frame we send to the VTON model has to match the
// frame the user is standing in front of, and a CSS transform is invisible to
// canvas.

/**
 * Named calibration presets.
 *
 * `uiScale` multiplies every font and control size, and tracks viewing
 * distance rather than resolution -- a Luma is read from across a room, an M2
 * from arm's length.
 *
 * `cameraZoom` / `cameraOffsetY` define the crop taken from the camera frame.
 * Zoom 1 is a plain cover fit; offset is a fraction of the crop height, and
 * negative moves the window up, favouring head and torso over floor. The Luma
 * values reproduce the old `scale(2.0) translateY(-15%)` that was tuned on the
 * real hardware at roughly 4ft.
 */
const PRESETS = {
  luma: { proto: true, uiScale: 1.45, cameraZoom: 2.0, cameraOffsetY: -0.15, label: 'Proto Luma' },
  m2: { proto: true, uiScale: 1.0, cameraZoom: 1.4, cameraOffsetY: -0.08, label: 'Proto M2' },
  // Any Proto surface we don't have a preset for, ProtoPlayer included.
  proto: { proto: true, uiScale: 1.15, cameraZoom: 1.5, cameraOffsetY: -0.1, label: 'Proto' },
  // iPad / laptop / phone. No zoom: the user is close and already fills frame.
  tablet: { proto: false, uiScale: 1.0, cameraZoom: 1.0, cameraOffsetY: 0, label: 'Touchscreen' },
}

function readOverride(search) {
  const params = new URLSearchParams(search)
  const named = (params.get('device') || '').toLowerCase()
  if (PRESETS[named]) return named
  if (params.has('luma')) return 'luma'
  if (params.has('m2')) return 'm2'
  if (params.has('proto')) return 'proto'
  if (params.has('tablet')) return 'tablet'
  return null
}

/**
 * Infer a profile from the viewport alone.
 *
 * Aspect ratio alone cannot do this. A phone in portrait is *more* extreme
 * than a Luma (0.46 vs 0.56), so "tall and narrow" identifies a Pixel just as
 * happily as a hologram. What separates them is CSS pixel budget: a Proto is
 * driven like a desktop display and reports its full native resolution, while
 * a phone reports ~390-430px wide and a large iPad ~1024.
 *
 * So auto-detection only claims a Proto when the evidence is unambiguous, and
 * everything else falls to 'tablet'. That bias is deliberate: guessing
 * "touchscreen" on a Proto costs some UI scale until someone appends ?luma,
 * whereas guessing "Proto" on a phone zooms the camera 1.5x into a face and
 * inflates every control past the edge of the screen. The kiosk shortcut
 * carries ?luma anyway.
 */
function detect(width, height) {
  const aspect = width / height
  const longEdge = Math.max(width, height)
  const shortEdge = Math.min(width, height)

  // Portrait and physically large => holographic box.
  if (aspect < 0.8) {
    if (longEdge >= 3000) return 'luma' // 4K-class portrait panel, the 86" unit
    // A tabletop M2 reports ~1080x1920. No phone reports a 1000px short edge.
    if (longEdge >= 1900 && shortEdge >= 1000) return 'm2'
  }

  // Safety net for any unit that reports a landscape-ish viewport at the exact
  // width the original hardcoded check keyed off.
  if (width === 2160) return 'proto'

  return 'tablet'
}

export function getDeviceProfile(win = window) {
  const width = win.innerWidth
  const height = win.innerHeight
  const override = readOverride(win.location.search)
  const key = override || detect(width, height)
  const preset = PRESETS[key]

  return {
    key,
    label: preset.label,
    isProto: preset.proto,
    forced: Boolean(override),
    width,
    height,
    aspect: width / height,
    uiScale: preset.uiScale,
    cameraZoom: preset.cameraZoom,
    cameraOffsetY: preset.cameraOffsetY,
  }
}

export { PRESETS }
