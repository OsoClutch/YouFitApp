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
import { judgeFraming } from './framing'

let landmarker = null
let busy = false

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
    self.postMessage({ type: 'framing', verdict: judgeFraming(result?.landmarks?.[0]) })
  } catch (err) {
    self.postMessage({ type: 'framing', verdict: 'no-person', error: String(err?.message || err) })
  } finally {
    bitmap.close()
    busy = false
  }
}
