// End-to-end browser check, driven over the Chrome DevTools Protocol.
//
// No Playwright, no Puppeteer: Node 22 ships a WebSocket client, and Chrome
// ships a fake camera. Between them this exercises the parts that unit tests
// cannot reach -- getUserMedia, the MediaPipe worker, canvas pixels, and the
// full gender -> garment -> confirm -> result flow.
//
// The try-on API is stubbed with a deliberately asymmetric image (red stripe
// left, blue right), which is how the "result renders mirrored" and "result
// renders stretched" bugs are held down: mirrored output puts red on the
// right, stretched output has no letterbox bars.
//
// Usage (three terminals, or background the first two):
//   npm run build && npx wrangler pages dev dist --port 8788 --binding FAL_KEY=x
//   scripts/chrome-headless.sh
//   npm run test:e2e
//
// Exits non-zero if anything fails, so it works in CI.

const BASE = process.env.BASE || 'http://127.0.0.1:8788'
const CDP = process.env.CDP || 'http://127.0.0.1:9222'
const SHOT = process.env.SHOT || ''

let ws
let nextId = 1
const pending = new Map()
let consoleMsgs = []
let exceptions = []
let failedRequests = []

function send(method, params = {}) {
  const id = nextId++
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((res, rej) => {
    pending.set(id, { res, rej })
    setTimeout(
      () => pending.has(id) && (pending.delete(id), rej(new Error(`timeout ${method}`))),
      30000,
    )
  })
}

async function connect() {
  let targets
  try {
    targets = await (await fetch(`${CDP}/json/list`)).json()
  } catch {
    console.error(`\nCannot reach Chrome at ${CDP}. Start it with scripts/chrome-headless.sh\n`)
    process.exit(2)
  }
  const page = targets.find((t) => t.type === 'page')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  ws.onmessage = (event) => {
    const m = JSON.parse(event.data)
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id)
      pending.delete(m.id)
      return m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      consoleMsgs.push({
        level: m.params.type,
        text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' '),
      })
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails
      exceptions.push(d.exception?.description || d.text)
    }
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) {
      failedRequests.push(`${m.params.response.status} ${m.params.response.url}`)
    }
  }
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed')
  return r.result.value
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function shot(name) {
  if (!SHOT) return
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  const fs = await import('node:fs')
  fs.writeFileSync(`${SHOT}-${name}.png`, Buffer.from(data, 'base64'))
}

let failures = 0
function report(label, ok, detail = '') {
  if (!ok) failures++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
}

async function goto(path, { width, height }) {
  consoleMsgs = []
  exceptions = []
  failedRequests = []
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await send('Page.navigate', { url: BASE + path })
  // Camera negotiation plus a ~12MB wasm instantiation.
  await sleep(8000)
}

// Stub the try-on API so no inference is spent and the result is a known target.
const STUB = `
window.__testImage = () => {
  const c = document.createElement('canvas'); c.width = 864; c.height = 1296;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 864, 1296);
  g.fillStyle = '#ff0000'; g.fillRect(0, 0, 200, 1296);
  g.fillStyle = '#0000ff'; g.fillRect(664, 0, 200, 1296);
  return c.toDataURL('image/png');
};
if (!location.search.includes('realapi')) {
  const _f = window.fetch;
  window.fetch = async (u, o) => {
    const s = String(u);
    if (s.includes('/api/tryon') && o && o.method === 'POST')
      return new Response(JSON.stringify({ request_id: 'stub-1' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (s.includes('/api/tryon/'))
      return new Response(JSON.stringify({ status: 'COMPLETED', image_url: window.__testImage() }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    return _f(u, o);
  };
}
`

await connect()
await send('Runtime.enable')
await send('Log.enable')
await send('Page.enable')
await send('Network.enable')
await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB })

// ---------------------------------------------------------------- 1. boot --
console.log('\n=== Boot, camera and worker (tablet) ===')
await goto('/?device=tablet', { width: 1024, height: 1366 })

report('no uncaught exceptions', exceptions.length === 0, exceptions.join(' | '))
report(
  'no failed requests',
  failedRequests.filter((r) => !r.includes('favicon')).length === 0,
  failedRequests.slice(0, 3).join(' | '),
)
report('React mounted', await evaluate(`!!document.querySelector('.luma-container')`))

const cam = await evaluate(`(() => {
  const v = document.querySelector('video'); const s = v && v.srcObject
  return { has: !!s, tracks: s ? s.getTracks().length : 0,
           live: s ? s.getTracks().every(t => t.readyState === 'live') : false,
           w: v?.videoWidth, h: v?.videoHeight, display: getComputedStyle(v).display }
})()`)
report('camera stream attached and live', cam.has && cam.live, `${cam.w}x${cam.h}`)
report('exactly one track (no StrictMode leak)', cam.tracks === 1, `${cam.tracks}`)
report('video element is not display:none', cam.display !== 'none', cam.display)

const canv = await evaluate(`(() => {
  const c = document.querySelector('canvas'); const g = c.getContext('2d')
  const d = g.getImageData(0, 0, c.width, c.height).data
  let lit = 0, n = 0
  for (let i = 0; i < d.length; i += 4000) { n++; if (d[i] + d[i+1] + d[i+2] > 30) lit++ }
  return { w: c.width, h: c.height, lit, n }
})()`)
report('canvas sized to its box', canv.w > 0 && canv.h > 0, `${canv.w}x${canv.h}`)
report('canvas is painting camera frames', canv.lit > canv.n * 0.15, `${canv.lit}/${canv.n} lit`)

const guide = await evaluate(`(() => {
  const g = document.querySelector('.framing-guide')
  const h = document.querySelector('.framing-hint')
  return { box: !!g, hint: h?.textContent || null }
})()`)
report('framing guide rendered', guide.box)
report('framing hint shown', !!guide.hint, guide.hint || '')
report(
  'MediaPipe initialised in the worker',
  !consoleMsgs.some((m) => m.text.includes('Framing guide unavailable')),
)
await shot('attract')

// ------------------------------------------------------------ 2. layout ----
console.log('\n=== Layout across devices ===')
for (const [name, w, h, path] of [
  ['phone', 390, 844, '/?device=tablet'],
  ['tablet', 1024, 1366, '/?device=tablet'],
  ['luma', 2160, 3840, '/?device=luma'],
]) {
  await goto(path, { width: w, height: h })
  const info = await evaluate(`(() => {
    const c = document.querySelector('.luma-container')
    const t = document.querySelector('.youfit-title')
    const btns = [...document.querySelectorAll('.gender-btn')]
    const hint = document.querySelector('.framing-hint')
    const de = document.documentElement
    const overlaps = hint ? btns.some(b => { const r = b.getBoundingClientRect(), x = hint.getBoundingClientRect()
      return !(x.bottom <= r.top || x.top >= r.bottom || x.right <= r.left || x.left >= r.right) }) : false
    return { device: c.dataset.device, fontPx: parseFloat(getComputedStyle(c).fontSize),
      titlePx: parseFloat(getComputedStyle(t).fontSize),
      overflow: de.scrollWidth > de.clientWidth || de.scrollHeight > de.clientHeight,
      inside: btns.every(b => { const r = b.getBoundingClientRect()
        return r.left >= -1 && r.right <= ${w} + 1 && r.top >= -1 && r.bottom <= ${h} + 1 }),
      minTap: Math.min(...btns.map(b => b.getBoundingClientRect().height)), overlaps }
  })()`)
  const expected = name === 'luma' ? 'luma' : 'tablet'
  console.log(`\n  [${name} ${w}x${h}]`)
  report(`detected as ${expected}`, info.device === expected, info.device)
  report('no page overflow', !info.overflow)
  report('controls on screen', info.inside)
  report('tap targets >= 44px', info.minTap >= 44, `${Math.round(info.minTap)}px`)
  report('framing hint clear of the buttons', !info.overlaps)
  report(
    'type scale sane',
    info.fontPx > 10 && info.titlePx > 16 && info.titlePx < h / 3,
    `base ${info.fontPx.toFixed(1)}px, title ${info.titlePx.toFixed(1)}px`,
  )
  await shot(`vp-${name}`)
}

// -------------------------------------------------------------- 3. flow ----
console.log('\n=== Flow: gender -> catalog -> confirm ===')
await goto('/?device=tablet', { width: 1024, height: 1366 })
await evaluate(
  `[...document.querySelectorAll('.gender-btn')].find(b=>b.textContent.trim()==='Men').click()`,
)
await sleep(600)
const bar = await evaluate(`(() => {
  const cards = [...document.querySelectorAll('.outfit-card')]
  return { open: !!document.querySelector('.bottom-bar'), n: cards.length,
    loaded: cards.every(c => { const i = c.querySelector('img'); return i.complete && i.naturalWidth > 0 }),
    guideGone: !document.querySelector('.framing-guide') }
})()`)
report('catalog opened', bar.open)
report('garments listed', bar.n > 0, `${bar.n}`)
report('all garment art loaded', bar.loaded)
report('framing guide hidden past attract', bar.guideGone)

report('no confirm button before selecting', !(await evaluate(`!!document.querySelector('.confirm-btn')`)))
await evaluate(`document.querySelector('.outfit-card').click()`)
await sleep(300)
const confirm = await evaluate(`(() => {
  const b = document.querySelector('.confirm-btn')
  return { shown: !!b, text: b?.textContent, selected: !!document.querySelector('.outfit-card.selected') }
})()`)
report('card marked selected', confirm.selected)
report('confirm required — inference does not auto-fire', confirm.shown, confirm.text || '')
await shot('catalog')

// ------------------------------------------------------------ 4. result ----
console.log('\n=== Result rendering (stubbed inference) ===')
await evaluate(`document.querySelector('.confirm-btn').click()`)
let sawOverlay = false
for (let i = 0; i < 60; i++) {
  if (await evaluate(`!!document.querySelector('.loading-overlay')`)) {
    sawOverlay = true
    break
  }
  await sleep(50)
}
report('loading overlay appears while working', sawOverlay)
await sleep(4000)
report(
  'completed and overlay cleared',
  await evaluate(`!document.querySelector('.loading-overlay')`),
)

const px = await evaluate(`(() => {
  const c = document.querySelector('canvas'); const g = c.getContext('2d')
  const at = (x, y) => { const d = g.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]] }
  const mid = Math.floor(c.height / 2)
  return { farLeft: at(8, mid), left: at(150, mid), centre: at(512, mid),
           right: at(860, mid), farRight: at(c.width - 9, mid) }
})()`)
const black = (p) => p[0] < 24 && p[1] < 24 && p[2] < 24
console.log(`  sampled ${JSON.stringify(px)}`)
report('letterbox bar left — result not stretched', black(px.farLeft))
report('letterbox bar right — result not stretched', black(px.farRight))
report(
  'RED stripe on the LEFT — result not mirrored',
  px.left[0] > 180 && px.left[1] < 70 && px.left[2] < 70,
)
report(
  'BLUE stripe on the RIGHT — result not mirrored',
  px.right[2] > 180 && px.right[0] < 70 && px.right[1] < 70,
)
await shot('result')

// ------------------------------------------------------- 5. try another ----
console.log('\n=== Try Another ===')
await evaluate(
  `[...document.querySelectorAll('.back-btn')].find(b=>b.textContent.includes('Try Another')).click()`,
)
await sleep(1200)
const back = await evaluate(`(() => {
  const c = document.querySelector('canvas'); const g = c.getContext('2d')
  const d = g.getImageData(8, Math.floor(c.height / 2), 1, 1).data
  return { live: !(d[0] < 24 && d[1] < 24 && d[2] < 24),
           cleared: !document.querySelector('.outfit-card.selected') && !document.querySelector('.confirm-btn') }
})()`)
report('canvas back to live camera', back.live)
report('selection cleared', back.cleared)
report('no uncaught exceptions across the flow', exceptions.length === 0, exceptions.join(' | '))

console.log(`\n${failures === 0 ? 'All browser checks passed.' : failures + ' check(s) FAILED.'}`)
process.exit(failures === 0 ? 0 : 1)
