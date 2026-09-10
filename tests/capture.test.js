// Crop geometry. This is the code that decides what the model actually sees,
// and it is the reason the preview and the capture can be trusted to agree.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MODEL_WIDTH,
  MODEL_HEIGHT,
  computeCropRect,
  captureRegionInDisplay,
  drawCameraFrame,
  drawContain,
} from '../src/lib/capture.js'

const LUMA = { cameraZoom: 2.0, cameraOffsetY: -0.15 }
const FLAT = { cameraZoom: 1, cameraOffsetY: 0 }

test('model target is 2:3', () => {
  assert.equal(MODEL_WIDTH, 864)
  assert.equal(MODEL_HEIGHT, 1296)
  assert.ok(Math.abs(MODEL_WIDTH / MODEL_HEIGHT - 2 / 3) < 1e-9)
})

test('crop of a portrait frame to 2:3 keeps full width and trims height', () => {
  // 9:16 frame is narrower than 2:3, so width binds.
  const r = computeCropRect(2160, 3840, 2 / 3, 1, 0)
  assert.equal(r.sw, 2160)
  assert.equal(r.sh, 3240)
  assert.equal(r.sx, 0)
  assert.equal(r.sy, 300) // (3840 - 3240) / 2
})

test('crop of a landscape webcam to 2:3 keeps full height and trims width', () => {
  const r = computeCropRect(1280, 720, 2 / 3, 1, 0)
  assert.equal(r.sh, 720)
  assert.equal(r.sw, 480)
  assert.equal(r.sx, 400)
  assert.equal(r.sy, 0)
})

test('zoom shrinks the window about the centre', () => {
  const r = computeCropRect(2000, 2000, 1, 2, 0)
  assert.equal(r.sw, 1000)
  assert.equal(r.sh, 1000)
  assert.equal(r.sx, 500)
  assert.equal(r.sy, 500)
})

test('negative offsetY moves the window up, favouring head and torso', () => {
  const flat = computeCropRect(2160, 3840, 9 / 16, 2, 0)
  const up = computeCropRect(2160, 3840, 9 / 16, 2, -0.15)
  assert.ok(up.sy < flat.sy, 'offset should raise the window')
  assert.equal(up.sy, flat.sy - 0.15 * up.sh)
})

test('the window is always clamped inside the frame', () => {
  // A large negative offset must not sample above the top edge.
  const r = computeCropRect(1000, 1000, 1, 1, -5)
  assert.equal(r.sy, 0)
  assert.ok(r.sy >= 0 && r.sy + r.sh <= 1000)
  const r2 = computeCropRect(1000, 1000, 1, 1, 5)
  assert.ok(r2.sy >= 0 && r2.sy + r2.sh <= 1000)
})

test('reproduces the Luma framing the old CSS transform encoded', () => {
  // scale(2.0) translateY(-15%) on a 9:16 panel, now expressed as a crop.
  const r = computeCropRect(2160, 3840, 2160 / 3840, LUMA.cameraZoom, LUMA.cameraOffsetY)
  assert.equal(r.sw, 1080)
  assert.equal(r.sh, 1920)
  assert.equal(r.sx, 540)
  assert.equal(r.sy, 960 - 0.15 * 1920)
})

test('capture region maps into the displayed frame correctly', () => {
  // Matches the values observed live in headless Chrome: a square 2160 fake
  // camera shown on a 1024x1366 canvas.
  const video = { videoWidth: 2160, videoHeight: 2160 }
  const region = captureRegionInDisplay(video, FLAT, 1024 / 1366)
  assert.ok(Math.abs(region.left - 0.0555) < 0.001, `left ${region.left}`)
  assert.equal(region.top, 0)
  assert.ok(Math.abs(region.width - 0.8889) < 0.001, `width ${region.width}`)
  assert.equal(region.height, 1)
})

test('capture region stays within the canvas on a Luma', () => {
  const video = { videoWidth: 2160, videoHeight: 3840 }
  const region = captureRegionInDisplay(video, LUMA, 2160 / 3840)
  for (const [k, v] of Object.entries(region)) {
    assert.ok(v >= 0 && v <= 1, `${k}=${v} outside 0..1`)
  }
  assert.ok(region.height < 1, 'the 2:3 capture is shorter than the 9:16 preview')
})

// --- drawing ---------------------------------------------------------------

function stubCtx(width, height) {
  const calls = []
  return {
    canvas: { width, height },
    calls,
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    translate: (x, y) => calls.push(['translate', x, y]),
    scale: (x, y) => calls.push(['scale', x, y]),
    fillRect: (...a) => calls.push(['fillRect', ...a]),
    drawImage: (...a) => calls.push(['drawImage', ...a.slice(1)]),
    set fillStyle(v) {
      calls.push(['fillStyle', v])
    },
  }
}

test('live preview mirrors', () => {
  const ctx = stubCtx(1080, 1920)
  drawCameraFrame(ctx, { videoWidth: 2160, videoHeight: 3840 }, FLAT, { mirror: true })
  const names = ctx.calls.map((c) => c[0])
  assert.deepEqual(names, ['save', 'translate', 'scale', 'drawImage', 'restore'])
  assert.deepEqual(ctx.calls[1], ['translate', 1080, 0])
  assert.deepEqual(ctx.calls[2], ['scale', -1, 1])
})

test('mirror can be turned off, and nothing else changes', () => {
  const ctx = stubCtx(1080, 1920)
  drawCameraFrame(ctx, { videoWidth: 2160, videoHeight: 3840 }, FLAT, { mirror: false })
  assert.deepEqual(
    ctx.calls.map((c) => c[0]),
    ['save', 'drawImage', 'restore'],
  )
})

test('result is letterboxed, never stretched, and never mirrored', () => {
  // The bug: a 2:3 result drawn onto a 9:16 canvas at canvas.width/height.
  const ctx = stubCtx(2160, 3840)
  drawContain(ctx, { width: 864, height: 1296 })

  assert.ok(
    !ctx.calls.some((c) => c[0] === 'scale'),
    'drawContain must not flip the image',
  )

  const draw = ctx.calls.find((c) => c[0] === 'drawImage')
  const [, dx, dy, dw, dh] = draw
  assert.ok(Math.abs(dw / dh - 864 / 1296) < 1e-9, 'aspect ratio preserved')
  assert.ok(dw <= 2160 && dh <= 3840, 'fits inside the canvas')
  assert.ok(Math.abs(dx - (2160 - dw) / 2) < 1e-9, 'centred horizontally')
  assert.ok(Math.abs(dy - (3840 - dh) / 2) < 1e-9, 'centred vertically')
  assert.ok(dy > 0, 'letterbox bars exist on this aspect pair')
  assert.ok(ctx.calls.some((c) => c[0] === 'fillRect'), 'background painted first')
})
