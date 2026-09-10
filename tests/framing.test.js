// The framing verdict decides what the kiosk tells people to do, and person
// framing is the largest remaining lever on fit. Worth examples.

import test from 'node:test'
import assert from 'node:assert/strict'
import { judgeFraming } from '../src/lib/framing.js'

/**
 * A well-framed person, head to mid-thigh in the 2:3 crop.
 *
 * Proportions matter here: a real adult's shoulders span about half the frame
 * width at this distance (~40cm of breadth over an 864px-wide crop covering
 * ~80cm). An earlier version of this helper used a much narrower span and the
 * verdict came back 'turned' -- correctly.
 */
function pose(overrides = {}) {
  const pts = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.99 }))
  const set = (i, x, y, v = 0.99) => (pts[i] = { x, y, visibility: v })
  set(11, 0.75, 0.25) // left shoulder
  set(12, 0.25, 0.25) // right shoulder
  set(23, 0.68, 0.65) // left hip
  set(24, 0.32, 0.65) // right hip
  set(15, 0.78, 0.70) // left wrist, at the side
  set(16, 0.22, 0.70) // right wrist, at the side
  for (const [i, p] of Object.entries(overrides)) set(Number(i), p.x, p.y, p.visibility ?? 0.99)
  return pts
}

test('a well-framed person is ready', () => {
  assert.equal(judgeFraming(pose()), 'ready')
})

test('no landmarks means nobody is there', () => {
  assert.equal(judgeFraming(null), 'no-person')
  assert.equal(judgeFraming([]), 'no-person')
  assert.equal(judgeFraming(new Array(10).fill({ x: 0.5, y: 0.5 })), 'no-person')
})

test('invisible shoulders means nobody is there', () => {
  const p = pose({ 11: { x: 0.65, y: 0.25, visibility: 0.1 } })
  assert.equal(judgeFraming(p), 'no-person')
})

test('hips out of frame means too close', () => {
  const p = pose({ 23: { x: 0.68, y: 0.65, visibility: 0.2 }, 24: { x: 0.32, y: 0.65, visibility: 0.2 } })
  assert.equal(judgeFraming(p), 'too-close')
})

test('an oversized torso means too close', () => {
  const p = pose({ 11: { x: 0.75, y: 0.10 }, 12: { x: 0.25, y: 0.10 }, 23: { x: 0.68, y: 0.75 }, 24: { x: 0.32, y: 0.75 } })
  assert.equal(judgeFraming(p), 'too-close')
})

test('a tiny torso means too far', () => {
  const p = pose({ 23: { x: 0.68, y: 0.40 }, 24: { x: 0.32, y: 0.40 } })
  assert.equal(judgeFraming(p), 'too-far')
})

test('standing off to one side is caught, both directions', () => {
  const left = pose({ 11: { x: 0.50, y: 0.25 }, 12: { x: 0.00, y: 0.25 } })
  const right = pose({ 11: { x: 1.00, y: 0.25 }, 12: { x: 0.50, y: 0.25 } })
  assert.equal(judgeFraming(left), 'off-centre')
  assert.equal(judgeFraming(right), 'off-centre')
})

test('a turned body collapses shoulder breadth and is caught', () => {
  const p = pose({ 11: { x: 0.58, y: 0.25 }, 12: { x: 0.42, y: 0.25 } })
  assert.equal(judgeFraming(p), 'turned')
})

test('raised arms are caught, but only when the wrists are visible', () => {
  const raised = pose({ 15: { x: 0.78, y: 0.20 } })
  assert.equal(judgeFraming(raised), 'arms-raised')

  // Cropped-out wrists must not be mistaken for raised ones.
  const cropped = pose({
    15: { x: 0.78, y: 0.20, visibility: 0.1 },
    16: { x: 0.22, y: 0.20, visibility: 0.1 },
  })
  assert.equal(judgeFraming(cropped), 'ready')
})

test('framing problems are reported in fix-this-first order', () => {
  // Off-centre AND turned: centring is the more useful instruction.
  const p = pose({ 11: { x: 0.30, y: 0.25 }, 12: { x: 0.14, y: 0.25 } })
  assert.equal(judgeFraming(p), 'off-centre')
})
