// The catalog. Single source of truth: the browser renders from it, and the
// Pages Function imports this same module to resolve a garment id into a URL.
// That's deliberate -- the client sends an id, never a URL, so no caller can
// point our fal.ai budget at an arbitrary image on the internet.
//
// Every entry is upper-body. FASHN VTON v1.6 runs with category 'tops', and
// feeding it trousers or a full-length dress makes it paint the garment across
// the torso -- which is exactly what went wrong with the old joggers and dress.
//
// Art lives in public/garments/ and ships with the build: same-origin, so no
// canvas tainting and no third-party CDN in the critical path. Regenerate it
// with `npm run garments` (see scripts/export_garments.py) -- 864x1152 portrait,
// garment trimmed to its bounding box and centred on white.

/** Sent to fal for every garment; see README for why each value. */
export const TRYON_DEFAULTS = {
  category: 'tops',
  garmentPhotoType: 'flat-lay',
}

const garments = {
  male: [
    {
      id: 'M1',
      label: 'Casual',
      name: 'Track Jacket',
      url: '/garments/M1-track-jacket.png',
      ...TRYON_DEFAULTS,
    },
    {
      id: 'M2',
      label: 'Business',
      name: 'Navy Blazer',
      url: '/garments/M2-navy-blazer.png',
      ...TRYON_DEFAULTS,
    },
  ],
  female: [
    {
      id: 'W2',
      label: 'Business',
      name: 'Blue Blazer',
      url: '/garments/W2-blue-blazer.png',
      ...TRYON_DEFAULTS,
    },
  ],
}

/**
 * Resolve a garment id. Used by the Pages Function to validate what the client
 * asked for before spending an inference call on it.
 */
export function findGarment(id) {
  for (const list of Object.values(garments)) {
    const hit = list.find((g) => g.id === id)
    if (hit) return hit
  }
  return null
}

export default garments
