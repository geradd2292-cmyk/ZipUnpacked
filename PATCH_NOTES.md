# EFL — Physics bugfix · GPS map · Faction model compiler

## 1. AI roof teleport (`src/ai/agent.js`)

Root cause: `_move()` advanced the actor along its heading *before* `_tryVault()` ran.
When both probes were blocked (a wall) the vault returned false, but the actor was
already inside the footprint. The ground re-probe then asked the world for the highest
surface under that sample — inside a building that is the roof — and wrote it into
`root.position.y`. Non-finite / roof-height bone matrices are what surfaced as the
runtime WebGL program errors.

Fix — three independent gates:

| gate | where | rule |
| --- | --- | --- |
| 1 | `_tryVault(dir)` | runs **before** the step is committed. Low probe at ground + `LOW_PROBE` (0.30 m, never above `STEP_CEILING` 0.45 m). Clearance probe at ground + 1.2 m. Low blocked **and** high blocked ⇒ wall: no vertical write, step rolled back, `desiredSpeed = 0`, lateral redirection requested (`ai:redirect`). |
| 2 | `_tryVault(dir)` | a step is only applied when the **measured** rise ahead is ≤ `STEP_CEILING`. |
| 3 | `_settle()` | ground re-probe is asked for surfaces at or below `y + STEP_CEILING` and rejects any rise above it, so the snap is impossible even without `lineOfSight()`. |

`_sanitize()` guarantees a finite transform every frame and rolls back to the last good pose.

## 2. GPS tactical map (`src/ui/gpsMap.js`)

- `GpsMap(ctx, canvas)` renders layout vectors for `ctx.get('world').mapId` ∈ factory / customs / woods / interchange.
- Marker schema: green extraction zones (`factory:gate3`, …), yellow **active** and red **future** quest pins (`Посылка Прапора`, `Документы в Офисе`, …), grey **done**.
- Player fix (position, heading arrow, view frustum, coordinate readout) is rendered **only** when `item_gps_device` is present in `ctx.get('inventory').special`; otherwise the tablet shows the raw grid chart and a *НЕТ СИГНАЛА* stamp.
- Time comes from `update(dt)` on the engine clock, not `performance.now()`.

## 3. Faction model compiler (`src/ai/parts.js`, `src/ai/textures.js`)

`buildActor({ faction, profile, armorZones, seed })` reads the canonical `faction` archetype:

- **scav** — random civilian layers (quilted jacket / tracksuit / jeans), ushanka / beanie / bare head, **no armour mesh unless a PACA is in `_armorZones`**.
- **raider** — dark combat uniform, combat helmet + visor, knee/elbow pads, heavy modular plate carrier with pouches and radio, gloves.
- **pmc** — USEC multicam / BEAR gorka, ballistic helmet, plate carrier, headset, large pack.
- **boss** — `killa`: 6B13 assault armour + Maska-1Sch with the three white stripes; `shturman`: open camo coat silhouette, ushanka, slung pack.

All textures are painted procedurally into canvases and cached per (faction, profile, seed).

## Repo hygiene

`.gitattributes` enforces CRLF on all text files; `.prettierrc` enforces semicolon-free style.
