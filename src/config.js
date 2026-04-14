const config = {
  wasmUrl: [
    "https://cdn.jsdelivr.net/npm/",
    "@mediapipe/tasks-vision@latest/wasm",
  ].join(""),
  modelUrl: [
    "https://storage.googleapis.com/mediapipe-models/",
    "pose_landmarker/pose_landmarker_lite/",
    "float16/latest/pose_landmarker_lite.task",
  ].join(""),

  // Returns the API base URL for IDM-VTON backend.
  // Priority:
  //   1. ?api=192.168.x.x:8000 URL parameter (for Vercel → local MacBook)
  //   2. Same hostname as the page (for local dev on MacBook)
  getApiBaseUrl() {
    const params = new URLSearchParams(window.location.search);
    const apiParam = params.get("api");
    if (apiParam) {
      // Support both "192.168.1.5:8000" and "http://192.168.1.5:8000"
      return apiParam.startsWith("http") ? apiParam : `http://${apiParam}`;
    }
    if (window.location.hostname === "localhost") {
      return "http://localhost:8000";
    }
    return `http://${window.location.hostname}:8000`;
  },
};

export default config;
