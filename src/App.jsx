import { useCallback, useEffect, useRef, useState } from 'react'
import garments from './garments'
import { captureRegionInDisplay, drawCameraFrame, drawContain } from './lib/capture'
import { runTryon } from './lib/tryon'
import { useDeviceProfile } from './lib/useDeviceProfile'
import { useFramingGuide } from './lib/useFramingGuide'
import { setupWakeLock } from './lib/wakelock'
import FramingGuide from './components/FramingGuide'
import GarmentBar from './components/GarmentBar'
import GenderScreen from './components/GenderScreen'
import LoadingOverlay from './components/LoadingOverlay'
import './App.css'

const IDLE_RESET_MS = 60_000

// Consecutive inference failures before the kiosk reloads itself. Three is
// enough to ride out a transient fal hiccup without a human, and few enough
// that a wedged page does not stay wedged all afternoon.
const FAILURES_BEFORE_RELOAD = 3

// Cap the backing store so the render loop stays affordable. A Luma is
// 2160x3840 and needs every pixel; nothing needs more.
const MAX_CANVAS_EDGE = 4096

export default function App() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const resultImgRef = useRef(null)
  const abortRef = useRef(null)
  const idleTimerRef = useRef(null)
  const failureCountRef = useRef(0)

  const [gender, setGender] = useState(null)
  const [selected, setSelected] = useState(null)
  // 'live' -> camera preview | 'working' -> generating | 'result' -> showing
  const [phase, setPhase] = useState('live')
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [region, setRegion] = useState(null)

  const profile = useDeviceProfile()
  const showGuide = cameraReady && !gender && phase === 'live'
  const { verdict } = useFramingGuide(videoRef, profile, showGuide)

  // ===== Reset =====
  const resetToAttract = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    resultImgRef.current = null
    setGender(null)
    setSelected(null)
    setPhase('live')
    setProgress(null)
    setError(null)
  }, [])

  // ===== Idle timer (kiosk) =====
  useEffect(() => {
    // pointermove fires ~60Hz wherever there is a mouse, so only actually
    // rebuild the timeout once a second.
    let last = 0
    const bump = () => {
      const now = Date.now()
      if (now - last < 1000) return
      last = now
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = setTimeout(resetToAttract, IDLE_RESET_MS)
    }
    const events = ['pointerdown', 'pointermove', 'keydown']
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    bump()
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump))
      clearTimeout(idleTimerRef.current)
    }
  }, [resetToAttract])

  // ===== Screen wake lock =====
  useEffect(() => setupWakeLock(), [])

  // Drop any in-flight generation if the app goes away mid-poll.
  useEffect(() => () => abortRef.current?.abort(), [])

  // ===== Camera =====
  // The stream lives in a ref and every track is stopped on teardown. It used
  // to be a local inside setup(), so nothing ever stopped it: the camera light
  // stayed on, and StrictMode's double-invoke leaked a second stream on every
  // mount. `cancelled` covers the same race for the async path.
  useEffect(() => {
    let cancelled = false
    const video = videoRef.current

    async function setup() {
      try {
        const stream = await openCamera()
        if (cancelled || !video) {
          stopStream(stream)
          return
        }
        streamRef.current = stream
        video.srcObject = stream
        await video.play().catch(() => {})
        if (cancelled) return
        setCameraReady(true)
      } catch (err) {
        if (cancelled) return
        console.error('Camera setup failed:', err)
        setError('Camera unavailable — check permissions and reload.')
      }
    }

    setup()

    return () => {
      cancelled = true
      stopStream(streamRef.current)
      streamRef.current = null
      if (video) video.srcObject = null
    }
  }, [])

  // ===== Live preview loop =====
  // Runs only while the camera is the thing on screen. The old loop redrew a
  // static result at 60fps forever on a 2160x3840 canvas; here 'result' simply
  // is not a state this effect runs in.
  useEffect(() => {
    if (!cameraReady || phase === 'result') return

    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return

    const ctx = canvas.getContext('2d')
    let raf = 0

    const tick = () => {
      if (video.readyState >= 2) {
        sizeCanvas(canvas)
        // Mirrored, so the preview reads like a mirror. This flip is confined
        // to the live path -- it must never touch the capture or the result.
        drawCameraFrame(ctx, video, profile, { mirror: true })
      }
      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => cancelAnimationFrame(raf)
  }, [cameraReady, phase, profile])

  // ===== Result =====
  // Drawn once, unmirrored, letterboxed to its own aspect ratio. The result is
  // 2:3 and the Luma canvas is 9:16; stretching one onto the other is what made
  // early output look subtly wrong.
  useEffect(() => {
    if (phase !== 'result') return
    const canvas = canvasRef.current
    const img = resultImgRef.current
    if (!canvas || !img) return
    sizeCanvas(canvas)
    drawContain(canvas.getContext('2d'), img)
  }, [phase, profile])

  // ===== Framing guide geometry =====
  // Measured on a frame callback, not in the effect body: the canvas has no
  // backing size until the preview loop has run once, and the video has no
  // dimensions until metadata lands. Retry until both are real.
  useEffect(() => {
    if (!showGuide) return
    let raf = 0
    const measure = () => {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (video?.videoWidth && canvas?.width) {
        setRegion(captureRegionInDisplay(video, profile, canvas.width / canvas.height))
        return
      }
      raf = requestAnimationFrame(measure)
    }
    raf = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(raf)
  }, [showGuide, profile])

  // ===== Try-on =====
  const confirmTryon = useCallback(async () => {
    const garment = selected
    if (!garment) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setPhase('working')
    setProgress(null)
    setError(null)

    try {
      const imageUrl = await runTryon(videoRef.current, garment, profile, {
        signal: controller.signal,
        onProgress: setProgress,
      })
      const img = await loadImage(imageUrl, controller.signal)
      if (controller.signal.aborted) return
      resultImgRef.current = img
      failureCountRef.current = 0
      setPhase('result')
    } catch (err) {
      if (err?.name === 'AbortError') return
      console.error('Try-on failed:', err)
      setError(err?.message || 'Something went wrong — try again.')
      setPhase('live')

      // Watchdog. A run of failures usually means the page, not the service:
      // a dead camera track, a wedged worker, a stale deploy.
      failureCountRef.current += 1
      if (failureCountRef.current >= FAILURES_BEFORE_RELOAD) window.location.reload()
    }
  }, [selected, profile])

  const selectGarment = useCallback((item) => {
    setSelected(item)
    if (phase === 'result') {
      resultImgRef.current = null
      setPhase('live')
    }
  }, [phase])

  const tryAnother = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    resultImgRef.current = null
    setSelected(null)
    setPhase('live')
    setProgress(null)
    setError(null)
  }, [])

  const catalog = gender ? garments[gender] : []
  const containerStyle = { '--ui': profile.uiScale }

  return (
    // uiScale tracks viewing distance, not resolution. Every size in
    // App.css is an em against it, so one number moves the whole UI.
    <div className="luma-container" data-device={profile.key} style={containerStyle}>
      <video ref={videoRef} autoPlay playsInline muted className="camera-feed-hidden" />
      <canvas ref={canvasRef} className="camera-canvas" />

      {showGuide && <FramingGuide region={region} verdict={verdict} dimmed={Boolean(error)} />}

      {phase === 'working' && (
        <LoadingOverlay
          status={progress?.status}
          queuePosition={progress?.queuePosition}
          garmentName={selected?.name}
        />
      )}

      <div className="overlay">
        {!gender ? (
          <GenderScreen onPick={setGender} error={error} cameraReady={cameraReady} />
        ) : (
          <GarmentBar
            garments={catalog}
            selected={selected}
            onSelect={selectGarment}
            onConfirm={confirmTryon}
            onTryAnother={tryAnother}
            onBack={resetToAttract}
            hasResult={phase === 'result'}
            busy={phase === 'working'}
            error={error}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Open the best camera on this machine.
 *
 * The Proto Luma enumerates HDMI capture and "Real" virtual devices alongside
 * its actual sensor, and picking the wrong one gives a black frame.
 */
async function openCamera() {
  // Labels are empty until permission has been granted once, so take a
  // throwaway stream first purely to unlock enumerateDevices().
  const probe = await navigator.mediaDevices.getUserMedia({ video: true })
  stopStream(probe)

  const devices = await navigator.mediaDevices.enumerateDevices()
  const cameras = devices.filter((d) => d.kind === 'videoinput')
  const usable = cameras.filter((d) => !/hdmi|real/i.test(d.label))
  const deviceId = (usable[0] || cameras[0])?.deviceId

  const video = { width: { ideal: 2160 }, height: { ideal: 3840 } }
  if (deviceId) video.deviceId = { exact: deviceId }

  return navigator.mediaDevices.getUserMedia({ video })
}

function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop())
}

/** Match the backing store to the element's box, within reason. */
function sizeCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const rect = canvas.getBoundingClientRect()
  let width = Math.round(rect.width * dpr)
  let height = Math.round(rect.height * dpr)

  const longEdge = Math.max(width, height)
  if (longEdge > MAX_CANVAS_EDGE) {
    const k = MAX_CANVAS_EDGE / longEdge
    width = Math.round(width * k)
    height = Math.round(height * k)
  }

  if (width > 0 && height > 0 && (canvas.width !== width || canvas.height !== height)) {
    canvas.width = width
    canvas.height = height
  }
}

function loadImage(url, signal) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // No crossOrigin: we only ever draw this image, never read pixels back,
    // so a tainted canvas costs nothing and we avoid depending on fal's CORS.
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load the result image'))
    img.src = url
    signal?.addEventListener('abort', () => reject(abortError()), { once: true })
  })
}

function abortError() {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}
