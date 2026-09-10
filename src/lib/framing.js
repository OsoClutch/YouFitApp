// Turning pose landmarks into one actionable hint.
//
// Split out of pose.worker.js so it can be tested directly: it is pure, and
// it encodes judgement calls (how close is too close, when is someone "turned
// away") that are worth pinning down with examples rather than eyeballing on
// a kiosk.
//
// Coordinates are normalised to the 2:3 crop that will be sent to the model,
// so these thresholds describe head-to-mid-thigh framing: shoulders near
// y=0.25, hips near y=0.65.

export const TORSO_MIN = 0.24 // below this the person is too far away
export const TORSO_MAX = 0.52 // above this they are too close to fit in frame
export const CENTRE_MIN = 0.34
export const CENTRE_MAX = 0.66
export const FACING_MIN = 0.55 // shoulder breadth / torso height, aspect-corrected
export const VISIBLE_MIN = 0.5
const FRAME_ASPECT = 2 / 3

/**
 * Ordered by what the user should fix first: being in frame beats being
 * centred, which beats being square to the camera, which beats arm position.
 * Only one hint is ever shown, so the order is the whole UX.
 *
 * @param {Array<{x:number,y:number,visibility?:number}>} points BlazePose 33
 * @returns {'no-person'|'too-close'|'too-far'|'off-centre'|'turned'|'arms-raised'|'ready'}
 */
export function judgeFraming(points) {
  if (!points || points.length < 25) return 'no-person'

  const [leftShoulder, rightShoulder] = [points[11], points[12]]
  const [leftHip, rightHip] = [points[23], points[24]]

  const seen = (p) => p && (p.visibility ?? 1) >= VISIBLE_MIN
  if (!seen(leftShoulder) || !seen(rightShoulder)) return 'no-person'
  if (!seen(leftHip) || !seen(rightHip)) return 'too-close'

  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2
  const hipY = (leftHip.y + rightHip.y) / 2
  const torsoH = Math.abs(hipY - shoulderY)

  if (torsoH > TORSO_MAX || shoulderY < 0.08) return 'too-close'
  if (torsoH < TORSO_MIN) return 'too-far'

  const centreX = (leftShoulder.x + rightShoulder.x) / 2
  if (centreX < CENTRE_MIN || centreX > CENTRE_MAX) return 'off-centre'

  // Shoulder breadth collapses when the body turns. Both spans are normalised
  // to their own axis, so correct for the frame's aspect before comparing.
  const shoulderW = Math.abs(leftShoulder.x - rightShoulder.x)
  if ((shoulderW * FRAME_ASPECT) / torsoH < FACING_MIN) return 'turned'

  // Wrists are often cropped out at mid-thigh framing; only judge when seen.
  const [leftWrist, rightWrist] = [points[15], points[16]]
  const raised = (w) => seen(w) && w.y < shoulderY + torsoH * 0.35
  if (raised(leftWrist) || raised(rightWrist)) return 'arms-raised'

  return 'ready'
}
