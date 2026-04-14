import { useEffect, useRef, useState } from "react";
import { PoseLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import garments from "./garments";
import config from "./config";
import "./App.css";

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const poseLandmarkerRef = useRef(null);
  const animFrameRef = useRef(null);
  const garmentImgRef = useRef(null);
  const tryonResultRef = useRef(null);
  const abortControllerRef = useRef(null);
  const isProcessingRef = useRef(false); // ref for animation loop access (avoids stale closure)
  const idleTimerRef = useRef(null);

  const [gender, setGender] = useState(null);
  const [selected, setSelected] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasTryonResult, setHasTryonResult] = useState(false);
  const [error, setError] = useState(null);

  // Detect Proto Luma via URL param or screen width
  const isLuma =
    window.innerWidth === 2160 ||
    new URLSearchParams(window.location.search).has("luma");

  // Keep the ref in sync with state
  function updateProcessing(value) {
    isProcessingRef.current = value;
    setIsProcessing(value);
  }

  // ===== Idle Reset Timer (kiosk mode — 60s) =====
  function resetIdleTimer() {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      console.log("Idle timeout — resetting to home screen");
      tryonResultRef.current = null;
      garmentImgRef.current = null;
      if (abortControllerRef.current) abortControllerRef.current.abort();
      setGender(null);
      setSelected(null);
      updateProcessing(false);
      setHasTryonResult(false);
      setError(null);
    }, 60000);
  }

  useEffect(() => {
    const events = ["click", "touchstart", "mousemove"];
    const handler = () => resetIdleTimer();
    events.forEach((e) => window.addEventListener(e, handler));
    resetIdleTimer();
    return () => {
      events.forEach((e) => window.removeEventListener(e, handler));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, []);

  // ===== Camera + MediaPipe Setup =====
  useEffect(() => {
    async function setup() {
      try {
        const vision = await FilesetResolver.forVisionTasks(config.wasmUrl);
        const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: config.modelUrl,
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numPoses: 1,
        });
        poseLandmarkerRef.current = poseLandmarker;

        // Get camera permission first so we can read device labels
        const tempStream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        tempStream.getTracks().forEach((track) => track.stop());

        // Enumerate cameras with labels now available
        const devices = await navigator.mediaDevices.enumerateDevices();
        const allCameras = devices.filter((d) => d.kind === "videoinput");
        console.log(
          "All cameras found:",
          allCameras.map((c) => ({ label: c.label, id: c.deviceId }))
        );

        // Filter out HDMI/virtual cameras (Proto Luma has these)
        const validCameras = allCameras.filter(
          (device) =>
            !device.label.match(/hdmi/i) && !device.label.match(/real/i)
        );

        const cameraId =
          validCameras[0]?.deviceId || allCameras[0]?.deviceId;

        const videoConstraints = {
          width: { ideal: 2160 },
          height: { ideal: 3840 },
        };
        if (cameraId) {
          videoConstraints.deviceId = { exact: cameraId };
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          console.log("Camera stream attached");
          videoRef.current.onloadeddata = function () {
            console.log("Video data loaded, starting detection");
            setTimeout(startDetection, 500);
          };
        }
      } catch (err) {
        console.error("Setup error:", err);
      }
    }

    setup();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // ===== Load garment thumbnail when selected (flat overlay fallback) =====
  useEffect(() => {
    if (selected) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = selected.cleanUrl || selected.url;
      img.onload = () => {
        garmentImgRef.current = img;
      };
    } else {
      garmentImgRef.current = null;
    }
  }, [selected]);

  // ===== IDM-VTON API Call =====
  async function requestTryon(garment) {
    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    updateProcessing(true);
    setError(null);
    tryonResultRef.current = null;
    setHasTryonResult(false);

    try {
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        throw new Error("Camera not ready");
      }

      // Capture snapshot from video (NOT mirrored — VTON needs normal orientation)
      const snapCanvas = document.createElement("canvas");
      snapCanvas.width = video.videoWidth;
      snapCanvas.height = video.videoHeight;
      snapCanvas.getContext("2d").drawImage(video, 0, 0);

      // Convert canvas to blob
      const blob = await new Promise((resolve, reject) => {
        snapCanvas.toBlob(
          (b) =>
            b
              ? resolve(b)
              : reject(new Error("Failed to capture snapshot")),
          "image/jpeg",
          0.9
        );
      });

      // Build FormData
      const formData = new FormData();
      formData.append("person_image", blob, "snapshot.jpg");
      formData.append("garment_url", garment.url);

      const apiUrl = config.getApiBaseUrl();
      console.log("Sending try-on request to:", apiUrl + "/tryon");

      const response = await fetch(apiUrl + "/tryon", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(
          errData?.error || `Server error: ${response.status}`
        );
      }

      // Get result image
      const resultBlob = await response.blob();
      const resultUrl = URL.createObjectURL(resultBlob);

      // Load into an Image for canvas rendering
      const resultImg = new Image();
      resultImg.onload = () => {
        tryonResultRef.current = resultImg;
        updateProcessing(false);
        setHasTryonResult(true);
        console.log("Try-on result loaded successfully");
      };
      resultImg.onerror = () => {
        setError("Failed to load result image");
        updateProcessing(false);
      };
      resultImg.src = resultUrl;
    } catch (err) {
      if (err.name === "AbortError") {
        console.log("Try-on request cancelled");
        return;
      }
      console.error("Try-on error:", err);
      setError(err.message);
      updateProcessing(false);
    }
  }

  // ===== Pose Detection + Rendering Loop =====
  function startDetection() {
    console.log("startDetection called");

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) {
      console.error("Missing video or canvas ref");
      return;
    }

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    console.log("Video dimensions:", vw, "x", vh);

    canvas.width = vw || 1080;
    canvas.height = vh || 1920;

    function detect() {
      const ctx = canvas.getContext("2d");

      // If we have a VTON result, draw it full-canvas instead of camera
      if (tryonResultRef.current) {
        ctx.drawImage(
          tryonResultRef.current,
          0,
          0,
          canvas.width,
          canvas.height
        );
        animFrameRef.current = requestAnimationFrame(detect);
        return;
      }

      // Otherwise draw live camera frame
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Run pose detection (with error handling so loop never dies)
      // Uses isProcessingRef (not isProcessing state) to avoid stale closure
      try {
        if (poseLandmarkerRef.current && video.readyState >= 2) {
          const results = poseLandmarkerRef.current.detectForVideo(
            video,
            performance.now()
          );

          // Draw flat garment overlay as preview (only when not waiting for VTON)
          if (
            results.landmarks &&
            results.landmarks.length > 0 &&
            garmentImgRef.current &&
            !isProcessingRef.current
          ) {
            const landmarks = results.landmarks[0];
            const w = canvas.width;
            const h = canvas.height;
            const leftShoulder = landmarks[11];
            const rightShoulder = landmarks[12];
            const leftHip = landmarks[23];

            const shoulderWidth =
              Math.abs(rightShoulder.x - leftShoulder.x) * w;
            const torsoHeight =
              Math.abs(leftHip.y - leftShoulder.y) * h;
            const garmentWidth = shoulderWidth * 1.6;
            const garmentHeight = torsoHeight * 1.4;

            const centerX =
              ((leftShoulder.x + rightShoulder.x) / 2) * w;
            const topY =
              Math.min(leftShoulder.y, rightShoulder.y) * h -
              torsoHeight * 0.08;

            ctx.globalAlpha = 0.92;
            ctx.drawImage(
              garmentImgRef.current,
              centerX - garmentWidth / 2,
              topY,
              garmentWidth,
              garmentHeight
            );
            ctx.globalAlpha = 1.0;
          }
        }
      } catch (err) {
        console.error("Pose detection error:", err);
      }

      animFrameRef.current = requestAnimationFrame(detect);
    }

    detect();
  }

  // ===== Garment Selection Handler =====
  function handleSelectGarment(item) {
    setSelected(item);
    tryonResultRef.current = null;
    setHasTryonResult(false);
    requestTryon(item);
  }

  // ===== Clear Result (back to live camera) =====
  function clearResult() {
    tryonResultRef.current = null;
    setSelected(null);
    updateProcessing(false);
    setHasTryonResult(false);
    setError(null);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }

  const currentGarments = gender ? garments[gender] : [];

  return (
    <div className="luma-container">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="camera-feed-hidden"
      />
      <canvas
        ref={canvasRef}
        className={isLuma ? "camera-canvas luma-mode" : "camera-canvas"}
      />

      {/* Loading overlay */}
      {isProcessing && (
        <div className="loading-overlay">
          <p className="loading-text">Styling your look...</p>
        </div>
      )}

      <div className="overlay">
        {/* Gender Selection — centered, shown until gender is picked */}
        {!gender && (
          <div className="gender-screen">
            <h1 className="youfit-title">YOUFIT</h1>
            <p className="youfit-sub">Holographic AI Try-On</p>
            <p className="prompt-text">Who is shopping today?</p>
            <div className="gender-buttons">
              <button
                className="gender-btn"
                onClick={() => setGender("male")}
              >
                Men
              </button>
              <button
                className="gender-btn"
                onClick={() => setGender("female")}
              >
                Women
              </button>
            </div>
          </div>
        )}

        {/* Bottom Bar — compact garment selection strip */}
        {gender && (
          <div className="bottom-bar">
            <div className="bottom-bar-header">
              <p className="catalog-title">Choose your look</p>
              <div style={{ display: "flex", gap: "1vw" }}>
                {hasTryonResult && (
                  <button className="back-btn" onClick={clearResult}>
                    Try Another
                  </button>
                )}
                <button
                  className="back-btn"
                  onClick={() => {
                    clearResult();
                    setGender(null);
                  }}
                >
                  Back
                </button>
              </div>
            </div>
            <div className="outfit-carousel">
              {currentGarments.map((item) => (
                <div
                  key={item.id}
                  className={
                    "outfit-card" +
                    (selected && selected.id === item.id ? " selected" : "")
                  }
                  onClick={() => handleSelectGarment(item)}
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
            {error && (
              <div className="selected-banner" style={{ color: "#ff6b6b" }}>
                {error}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
