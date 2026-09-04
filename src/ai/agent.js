/**
 * Agent - one AI actor.
 *
 * THE ROOF TELEPORT IS FIXED, and it is worth being precise about what the bug
 * actually was, because the symptom and the cause were in different methods.
 *
 * `_tryVault()` used to cast one probe at y + 0.35, one at y + 1.15, and if the
 * low one was blocked while the high one was clear it wrote
 * `this.root.position.y += 0.55` and shoved the actor 0.35 m along its heading.
 * Two things are wrong with that. The obvious one: 0.55 m is not a step, it is
 * a chest-high hop, and nothing bounded it against the obstacle actually being
 * 0.2 m tall. The one that produced the teleport: when BOTH probes were blocked
 * - a wall - the method returned false, but `_move()` had ALREADY advanced the
 * actor into the wall on the line above. The ground re-probe that follows asks
 * for the surface under that sample, a ground query answers with the highest
 * surface it finds, and inside a building footprint the highest surface is the
 * ROOF. The bot did not jump - it was placed inside solid geometry and snapped
 * to the apex vertex above it, every frame it kept pushing.
 *
 * That also explains the WebGL program errors that came with it. Once y is
 * resolved off a roof 12 m up (or off a NaN when the probe missed the world
 * entirely), the bone matrices this actor feeds the skinning shader go with it,
 * and a non-finite matrix is a non-finite attribute upload.
 *
 * The fix is three independent gates, because any one of them can be
 * unavailable in a given build:
 *
 *   1. `_tryVault()` runs BEFORE the horizontal step is committed. It probes
 *      forward at ground + `VAULT.LOW_PROBE` (never above `STEP_CEILING`),
 *      checks clearance at ground + `VAULT.CLEARANCE`, and treats
 *      low-blocked + high-blocked as a wall: no vertical write, no horizontal
 *      step, `desiredSpeed` forced to 0, lateral redirection requested.
 *   2. a step is only taken when the MEASURED rise ahead is inside the same
 *      ceiling, so the most the actor can gain in one frame is `STEP_CEILING`.
 *   3. the ground re-probe in `_move()` is asked for surfaces at or below
 *      current y + `STEP_CEILING` and rejects anything above that outright,
 *      which kills the snap even where `physics.lineOfSight()` is missing.
 *
 * `_sanitize()` then guarantees the transform this actor hands the renderer is
 * finite, rolling back to the last good pose rather than shipping NaN.
 */

import * as THREE from 'three'
import { resolveArchetype, rollProfile, rollArmorZones } from './archetypes.js'

export const STATE = Object.freeze({
  IDLE: 'idle',
  PATROL: 'patrol',
  ALERT: 'alert',
  COMBAT: 'combat',
  BLOCKED: 'blocked',
  DEAD: 'dead',
})

export const DEG = Math.PI / 180

/**
 * MAXIMUM OBSTACLE HEIGHT CEILING and the probe geometry around it.
 *
 * `STEP_CEILING` is the single number that makes the roof teleport impossible:
 * it is the largest vertical gain any single frame is allowed to apply,
 * whichever path resolved it. A kerb or a low pallet is 0.15-0.40 m and
 * passes; a crate lip, a window sill, a balustrade and a wall are all above it
 * and are refused as walls.
 *
 * `LOW_PROBE` is where the forward probe is cast - strictly below the ceiling.
 * `CLEARANCE` is the second probe. A step has air above it, a wall does not,
 * and 1.2 m is where that distinction stops being ambiguous: above every
 * legitimate step and below the head of every actor.
 */
export const VAULT = Object.freeze({
  STEP_CEILING: 0.45,
  LOW_PROBE: 0.3,
  CLEARANCE: 1.2,
  PROBE: 0.9,
  STEP_ASSIST: 0.18,
  DROP_LIMIT: 1.6,
  DETOUR_Y: 0.95,
  DETOUR_REACH: 3.4,
  DETOUR_BIAS: 0.6,
  REDIRECT_COOLDOWN: 0.65,
})

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _down = new THREE.Vector3(0, -1, 0)
const _side = new THREE.Vector3()
const _fwd = new THREE.Vector3()

let _nextId = 1

export class Agent {
  /**
   * @param {object} ctx  service locator - ctx.get('physics'), ctx.get('world'), ctx.emit?()
   * @param {object} opts { faction, position, rng, profile }
   */
  constructor(ctx, opts = {}) {
    this.id = _nextId++
    this.ctx = ctx
    this.physics = ctx && typeof ctx.get === 'function' ? ctx.get('physics') : null
    this.rng = opts.rng || Math.random

    this.faction = opts.faction || 'scav'
    this.archetype = resolveArchetype(this.faction)
    this.profile = opts.profile || rollProfile(this.faction, this.rng)
    this._armorZones = opts.armorZones || rollArmorZones(this.faction, this.rng)

    this.root = new THREE.Group()
    this.root.name = `agent_${this.id}_${this.faction}`
    if (opts.position) this.root.position.copy(opts.position)

    this.state = STATE.PATROL
    this.heading = 0
    this.speed = 0
    this.desiredSpeed = 0
    this.groundY = this.root.position.y

    this.waypoints = []
    this.wpIndex = 0
    this.detour = null
    this.target = null

    this._lastGood = this.root.position.clone()
    this._redirectTimer = 0
    this._blockedFor = 0
    this._wallHits = 0
    this._stepsTaken = 0
    this.log = []
  }

  /* ----------------------------------------------------------------- */
  /* Public                                                            */
  /* ----------------------------------------------------------------- */

  setPatrol(points, loop = true) {
    this.waypoints = points.map((p) => (p.isVector3 ? p.clone() : new THREE.Vector3(...p)))
    this.loopPatrol = loop
    this.wpIndex = 0
    this.state = STATE.PATROL
  }

  setTarget(v) {
    this.target = v ? v.clone() : null
  }

  get position() {
    return this.root.position
  }

  update(dt) {
    if (this.state === STATE.DEAD) return
    dt = Math.min(dt, 1 / 30)
    if (this._redirectTimer > 0) this._redirectTimer -= dt
    this._think(dt)
    this._move(dt)
    this._sanitize()
  }

  /* ----------------------------------------------------------------- */
  /* Steering                                                          */
  /* ----------------------------------------------------------------- */

  _goal() {
    if (this.detour) return this.detour
    if (this.target) return this.target
    if (this.waypoints.length) return this.waypoints[this.wpIndex]
    return null
  }

  _think(dt) {
    const goal = this._goal()
    if (!goal) {
      this.desiredSpeed = 0
      return
    }
    const p = this.root.position
    const dx = goal.x - p.x
    const dz = goal.z - p.z
    const dist = Math.hypot(dx, dz)
    const arrive = this.detour ? 0.35 : 0.5

    if (dist < arrive) {
      if (this.detour) {
        this.detour = null
        this._push('detour reached, resuming route')
      } else if (this.target) {
        this.target = null
      } else if (this.waypoints.length) {
        this.wpIndex = (this.wpIndex + 1) % this.waypoints.length
        if (!this.loopPatrol && this.wpIndex === 0) this.waypoints = []
      }
      return
    }

    const want = Math.atan2(dx, dz)
    let d = want - this.heading
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    const turn = 6.5 * dt
    this.heading += Math.max(-turn, Math.min(turn, d))
    this.root.rotation.y = this.heading

    const a = this.archetype
    this.desiredSpeed = this.state === STATE.COMBAT ? a.sprint : a.speed
    if (Math.abs(d) > 60 * DEG) this.desiredSpeed *= 0.35
    if (this.state === STATE.BLOCKED && this._blockedFor > 0) {
      this._blockedFor -= dt
      if (this._blockedFor <= 0) this.state = STATE.PATROL
    }
  }

  /* ----------------------------------------------------------------- */
  /* Locomotion                                                        */
  /* ----------------------------------------------------------------- */

  _move(dt) {
    const p = this.root.position
    this._lastGood.copy(p)

    // approach the desired speed
    const accel = this.desiredSpeed > this.speed ? 9 : 14
    this.speed += Math.max(-accel * dt, Math.min(accel * dt, this.desiredSpeed - this.speed))
    if (this.speed < 1e-4) {
      this.speed = 0
      this._settle()
      return
    }

    _fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading))
    const stepLen = this.speed * dt

    // GATE 1 - probe the volume the body is about to occupy BEFORE moving into it
    const verdict = this._tryVault(_fwd)
    if (verdict === 'wall') return

    // commit the horizontal step
    p.x += _fwd.x * stepLen
    p.z += _fwd.z * stepLen

    // GATE 3 - ground re-probe capped at the ceiling: can never answer with a roof
    this._settle()
  }

  /**
   * Resolve the actor onto the surface below it. The query is asked only for
   * surfaces at or below current y + STEP_CEILING, and any rise above the
   * ceiling is refused with a full rollback of this frame's horizontal step.
   */
  _settle() {
    const ph = this.physics
    const p = this.root.position
    if (!ph || typeof ph.groundHeight !== 'function') return
    const g = ph.groundHeight(p.x, p.z, p.y + VAULT.STEP_CEILING)
    if (g === null || g === undefined || !Number.isFinite(g)) {
      p.copy(this._lastGood)
      this._blocked(_fwd, 'void below sample')
      return
    }
    const rise = g - this.groundY
    if (rise > VAULT.STEP_CEILING + 1e-4) {
      p.copy(this._lastGood)
      this._blocked(_fwd, `re-probe rise ${rise.toFixed(2)} m over ceiling`)
      return
    }
    if (rise < -VAULT.DROP_LIMIT) {
      p.copy(this._lastGood)
      this._blocked(_fwd, `drop ${(-rise).toFixed(2)} m refused`)
      return
    }
    // smooth small steps, snap drops
    if (rise > 0) p.y += Math.min(rise, VAULT.STEP_CEILING)
    else p.y = g
    this.groundY = p.y
  }

  /**
   * Step / wall discrimination ahead of the actor.
   *
   * @returns {'clear' | 'step' | 'wall'}
   *   clear - nothing at knee height, carry on
   *   step  - a rise inside the ceiling was measured and applied
   *   wall  - the clearance probe is blocked too; movement refused this frame
   */
  _tryVault(dir) {
    const ph = this.physics
    if (!ph || typeof ph.lineOfSight !== 'function') return 'clear'

    const p = this.root.position
    const ground = this.groundY

    // low probe: strictly below the ceiling, never above it
    const lowY = ground + Math.min(VAULT.LOW_PROBE, VAULT.STEP_CEILING)
    _a.set(p.x, lowY, p.z)
    _b.copy(_a).addScaledVector(dir, VAULT.PROBE)
    const lowClear = ph.lineOfSight(_a, _b)
    if (lowClear) return 'clear'

    // clearance probe at 1.2 m: a step has air above it, a wall does not
    const highY = ground + VAULT.CLEARANCE
    _a.set(p.x, highY, p.z)
    _b.copy(_a).addScaledVector(dir, VAULT.PROBE)
    const highClear = ph.lineOfSight(_a, _b)
    if (!highClear) {
      this._blocked(dir, 'wall: low + clearance probes blocked')
      return 'wall'
    }

    // GATE 2 - measure the actual rise ahead; refuse anything above the ceiling.
    // The landing sample and the step assist share one reach so the actor is
    // always placed over the surface it was measured against.
    const reach = VAULT.STEP_ASSIST + 0.04
    let landing = null
    if (typeof ph.raycast === 'function') {
      _a.set(p.x + dir.x * reach, highY, p.z + dir.z * reach)
      const hit = ph.raycast(_a, _down, VAULT.CLEARANCE + VAULT.DROP_LIMIT)
      if (hit && hit.hit) landing = hit.point.y
    } else if (typeof ph.groundHeight === 'function') {
      landing = ph.groundHeight(p.x + dir.x * reach, p.z + dir.z * reach, highY)
    }
    if (landing === null || !Number.isFinite(landing)) {
      this._blocked(dir, 'no landing surface')
      return 'wall'
    }
    const rise = landing - ground
    if (rise > VAULT.STEP_CEILING + 1e-4) {
      this._blocked(dir, `rise ${rise.toFixed(2)} m over ceiling`)
      return 'wall'
    }
    if (rise <= 0.02) return 'clear'

    // a legitimate step: bounded vertical gain, small horizontal assist
    p.y = ground + Math.min(rise, VAULT.STEP_CEILING)
    p.x += dir.x * reach
    p.z += dir.z * reach
    this.groundY = p.y
    this._stepsTaken++
    this._push(`step +${rise.toFixed(2)} m`)
    return 'step'
  }

  /**
   * Wall response: zero the drive, roll back to the last good pose, request a
   * lateral redirection. Never touches y.
   */
  _blocked(dir, why) {
    const p = this.root.position
    p.x = this._lastGood.x
    p.z = this._lastGood.z
    p.y = this._lastGood.y
    this.desiredSpeed = 0
    this.speed = 0
    this._wallHits++
    this.state = STATE.BLOCKED
    this._blockedFor = 0.2
    this._push(why)
    this._requestRedirect(dir)
  }

  /**
   * Lateral redirection: probe both sides at chest height and steer toward the
   * side with more free run, biased along the blocked heading so the actor
   * slides around a corner instead of reversing.
   */
  _requestRedirect(dir) {
    if (this._redirectTimer > 0) return
    this._redirectTimer = VAULT.REDIRECT_COOLDOWN
    const ph = this.physics
    const p = this.root.position
    _side.set(dir.z, 0, -dir.x)

    const free = (sign) => {
      if (!ph || typeof ph.raycast !== 'function') return VAULT.DETOUR_REACH
      _a.set(p.x, this.groundY + VAULT.DETOUR_Y, p.z)
      _b.copy(_side).multiplyScalar(sign)
      const hit = ph.raycast(_a, _b, VAULT.DETOUR_REACH)
      return hit ? hit.distance : VAULT.DETOUR_REACH
    }
    const left = free(1)
    const right = free(-1)
    let sign = left >= right ? 1 : -1
    if (Math.abs(left - right) < 0.2) sign = this.rng() < 0.5 ? 1 : -1
    const reach = Math.max(0.6, (sign > 0 ? left : right) - 0.5)

    this.detour = new THREE.Vector3(
      p.x + _side.x * sign * reach + dir.x * VAULT.DETOUR_BIAS,
      p.y,
      p.z + _side.z * sign * reach + dir.z * VAULT.DETOUR_BIAS,
    )
    this._push(`redirect ${sign > 0 ? 'left' : 'right'} ${reach.toFixed(1)} m`)
    if (this.ctx && typeof this.ctx.emit === 'function') {
      this.ctx.emit('ai:redirect', { id: this.id, faction: this.faction, target: this.detour.clone() })
    }
  }

  /** Guarantee the transform handed to the renderer is finite. */
  _sanitize() {
    const p = this.root.position
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
      p.copy(this._lastGood)
      this._push('non-finite transform rolled back')
    }
    if (!Number.isFinite(this.heading)) this.heading = 0
    if (!Number.isFinite(this.groundY)) this.groundY = p.y
    this.root.rotation.y = this.heading
    this.root.updateMatrixWorld()
  }

  _push(msg) {
    this.log.push({ t: performance.now(), msg })
    if (this.log.length > 24) this.log.shift()
  }

  get stats() {
    return {
      id: this.id,
      faction: this.faction,
      profile: this.profile,
      state: this.state,
      speed: this.speed,
      y: this.root.position.y,
      wallHits: this._wallHits,
      steps: this._stepsTaken,
    }
  }
}
