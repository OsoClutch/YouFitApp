// Device profiling replaced `window.innerWidth === 2160`. These pin down that
// the replacement is actually continuous, and that the Luma still lands on the
// framing the hardware was calibrated for.

import test from 'node:test'
import assert from 'node:assert/strict'
import { getDeviceProfile, PRESETS } from '../src/lib/device.js'

const win = (innerWidth, innerHeight, search = '') => ({
  innerWidth,
  innerHeight,
  location: { search },
})

test('a 4K portrait panel is a Luma', () => {
  const p = getDeviceProfile(win(2160, 3840))
  assert.equal(p.key, 'luma')
  assert.equal(p.isProto, true)
  assert.equal(p.uiScale, 1.45)
  assert.equal(p.forced, false)
})

test('a smaller portrait Proto is an M2', () => {
  assert.equal(getDeviceProfile(win(1080, 1920)).key, 'm2')
})

test('laptops, tablets and phones are not Protos', () => {
  for (const [w, h] of [
    [1440, 900],
    [1024, 1366],
    [390, 844],
    [820, 1180],
  ]) {
    const p = getDeviceProfile(win(w, h))
    assert.equal(p.isProto, false, `${w}x${h} should not be a Proto`)
    assert.equal(p.key, 'tablet')
  }
})

test('the old hardcoded 2160 check survives as a landscape safety net', () => {
  assert.equal(getDeviceProfile(win(2160, 1080)).key, 'proto')
})

test('?device= overrides detection and is flagged as forced', () => {
  for (const key of Object.keys(PRESETS)) {
    const p = getDeviceProfile(win(1440, 900, `?device=${key}`))
    assert.equal(p.key, key)
    assert.equal(p.forced, true)
  }
})

test('bare ?luma and ?proto flags still work', () => {
  assert.equal(getDeviceProfile(win(1440, 900, '?luma')).key, 'luma')
  assert.equal(getDeviceProfile(win(1440, 900, '?proto')).key, 'proto')
})

test('an unknown ?device= falls back to detection rather than crashing', () => {
  const p = getDeviceProfile(win(1440, 900, '?device=nonsense'))
  assert.equal(p.key, 'tablet')
  assert.equal(p.forced, false)
})

test('every preset exposes a complete, usable profile', () => {
  for (const key of Object.keys(PRESETS)) {
    const p = getDeviceProfile(win(1000, 1000, `?device=${key}`))
    assert.ok(p.uiScale > 0, `${key} uiScale`)
    assert.ok(p.cameraZoom >= 1, `${key} cameraZoom`)
    assert.ok(p.cameraOffsetY <= 0, `${key} cameraOffsetY should not push the crop down`)
    assert.ok(typeof p.label === 'string' && p.label.length > 0)
  }
})

test('flat screens get no zoom -- the user is already close', () => {
  const p = getDeviceProfile(win(1024, 1366, '?device=tablet'))
  assert.equal(p.cameraZoom, 1)
  assert.equal(p.cameraOffsetY, 0)
})
