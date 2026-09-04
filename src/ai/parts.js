/**
 * AI - faction body & clothing compiler for the procedural actor.
 *
 * `buildActor()` returns a THREE.Group in the actor's bind space (metres, feet
 * on y = 0, facing +Z). Every part is tagged with `userData.part` so the
 * inspector can list exactly what a given actor is wearing.
 *
 * The compiler reads the canonical `faction` archetype field and NEVER emits
 * the same kit for two archetypes:
 *
 *   scav   - random civil layers (quilted jacket / tracksuit / jeans), civilian
 *            headgear (ushanka, beanie, bare), armour mesh only when a PACA was
 *            actually rolled into `armorZones`.
 *   raider - matching dark combat uniform, combat helmet with visor, knee pads,
 *            heavy modular plate carrier with pouches, gloves.
 *   pmc    - camo uniform, ballistic helmet, plate carrier, backpack.
 *   boss   - killa: 6B13 track armour + Maska-1Sch with the three-stripe visor
 *            shturman: open camo coat silhouette, ushanka, slung pack.
 */

import * as THREE from 'three'
import { texturesFor, mulberry32, hashSeed } from './textures.js'

const PARTS = []

function mat(map, extra = {}) {
  return new THREE.MeshStandardMaterial({
    map: map || null,
    color: extra.color !== undefined ? extra.color : 0xffffff,
    roughness: extra.roughness !== undefined ? extra.roughness : 0.92,
    metalness: extra.metalness !== undefined ? extra.metalness : 0.02,
    side: extra.side || THREE.FrontSide,
    transparent: !!extra.transparent,
    opacity: extra.opacity !== undefined ? extra.opacity : 1,
  })
}

function tag(mesh, part, group) {
  mesh.userData.part = part
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
  return mesh
}

function box(w, h, d, m, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d)
  const mesh = new THREE.Mesh(g, m)
  mesh.position.set(x, y, z)
  mesh.rotation.set(rx, ry, rz)
  return mesh
}

function capsule(r, len, m, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.CapsuleGeometry(r, len, 6, 12)
  const mesh = new THREE.Mesh(g, m)
  mesh.position.set(x, y, z)
  mesh.rotation.set(rx, ry, rz)
  return mesh
}

function sphere(r, m, x, y, z, sx = 1, sy = 1, sz = 1) {
  const g = new THREE.SphereGeometry(r, 18, 14)
  const mesh = new THREE.Mesh(g, m)
  mesh.position.set(x, y, z)
  mesh.scale.set(sx, sy, sz)
  return mesh
}

function cyl(rt, rb, h, m, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.CylinderGeometry(rt, rb, h, 16)
  const mesh = new THREE.Mesh(g, m)
  mesh.position.set(x, y, z)
  mesh.rotation.set(rx, ry, rz)
  return mesh
}

/* ================================================================== */
/* Shared body                                                        */
/* ================================================================== */

function baseBody(g, tex, opts) {
  const skin = mat(tex.skin, { roughness: 0.75 })
  const torso = mat(tex.torso)
  const legs = mat(tex.legs)
  const boot = mat(null, { color: 0x1d1a16, roughness: 0.6 })
  const bulk = opts.bulk || 1
  const height = opts.height || 1

  // head + neck
  tag(sphere(0.1, skin, 0, 1.66 * height, 0.005, 0.92, 1.05, 0.98), 'head', g)
  tag(cyl(0.05, 0.06, 0.08, skin, 0, 1.53 * height, 0), 'neck', g)

  // torso
  tag(box(0.36 * bulk, 0.56, 0.22 * bulk, torso, 0, 1.22 * height, 0), 'torso', g)
  tag(box(0.34 * bulk, 0.16, 0.22 * bulk, legs, 0, 0.88 * height, 0), 'pelvis', g)

  // arms
  for (const s of [-1, 1]) {
    tag(sphere(0.075 * bulk, torso, s * 0.21 * bulk, 1.45 * height, 0), 'shoulder', g)
    tag(capsule(0.052 * bulk, 0.22, torso, s * 0.235 * bulk, 1.3 * height, 0, 0, 0, s * 0.06), 'upperArm', g)
    tag(capsule(0.045 * bulk, 0.22, torso, s * 0.25 * bulk, 1.04 * height, 0.02, 0.1, 0, 0), 'forearm', g)
    tag(sphere(0.045, opts.gloves ? mat(null, { color: 0x1a1a1a }) : skin, s * 0.255 * bulk, 0.9 * height, 0.045, 0.9, 1, 0.7), 'hand', g)
  }

  // legs
  for (const s of [-1, 1]) {
    tag(capsule(0.078 * bulk, 0.3, legs, s * 0.1, 0.63 * height, 0), 'thigh', g)
    tag(capsule(0.062, 0.3, legs, s * 0.1, 0.3 * height, 0.01), 'shin', g)
    tag(box(0.12, 0.08, 0.26, boot, s * 0.1, 0.05, 0.04), 'boot', g)
  }
}

/* ================================================================== */
/* Head gear                                                          */
/* ================================================================== */

function ushanka(g, tex) {
  const fur = mat(tex.hat, { roughness: 1 })
  tag(sphere(0.115, fur, 0, 1.7, 0, 1, 0.8, 1), 'ushanka crown', g)
  tag(box(0.24, 0.05, 0.2, fur, 0, 1.745, 0), 'ushanka top', g)
  for (const s of [-1, 1]) tag(box(0.05, 0.14, 0.12, fur, s * 0.115, 1.6, -0.01, 0, 0, s * 0.15), 'ushanka ear flap', g)
  PARTS.push('ushanka')
}

function beanie(g, tex) {
  const knit = mat(tex.hat, { roughness: 1 })
  tag(sphere(0.108, knit, 0, 1.69, 0, 1, 0.85, 1), 'beanie', g)
  tag(cyl(0.11, 0.108, 0.05, knit, 0, 1.64, 0), 'beanie cuff', g)
  PARTS.push('beanie')
}

function combatHelmet(g, tex, visor, color) {
  const shell = mat(tex.helmet || tex.hat, { color: color || 0xffffff, roughness: 0.55, metalness: 0.15 })
  tag(sphere(0.122, shell, 0, 1.68, 0, 1, 0.92, 1.02), 'helmet shell', g)
  tag(box(0.26, 0.06, 0.02, shell, 0, 1.6, -0.1), 'helmet nape', g)
  // rail mounts
  for (const s of [-1, 1]) tag(box(0.02, 0.05, 0.16, mat(null, { color: 0x222, roughness: 0.5 }), s * 0.122, 1.66, 0.01), 'helmet rail', g)
  if (visor) {
    const vis = mat(null, { color: 0x0f1216, roughness: 0.15, metalness: 0.7, transparent: true, opacity: 0.85 })
    tag(box(0.19, 0.08, 0.03, vis, 0, 1.655, 0.11, -0.15), 'visor', g)
    PARTS.push('helmet + visor')
  } else {
    PARTS.push('helmet')
  }
}

function maskaHelmet(g, tex) {
  // Killa: Maska-1Sch with the full face plate and three white stripes
  const shell = mat(tex.helmet, { roughness: 0.5, metalness: 0.2 })
  const head = tag(sphere(0.128, shell, 0, 1.675, 0.005, 1, 0.98, 1.06), 'maska shell', g)
  head.rotation.y = Math.PI / 2
  const plate = mat(null, { color: 0x24262a, roughness: 0.4, metalness: 0.3 })
  tag(box(0.2, 0.2, 0.05, plate, 0, 1.63, 0.105, -0.08), 'maska face plate', g)
  const slit = mat(null, { color: 0x05060a, roughness: 0.2 })
  tag(box(0.15, 0.02, 0.01, slit, 0, 1.672, 0.135), 'maska eye slit', g)
  PARTS.push('Maska-1Sch (3 stripes)')
}

/* ================================================================== */
/* Armour                                                             */
/* ================================================================== */

function paca(g, tex) {
  const m = mat(tex.armor, { roughness: 0.95 })
  tag(box(0.34, 0.38, 0.26, m, 0, 1.22, 0.005), 'PACA soft armour', g)
  PARTS.push('PACA')
}

function plateCarrier(g, tex, heavy) {
  const m = mat(tex.armor, { roughness: 0.85 })
  const depth = heavy ? 0.32 : 0.28
  tag(box(0.38, 0.42, depth, m, 0, 1.24, 0.005), 'plate carrier', g)
  // cummerbund
  tag(box(0.4, 0.14, depth + 0.02, m, 0, 1.04, 0.005), 'cummerbund', g)
  // front pouches
  const pouch = mat(tex.armor, { roughness: 0.9, color: 0xd8d8d8 })
  for (const x of [-0.11, 0, 0.11]) tag(box(0.09, 0.14, 0.06, pouch, x, 1.16, depth / 2 + 0.03), 'mag pouch', g)
  if (heavy) {
    // shoulder plates + radio
    for (const s of [-1, 1]) tag(box(0.1, 0.06, 0.2, m, s * 0.2, 1.5, 0), 'shoulder plate', g)
    tag(box(0.06, 0.16, 0.05, mat(null, { color: 0x141414, roughness: 0.5 }), -0.15, 1.36, depth / 2 + 0.025), 'radio', g)
    PARTS.push('heavy plate carrier')
  } else {
    PARTS.push('plate carrier')
  }
}

function kneePads(g) {
  const m = mat(null, { color: 0x121212, roughness: 0.55 })
  for (const s of [-1, 1]) tag(sphere(0.075, m, s * 0.1, 0.46, 0.04, 1, 1, 0.8), 'knee pad', g)
  PARTS.push('knee pads')
}

function backpack(g, tex, big) {
  const m = mat(tex.armor, { roughness: 0.9, color: 0xc8c8c8 })
  const h = big ? 0.5 : 0.36
  tag(box(0.3, h, big ? 0.24 : 0.16, m, 0, 1.2, -(0.13 + (big ? 0.12 : 0.08))), 'backpack', g)
  PARTS.push(big ? 'large pack' : 'daypack')
}

/* ================================================================== */
/* Faction kits                                                       */
/* ================================================================== */

function scavKit(g, tex, profile, armorZones, rng) {
  baseBody(g, tex, { bulk: 1 })
  // civil outer layer: quilted jacket adds a hood & hem; tracksuit adds a zip
  if (profile === 'track') {
    const zip = mat(null, { color: 0xcfcfcf, metalness: 0.6, roughness: 0.3 })
    tag(box(0.015, 0.5, 0.01, zip, 0, 1.22, 0.115), 'zip', g)
    PARTS.push('tracksuit')
  } else {
    const hood = mat(tex.torso)
    tag(box(0.3, 0.12, 0.12, hood, 0, 1.5, -0.1), 'hood', g)
    tag(box(0.4, 0.06, 0.26, hood, 0, 0.95, 0), 'jacket hem', g)
    PARTS.push(profile === 'jeans' ? 'jacket + jeans' : 'quilted jacket')
  }
  const head = rng()
  if (head < 0.4) ushanka(g, tex)
  else if (head < 0.8) beanie(g, tex)
  else PARTS.push('bare head')
  // armour only when a PACA was rolled
  if (armorZones.includes('thorax')) paca(g, tex)
  else PARTS.push('no armour')
  if (rng() < 0.4) backpack(g, tex, false)
}

function raiderKit(g, tex) {
  baseBody(g, tex, { bulk: 1.05, gloves: true })
  combatHelmet(g, tex, true, 0xffffff)
  plateCarrier(g, tex, true)
  kneePads(g)
  // elbow pads + drop-leg holster
  const pad = mat(null, { color: 0x121212, roughness: 0.55 })
  for (const s of [-1, 1]) tag(sphere(0.055, pad, s * 0.25, 1.15, 0.02, 1, 1, 0.7), 'elbow pad', g)
  tag(box(0.06, 0.16, 0.1, pad, 0.19, 0.7, 0.02), 'drop-leg holster', g)
  PARTS.push('dark combat uniform', 'gloves')
}

function pmcKit(g, tex, profile) {
  baseBody(g, tex, { bulk: 1.02, gloves: true })
  combatHelmet(g, tex, false, 0xffffff)
  plateCarrier(g, tex, false)
  backpack(g, tex, true)
  // headset
  const hs = mat(null, { color: 0x1a1a1a, roughness: 0.5 })
  for (const s of [-1, 1]) tag(box(0.04, 0.08, 0.07, hs, s * 0.115, 1.64, 0.0), 'headset', g)
  PARTS.push(profile === 'bear' ? 'BEAR gorka' : 'USEC multicam', 'headset')
}

function killaKit(g, tex) {
  baseBody(g, tex, { bulk: 1.12, height: 1.02, gloves: true })
  maskaHelmet(g, tex)
  // 6B13 assault armour - tall, boxy, covering shoulders and groin
  const m = mat(tex.armor, { roughness: 0.8 })
  tag(box(0.44, 0.5, 0.34, m, 0, 1.24, 0.005), '6B13 assault armour', g)
  tag(box(0.3, 0.14, 0.32, m, 0, 0.94, 0.005), 'groin plate', g)
  for (const s of [-1, 1]) tag(box(0.14, 0.08, 0.24, m, s * 0.23, 1.52, 0), 'shoulder armour', g)
  // white side stripes on the armour, echoing the helmet
  const stripe = mat(null, { color: 0xe8e8e6, roughness: 0.6 })
  for (const s of [-1, 1]) for (const dz of [-0.06, 0, 0.06]) tag(box(0.005, 0.44, 0.02, stripe, s * 0.222, 1.24, dz), 'armour stripe', g)
  kneePads(g)
  PARTS.push('6B13 track armour', 'killa stripes')
}

function shturmanKit(g, tex) {
  baseBody(g, tex, { bulk: 1, gloves: true })
  ushanka(g, tex)
  // open camo coat: two angled front panels and a long back panel
  const coat = mat(tex.torso, { side: THREE.DoubleSide })
  tag(box(0.42, 0.7, 0.03, coat, 0, 1.0, -0.15), 'coat back', g)
  for (const s of [-1, 1]) tag(box(0.16, 0.72, 0.03, coat, s * 0.19, 0.98, 0.12, 0, s * -0.35, 0), 'coat front panel', g)
  tag(box(0.34, 0.08, 0.3, coat, 0, 1.47, -0.02), 'coat collar', g)
  // carrier visible between the open panels
  const m = mat(tex.armor, { roughness: 0.85 })
  tag(box(0.28, 0.36, 0.26, m, 0, 1.24, 0.005), 'chest rig', g)
  // slung pack + scope case
  backpack(g, tex, false)
  tag(cyl(0.03, 0.03, 0.34, mat(null, { color: 0x111, roughness: 0.4 }), -0.2, 1.3, -0.14, 0.3, 0, 0.4), 'scope case', g)
  PARTS.push('open camo coat', 'shturman silhouette')
}

/* ================================================================== */
/* Entry                                                              */
/* ================================================================== */

/**
 * @param {object} spec { faction, profile, armorZones, seed }
 * @returns {{ group: THREE.Group, parts: string[], meta: object }}
 */
export function buildActor(spec) {
  const faction = spec.faction || 'scav'
  const profile = spec.profile || 'civ'
  const armorZones = spec.armorZones || []
  const seed = spec.seed || 1
  const tex = texturesFor(faction, profile, seed)
  const rng = mulberry32(hashSeed(`${faction}:${profile}:${seed}:parts`))
  const g = new THREE.Group()
  g.name = `actor_${faction}_${profile}`
  PARTS.length = 0

  if (faction === 'raider') raiderKit(g, tex)
  else if (faction === 'pmc') pmcKit(g, tex, profile)
  else if (faction === 'boss') (profile === 'shturman' ? shturmanKit : killaKit)(g, tex)
  else scavKit(g, tex, profile, armorZones, rng)

  const parts = PARTS.slice()
  return { group: g, parts, meta: { faction, profile, armorZones, seed, garment: tex.meta.garment } }
}

export function disposeActor(group) {
  group.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose()
      if (o.material && o.material.dispose) o.material.dispose()
    }
  })
}
