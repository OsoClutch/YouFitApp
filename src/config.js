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
  //   1. ?api= URL parameter (explicit override)
  //   2. /api proxy path (when served from Vite dev server — same origin, no CORS/mixed content)
  //   3. Direct localhost fallback
  getApiBaseUrl() {
    const params = new URLSearchParams(window.location.search);
    const apiParam = params.get("api");
    if (apiParam) {
      return apiParam.startsWith("http") ? apiParam : `http://${apiParam}`;
    }
    // Use the Vite proxy — works for both localhost AND when Luma accesses
    // the MacBook's Vite dev server via IP (e.g. http://10.26.73.20:5173)
    // The proxy forwards /api/* to localhost:8000/* on the MacBook
    return "/api";
  },
};

export default config;
