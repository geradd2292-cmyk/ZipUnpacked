/* ==========================================================================
 * Escape-From-Larpov · src/ui/gpsMap.js  —  MARKER RECONSTRUCTION BLOCK
 *
 * HOTFIX: registry.js:32 `subsystem "quests" not registered`
 *         thrown from GpsMap._rebuildMarkers (gpsMap.js:197:73)
 *
 * ROOT CAUSE. `_rebuildMarkers()` reached the service locator with a HARD
 * lookup — `ctx.get('quests')` — and the registry contract (src/core/registry.js)
 * is explicit: `get(id)` THROWS for an unknown id, `peek(id)` returns null,
 * `has(id)` returns a boolean. The quest subsystem is not part of the boot
 * graph yet, so the first `raid:start` rebuilt the chart, the lookup threw
 * inside Engine.step(), and the whole frame died before HealthSystem, the
 * weapon hit path and the AI locomotion gates ever ran.
 *
 * THE FIX IS AN ISOLATION LAYER, NOT A TRY/CATCH BAND-AID.
 *   1. Quest access goes through ONE resolver, `_questService()`, that only
 *      ever uses the non-throwing registry primitives (`has` / `peek`).
 *   2. The rebuild has two explicit modes:
 *        LIVE    — service present: extraction pins + live quest pins.
 *        STATIC  — service absent : extraction pins from the authored map
 *                  schema only. No quest math, no listener, clean exit.
 *   3. Live pin extraction is itself fenced: a quest service that exists but
 *      misbehaves degrades the chart to STATIC mode for that rebuild instead
 *      of taking the main thread down.
 *   4. Event binding is symmetric (`_bindMapSources` / `_unbindMapSources`),
 *      quest listeners are attached ONLY when the service is present, and a
 *      late-registered quest service is picked up on the next rebuild.
 *
 * INTEGRATION. Replace the existing `_rebuildMarkers()` and the map-binding
 * methods in the GpsMap class body with the methods below (they are class
 * members — paste them inside `export class GpsMap { … }`). The helper
 * constants and the two module-level functions go at module scope, above the
 * class. Nothing here allocates per frame: the marker array is reused, and
 * the rebuild only runs when `_markersDirty` is set.
 *
 * Requires from module scope (already present in gpsMap.js):
 *   MAP_SCHEMAS, MARKER
 * Reads from the instance (already present in gpsMap.js):
 *   this.ctx, this.mapId, this.schema, this.markers, this._objectives
 *
 * File is intentionally semicolon-free. CRLF line endings.
 * ========================================================================== */

/* ------------------------------------------------------------------ *
 * Module-scope helpers (place ABOVE `export class GpsMap`)
 * ------------------------------------------------------------------ */

/** Registry id of the (optional) quest subsystem. */
export const QUEST_SERVICE_ID = 'quests'

/** Events that invalidate the pin layer. Quest events bind only in LIVE mode. */
export const MAP_SOURCE_EVENTS = Object.freeze(['raid:start', 'raid:end', 'map:changed'])
export const QUEST_SOURCE_EVENTS = Object.freeze([
  'quest:accepted',
  'quest:updated',
  'quest:completed',
  'quest:failed',
  'quests:changed',
  'objectives:changed',
])

/** Method names a quest service may expose for per-map pins, in preference order. */
const QUEST_PIN_READERS = Object.freeze(['markersFor', 'pinsFor', 'objectivesFor', 'forMap'])

/** Marker status vocabulary. Anything else collapses to 'future'. */
const MARKER_STATUS = Object.freeze({ active: 'active', future: 'future', done: 'done' })

/** Default pin radius in metres when a source omits it. */
const DEFAULT_PIN_RADIUS = 3

function finite(n) {
  return typeof n === 'number' && Number.isFinite(n)
}

/**
 * Coerce an arbitrary source record into the canonical `Marker` shape
 * ({ id, kind, status, label, x, z, radius }) or return null when the record
 * cannot be placed on the chart. Accepts `{x,z}`, `{position:{x,z}}` and
 * `{pos:{x,z}}` so the world, the raid controller and a future quest system
 * can all feed it without an adapter.
 */
function coerceMarker(src, kind, fallbackStatus) {
  if (!src || typeof src !== 'object') return null
  const p = src.position || src.pos || src
  const x = finite(p.x) ? p.x : null
  const z = finite(p.z) ? p.z : null
  if (x === null || z === null) return null
  const rawStatus = typeof src.status === 'string' ? src.status : fallbackStatus
  const status = MARKER_STATUS[rawStatus] || 'future'
  const id = typeof src.id === 'string' && src.id ? src.id : kind + ':' + x.toFixed(1) + ':' + z.toFixed(1)
  const label = typeof src.label === 'string' ? src.label : typeof src.name === 'string' ? src.name : id
  const radius = finite(src.radius) && src.radius > 0 ? src.radius : DEFAULT_PIN_RADIUS
  return { id, kind, status, label, x, z, radius }
}

/* ------------------------------------------------------------------ *
 * Class members (paste INSIDE `export class GpsMap { … }`)
 * ------------------------------------------------------------------ */

  /**
   * Resolve the quest subsystem WITHOUT ever throwing.
   *
   * Order matters: `has()` is the cheapest and the most explicit signal; `peek()`
   * is the contract's own non-throwing lookup; the guarded `get()` is only for
   * a foreign ctx that implements neither. A ctx that is missing entirely
   * (headless preview, unit harness) resolves to null like an absent service.
   */
  _questService() {
    const ctx = this.ctx
    if (!ctx) return null
    if (typeof ctx.has === 'function' && !ctx.has(QUEST_SERVICE_ID)) return null
    if (typeof ctx.peek === 'function') return ctx.peek(QUEST_SERVICE_ID) || null
    if (typeof ctx.get !== 'function') return null
    try {
      return ctx.get(QUEST_SERVICE_ID) || null
    } catch (_err) {
      return null
    }
  }

  /** True when the chart is currently allowed to compute live quest pins. */
  get questsLive() {
    return this._questsLive === true
  }

  /**
   * The authored schema for the map the raid is on. `this.schema` wins when the
   * device was opened with an explicit chart; otherwise resolve from the raid's
   * map id, then fall back to the first known schema so the tablet never opens
   * on an empty canvas.
   */
  _activeSchema() {
    if (this.schema && Array.isArray(this.schema.extractions)) return this.schema
    const raid = this.ctx && typeof this.ctx.peek === 'function' ? this.ctx.peek('raid') : null
    const mapId = this.mapId || (raid && raid.mapId) || null
    if (mapId && MAP_SCHEMAS[mapId]) return MAP_SCHEMAS[mapId]
    const ids = Object.keys(MAP_SCHEMAS)
    return ids.length ? MAP_SCHEMAS[ids[0]] : null
  }

  /**
   * Static world extraction zones. This is the ONLY data the chart carries in
   * STATIC mode. Source of truth is the authored schema; if the live raid
   * controller has resolved exits for this map they are merged by id so a
   * closed/conditional exit can still be reflected without a quest service.
   */
  _pushExtractions(out, schema) {
    const seen = this._extractSeen || (this._extractSeen = new Set())
    seen.clear()
    const list = Array.isArray(schema.extractions) ? schema.extractions : []
    for (let i = 0; i < list.length; i++) {
      const m = coerceMarker(list[i], 'extract', 'active')
      if (!m) continue
      seen.add(m.id)
      out.push(m)
    }
    const raid = this.ctx && typeof this.ctx.peek === 'function' ? this.ctx.peek('raid') : null
    const exits = raid && Array.isArray(raid.exits) ? raid.exits : null
    if (!exits) return
    for (let i = 0; i < exits.length; i++) {
      const m = coerceMarker(exits[i], 'extract', 'active')
      if (!m || seen.has(m.id)) continue
      seen.add(m.id)
      out.push(m)
    }
  }

  /**
   * Objectives pushed explicitly through the public `setObjectives()` API.
   * These are caller-authored static pins, not live quest calculations, so
   * they are legal in both modes.
   */
  _pushStaticObjectives(out) {
    const list = Array.isArray(this._objectives) ? this._objectives : null
    if (!list) return
    for (let i = 0; i < list.length; i++) {
      const m = coerceMarker(list[i], 'quest', 'future')
      if (m) out.push(m)
    }
  }

  /**
   * Read live pins from a PRESENT quest service. Tries the known reader names,
   * then a plain `objectives` array. Returns null when the service exposes
   * nothing usable so the caller can fall back to STATIC mode explicitly.
   */
  _readQuestPins(quests, schema) {
    const mapId = this.mapId || (schema && schema.id) || null
    for (let i = 0; i < QUEST_PIN_READERS.length; i++) {
      const name = QUEST_PIN_READERS[i]
      if (typeof quests[name] !== 'function') continue
      const res = quests[name](mapId)
      if (Array.isArray(res)) return res
    }
    if (Array.isArray(quests.objectives)) return quests.objectives
    if (Array.isArray(quests.pins)) return quests.pins
    return null
  }

  _pushQuestPins(out, pins) {
    for (let i = 0; i < pins.length; i++) {
      const m = coerceMarker(pins[i], 'quest', 'future')
      if (m) out.push(m)
    }
  }

  /** One-shot diagnostics so a missing optional service never spams the console. */
  _noteOnce(key, msg) {
    const seen = this._noted || (this._noted = Object.create(null))
    if (seen[key]) return
    seen[key] = true
    if (typeof console !== 'undefined') console.info('[EFL/gps] ' + msg)
  }

  /**
   * Rebuild the pin layer.
   *
   * Never throws. Never touches the quest subsystem through a throwing path.
   * Always leaves `this.markers` in a drawable state (possibly extraction-only)
   * and clears `_markersDirty` so `draw()` will not retry every frame.
   *
   * Returns the reused marker array for callers that want it inline.
   */
  _rebuildMarkers() {
    const out = this.markers || (this.markers = [])
    out.length = 0
    this._markersDirty = false

    const schema = this._activeSchema()
    if (!schema) {
      this._questsLive = false
      this._noteOnce('schema', 'no chart schema for map "' + String(this.mapId) + '" — pin layer empty')
      return out
    }

    /* Layer 1 — static world extraction zones. Present in BOTH modes. */
    this._pushExtractions(out, schema)

    /* Layer 2 — caller-authored objectives. Static, so present in BOTH modes. */
    this._pushStaticObjectives(out)

    /* Layer 3 — live quest pins. Requires the optional service. */
    const quests = this._questService()
    if (!quests) {
      if (this._questsLive) this._unbindQuestSources()
      this._questsLive = false
      this._noteOnce('quests:absent', 'quest service not registered — chart running in STATIC extraction mode')
      return out
    }

    let pins = null
    try {
      pins = this._readQuestPins(quests, schema)
    } catch (err) {
      pins = null
      if (typeof console !== 'undefined') console.warn('[EFL/gps] quest pin read failed — falling back to STATIC mode for this rebuild', err)
    }

    if (!pins) {
      this._questsLive = false
      this._noteOnce('quests:empty', 'quest service present but exposes no pin reader — STATIC mode')
      return out
    }

    this._pushQuestPins(out, pins)
    if (!this._questsLive) {
      this._questsLive = true
      this._bindQuestSources()
    }
    return out
  }

  /**
   * Public API (declared in gpsMap.d.ts). Accepts caller-authored objective
   * pins, marks the layer dirty and rebuilds immediately so the next `draw()`
   * has the new set. Passing a non-array clears the static objective layer.
   */
  setObjectives(list) {
    this._objectives = Array.isArray(list) ? list.slice() : null
    this._markersDirty = true
    this._rebuildMarkers()
    if (typeof this.requestDraw === 'function') this.requestDraw()
  }

  /** Mark the pin layer stale; the rebuild happens lazily on the next draw. */
  _invalidateMarkers() {
    this._markersDirty = true
    if (typeof this.requestDraw === 'function') this.requestDraw()
  }

  /** Called from `draw()` before the pin pass. Cheap when nothing changed. */
  _ensureMarkers() {
    if (this._markersDirty || !this.markers) this._rebuildMarkers()
    return this.markers
  }

  /**
   * Bind the chart to the world. Map-level events always bind; quest events
   * bind only once a quest service has actually been observed (see
   * `_bindQuestSources`). Idempotent — calling twice does not double-subscribe.
   */
  _bindMapSources() {
    if (this._mapUnsubs) return
    const ev = this.ctx && this.ctx.events
    if (!ev || typeof ev.on !== 'function') {
      this._mapUnsubs = []
      return
    }
    const unsubs = []
    this._onMapSource = (e) => {
      if (e && typeof e.mapId === 'string') this.mapId = e.mapId
      this.schema = this.mapId && MAP_SCHEMAS[this.mapId] ? MAP_SCHEMAS[this.mapId] : this.schema
      this._invalidateMarkers()
    }
    for (let i = 0; i < MAP_SOURCE_EVENTS.length; i++) {
      unsubs.push(ev.on(MAP_SOURCE_EVENTS[i], this._onMapSource))
    }
    this._mapUnsubs = unsubs
    this._markersDirty = true
  }

  /** Quest listeners — attached ONLY in LIVE mode. Idempotent. */
  _bindQuestSources() {
    if (this._questUnsubs) return
    const ev = this.ctx && this.ctx.events
    if (!ev || typeof ev.on !== 'function') {
      this._questUnsubs = []
      return
    }
    const unsubs = []
    this._onQuestSource = () => this._invalidateMarkers()
    for (let i = 0; i < QUEST_SOURCE_EVENTS.length; i++) {
      unsubs.push(ev.on(QUEST_SOURCE_EVENTS[i], this._onQuestSource))
    }
    this._questUnsubs = unsubs
  }

  _unbindQuestSources() {
    const unsubs = this._questUnsubs
    this._questUnsubs = null
    this._onQuestSource = null
    if (!unsubs) return
    for (let i = 0; i < unsubs.length; i++) {
      if (typeof unsubs[i] === 'function') unsubs[i]()
    }
  }

  /** Symmetric teardown. Safe to call from `dispose()` any number of times. */
  _unbindMapSources() {
    this._unbindQuestSources()
    const unsubs = this._mapUnsubs
    this._mapUnsubs = null
    this._onMapSource = null
    if (!unsubs) return
    for (let i = 0; i < unsubs.length; i++) {
      if (typeof unsubs[i] === 'function') unsubs[i]()
    }
  }
