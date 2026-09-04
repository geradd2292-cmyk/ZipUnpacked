/* ==========================================================================
 * Escape-From-Larpov · src/main.js  —  ENTRY-POINT WIRING (delta only)
 *
 * Two lines join the existing bridge imports. Order matters: both bridges
 * patch MainMenuSystem.prototype and MUST run before `new MainMenuSystem()`
 * and before the first `mount()`.
 * ========================================================================== */

import { applyMainMenuBridge } from './ui/mainMenuBridge.js'
import { applyLobbyDeployFlags } from './ui/lobbyDeployFlags.js'

applyMainMenuBridge()
applyLobbyDeployFlags()

/* engine.startRaid — the raid controller now receives the lobby flags
 * explicitly. `menu.state` is the bag lobbyDeployFlags resets on mount. */
export async function startRaid(engine, menu, mapId, faction, night) {
  const raid = engine.ctx.get('raid')
  const state = menu && menu.state ? menu.state : { training: false }
  const isTraining = state.training === true || state.offline === true
  try {
    await raid.start(mapId, faction, night, { isTraining, offline: isTraining, insurance: state.insurance !== false })
  } catch (err) {
    console.error('[EFL/main] raid.start() отклонён', err)
    engine.ctx.events.emit('menu:open', { tab: 'lobby', error: String(err && err.message ? err.message : err) })
  }
}

/* ARCHITECTURE.md — add these rows to the cross-subsystem event table in the
 * same commit:
 *
 * | ai:redirect | { actor, id, position, normal, dir, reason }        | ai   |
 * | raid:end    | { kind, summary, training, kitRetained, mapId, faction } | raid |
 * | menu:open   | { tab, summary?, training?, error? }               | raid / main |
 */
