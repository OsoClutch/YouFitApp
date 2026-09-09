// The backend. One Cloudflare Pages Function, three routes.
//
// It exists for one reason the frontend cannot solve: FAL_KEY must never reach
// the browser. Everything else here follows from that plus two hard limits.
//
// 1. No single HTTP hop may exceed ~30s. Cloudflare's proxy gives up at 100s
//    (Error 524, Enterprise-only to raise) and a generation can run longer than
//    is comfortable. fal's queue API is already job-shaped, so we mirror it
//    rather than fight it: POST returns a request_id immediately, the client
//    polls. That also buys the kiosk a real progress indicator instead of a
//    60-second spinner, and keeps us portable if we ever move off Pages.
//
// 2. Workers bill *net CPU*, ~10ms on the free plan. Wall-clock spent waiting
//    on fal is free; touching the payload is not. So the person image arrives
//    as a raw text body with the garment id in the query string, and we hand
//    the data URI to fal without decoding, re-encoding, or JSON-parsing around
//    it. See submitTryon() for the one place that matters.
//
// Swapping fal for self-hosted FASHN VTON 1.5 on Modal means reimplementing
// submitTryon/fetchStatus against a different base URL. Nothing else moves,
// and the frontend never learns about it.

import { findGarment } from '../../src/garments.js'

const FAL_MODEL = 'fal-ai/fashn/tryon/v1.6'
const FAL_QUEUE = `https://queue.fal.run/${FAL_MODEL}`

// fal request ids are uuid-shaped. Validate before interpolating into a URL.
const REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/

// A JPEG data URI and nothing else. This is a correctness guard as much as a
// security one -- submitTryon() embeds the string into a JSON body directly,
// which is only safe because the base64 alphabet contains no character JSON
// would need to escape.
const DATA_URI = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/

// Roughly 6MB of base64 ~= 4.5MB of JPEG. An 864x1296 q0.92 frame is well
// under 1MB; anything near this ceiling is a client bug or an abuse attempt.
const MAX_IMAGE_CHARS = 6_000_000

export async function onRequest(context) {
  const { request, env, params } = context
  const segments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean)
  const [route, id] = segments
  const { method } = request

  try {
    if (route === 'health' && method === 'GET') {
      return health(env)
    }
    if (route === 'tryon' && method === 'POST' && !id) {
      return await submitTryon(request, env)
    }
    if (route === 'tryon' && method === 'GET' && id) {
      return await pollTryon(id, env)
    }
    return json({ error: `No route for ${method} /api/${segments.join('/')}` }, 404)
  } catch (err) {
    // Never surface err.message raw -- an upstream error could echo the key
    // back to us, and this response goes to the kiosk.
    console.error('api error:', err)
    return json({ error: 'Internal error' }, 500)
  }
}

/**
 * Liveness for the cron-job.org keep-warm ping.
 *
 * Reports whether FAL_KEY is bound, because a Pages project deployed without
 * it fails only on the first try-on -- which is a bad time to find out.
 */
function health(env) {
  return json({
    ok: true,
    service: 'youfit',
    model: FAL_MODEL,
    falKeyConfigured: Boolean(env.FAL_KEY),
    time: new Date().toISOString(),
  })
}

/**
 * POST /api/tryon?garment=<id>
 * Body: the person frame as an image/jpeg data URI, text/plain.
 *
 * Returns { request_id } as soon as fal accepts the job -- typically well
 * under a second.
 */
async function submitTryon(request, env) {
  if (!env.FAL_KEY) {
    return json({ error: 'Server is missing FAL_KEY' }, 503)
  }

  const garmentId = new URL(request.url).searchParams.get('garment')
  const garment = findGarment(garmentId)
  if (!garment) {
    // The client sends an id, never a URL. This is what stops a passer-by from
    // pointing our inference budget at an arbitrary image.
    return json({ error: `Unknown garment: ${garmentId}` }, 400)
  }

  const personImage = await request.text()
  if (personImage.length > MAX_IMAGE_CHARS) {
    return json({ error: 'Person image too large' }, 413)
  }
  if (!DATA_URI.test(personImage)) {
    return json({ error: 'Person image must be an image/jpeg data URI' }, 400)
  }

  // fal fetches the garment itself, so it needs an absolute URL. Deriving it
  // from the request keeps this correct on pages.dev, on a custom domain, and
  // under `wrangler pages dev` without configuration.
  const garmentUrl = new URL(garment.url, request.url).href

  // Built by hand rather than with JSON.stringify: stringify would walk and
  // re-escape the entire multi-MB data URI, which is the one thing that could
  // actually put us near the CPU ceiling. DATA_URI above guarantees the string
  // is JSON-safe.
  const body =
    '{' +
    `"model_image":"${personImage}",` +
    `"garment_image":${JSON.stringify(garmentUrl)},` +
    `"category":${JSON.stringify(garment.category)},` +
    `"garment_photo_type":${JSON.stringify(garment.garmentPhotoType)},` +
    // Maskless. This is the whole reason for choosing FASHN: no detectron2,
    // no DensePose, no SCHP, no OpenPose -- and mask quality, the documented
    // number-one cause of bad fit, stops being something we can get wrong.
    '"segmentation_free":true,' +
    '"mode":"quality",' +
    '"num_samples":1,' +
    '"output_format":"jpeg"' +
    '}'

  const res = await fetch(FAL_QUEUE, {
    method: 'POST',
    headers: {
      Authorization: `Key ${env.FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body,
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error('fal submit failed:', res.status, detail.slice(0, 500))
    return json({ error: 'Try-on service rejected the request', status: res.status }, 502)
  }

  const queued = await res.json()
  if (!queued.request_id) {
    return json({ error: 'Try-on service returned no request id' }, 502)
  }
  return json({ request_id: queued.request_id })
}

/**
 * GET /api/tryon/:id
 *
 * Mirrors fal's queue states back to the client:
 *   { status: 'IN_QUEUE' | 'IN_PROGRESS', queue_position? }
 *   { status: 'COMPLETED', image_url }
 *   { status: 'FAILED', error }
 */
async function pollTryon(id, env) {
  if (!env.FAL_KEY) {
    return json({ error: 'Server is missing FAL_KEY' }, 503)
  }
  if (!REQUEST_ID.test(id)) {
    return json({ error: 'Malformed request id' }, 400)
  }

  const auth = { Authorization: `Key ${env.FAL_KEY}` }

  const statusRes = await fetch(`${FAL_QUEUE}/requests/${id}/status`, { headers: auth })
  if (!statusRes.ok) {
    if (statusRes.status === 404) {
      return json({ status: 'FAILED', error: 'Request expired or not found' }, 404)
    }
    console.error('fal status failed:', statusRes.status)
    return json({ error: 'Could not read job status', status: statusRes.status }, 502)
  }

  const state = await statusRes.json()
  if (state.status !== 'COMPLETED') {
    return json({
      status: state.status || 'IN_PROGRESS',
      queue_position: state.queue_position ?? null,
    })
  }

  const resultRes = await fetch(`${FAL_QUEUE}/requests/${id}`, { headers: auth })
  if (!resultRes.ok) {
    console.error('fal result failed:', resultRes.status)
    return json({ error: 'Could not read job result', status: resultRes.status }, 502)
  }

  const result = await resultRes.json()
  const imageUrl = result?.images?.[0]?.url
  if (!imageUrl) {
    return json({ status: 'FAILED', error: 'Try-on produced no image' }, 502)
  }

  // The URL points at fal's CDN and the browser loads it directly -- keeping
  // the image out of this worker saves both bandwidth and CPU. We only ever
  // draw it, never read pixels back, so cross-origin canvas tainting is moot.
  return json({ status: 'COMPLETED', image_url: imageUrl })
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
