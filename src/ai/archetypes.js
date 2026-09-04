/**
 * AI - frozen archetype records.
 *
 * Everything that used to be inferred from a mesh variant string lives here.
 * `faction` is the canonical key: 'scav' | 'raider' | 'pmc' | 'boss'.
 * Bosses carry a `profile` so the model compiler can pick a signature look.
 */

export const FACTIONS = Object.freeze(['scav', 'raider', 'pmc', 'boss'])

export const ARCHETYPES = Object.freeze({
  scav: Object.freeze({
    faction: 'scav',
    label: 'Scav',
    speed: 3.1,
    sprint: 4.6,
    reaction: 0.55,
    armorChance: 0.22,
    armorClass: 2,
    voice: 'scav_ru',
    profiles: Object.freeze(['civ', 'track', 'jeans']),
  }),
  raider: Object.freeze({
    faction: 'raider',
    label: 'Raider',
    speed: 3.4,
    sprint: 5.2,
    reaction: 0.28,
    armorChance: 1,
    armorClass: 5,
    voice: 'raider_ru',
    profiles: Object.freeze(['black', 'olive']),
  }),
  pmc: Object.freeze({
    faction: 'pmc',
    label: 'PMC',
    speed: 3.5,
    sprint: 5.4,
    reaction: 0.3,
    armorChance: 0.85,
    armorClass: 4,
    voice: 'pmc',
    profiles: Object.freeze(['usec', 'bear']),
  }),
  boss: Object.freeze({
    faction: 'boss',
    label: 'Boss',
    speed: 3.3,
    sprint: 5.0,
    reaction: 0.2,
    armorChance: 1,
    armorClass: 6,
    voice: 'boss',
    profiles: Object.freeze(['killa', 'shturman']),
  }),
})

export function resolveArchetype(faction) {
  return ARCHETYPES[faction] || ARCHETYPES.scav
}

export function rollProfile(faction, rng = Math.random) {
  const a = resolveArchetype(faction)
  const list = a.profiles
  return list[Math.floor(rng() * list.length) % list.length]
}

/**
 * Armour zones. A scav only gets plated zones on the PACA roll; everyone else
 * is issued a carrier. The model compiler reads this to decide whether armour
 * geometry is visible at all.
 */
export function rollArmorZones(faction, rng = Math.random) {
  const a = resolveArchetype(faction)
  if (rng() > a.armorChance) return []
  if (faction === 'scav') return ['thorax']
  if (faction === 'pmc') return ['thorax', 'stomach']
  return ['thorax', 'stomach', 'head']
}
