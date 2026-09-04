/* ==========================================================================
 * Escape-From-Larpov · src/raid/index.js  —  RAID TERMINATION LIFECYCLE BLOCK
 *
 * HOTFIX: offline / training death must NOT wipe the kit.
 *
 * WHAT CHANGES.
 *   • `start()` gains an OPTIONS argument and normalises it into
 *     `this.raidOptions`. `isTraining` is the only flag this block reads, but
 *     the whole object is kept so the result screen and the profile can see
 *     exactly what the lobby deployed with.
 *   • `end(kind)` is now a three-branch settlement:
 *       extracted           → profile keeps the loadout, FIR loot is banked
 *       killed  (training)  → NO death payload, NO serialisation, NO wipe.
 *                             Every container / rig / weapon instance stays
 *                             exactly where it is and the player returns to
 *                             the stash menu with the kit intact.
 *       killed / mia / timeout (live) → the hardcore path: serialise the body,
 *                             hand the death payload to the profile, wipe.
 *   • The settlement is fenced by `_metaCall` so a profile method that throws
 *     can never strand the player in a raid without a result screen; but the
 *     TRAINING branch does not even reach those calls — it is a hard bypass,
 *     not a soft one.
 *   • `raid:end` carries `{ kind, summary, training, kitRetained }` so the
 *     HUD, the result screen and the main menu can route without re-deriving
 *     the rules.
 *
 * INTEGRATION. Replace the existing `start()` signature/preamble, `end()`,
 * `extract()` and any inventory-settlement helpers in RaidSystem with the
 * members below. Module-scope helpers go above the class. `init()` keeps its
 * `_onDeath` → `this.end('killed')` listener unchanged.
 *
 * Call site (engine.startRaid):
 *   await raid.start(mapId, faction, night, { isTraining: lobby.state.training })
 *
 * File is intentionally semicolon-free. CRLF line endings.
 * ========================================================================== */

/* ------------------------------------------------------------------ *
 * Module scope (place ABOVE `export class RaidSystem`)
 * ------------------------------------------------------------------ */

/** Canonical raid-end kinds. Anything unknown is treated as `mia`. */
export const RAID_END = Object.freeze({
  extracted: 'extracted',
  killed: 'killed',
  mia: 'mia',
  timeout: 'timeout',
  aborted: 'aborted',
})

/** Lobby flags the raid controller understands. Unknown keys are preserved. */
export const DEFAULT_RAID_OPTIONS = Object.freeze({
  isTraining: false,
  offline: false,
  night: false,
  insurance: true,
})

/**
 * Normalise whatever the lobby handed over into a complete options object.
 * Accepts a boolean (legacy `night` positional), a partial object or nothing.
 * `isTraining` is coerced strictly — only a real `true` turns protection on.
 */
export function normalizeRaidOptions(input, night) {
  const out = Object.assign({}, DEFAULT_RAID_OPTIONS)
  if (input && typeof input === 'object') {
    const keys = Object.keys(input)
    for (let i = 0; i < keys.length; i++) out[keys[i]] = input[keys[i]]
  }
  out.night = night === undefined ? !!out.night : !!night
  out.isTraining = input && typeof input === 'object' ? input.isTraining === true : false
  out.offline = out.isTraining || out.offline === true
  return out
}

function endKind(kind) {
  return RAID_END[kind] ? RAID_END[kind] : RAID_END.mia
}

/* ------------------------------------------------------------------ *
 * Class members (paste INSIDE `export class RaidSystem { … }`)
 * ------------------------------------------------------------------ */

  /** Deployed lobby flags for the active raid. Replaced on every `start()`. */
  raidOptions = Object.assign({}, DEFAULT_RAID_OPTIONS)

  /** Single source of truth for the protection rule. */
  isTraining() {
    return !!(this.raidOptions && this.raidOptions.isTraining === true)
  }

  /* ---------- старт ---------- */
  async start(mapId, faction, night, options) {
    const seed = this.ctx.rng.u32()
    this.rng = this.ctx.rng.fork('raid:' + seed)
    this.raidOptions = normalizeRaidOptions(options, night)
    this.mapId = mapId
    this.faction = faction
    this.night = this.raidOptions.night
    this.kills = 0
    this._scavKitSource = ''
    this._activeExit = null
    this._holdT = 0
    this.summary = {
      kind: '',
      kills: 0,
      xp: 0,
      value: 0,
      time: 0,
      exit: '',
      mapId,
      faction,
      night: this.night,
      training: this.isTraining(),
      kitRetained: false,
    }

    const meta = this.ctx.get('meta')

    /* Таймер Дикого проверяется ДО buildMap(): отказ обязан быть дешёвым.
     * В тренировочном рейде кулдаун не применяется — это оффлайн-сессия. */
    if (faction === 'scav' && !this.isTraining()) {
      const left = meta.scavCooldownLeft()
      if (left > 0) {
        throw new Error('[EFL/raid] выход за Дикого будет доступен через ' + Math.ceil(left / 1000) + ' с')
      }
    }

    const map = await this.world.buildMap(mapId, { night: this.night, seed })
    this.exits = map.exits
    this.timeLeft = map.duration
    this._startElapsed = this.ctx.time.elapsed

    this._scatterLoot(map)

    if (faction === 'scav') {
      const descriptor = meta.generateScavLoadout(this.rng)
      const applied = this.inv.applyLoadout(descriptor)
      this._scavKitSource = 'meta:generateScavLoadout'
      this._emitScavKit(descriptor, applied)
    }

    if (this.health && typeof this.health.reset === 'function') this.health.reset()

    this.active = true
    this.ctx.events.emit('raid:start', {
      mapId,
      faction,
      night: this.night,
      seed,
      training: this.isTraining(),
      options: this.raidOptions,
    })
  }

  /* ---------- выход ---------- */

  /** Successful extraction through `exit`. Routes into the shared terminator. */
  extract(exit) {
    if (!this.active) return
    this.summary.exit = exit && typeof exit.id === 'string' ? exit.id : exit && exit.label ? exit.label : ''
    this.end(RAID_END.extracted)
  }

  /**
   * Terminate the raid. Idempotent: the second call in the same raid is a
   * no-op, so a death event that races a timeout cannot double-settle.
   */
  end(kind) {
    if (!this.active) return
    this.active = false

    const k = endKind(kind)
    const training = this.isTraining()

    this.summary.kind = k
    this.summary.kills = this.kills
    this.summary.time = Math.max(0, this.ctx.time.elapsed - this._startElapsed)
    this.summary.training = training
    this.summary.value = this._kitValue()

    let kitRetained = false

    if (k === RAID_END.extracted) {
      kitRetained = this._settleExtract()
    } else if (training) {
      /* OFFLINE DEATH PROTECTION.
       * Hard bypass. No death payload is built, nothing is serialised, no wipe
       * runs, the profile is not told a character died. The body — container,
       * rig, weapons, pockets, secure — stays exactly as it was at the moment
       * of death and the player returns to the stash with it. */
      kitRetained = this._settleTraining(k)
    } else {
      kitRetained = this._settleDeath(k)
    }

    this.summary.kitRetained = kitRetained

    this._clearField()
    if (this.health && typeof this.health.reset === 'function') this.health.reset()

    this.ctx.events.emit('raid:end', {
      kind: k,
      summary: this.summary,
      training,
      kitRetained,
      mapId: this.mapId,
      faction: this.faction,
    })

    this._returnToStash(k, training)
  }

  /* ---------- урегулирование снаряжения ---------- */

  /** Extraction: the profile banks the loadout and the FIR loot. */
  _settleExtract() {
    const snapshot = this._serializeBody()
    this._metaCall('keepLoadout', snapshot, this.summary)
    this._metaCall('bankRaid', this.summary)
    if (this.faction === 'scav') this._metaCall('transferScavKit', snapshot, this.summary)
    return true
  }

  /**
   * Training death. Deliberately does NOT call `_serializeBody()`, does NOT
   * call `applyDeath`, does NOT clear any body path. Only a bookkeeping note
   * for the result screen; even that is optional for the profile.
   */
  _settleTraining(kind) {
    this._metaCall('noteTrainingRaid', { kind, summary: this.summary })
    return true
  }

  /**
   * Live death / MIA / timeout — the hardcore path. Serialise what was on the
   * body, hand the death payload to the profile, then wipe the body paths so
   * the stash shows exactly what the profile decided survived (insurance,
   * secure container).
   */
  _settleDeath(kind) {
    const snapshot = this._serializeBody()
    const payload = { kind, summary: this.summary, body: snapshot, insured: !!this.raidOptions.insurance }
    this._metaCall('applyDeath', payload)
    this._wipeBody()
    if (this.faction === 'scav') this._metaCall('startScavCooldown', this.summary)
    return false
  }

  /** Snapshot of every body path. Soft: a missing serializer yields null. */
  _serializeBody() {
    const inv = this.inv
    if (!inv) return null
    if (typeof inv.serializeBody === 'function') return inv.serializeBody()
    if (typeof inv.serialize === 'function') return inv.serialize({ scope: 'body' })
    return null
  }

  /** Clear every body path except the secure container. */
  _wipeBody() {
    const inv = this.inv
    if (!inv) return
    if (typeof inv.wipeBody === 'function') {
      inv.wipeBody({ keepSecure: true })
      return
    }
    if (typeof inv.bodyPaths !== 'function' || typeof inv.clearPath !== 'function') return
    const paths = inv.bodyPaths()
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i]
      if (typeof p === 'string' && p.indexOf('secure') === 0) continue
      inv.clearPath(p)
    }
  }

  /** Rouble value of the current body for the result screen. Soft. */
  _kitValue() {
    const inv = this.inv
    if (!inv || typeof inv.bodyValue !== 'function') return 0
    try {
      const v = inv.bodyValue()
      return Number.isFinite(v) ? v : 0
    } catch (_err) {
      return 0
    }
  }

  /* ---------- уборка поля ---------- */

  /** Corpses and loot points are pooled; only their contents are dropped. */
  _clearField() {
    for (let i = 0; i < this.lootPoints.length; i++) {
      const lp = this.lootPoints[i]
      lp.items.length = 0
      lp.opened = false
      lp.mesh = null
    }
    this.lootPoints.length = 0
    this.corpses.length = 0
    this.exits = []
    this._activeExit = null
    this._holdT = 0
    this._exitOut.open = false
    this._exitOut.reason = ''
    this._exitOut.progress = 0
  }

  /**
   * Route the player back to the stash. The main menu owns the screen, so we
   * ask for it through the locator (non-throwing) and fall back to an event
   * the engine already listens for. Training deaths open the STASH tab
   * directly — there is nothing to insure and nothing to mourn.
   */
  _returnToStash(kind, training) {
    const ctx = this.ctx
    const menu = typeof ctx.peek === 'function' ? ctx.peek('mainMenu') : null
    const tab = kind === RAID_END.extracted || training ? 'stash' : 'result'
    if (menu && typeof menu.show === 'function') {
      try {
        menu.show(tab, { summary: this.summary, training })
        return
      } catch (err) {
        console.warn('[EFL/raid] mainMenu.show(' + tab + ') упал, уходим через событие', err)
      }
    }
    ctx.events.emit('menu:open', { tab, summary: this.summary, training })
  }
