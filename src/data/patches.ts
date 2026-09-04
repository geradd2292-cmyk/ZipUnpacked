import gpsMapSrc from "../../patches/src/ui/gpsMap.markers.js?raw";
import aiSrc from "../../patches/src/ai/index.locomotion.js?raw";
import raidSrc from "../../patches/src/raid/index.lifecycle.js?raw";
import lobbySrc from "../../patches/src/ui/lobbyDeployFlags.js?raw";
import mainSrc from "../../patches/src/main.wiring.js?raw";
import gitattributesSrc from "../../patches/.gitattributes?raw";

export type PatchMode = "block-rewrite" | "new-module" | "delta" | "config";

export type Patch = {
  id: string;
  requirement: string;
  title: string;
  target: string;
  downloadName: string;
  mode: PatchMode;
  summary: string;
  rootCause?: string;
  guarantees: string[];
  injection: string[];
  source: string;
  events?: string[];
  severity: "fatal" | "high" | "medium";
};

export const PATCHES: Patch[] = [
  {
    id: "gps",
    requirement: "REQ 1",
    title: "Defensive null-registry gating",
    target: "src/ui/gpsMap.js",
    downloadName: "gpsMap.markers.js",
    mode: "block-rewrite",
    severity: "fatal",
    summary:
      "Marker reconstruction and map-source binding rewritten around a single non-throwing quest resolver. Absent service → STATIC extraction-only chart, clean exit.",
    rootCause:
      "_rebuildMarkers() used ctx.get('quests'). Registry.get() throws for an unregistered id (registry.js:32). The throw escaped Engine.step() on the first raid:start rebuild and killed frame 1 — before HealthSystem, hit registration, bot weapon sync and the gated locomotion tick ever ran.",
    guarantees: [
      "Quest access only via ctx.has() / ctx.peek(); guarded get() exists solely for a foreign ctx",
      "STATIC mode: extraction pins from the authored MAP_SCHEMAS (+ live raid.exits merged by id) — no quest math",
      "LIVE mode: a misbehaving quest service degrades that rebuild to STATIC instead of throwing",
      "Quest event listeners are bound only after a service is observed; symmetric unbind on dispose",
      "Marker array reused, rebuild only on _markersDirty — zero per-frame allocation",
    ],
    injection: [
      "Place QUEST_SERVICE_ID, MAP_SOURCE_EVENTS, QUEST_SOURCE_EVENTS, QUEST_PIN_READERS, MARKER_STATUS, finite(), coerceMarker() at module scope above export class GpsMap",
      "Replace _rebuildMarkers(), setObjectives() and every map-binding method in the class body with the members provided",
      "Call _bindMapSources() from mount(), _unbindMapSources() from dispose(), _ensureMarkers() at the top of the pin pass in draw()",
    ],
    source: gpsMapSrc,
    events: ["raid:start", "raid:end", "map:changed", "quest:* (LIVE only)"],
  },
  {
    id: "ai",
    requirement: "REQ 2",
    title: "Live movement path & engine timers",
    target: "src/ai/index.js",
    downloadName: "index.locomotion.js",
    mode: "block-rewrite",
    severity: "high",
    summary:
      "Every agent positional mutate now routes through _advanceBot() (3 horizontal gates) then _settleBot() (vertical matrix). Gate failure = hard rollback, speed freeze, one lateral ai:redirect.",
    rootCause:
      "With the gated tick dead, the un-gated legacy path integrated bot.root.position straight from the path direction and ground-snapped to whatever surface the down-ray found — including roofs above the intended floor.",
    guarantees: [
      "GATE 1 — swept wall probe at knee + chest; tangential slide attempted once, else rollback",
      "GATE 2 — step height ≤ 0.42 m and full standing headroom at the candidate column",
      "GATE 3 — navmesh membership + void guard (skipped only when no navmesh is registered)",
      "_settleBot — gravity, ground snap, per-tick vertical clamp (roof-warp signature refused), post-snap headroom, NaN fence",
      "fixedUpdate(h) preferred (PHYSICS_HZ); update(dt) runs the same matrix with clamped sub-steps only if the core never calls fixedUpdate",
      "ai:redirect emitted at most once per 0.30 s per bot; repath after 6 consecutive blocks",
      "All probe vectors preallocated in _locoInit(); per-bot state allocated once in _ensureLocomotion()",
    ],
    injection: [
      "Add the LOCO_* constants at module scope below STRAFE_MAX_T",
      "Call this._locoInit() at the end of init(ctx)",
      "Replace update(); add fixedUpdate() and all other members to the AiSystem class body",
      "Call this._ensureLocomotion(bot) once when a bot leaves the pool in spawnWave()",
      "Behaviours write only bot.moveDir + bot.wantSpeed — delete every remaining direct write to bot.root.position",
      "Add the ai:redirect row to ARCHITECTURE.md in the same commit",
    ],
    source: aiSrc,
    events: ["ai:redirect"],
  },
  {
    id: "lobby",
    requirement: "REQ 3.1",
    title: "Lobby UI state fix — training defaults to false",
    target: "src/ui/lobbyDeployFlags.js",
    downloadName: "lobbyDeployFlags.js",
    mode: "new-module",
    severity: "medium",
    summary:
      "Prototype bridge (same pattern as mainMenuBridge.js). selectLobbyState() forces training/offline to false on every mount(), syncs the checkbox to UNCHECKED, and wraps every deploy path to pass explicit { isTraining } options to the raid controller.",
    guarantees: [
      "Pure selector exported: selectLobbyState(prev) never mutates prev and resets only the deploy flags",
      "Checkbox found across both markup generations via TRAINING_TOGGLE_SELECTOR; player can still tick it after mount",
      "startRaid / deploy / launchRaid / onDeploy wrapped: options appended, never substituted — legacy 3-arg call sites keep working",
      "Namespaced imports: a missing export can never become an ESM link error that breaks boot",
    ],
    injection: [
      "Create src/ui/lobbyDeployFlags.js with the full module",
      "In src/main.js call applyLobbyDeployFlags() right after applyMainMenuBridge(), before new MainMenuSystem()",
    ],
    source: lobbySrc,
  },
  {
    id: "raid",
    requirement: "REQ 3.2",
    title: "Offline death protection",
    target: "src/raid/index.js",
    downloadName: "index.lifecycle.js",
    mode: "block-rewrite",
    severity: "high",
    summary:
      "start() normalises lobby options into raidOptions. end(kind) is a three-branch settlement; the training-death branch is a hard bypass — no serialisation, no death payload, no wipe — and routes the player to the stash with the kit intact.",
    guarantees: [
      "isTraining() is the single source of truth; only a literal true enables protection",
      "Training branch never calls _serializeBody(), applyDeath or any body-path clear",
      "end() is idempotent — a death racing a timeout cannot double-settle",
      "Live death path unchanged in spirit: serialise → applyDeath payload → wipe (secure kept) → scav cooldown",
      "raid:end carries { kind, summary, training, kitRetained } so UI routing needs no rule re-derivation",
      "Scav cooldown is not enforced for training raids",
    ],
    injection: [
      "Place RAID_END, DEFAULT_RAID_OPTIONS, normalizeRaidOptions(), endKind() at module scope above export class RaidSystem",
      "Replace start(), extract(), end() and any inventory-settlement helpers with the provided members; keep the existing _onDeath → this.end('killed') listener",
      "Update engine.startRaid to pass { isTraining } as the 4th argument (see main.js delta)",
    ],
    source: raidSrc,
    events: ["raid:start (+training, options)", "raid:end (+training, kitRetained)", "menu:open"],
  },
  {
    id: "main",
    requirement: "WIRING",
    title: "Entry-point delta",
    target: "src/main.js",
    downloadName: "main.wiring.js",
    mode: "delta",
    severity: "medium",
    summary:
      "Two bridge calls before the menu is constructed, and the engine.startRaid call site forwarding the lobby flags. Includes the ARCHITECTURE.md event rows.",
    guarantees: [
      "Bridges run before new MainMenuSystem() and before the first mount()",
      "raid.start() receives an explicit options object on every launch",
    ],
    injection: ["Merge into src/main.js", "Append the three event rows to ARCHITECTURE.md"],
    source: mainSrc,
  },
  {
    id: "gitattributes",
    requirement: "STYLE",
    title: "CRLF enforcement",
    target: ".gitattributes",
    downloadName: ".gitattributes",
    mode: "config",
    severity: "medium",
    summary: "Repository-level guarantee that every injected source file is normalised to CRLF regardless of the agent's platform.",
    guarantees: ["*.js / *.mjs / *.d.ts / *.md checked out and committed as CRLF"],
    injection: ["Drop at repository root or merge into the existing .gitattributes"],
    source: gitattributesSrc,
  },
];
