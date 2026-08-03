/**
 * Canonical organelle → struct mapping (spec §4).
 * Struct type names come from the chain's struct-type registry; matching is
 * by name pattern so new defensive types map sensibly without a code change.
 */

export type OrganelleKind =
  | 'nucleus' // Command Ship — nucleus / DNA
  | 'mitochondrion' // Reactor / charge — energy production
  | 'membrane-shield' // Shields / Orbital Shield Generators — cell membrane reinforcement
  | 'ribosome-golgi' // Builders — construction / build queue
  | 'extractor-vacuole' // Ore Extractor — intake organelle
  | 'er-refinery' // Ore Refinery — endoplasmic reticulum (ore → alpha/ATP)
  | 'lysosome' // Defensive structs — Tank, PDC, cannon, fighters…
  | 'vesicle'; // Unknown/other struct types

const RULES: Array<{ match: RegExp; kind: OrganelleKind }> = [
  { match: /command\s*ship/i, kind: 'nucleus' },
  { match: /reactor|power\s*plant|generator\s*station/i, kind: 'mitochondrion' },
  { match: /shield|field\s*generator/i, kind: 'membrane-shield' },
  { match: /builder|foundry|fabricator|dock/i, kind: 'ribosome-golgi' },
  { match: /ore\s*extractor|miner/i, kind: 'extractor-vacuole' },
  { match: /refinery/i, kind: 'er-refinery' },
  {
    match:
      /tank|cannon|fighter|battleship|cruiser|destroyer|frigate|bomber|artillery|missile|interceptor|jamming|sam\b|pdc|bunker|marine|stealth/i,
    kind: 'lysosome',
  },
];

export function organelleFor(structTypeName: string): OrganelleKind {
  for (const rule of RULES) {
    if (rule.match.test(structTypeName)) return rule.kind;
  }
  return 'vesicle';
}

/** Full metaphor table (for UI/tooltips), mirroring spec §4. */
export const METAPHOR: Record<OrganelleKind, { biology: string; structs: string }> = {
  nucleus: { biology: 'Nucleus / DNA', structs: 'Command Ship' },
  mitochondrion: { biology: 'Mitochondria', structs: 'Reactor / charge (energy production)' },
  'membrane-shield': { biology: 'Cell membrane', structs: 'Shields / Orbital Shield Generators' },
  'ribosome-golgi': { biology: 'Ribosomes · Golgi', structs: 'Builders (construction queue)' },
  'extractor-vacuole': { biology: 'Ore vacuole / intake organelle', structs: 'Ore Extractor' },
  'er-refinery': { biology: 'Endoplasmic reticulum', structs: 'Ore Refinery (ore → alpha)' },
  lysosome: { biology: 'Lysosomes', structs: 'Defensive structs (Tank, PDC, cannon…)' },
  vesicle: { biology: 'Vesicle', structs: 'Other struct' },
};
