// Client for the job-shaped try-on API.
//
// POST returns a request_id in well under a second; we then poll until the
// image is ready. No single request stays open long enough to hit
// Cloudflare's 100s proxy timeout, and the caller gets progress it can show
// instead of a spinner that might mean anything.

import config from '../config'
import { capturePersonFrame, toDataUri } from './capture'

const POLL_INTERVAL_MS = 1200
const MAX_WAIT_MS = 180_000

export class TryonError extends Error {}

/**
 * Run a try-on and resolve to the result image URL.
 *
 * @param {HTMLVideoElement} video   live camera element
 * @param {object} garment           catalog entry; only its id is sent
 * @param {object} profile           device profile, for capture framing
 * @param {object} opts
 * @param {AbortSignal} opts.signal
 * @param {(state: {status: string, queuePosition: number|null}) => void} opts.onProgress
 */
export async function runTryon(video, garment, profile, { signal, onProgress } = {}) {
  if (!video || video.readyState < 2) {
    throw new TryonError('Camera is not ready yet')
  }

  const dataUri = toDataUri(capturePersonFrame(video, profile))
  const base = config.getApiBaseUrl()

  const submit = await fetch(`${base}/tryon?garment=${encodeURIComponent(garment.id)}`, {
    method: 'POST',
    // text/plain, with the garment id in the query string. The worker bills
    // net CPU, so handing it the data URI as an opaque string lets it forward
    // the payload without parsing or re-encoding it. See the Function header.
    headers: { 'Content-Type': 'text/plain' },
    body: dataUri,
    signal,
  })

  if (!submit.ok) {
    throw new TryonError(await readError(submit, 'Could not start the try-on'))
  }

  const { request_id: requestId } = await submit.json()
  if (!requestId) throw new TryonError('Try-on service returned no job id')

  const deadline = Date.now() + MAX_WAIT_MS
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS, signal)

    const res = await fetch(`${base}/tryon/${encodeURIComponent(requestId)}`, { signal })
    if (!res.ok && res.status !== 404) {
      throw new TryonError(await readError(res, 'Lost contact with the try-on service'))
    }

    const state = await res.json()
    if (state.status === 'COMPLETED') return state.image_url
    if (state.status === 'FAILED') {
      throw new TryonError(state.error || 'The try-on did not complete')
    }
    onProgress?.({ status: state.status, queuePosition: state.queue_position ?? null })
  }

  throw new TryonError('The try-on took too long')
}

async function readError(res, fallback) {
  const body = await res.json().catch(() => null)
  return body?.error || `${fallback} (${res.status})`
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function abortError() {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}
