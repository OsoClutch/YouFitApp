import { useEffect, useRef } from 'react'
import './App.css'
 
function App() {
  const videoRef = useRef(null)
 
  useEffect(() => {
    async function startCamera() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const validCameras = devices.filter(
          (device) =>
            device.kind === 'videoinput' &&
            (!device.label ||
              (!device.label.match(/hdmi/i) &&
                !device.label.match(/real/i)))
        )
 
        const cameraId = validCameras[0]?.deviceId
 
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: cameraId ? { exact: cameraId } : undefined,
            width: { ideal: 2160 },
            height: { ideal: 3840 }
          }
        })
 
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
      } catch (err) {
        console.error('Camera error:', err)
      }
    }
 
    startCamera()
  }, [])
 
  return (
<div className="luma-container">
<video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="camera-feed"
      />
<div className="overlay">
<h1 className="youfit-title">YOUFIT</h1>
<p className="youfit-sub">Holographic AI Try-On</p>
</div>
</div>
  )
}
 
export default App