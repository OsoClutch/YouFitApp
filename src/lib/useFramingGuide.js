// Drives the pose worker and turns its verdicts into one stable hint.

import { useEffect, useRef, useState } from 'react'
import config from '../config'
import { personCropRect } from './capture'

// 6Hz. Framing feedback only needs to feel responsive to a person moving, and
// every frame costs an ImageBitmap allocation on the main thread.
const SAMPLE_MS = 160

// Small enough to be cheap to build and transfer, large enough for the lite
// model. 2:3, matching the crop.
const SAMPLE_W = 256
const SAMPLE_H = 384

// A verdict has to repeat before it is shown. Without this the hint flickers
// between two states whenever the user sits on a threshold.
const STABLE_FRAMES = 3

export const FRAMING_HINTS = {
  'no-person': 'Step into frame',
  'too-close': 'Step back a little',
  'too-far': 'Step closer',
  'off-centre': 'Move to the centre',
  turned: 'Face the camera',
  'arms-raised': 'Arms at your sides',
  ready: "You're set — pick a look",
}

/**
 * @param {{current: HTMLVideoElement}} videoRef
 * @param {object} profile  device profile, for the crop
 * @param {boolean} active  false pauses sampling (result showing, idle, etc.)
 * @returns {{verdict: string|null, ready: boolean, available: boolean}}
 */
export function useFramingGuide(videoRef, profile, active) {
  const [verdict, setVerdict] = useState(null)
  const [available, setAvailable] = useState(false)
  const workerRef = useRef(null)
  const pendingRef = useRef({ value: null, count: 0 })
  // Read by the worker's message handler, which outlives any one activation.
  const activeRef = useRef(false)

  // The worker outlives individual activations -- init is the expensive part
  // (a ~12MB wasm instantiation) and we only want to pay it once.
  useEffect(() => {
    // Classic worker, deliberately. See the header of pose.worker.js.
    const worker = new Worker(new URL('./pose.worker.js', import.meta.url))
    workerRef.current = worker

    worker.onmessage = (event) => {
      const msg = event.data
      if (msg.type === 'ready') {
        setAvailable(true)
        return
      }
      if (msg.type === 'failed') {
        // Degrade quietly: no guide, but the kiosk still works end to end.
        console.warn('Framing guide unavailable:', msg.error)
        setAvailable(false)
        return
      }
      if (msg.type === 'framing') {
        if (!activeRef.current) return
        const pending = pendingRef.current
        if (msg.verdict === pending.value) {
          pending.count += 1
        } else {
          pending.value = msg.verdict
          pending.count = 1
        }
        if (pending.count >= STABLE_FRAMES) setVerdict(msg.verdict)
      }
    }

    worker.postMessage({
      type: 'init',
      wasmUrl: new URL(config.wasmUrl, window.location.href).href,
      modelUrl: new URL(config.modelUrl, window.location.href).href,
    })

    return () => {
      worker.postMessage({ type: 'close' })
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!active || !available) return

    activeRef.current = true
    pendingRef.current = { value: null, count: 0 }
    let cancelled = false
    const timer = setInterval(async () => {
      const video = videoRef.current
      const worker = workerRef.current
      if (!video || !worker || video.readyState < 2) return

      const { sx, sy, sw, sh } = personCropRect(video, profile)
      try {
        // Crop and downscale in one step; createImageBitmap does it off the
        // main thread where the browser can, and the result transfers by move.
        const bitmap = await createImageBitmap(video, sx, sy, sw, sh, {
          resizeWidth: SAMPLE_W,
          resizeHeight: SAMPLE_H,
          resizeQuality: 'low',
        })
        if (cancelled) {
          bitmap.close()
          return
        }
        worker.postMessage({ type: 'frame', bitmap, timestamp: performance.now() }, [bitmap])
      } catch {
        // A frame can fail mid-teardown; the next tick will do.
      }
    }, SAMPLE_MS)

    return () => {
      cancelled = true
      activeRef.current = false
      clearInterval(timer)
    }
  }, [active, available, profile, videoRef])

  // Derived rather than cleared in an effect. While inactive the last verdict
  // is simply not surfaced; it is replaced within a few frames of resuming.
  const current = active && available ? verdict : null
  return { verdict: current, ready: current === 'ready', available }
}
