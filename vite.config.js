import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The old config proxied /api to a FastAPI server on localhost:8000. No such
// server ever existed in this repo, and the app is now served with its backend
// attached: functions/api/[[path]].js runs on the same origin under Cloudflare
// Pages. To exercise the real API locally, build and run `npm run pages:dev`
// (wrangler) rather than `npm run dev` -- Vite alone serves the SPA only.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // reachable from a Proto on the same network
    port: 5173,
  },
  worker: {
    // Classic worker, not ESM. MediaPipe's wasm loader branches on
    // `typeof importScripts` and falls through to a document.createElement
    // path when it is absent -- which throws inside a module worker.
    format: 'iife',
  },
})
