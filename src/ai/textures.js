/**
 * AI - procedural clothing textures per faction archetype.
 *
 * No image assets. Every surface is painted into a canvas at load time and
 * cached per (faction, profile, seed). `texturesFor()` is the only entry point
 * `parts.js` needs: it returns a bundle keyed by garment slot.
 */

import * as THREE from 'three'

const _cache = new Map()

export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashSeed(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function canvas(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function toTexture(c, repeat = 1) {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  t.needsUpdate = true
  return t
}

function hex(c) {
  return typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : c
}

function shade(color, k) {
  const c = new THREE.Color(hex(color))
  c.multiplyScalar(k)
  return '#' + c.getHexString()
}

/** Speckle grain + directional weave, the base of every fabric here. */
function grain(ctx, w, h, rng, amount = 0.08, weave = true) {
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * 255 * amount
    d[i] += n
    d[i + 1] += n
    d[i + 2] += n
  }
  ctx.putImageData(img, 0, 0)
  if (weave) {
    ctx.globalAlpha = 0.06
    ctx.fillStyle = '#000'
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1)
    for (let x = 0; x < w; x += 3) ctx.fillRect(x, 0, 1, h)
    ctx.globalAlpha = 1
  }
}

function dirt(ctx, w, h, rng, strength = 0.25) {
  for (let i = 0; i < 40; i++) {
    const x = rng() * w
    const y = rng() * h
    const r = 8 + rng() * 40
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(30,22,12,${strength * rng()})`)
    g.addColorStop(1, 'rgba(30,22,12,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
}

/* ================================================================== */
/* Surfaces                                                           */
/* ================================================================== */

export function quiltedJacket(color, rng) {
  const w = 256
  const h = 256
  const c = canvas(w, h)
  const ctx = c.getContext('2d')
  ctx.fillStyle = hex(color)
  ctx.fillRect(0, 0, w, h)
  grain(ctx, w, h, rng, 0.05)
  // quilt channels
  ctx.strokeStyle = shade(color, 0.55)
  ctx.lineWidth = 2
  for (let y = 0; y < h; y += 32) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }
  ctx.strokeStyle = shade(color, 1.25)
  ctx.lineWidth = 1
  for (let y = 4; y < h; y += 32) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }
  dirt(ctx, w, h, rng, 0.3)
  return toTexture(c, 2)
}

export function tracksuit(base, stripe, rng) {
  const w = 256
  const h = 256
  const c = canvas(w, h)
  const ctx = c.getContext('2d')
  ctx.fillStyle = hex(base)
  ctx.fillRect(0, 0, w, h)
  grain(ctx, w, h, rng, 0.04)
  // three lateral stripes down the side seam (u ~ 0.25 and 0.75)
  ctx.fillStyle = hex(stripe)
  for (const u of [0.25, 0.75]) {
    const x = u * w
    ctx.fillRect(x - 14, 0, 6, h)
    ctx.fillRect(x - 3, 0, 6, h)
    ctx.fillRect(x + 8, 0, 6, h)
  }
  ctx.globalAlpha = 0.35
  ctx.fillStyle = '#fff'
  for (let y = 0; y < h; y += 2) ctx.fillRect(0, y, w, 1)
  ctx.globalAlpha = 1
  dirt(ctx, w, h, rng, 0.2)
  return toTexture(c, 1)
}

export function denim(rng, tone = 0x2e3f5c) {
  const w = 256
  const h = 256
  const c = canvas(w, h)
  const ctx = c.getContext('2d')
  ctx.fillStyle = hex(tone)
  ctx.fillRect(0, 0, w, h)
  grain(ctx, w, h, rng, 0.14, false)
  // twill diagonal
  ctx.globalAlpha = 0.18
  ctx.strokeStyle = '#9fb3d1'
  ctx.lineWidth = 1
  for (let i = -h; i < w; i += 4) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i + h, h)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  // worn knees
  for (const y of [0.42, 0.44]) {
    const g = ctx.createRadialGradient(w * 0.5, h * y, 0, w * 0.5, h * y, 50)
    g.addColorStop(0, 'rgba(190,205,225,0.35)')
    g.addColorStop(1, 'rgba(190,205,225,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }
  dirt(ctx, w, h, rng, 0.35)
  return toTexture(c, 2)
}

export function camo(palette, rng, scale = 1) {
  const w = 256
  const h = 256
  const c = canvas(w, h)
  const ctx = c.getContext('2d')
  ctx.fillStyle = hex(palette[0])
  ctx.fillRect(0, 0, w, h)
  for (let layer = 1; layer < palette.length; layer++) {
    ctx.fillStyle = hex(palette[layer])
    const n = 26 - layer * 4
    for (let i = 0; i < n; i++) {
      const x = rng() * w
      const y = rng() * h
      ctx.beginPath()
      const segs = 7 + Math.floor(rng() * 5)
      for (let s = 0; s <= segs; s++) {
        const a = (s / segs) * Math.PI * 2
        const r = (14 + rng() * 26) * scale
        const px = x + Math.cos(a) * r * (0.7 + rng() * 0.6)
        const py = y + Math.sin(a) * r * (0.5 + rng() * 0.6)
        if (s === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
      ctx.fill()
    }
  }
  grain(ctx, w, h, rng, 0.07)
  dirt(ctx, w, h, rng, 0.15)
  return toTexture(c, 2)
}

export function plateCarrier(color, rng, molleRows = 6) {
  const w = 256
  const h = 256
  const c = canvas(w, h)
  const ctx = c.getContext('2d')
  ctx.fillStyle = hex(color)
  ctx.fillRect(0, 0, w, h)
  grain(ctx, w, h, rng, 0.06)
  // MOLLE webbing
  const rowH = h / (molleRows * 2)
  for (let r = 0; r < molleRows; r++) {
    const y = rowH * (r * 2 + 1)
    ctx.fillStyle = shade(color, 0.7)
    ctx.fillRect(0, y - 3, w, rowH * 0.9)
    ctx.fillStyle = shade(color, 1.15)
    ctx.fillRect(0, y - 3, w, 2)
    ctx.fillStyle = shade(color, 0.45)
    for (let x = 6; x < w; x += 24) ctx.fillRect(x, y - 1, 3, rowH * 0.8)
  }
  return toTexture(c, 1)
}

export function killaHelmet(rng) {
  const w = 256
  const h = 256
  const c = canvas(w, h)
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#2b2d30'
  ctx.fillRect(0, 0, w, h)
  grain(ctx, w, h, rng, 0.04, false)
  // Killa's iconic three white stripes running front to back over the crown
  ctx.fillStyle = '#e9e9e6'
  ctx.fillRect(w * 0.5 - 30, 0, 12, h)
  ctx.fillRect(w * 0.5 - 6, 0, 12, h)
  ctx.fillRect(w * 0.5 + 18, 0, 12, h)
  ctx.globalAlpha = 0.5
  dirt(ctx, w, h, rng, 0.4)
  ctx.globalAlpha = 1
  return toTexture(c, 1)
}

export function skin(tone, rng) {
  const w = 64
  const h = 64
  const c = canvas(w, h)
  const ctx = c.getContext('2d')
  ctx.fillStyle = hex(tone)
  ctx.fillRect(0, 0, w, h)
  grain(ctx, w, h, rng, 0.05, false)
  return toTexture(c, 1)
}

export function knit(color, rng) {
  const w = 128
  const h = 128
  const c = canvas(w, h)
  const ctx = c.getContext('2d')
  ctx.fillStyle = hex(color)
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = shade(color, 0.7)
  for (let y = 0; y < h; y += 6) ctx.fillRect(0, y, w, 2)
  grain(ctx, w, h, rng, 0.1, false)
  return toTexture(c, 3)
}

/* ================================================================== */
/* Faction palettes                                                   */
/* ================================================================== */

export const PALETTES = Object.freeze({
  scav: Object.freeze({
    civ: [0x5a4a3a, 0x3f4a2e, 0x6b6357, 0x2f3540, 0x7a3b2e],
    track: [
      [0x1c2a5a, 0xe4e4e4],
      [0x8c1c1c, 0xf0f0f0],
      [0x14141a, 0xd6d6d6],
      [0x2a5a2f, 0xf5f5f5],
    ],
    jeans: [0x2e3f5c, 0x1f2b40, 0x4a5b78, 0x30302e],
    hat: [0x3a2f26, 0x1e1e22, 0x5e5342, 0x6e1d1d],
  }),
  raider: Object.freeze({
    black: [0x15171a, 0x1e2226, 0x26292c],
    olive: [0x2f3a24, 0x3a4630, 0x222b1c],
    carrier: 0x1a1c1f,
    helmet: 0x1b1d20,
  }),
  pmc: Object.freeze({
    usec: [0x6b5b3e, 0x8a7a55, 0x4a4a32, 0x2c3a2c, 0x9c9070],
    bear: [0x3b4a34, 0x59653f, 0x2b3325, 0x7a7d5c],
    carrier: 0x4c4a3a,
    helmet: 0x4a4636,
  }),
  boss: Object.freeze({
    killaBody: 0x2a2c30,
    killaArmor: 0x1a1b1e,
    shturmanCoat: [0x5f6b4e, 0x8b8f6e, 0x3f4633, 0xb9b39a],
    shturmanBase: 0x2d3226,
  }),
})

/* ================================================================== */
/* Bundle                                                             */
/* ================================================================== */

/**
 * Build the material bundle for an actor.
 * @returns {{ torso, legs, hat, armor, helmet, skin, accent, meta }}
 */
export function texturesFor(faction, profile, seed = 1) {
  const key = `${faction}:${profile}:${seed}`
  if (_cache.has(key)) return _cache.get(key)
  const rng = mulberry32(hashSeed(key))
  const pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length]
  const skinTone = pick([0xd9b49a, 0xc79a7b, 0xe8c4a8, 0xb98a6b])
  const out = {
    skin: skin(skinTone, rng),
    meta: { faction, profile, seed },
  }

  if (faction === 'scav') {
    const P = PALETTES.scav
    if (profile === 'track') {
      const [base, stripe] = pick(P.track)
      out.torso = tracksuit(base, stripe, rng)
      out.legs = tracksuit(base, stripe, rng)
      out.meta.garment = 'tracksuit'
    } else if (profile === 'jeans') {
      out.torso = quiltedJacket(pick(P.civ), rng)
      out.legs = denim(rng, pick(P.jeans))
      out.meta.garment = 'jacket + jeans'
    } else {
      out.torso = quiltedJacket(pick(P.civ), rng)
      out.legs = knit(pick([0x3a3a3a, 0x4a4033, 0x2c2c30]), rng)
      out.meta.garment = 'civilian layers'
    }
    out.hat = knit(pick(P.hat), rng)
    out.armor = plateCarrier(0x3c3a34, rng, 3)
    out.accent = out.hat
  } else if (faction === 'raider') {
    const P = PALETTES.raider
    const pal = profile === 'olive' ? P.olive : P.black
    out.torso = camo(pal, rng, 0.7)
    out.legs = camo(pal, rng, 0.7)
    out.armor = plateCarrier(P.carrier, rng, 7)
    out.helmet = plateCarrier(P.helmet, rng, 1)
    out.hat = out.helmet
    out.accent = out.armor
    out.meta.garment = 'combat uniform'
  } else if (faction === 'pmc') {
    const P = PALETTES.pmc
    const pal = profile === 'bear' ? P.bear : P.usec
    out.torso = camo(pal, rng, 1)
    out.legs = camo(pal, rng, 1)
    out.armor = plateCarrier(P.carrier, rng, 6)
    out.helmet = plateCarrier(P.helmet, rng, 1)
    out.hat = out.helmet
    out.accent = out.armor
    out.meta.garment = profile === 'bear' ? 'BEAR gorka' : 'USEC multicam'
  } else {
    const P = PALETTES.boss
    if (profile === 'shturman') {
      out.torso = camo(P.shturmanCoat, rng, 1.2)
      out.legs = camo([P.shturmanBase, 0x3a4030], rng, 0.8)
      out.armor = plateCarrier(0x2c3026, rng, 5)
      out.hat = knit(0x2b2f27, rng)
      out.accent = out.torso
      out.meta.garment = 'open camo coat'
    } else {
      out.torso = tracksuit(P.killaBody, 0xe6e6e6, rng)
      out.legs = tracksuit(P.killaBody, 0xe6e6e6, rng)
      out.armor = plateCarrier(P.killaArmor, rng, 8)
      out.helmet = killaHelmet(rng)
      out.hat = out.helmet
      out.accent = out.helmet
      out.meta.garment = '6B13 + Maska-1Sch'
    }
  }
  _cache.set(key, out)
  return out
}
