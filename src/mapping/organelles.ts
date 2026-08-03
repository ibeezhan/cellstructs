/**
 * Canonical organelle → struct mapping (spec §4).
 * Struct type names come from the chain's struct-type registry; matching is
 * by name pattern so new defensive types map sensibly without a code change.
 */

import type { StructState } from '../data/types';

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

/** What the pointer picked in the cell — payload for the tooltip/detail UI. */
export interface OrganellePick {
  id: string;
  kind: OrganelleKind;
  struct: StructState | null;
  /** ambient mitochondria only: 0..1 charge-derived energy */
  energy?: number;
}

/** Compact live-status word for a picked organelle (tooltip + detail panel). */
export function statusLabel(pick: OrganellePick): string {
  const s = pick.struct;
  if (!s) return pick.kind === 'mitochondrion' ? 'ambient' : '—';
  if (s.destroyed) return 'destroyed';
  if (s.building) return 'building';
  const active = [s.mining && 'mining', s.refining && 'refining'].filter(Boolean) as string[];
  if (active.length) return active.join(' + ') + (s.online ? '' : ' (offline)');
  return s.online ? 'online' : 'offline';
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
