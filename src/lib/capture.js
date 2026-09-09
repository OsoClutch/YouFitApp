// Canvas geometry: what the user sees, and what the model gets.
//
// These two have to agree. The old code let them drift -- the preview was
// framed by a CSS transform the canvas knew nothing about, and the snapshot
// sent to the VTON model was the raw 9:16 camera frame, which the model then
// squashed to its own aspect ratio before inference. The person was distorted
// before the try-on even started.
//
// So both paths go through computeCropRect() with the same device profile.
// The only difference is the target aspect: the display canvas uses its own,
// and the capture uses the model's.

/** FASHN VTON v1.6 works at 2:3. Feed it that and nothing gets stretched. */
export const MODEL_WIDTH = 864
export const MODEL_HEIGHT = 1296
const MODEL_ASPECT = MODEL_WIDTH / MODEL_HEIGHT

/**
 * The source rectangle to take from a camera frame.
 *
 * Picks the largest rect of `targetAspect` that fits the frame, shrinks it by
 * `zoom`, then slides it vertically by `offsetY` (a fraction of the rect's own
 * height; negative favours head-and-torso over floor). Always clamped inside
 * the frame, so an aggressive zoom can never sample past the edge.
 */
export function computeCropRect(frameW, frameH, targetAspect, zoom = 1, offsetY = 0) {
  let sw
  let sh
  if (frameW / frameH > targetAspect) {
    sh = frameH
    sw = frameH * targetAspect
  } else {
    sw = frameW
    sh = frameW / targetAspect
  }

  sw /= zoom
  sh /= zoom

  const sx = clamp((frameW - sw) / 2, 0, Math.max(0, frameW - sw))
  const sy = clamp((frameH - sh) / 2 + offsetY * sh, 0, Math.max(0, frameH - sh))

  return { sx, sy, sw, sh }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

/**
 * Draw the live camera into the display canvas, framed for this device.
 *
 * `mirror` flips horizontally so the preview reads like a mirror. That flip
 * belongs here and nowhere else -- it must not reach the capture (the model
 * would learn the wrong handedness) or the result (garment text would render
 * backwards, which is exactly the bug this replaces).
 */
export function drawCameraFrame(ctx, video, profile, { mirror = true } = {}) {
  const { width, height } = ctx.canvas
  const { sx, sy, sw, sh } = computeCropRect(
    video.videoWidth,
    video.videoHeight,
    width / height,
    profile.cameraZoom,
    profile.cameraOffsetY,
  )

  ctx.save()
  if (mirror) {
    ctx.translate(width, 0)
    ctx.scale(-1, 1)
  }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height)
  ctx.restore()
}

/**
 * The region of the camera frame that will be sent for inference.
 *
 * Shared with the framing guide, so the hints the user is given describe the
 * exact crop the model will see -- not a slightly different one.
 */
export function personCropRect(video, profile) {
  return computeCropRect(
    video.videoWidth,
    video.videoHeight,
    MODEL_ASPECT,
    profile.cameraZoom,
    profile.cameraOffsetY,
  )
}

/**
 * Grab the person frame for inference: same framing the user sees, re-cropped
 * to the model's 2:3 and downscaled to 864x1296. Never mirrored.
 */
export function capturePersonFrame(video, profile) {
  const canvas = document.createElement('canvas')
  canvas.width = MODEL_WIDTH
  canvas.height = MODEL_HEIGHT

  const { sx, sy, sw, sh } = personCropRect(video, profile)

  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, MODEL_WIDTH, MODEL_HEIGHT)
  return canvas
}

/**
 * Draw an image letterboxed inside the canvas, preserving its aspect ratio.
 *
 * The result comes back at the model's 2:3 while the Luma canvas is 9:16;
 * stretching one to the other is what made early results look subtly wrong in
 * a way nobody could name.
 */
export function drawContain(ctx, img, background = '#000000') {
  const { width, height } = ctx.canvas
  const scale = Math.min(width / img.width, height / img.height)
  const dw = img.width * scale
  const dh = img.height * scale

  ctx.fillStyle = background
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh)
}

/** Encode a canvas as a data URI. JPEG: the person frame is a photo. */
export function toDataUri(canvas, quality = 0.92) {
  return canvas.toDataURL('image/jpeg', quality)
}

/**
 * Where the capture region sits inside the displayed frame, as fractions of
 * the canvas (0-1).
 *
 * The preview and the capture are different crops of the same camera frame --
 * the canvas uses its own aspect, the capture uses the model's 2:3 -- so the
 * region that actually gets sent is a sub-rectangle of what the user sees.
 * The framing guide draws exactly this, which is the difference between "stand
 * about here" and a guide that means something.
 */
export function captureRegionInDisplay(video, profile, canvasAspect) {
  const display = computeCropRect(
    video.videoWidth,
    video.videoHeight,
    canvasAspect,
    profile.cameraZoom,
    profile.cameraOffsetY,
  )
  const capture = personCropRect(video, profile)

  return {
    left: clamp((capture.sx - display.sx) / display.sw, 0, 1),
    top: clamp((capture.sy - display.sy) / display.sh, 0, 1),
    width: clamp(capture.sw / display.sw, 0, 1),
    height: clamp(capture.sh / display.sh, 0, 1),
  }
}
