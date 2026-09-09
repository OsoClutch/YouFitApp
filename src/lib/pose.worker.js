// Pose landmarking, off the main thread.
//
// This runs as a *classic* worker on purpose. MediaPipe's wasm loader branches
// on `typeof importScripts`, and in a module worker that check fails through to
// a `document.createElement('script')` path -- which throws, because a worker
// has no document. Vite is told to emit iife for workers (see vite.config.js);
// do not add `{ type: 'module' }` at the call site.
//
// What it produces is a framing verdict, not raw landmarks: the main thread
// gets one small string per frame instead of 33 points to reason about. Person
// framing is the second-largest driver of try-on quality after masking, and
// FASHN's maskless mode already took masking off our plate -- so this is the
// highest-leverage thing left, and it costs one silhouette and a hint line.

import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

let landmarker = null
let busy = false

// Thresholds are in the normalised coordinate space of the 2:3 crop we send,
// which is the same crop that goes to the VTON model. Tuned for head-to-
// mid-thigh framing: shoulders near y=0.25, hips near y=0.65.
const TORSO_MIN = 0.24 // below this the person is too far away
const TORSO_MAX = 0.52 // above this they are too close to fit in frame
const CENTRE_MIN = 0.34
const CENTRE_MAX = 0.66
const FACING_MIN = 0.55 // shoulder breadth / torso height, aspect-corrected
const VISIBLE_MIN = 0.5
const FRAME_ASPECT = 2 / 3

self.onmessage = async (event) => {
  const msg = event.data
  if (msg.type === 'init') {
    await init(msg)
  } else if (msg.type === 'frame') {
    detect(msg)
  } else if (msg.type === 'close') {
    landmarker?.close()
    landmarker = null
  }
}

async function init({ wasmUrl, modelUrl }) {
  try {
    const vision = await FilesetResolver.forVisionTasks(wasmUrl)
    landmarker = await createLandmarker(vision, modelUrl)
    self.postMessage({ type: 'ready' })
  } catch (err) {
    // Non-fatal by contract: the app runs without a framing guide.
    self.postMessage({ type: 'failed', error: String(err?.message || err) })
  }
}

async function createLandmarker(vision, modelUrl) {
  const options = {
    baseOptions: { modelAssetPath: modelUrl, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numPoses: 1,
  }
  try {
    return await PoseLandmarker.createFromOptions(vision, options)
  } catch {
    // Some Proto units expose a GL context the delegate refuses. The lite
    // model on 256x384 bitmaps at 6Hz is comfortable on CPU.
    options.baseOptions.delegate = 'CPU'
    return await PoseLandmarker.createFromOptions(vision, options)
  }
}

function detect({ bitmap, timestamp }) {
  // Drop frames rather than queue them: a stale verdict is worse than none.
  if (!landmarker || busy) {
    bitmap.close()
    return
  }
  busy = true
  try {
    const result = landmarker.detectForVideo(bitmap, timestamp)
    self.postMessage({ type: 'framing', verdict: judge(result?.landmarks?.[0]) })
  } catch (err) {
    self.postMessage({ type: 'framing', verdict: 'no-person', error: String(err?.message || err) })
  } finally {
    bitmap.close()
    busy = false
  }
}

/**
 * Turn landmarks into a single actionable hint.
 *
 * Ordered by what the user should fix first: being in frame beats being
 * centred, which beats being square to the camera, which beats arm position.
 * Only one hint is ever shown, so the order is the whole UX.
 */
function judge(points) {
  if (!points || points.length < 25) return 'no-person'

  const [leftShoulder, rightShoulder] = [points[11], points[12]]
  const [leftHip, rightHip] = [points[23], points[24]]

  const seen = (p) => p && (p.visibility ?? 1) >= VISIBLE_MIN
  if (!seen(leftShoulder) || !seen(rightShoulder)) return 'no-person'
  if (!seen(leftHip) || !seen(rightHip)) return 'too-close'

  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2
  const hipY = (leftHip.y + rightHip.y) / 2
  const torsoH = Math.abs(hipY - shoulderY)

  if (torsoH > TORSO_MAX || shoulderY < 0.08) return 'too-close'
  if (torsoH < TORSO_MIN) return 'too-far'

  const centreX = (leftShoulder.x + rightShoulder.x) / 2
  if (centreX < CENTRE_MIN || centreX > CENTRE_MAX) return 'off-centre'

  // Shoulder breadth collapses when the body turns. Both spans are normalised
  // to their own axis, so correct for the frame's aspect before comparing.
  const shoulderW = Math.abs(leftShoulder.x - rightShoulder.x)
  if ((shoulderW * FRAME_ASPECT) / torsoH < FACING_MIN) return 'turned'

  // Wrists are often cropped out at mid-thigh framing; only judge when seen.
  const [leftWrist, rightWrist] = [points[15], points[16]]
  const raised = (w) => seen(w) && w.y < shoulderY + torsoH * 0.35
  if (raised(leftWrist) || raised(rightWrist)) return 'arms-raised'

  return 'ready'
}
