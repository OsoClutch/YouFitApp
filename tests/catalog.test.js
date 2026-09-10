// The catalog is shared between the browser and the Pages Function, so its
// shape is load-bearing in two places at once.

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import garments, { findGarment, TRYON_DEFAULTS } from '../src/garments.js'

const all = Object.values(garments).flat()
const repoFile = (p) => fileURLToPath(new URL(`../public${p}`, import.meta.url))

test('the catalog is not empty and every id is unique', () => {
  assert.ok(all.length > 0)
  assert.equal(new Set(all.map((g) => g.id)).size, all.length)
})

test('every garment is upper-body -- the model runs category=tops', () => {
  for (const g of all) {
    assert.equal(g.category, 'tops', `${g.id} must be tops`)
    assert.equal(g.garmentPhotoType, 'flat-lay', `${g.id} must be flat-lay`)
  }
  assert.equal(TRYON_DEFAULTS.category, 'tops')
})

test('no garment points off-origin -- art ships with the build', () => {
  for (const g of all) {
    assert.ok(g.url.startsWith('/garments/'), `${g.id} url is ${g.url}`)
    assert.ok(!/^https?:/.test(g.url), `${g.id} must not use a remote CDN`)
  }
})

test('the dead cleanUrl field is gone', () => {
  for (const g of all) assert.equal('cleanUrl' in g, false, `${g.id} still has cleanUrl`)
})

test('every garment has art on disk at the expected size', () => {
  for (const g of all) {
    const file = repoFile(g.url)
    assert.ok(existsSync(file), `missing art for ${g.id}: ${g.url}`)
    assert.ok(statSync(file).size > 10_000, `${g.id} art looks truncated`)
  }
})

test('findGarment resolves real ids and refuses everything else', () => {
  for (const g of all) assert.equal(findGarment(g.id)?.id, g.id)
  for (const bad of ['', null, undefined, 'ZZ', '../../etc/passwd', 'M1 ']) {
    assert.equal(findGarment(bad), null, `findGarment(${JSON.stringify(bad)}) should be null`)
  }
})

test('every garment is displayable -- label and name present', () => {
  for (const g of all) {
    assert.ok(g.label?.length, `${g.id} needs a label`)
    assert.ok(g.name?.length, `${g.id} needs a name`)
  }
})
