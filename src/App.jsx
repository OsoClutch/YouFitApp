import { useEffect, useRef, useState } from 'react'
import garments from './garments'
import './App.css'
 
function App() {
  const videoRef = useRef(null)
  const [gender, setGender] = useState(null)
  const [selected, setSelected] = useState(null)
 
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
 
  const currentGarments = gender ? garments[gender] : []
 
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
 
        {!gender && (
<div className="gender-screen">
<h1 className="youfit-title">YOUFIT</h1>
<p className="youfit-sub">Holographic AI Try-On</p>
<p className="prompt-text">Who is shopping today?</p>
<div className="gender-buttons">
<button
                className="gender-btn"
                onClick={() => setGender('male')}
>
                Men
</button>
<button
                className="gender-btn"
                onClick={() => setGender('female')}
>
                Women
</button>
</div>
</div>
        )}
 
        {gender && (
<div className="catalog-screen">
<div className="catalog-header">
<p className="catalog-title">Choose your look</p>
<button
                className="back-btn"
                onClick={() => { setGender(null); setSelected(null) }}
>
                Back
</button>
</div>
 
            <div className="outfit-carousel">
              {currentGarments.map((item) => (
<div
                  key={item.id}
                  className={`outfit-card ${selected?.id === item.id ? 'selected' : ''}`}
                  onClick={() => setSelected(item)}
>
<img
                    src={item.url}
                    alt={item.label}
                    className="outfit-image"
                  />
<p className="outfit-label">{item.label}</p>
</div>
              ))}
</div>
 
            {selected && (
<div className="selected-banner">
                Styling you in {selected.label}...
</div>
            )}
</div>
        )}
 
      </div>
</div>
  )
}
 
export default App