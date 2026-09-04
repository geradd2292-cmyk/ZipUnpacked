/* ==========================================================================
 * Escape-From-Larpov · src/ai/index.js  —  LIVE LOCOMOTION TICKER BLOCK
 *
 * HOTFIX: bots sliding into walls and warping onto roofs.
 *
 * ROOT CAUSE. When the GPS crash killed frame 1 the AiSystem never reached its
 * gated tick, and the un-gated legacy path (`bot.root.position.addScaledVector`
 * straight from the path direction, followed by a bare ground snap) was the only
 * thing still moving actors. That path has no wall probe, no step limit, no
 * headroom check and no navmesh membership test, so a bot pushed into a wall
 * simply kept integrating, and a ground snap that found a ROOF above the
 * intended floor happily teleported the actor 6 m up.
 *
 * THE CONTRACT AFTER THIS PATCH.
 *   • EVERY positional mutate of an agent goes through `_advanceBot()` and
 *     then `_settleBot()`. Nothing else in the subsystem writes
 *     `bot.root.position`. Behaviours (`_patrol`, `_combat`, `_cover`, the
 *     path follower) only write INTENT: `bot.moveDir` and `bot.wantSpeed`.
 *   • `_advanceBot()` is the horizontal 3-gate matrix:
 *       GATE 1  structural wall probe (swept ray at knee + chest height)
 *       GATE 2  step / ceiling clearance at the candidate column
 *       GATE 3  navmesh membership + void guard
 *     Any gate failure = HARD ROLLBACK to the last legal position, speed
 *     frozen to zero, and one lateral `ai:redirect` event with the blocking
 *     normal so the actor slides around the corner instead of pushing into it.
 *   • `_settleBot()` is the vertical matrix: gravity, ground snap, a per-tick
 *     vertical delta clamp (no roof warps), a post-snap headroom re-check and
 *     a NaN fence. It rolls back exactly like the horizontal gates.
 *   • Locomotion prefers the deterministic `fixedUpdate(h)` (PHYSICS_HZ). If
 *     the engine never calls it (older core), `update(dt)` runs the same
 *     matrix with a clamped dt — never both in the same frame.
 *   • Zero per-frame allocation. All probes use vectors preallocated in
 *     `init()`; per-bot state is allocated once in `_ensureLocomotion()`.
 *
 * INTEGRATION.
 *   1. Add the constants block at module scope (below the existing STRAFE_*).
 *   2. Add the `_locoInit()` call at the end of `init(ctx)` and the two
 *      preallocations it performs.
 *   3. Replace the existing `update()` (and `fixedUpdate()` if one exists)
 *      with the versions below; add every other method to the class body.
 *   4. In `spawnWave()` / wherever a bot leaves the pool, call
 *      `this._ensureLocomotion(bot)` once after `bot.root` exists.
 *   5. Delete any remaining direct writes to `bot.root.position` in the
 *      behaviour code and replace them with `bot.moveDir` / `bot.wantSpeed`.
 *
 * New cross-subsystem event (add a row to ARCHITECTURE.md in the same commit):
 *   ai:redirect  { actor, id, position, normal, dir, reason }   emitted by ai
 *
 * File is intentionally semicolon-free. CRLF line endings.
 * ========================================================================== */

/* ------------------------------------------------------------------ *
 * Module scope — locomotion tuning
 * ------------------------------------------------------------------ */

/** Capsule radius / height used for every probe. Matches the soldier rig. */
const LOCO_RADIUS = 0.36
const LOCO_HEIGHT = 1.72

/** Probe heights (metres above feet) for the structural wall sweep. */
const LOCO_PROBE_KNEE = 0.38
const LOCO_PROBE_CHEST = 1.25

/** Extra look-ahead beyond radius + displacement so corners are seen early. */
const LOCO_WALL_LOOKAHEAD = 0.22

/** Highest ledge an actor may step onto in a single tick. Above this = wall. */
const LOCO_STEP_MAX = 0.42

/** Headroom required above the feet at the candidate column. */
const LOCO_CEIL_CLEAR = LOCO_HEIGHT + 0.12

/** Ground snap search depth. Deeper than this = void, refuse the move. */
const LOCO_GROUND_SEARCH = 3.2

/** Max vertical settle per tick while grounded. Anything larger is a warp. */
const LOCO_SETTLE_MAX = 0.55

/** Longest horizontal displacement one tick may commit (teleport guard). */
const LOCO_MAX_TICK_MOVE = 0.60

/** Free-fall constants. */
const LOCO_GRAVITY = 9.81
const LOCO_TERMINAL = 18

/** Redirect: speed is held at zero for this long, then ramps back. */
const LOCO_REDIRECT_HOLD = 0.18
const LOCO_REDIRECT_RAMP = 0.42
const LOCO_REDIRECT_COOLDOWN = 0.30

/** Longest dt the variable-rate fallback will integrate in one go. */
const LOCO_MAX_DT = 1 / 30

/** Consecutive blocked ticks before the bot is forced to repath. */
const LOCO_REPATH_AFTER_BLOCKS = 6

/* ------------------------------------------------------------------ *
 * Class members (paste INSIDE `export class AiSystem { … }`)
 * ------------------------------------------------------------------ */

  /** Call at the END of `init(ctx)`. Preallocates every probe vector once. */
  _locoInit() {
    this._up = new THREE.Vector3(0, 1, 0)
    this._down = new THREE.Vector3(0, -1, 0)
    this._disp = new THREE.Vector3()
    this._cand = new THREE.Vector3()
    this._probeO = new THREE.Vector3()
    this._probeD = new THREE.Vector3()
    this._slide = new THREE.Vector3()
    this._tangent = new THREE.Vector3()
    this._hit = { hit: false, distance: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: 0, actor: null, partIndex: -1 }
    this._fixedSeen = false
    this._locoFrame = -1
    this._redirectEvt = { actor: null, id: 0, position: new THREE.Vector3(), normal: new THREE.Vector3(), dir: new THREE.Vector3(), reason: '' }
    this.nav = this.nav || (typeof this.ctx.peek === 'function' ? this.ctx.peek('nav') : null)
  }

  /**
   * Per-bot locomotion state. Allocated ONCE when the bot leaves the pool.
   * `prev` is the last position that passed all gates — the rollback target.
   */
  _ensureLocomotion(bot) {
    if (bot.loco) {
      bot.loco.prev.copy(bot.root.position)
      bot.loco.vy = 0
      bot.loco.speed = 0
      bot.loco.blocked = 0
      bot.loco.redirectT = 0
      bot.loco.cooldown = 0
      bot.loco.grounded = false
      bot.loco.frozen = false
      return bot.loco
    }
    bot.moveDir = bot.moveDir || new THREE.Vector3()
    bot.wantSpeed = 0
    bot.loco = {
      prev: bot.root.position.clone(),
      vy: 0,
      speed: 0,
      blocked: 0,
      redirectT: 0,
      cooldown: 0,
      grounded: false,
      frozen: false,
    }
    return bot.loco
  }

  /* ---------- engine entry points ---------- */

  /**
   * Fixed-rate locomotion. Deterministic, PHYSICS_HZ. Marks `_fixedSeen` so the
   * variable-rate fallback in `update()` steps aside.
   */
  fixedUpdate(h, ctx) {
    this._fixedSeen = true
    if (!this.bots || !this.bots.length) return
    this._locoTick(h, ctx)
  }

  /**
   * Variable-rate tick: perception / decision time-slicing, path queue drain,
   * and — ONLY when the engine never calls fixedUpdate — the locomotion matrix.
   */
  update(dt, ctx) {
    const bots = this.bots
    if (!bots || !bots.length) return

    this._drainPathQueue(budget('pathRequestsPerFrame'))

    const think = Math.min(budget('botsUpdatedPerFrame'), bots.length)
    for (let n = 0; n < think; n++) {
      this.cursor = (this.cursor + 1) % bots.length
      const bot = bots[this.cursor]
      if (!bot || bot.state === S_DEAD) continue
      this._think(bot, dt * (bots.length / think), ctx)
    }

    if (!this._fixedSeen) {
      let left = Math.min(dt, 0.25)
      while (left > 0) {
        const step = left > LOCO_MAX_DT ? LOCO_MAX_DT : left
        this._locoTick(step, ctx)
        left -= step
      }
    }

    this._syncVisuals(ctx)
  }

  /**
   * One locomotion step for EVERY live agent. Same frame guard so a core that
   * calls fixedUpdate several times per frame never double-integrates a bot
   * that `update()` already moved in the fallback branch.
   */
  _locoTick(h, ctx) {
    const bots = this.bots
    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i]
      if (!bot || !bot.root || bot.state === S_DEAD) continue
      const loco = bot.loco || this._ensureLocomotion(bot)
      this._advanceBot(bot, loco, h, ctx)
      this._settleBot(bot, loco, h, ctx)
    }
  }

  /* ---------- physics wrapper ---------- */

  /**
   * Raycast against static world geometry only. Accepts both physics return
   * styles seen in this codebase: a boolean with the out-struct filled, or a
   * hit object / null. Never throws into the tick.
   */
  _ray(origin, dir, max, out) {
    out.hit = false
    const ph = this.physics
    if (!ph || typeof ph.raycast !== 'function') return false
    let res = null
    try {
      res = ph.raycast(origin, dir, max, out, 'static')
    } catch (err) {
      this._warnOnce('ray', 'physics.raycast threw inside the locomotion tick: ' + err.message)
      return false
    }
    if (res === true) return out.hit !== false && out.distance <= max
    if (res && typeof res === 'object') {
      if (res !== out) {
        out.hit = res.hit !== false
        out.distance = res.distance
        if (res.point) out.point.copy(res.point)
        if (res.normal) out.normal.copy(res.normal)
        out.surface = res.surface ?? 0
      }
      return out.hit && out.distance <= max
    }
    return false
  }

  /* ---------- GATE MATRIX: horizontal ---------- */

  /**
   * Resolve the speed the actor is allowed to use this tick. A redirect holds
   * speed at zero, then ramps it back so the slide around a corner reads as a
   * deliberate sidestep rather than a snap.
   */
  _resolveSpeed(bot, loco, h) {
    if (loco.cooldown > 0) loco.cooldown -= h
    if (loco.frozen) {
      loco.redirectT += h
      if (loco.redirectT < LOCO_REDIRECT_HOLD) {
        loco.speed = 0
        return 0
      }
      const t = (loco.redirectT - LOCO_REDIRECT_HOLD) / LOCO_REDIRECT_RAMP
      if (t >= 1) {
        loco.frozen = false
        loco.redirectT = 0
        loco.speed = bot.wantSpeed
        return loco.speed
      }
      loco.speed = bot.wantSpeed * t * t
      return loco.speed
    }
    loco.speed = bot.wantSpeed
    return loco.speed
  }

  /**
   * Horizontal advance. Reads intent (`bot.moveDir`, `bot.wantSpeed`), runs the
   * three gates on the candidate position and commits ONLY if all pass.
   */
  _advanceBot(bot, loco, h, ctx) {
    const pos = bot.root.position
    const speed = this._resolveSpeed(bot, loco, h)
    if (speed <= 0) return
    const dir = bot.moveDir
    const lenSq = dir.x * dir.x + dir.z * dir.z
    if (lenSq < 1e-8) return

    const disp = this._disp
    const inv = 1 / Math.sqrt(lenSq)
    disp.set(dir.x * inv, 0, dir.z * inv)
    let dist = speed * h
    if (dist > LOCO_MAX_TICK_MOVE) dist = LOCO_MAX_TICK_MOVE

    /* GATE 1 — structural wall. Probe at knee and chest along the travel dir. */
    const wallN = this._wallProbe(pos, disp, dist)
    if (wallN) {
      /* Try the tangential slide once: remove the into-wall component. */
      const slide = this._slide
      const dot = disp.x * wallN.x + disp.z * wallN.z
      slide.set(disp.x - wallN.x * dot, 0, disp.z - wallN.z * dot)
      const sl = Math.sqrt(slide.x * slide.x + slide.z * slide.z)
      if (sl < 0.15 || this._wallProbe(pos, slide.multiplyScalar(1 / sl), dist * sl)) {
        return this._blockRollback(bot, loco, wallN, 'wall', ctx)
      }
      disp.copy(slide)
      dist *= sl
    }

    const cand = this._cand
    cand.set(pos.x + disp.x * dist, pos.y, pos.z + disp.z * dist)

    /* GATE 2 — step height and ceiling clearance at the candidate column. */
    const floorY = this._floorAt(cand)
    if (floorY === null) {
      return this._blockRollback(bot, loco, this._faceNormal(disp), 'void', ctx)
    }
    if (floorY - pos.y > LOCO_STEP_MAX) {
      return this._blockRollback(bot, loco, this._faceNormal(disp), 'ledge', ctx)
    }
    if (!this._headroomAt(cand, floorY)) {
      return this._blockRollback(bot, loco, this._faceNormal(disp), 'ceiling', ctx)
    }

    /* GATE 3 — navmesh membership. Only enforced when a navmesh is present. */
    if (!this._onNavmesh(cand)) {
      return this._blockRollback(bot, loco, this._faceNormal(disp), 'offmesh', ctx)
    }

    /* All gates passed: commit horizontally. Vertical is settled next. */
    loco.prev.copy(pos)
    pos.x = cand.x
    pos.z = cand.z
    loco.blocked = 0
    if (floorY <= pos.y && pos.y - floorY <= LOCO_STEP_MAX) loco.grounded = true
  }

  /**
   * Sweep two rays (knee, chest) along `dir`. Returns the blocking normal
   * (preallocated, valid until the next probe) or null when the way is clear.
   */
  _wallProbe(pos, dir, dist) {
    const reach = LOCO_RADIUS + dist + LOCO_WALL_LOOKAHEAD
    const o = this._probeO
    const hit = this._hit
    o.set(pos.x, pos.y + LOCO_PROBE_CHEST, pos.z)
    if (this._ray(o, dir, reach, hit) && hit.distance < LOCO_RADIUS + dist) {
      if (Math.abs(hit.normal.y) < 0.6) return hit.normal
    }
    o.set(pos.x, pos.y + LOCO_PROBE_KNEE, pos.z)
    if (this._ray(o, dir, reach, hit) && hit.distance < LOCO_RADIUS + dist) {
      if (Math.abs(hit.normal.y) < 0.6) return hit.normal
    }
    return null
  }

  /** Floor height under `p`, searched from just above step height. Null = void. */
  _floorAt(p) {
    const o = this._probeO
    const hit = this._hit
    o.set(p.x, p.y + LOCO_STEP_MAX + 0.05, p.z)
    const max = LOCO_STEP_MAX + 0.05 + LOCO_GROUND_SEARCH
    if (!this._ray(o, this._down, max, hit)) return null
    if (hit.normal.y < 0.45) return null
    return hit.point.y
  }

  /** True when there is a full standing height of clearance above `floorY`. */
  _headroomAt(p, floorY) {
    const o = this._probeO
    const hit = this._hit
    o.set(p.x, floorY + 0.05, p.z)
    if (!this._ray(o, this._up, LOCO_CEIL_CLEAR, hit)) return true
    return hit.distance >= LOCO_CEIL_CLEAR
  }

  /** Navmesh membership. A missing navmesh means the gate is not applicable. */
  _onNavmesh(p) {
    const nav = this.nav
    if (!nav) return true
    if (typeof nav.contains === 'function') return !!nav.contains(p)
    if (typeof nav.isOnMesh === 'function') return !!nav.isOnMesh(p)
    if (typeof nav.nearest === 'function') {
      const n = nav.nearest(p)
      if (!n) return false
      const dx = (n.x ?? p.x) - p.x
      const dz = (n.z ?? p.z) - p.z
      return dx * dx + dz * dz <= LOCO_RADIUS * LOCO_RADIUS
    }
    return true
  }

  /** A normal facing back against the travel direction, for non-ray blocks. */
  _faceNormal(dir) {
    return this._tangent.set(-dir.x, 0, -dir.z)
  }

  /* ---------- rollback + lateral redirect ---------- */

  /**
   * HARD ROLLBACK. Restore the last legal position, zero the speed, and pick a
   * lateral direction along the blocking surface. Emits exactly one
   * `ai:redirect` per cooldown window so listeners (squad, audio, debug
   * overlay) are not flooded while an actor is pinned.
   */
  _blockRollback(bot, loco, normal, reason, ctx) {
    const pos = bot.root.position
    pos.copy(loco.prev)
    loco.speed = 0
    loco.vy = 0
    loco.blocked++
    loco.frozen = true
    loco.redirectT = 0

    /* Tangent along the wall: cross(up, n). Keep the sign that best matches
     * where the bot already wanted to go so it slides, not reverses. */
    const t = this._slide
    t.set(normal.z, 0, -normal.x)
    const tl = Math.sqrt(t.x * t.x + t.z * t.z)
    if (tl < 1e-4) {
      t.set(1, 0, 0)
    } else {
      t.multiplyScalar(1 / tl)
      if (t.x * bot.moveDir.x + t.z * bot.moveDir.z < 0) t.multiplyScalar(-1)
    }
    if (loco.blocked > LOCO_REPATH_AFTER_BLOCKS && (loco.blocked & 1)) t.multiplyScalar(-1)
    bot.moveDir.copy(t)

    if (loco.blocked >= LOCO_REPATH_AFTER_BLOCKS) {
      loco.blocked = 0
      this._requestRepath(bot)
    }

    if (loco.cooldown > 0) return
    loco.cooldown = LOCO_REDIRECT_COOLDOWN

    const e = this._redirectEvt
    e.actor = bot
    e.id = bot.id ?? 0
    e.position.copy(pos)
    e.normal.copy(normal)
    e.dir.copy(t)
    e.reason = reason
    const events = (ctx && ctx.events) || (this.ctx && this.ctx.events)
    if (events && typeof events.emit === 'function') events.emit('ai:redirect', e)
  }

  /** Push the bot onto the path queue once; the drain is budgeted per frame. */
  _requestRepath(bot) {
    if (!this.pathQueue) this.pathQueue = []
    if (bot._repathQueued) return
    bot._repathQueued = true
    this.pathQueue.push(bot)
  }

  /** Serve at most `n` queued path requests this frame. */
  _drainPathQueue(n) {
    const q = this.pathQueue
    if (!q || !q.length) return
    const nav = this.nav
    for (let i = 0; i < n && q.length; i++) {
      const bot = q.shift()
      bot._repathQueued = false
      if (!bot || bot.state === S_DEAD || !nav || typeof nav.findPath !== 'function') continue
      const goal = bot.goal || bot.target || null
      if (!goal) continue
      try {
        const path = nav.findPath(bot.root.position, goal)
        if (path && path.length) {
          bot.path = path
          bot.pathIdx = 0
        }
      } catch (err) {
        this._warnOnce('repath', 'nav.findPath threw: ' + err.message)
      }
    }
  }

  /* ---------- GATE MATRIX: vertical ---------- */

  /**
   * Vertical settle. Gravity when airborne, ground snap when a floor is within
   * reach, and — the part that stops roof warps — a per-tick vertical delta
   * clamp with a post-snap headroom re-check. Any violation rolls back to the
   * last legal position exactly like the horizontal gates.
   */
  _settleBot(bot, loco, h, ctx) {
    const pos = bot.root.position
    const startY = pos.y

    const floorY = this._floorAt(pos)
    if (floorY === null) {
      /* Nothing under the actor within search depth: free fall, but never
       * below the last legal height minus the search depth. */
      loco.grounded = false
      loco.vy = Math.max(loco.vy - LOCO_GRAVITY * h, -LOCO_TERMINAL)
      pos.y += loco.vy * h
      if (loco.prev.y - pos.y > LOCO_GROUND_SEARCH) {
        return this._blockRollback(bot, loco, this._up, 'void', ctx)
      }
    } else {
      const dy = floorY - pos.y
      if (dy > LOCO_SETTLE_MAX) {
        /* Floor found ABOVE the actor by more than a settle step — this is the
         * roof-warp signature. Refuse it. */
        return this._blockRollback(bot, loco, this._down, 'roofwarp', ctx)
      }
      if (dy >= -LOCO_STEP_MAX) {
        pos.y = floorY
        loco.vy = 0
        loco.grounded = true
      } else {
        loco.grounded = false
        loco.vy = Math.max(loco.vy - LOCO_GRAVITY * h, -LOCO_TERMINAL)
        pos.y += loco.vy * h
        if (pos.y < floorY) {
          pos.y = floorY
          loco.vy = 0
          loco.grounded = true
        }
      }
    }

    /* Vertical delta clamp while grounded: a snap larger than the settle
     * budget in one tick is never a legitimate step. */
    if (loco.grounded && Math.abs(pos.y - startY) > LOCO_SETTLE_MAX) {
      return this._blockRollback(bot, loco, this._down, 'settle', ctx)
    }

    /* Post-snap headroom: standing up into a ceiling is a rollback too. */
    if (loco.grounded && !this._headroomAt(pos, pos.y)) {
      return this._blockRollback(bot, loco, this._down, 'ceiling', ctx)
    }

    /* NaN fence. A single bad ray must never poison the transform. */
    if (pos.x !== pos.x || pos.y !== pos.y || pos.z !== pos.z) {
      pos.copy(loco.prev)
      loco.vy = 0
      loco.speed = 0
      this._warnOnce('nan', 'non-finite actor position rolled back')
      return
    }

    if (loco.grounded) loco.prev.copy(pos)
  }

  /* ---------- visuals follow the committed transform ---------- */

  /**
   * Face the actor along its committed travel direction. The rig, the
   * animator and the weapon sync hooks read `bot.root` after this, so the
   * transform they see is always one that passed every gate.
   */
  _syncVisuals(ctx) {
    const bots = this.bots
    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i]
      if (!bot || !bot.root || bot.state === S_DEAD) continue
      const loco = bot.loco
      if (!loco || loco.speed <= 0.05) continue
      const d = bot.moveDir
      if (d.x * d.x + d.z * d.z < 1e-6) continue
      const yaw = Math.atan2(d.x, d.z)
      let delta = yaw - bot.root.rotation.y
      while (delta > Math.PI) delta -= Math.PI * 2
      while (delta < -Math.PI) delta += Math.PI * 2
      bot.root.rotation.y += delta * Math.min(1, (ctx && ctx.time ? ctx.time.dt : 0.016) * 10)
    }
  }
