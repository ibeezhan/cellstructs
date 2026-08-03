/**
 * Bundled mock planet fixture — used when the desktop API is unreachable so
 * the cell always renders. Fictional data, clearly flagged `source: 'mock'`
 * in the snapshot and in the HUD. State evolves over time so every motion
 * state (mine, refine, raid, low charge) can be seen without a live chain.
 */

import type { CellEvent, CellSnapshot, StructState } from './types';
import type { EventsPage } from './desktopSource';

const MOCK_STRUCTS: StructState[] = [
  { id: 'M-1', typeName: 'Command Ship', ambit: 'land', slot: 0, health: 6, healthMax: 6, online: true, built: true, destroyed: false, mining: false, refining: false, building: false },
  { id: 'M-2', typeName: 'Ore Extractor', ambit: 'water', slot: 3, health: 6, healthMax: 6, online: true, built: true, destroyed: false, mining: true, refining: false, building: false },
  { id: 'M-3', typeName: 'Ore Refinery', ambit: 'land', slot: 1, health: 6, healthMax: 6, online: true, built: true, destroyed: false, mining: false, refining: true, building: false },
  { id: 'M-4', typeName: 'Orbital Shield Generator', ambit: 'space', slot: 0, health: 6, healthMax: 6, online: true, built: true, destroyed: false, mining: false, refining: false, building: false },
  { id: 'M-5', typeName: 'Orbital Shield Generator', ambit: 'space', slot: 1, health: 6, healthMax: 6, online: true, built: true, destroyed: false, mining: false, refining: false, building: false },
  { id: 'M-6', typeName: 'Field Generator', ambit: 'land', slot: 2, health: 8, healthMax: 8, online: true, built: true, destroyed: false, mining: false, refining: false, building: false },
  { id: 'M-7', typeName: 'Tank', ambit: 'land', slot: 3, health: 3, healthMax: 3, online: true, built: true, destroyed: false, mining: false, refining: false, building: false },
  { id: 'M-8', typeName: 'Tank', ambit: 'land', slot: 3, health: 3, healthMax: 3, online: true, built: true, destroyed: false, mining: false, refining: false, building: false },
  { id: 'M-9', typeName: 'Planetary Defense Cannon', ambit: 'water', slot: 0, health: 6, healthMax: 6, online: true, built: true, destroyed: false, mining: false, refining: false, building: false },
  { id: 'M-10', typeName: 'Pursuit Fighter', ambit: 'air', slot: 0, health: 3, healthMax: 3, online: true, built: true, destroyed: false, mining: false, refining: false, building: false },
  { id: 'M-11', typeName: 'Pursuit Fighter', ambit: 'air', slot: 1, health: 3, healthMax: 3, online: true, built: true, destroyed: false, mining: false, refining: false, building: false },
  { id: 'M-12', typeName: 'Jamming Satellite', ambit: 'space', slot: 2, health: 6, healthMax: 6, online: true, built: true, destroyed: false, mining: false, refining: false, building: false },
];

/** Raid demo window: 15s of every 90s. */
const raidActiveAt = (tSec: number): boolean => tSec % 90 >= 60 && tSec % 90 < 75;

export class MockSource {
  readonly kind = 'mock' as const;
  private startedAt = Date.now();
  private lastEventAt = 0;

  async fetchSnapshot(): Promise<CellSnapshot> {
    const tSec = (Date.now() - this.startedAt) / 1000;
    // Charge cycles 0 → 900 blocks over ~3 min so pale → vivid is visible.
    const charge = Math.floor((tSec * 5) % 900);
    return {
      source: 'mock',
      fetchedAt: Date.now(),
      blockHeight: 1_000_000 + Math.floor(tSec / 6),
      planet: {
        id: '2-0000',
        name: 'Petri-1 (mock)',
        shield: 120,
        raidActive: raidActiveAt(tSec),
        maxOre: 5,
        slots: { land: 4, water: 4, air: 4, space: 4 },
      },
      player: {
        id: '1-0000',
        name: 'mock-observer',
        ore: 2,
        alphaU: 1_500_000,
        charge,
        capacity: 9_000_000,
        load: 5_000_000,
      },
      structs: MOCK_STRUCTS,
      note: 'Desktop API unreachable — showing bundled mock fixture.',
    };
  }

  /** Synthetic events on a fixed rhythm so all animation triggers fire. */
  async pollEvents(_since: number): Promise<EventsPage> {
    const now = Date.now();
    const tSec = (now - this.startedAt) / 1000;
    const events: CellEvent[] = [];
    if (now - this.lastEventAt > 8000) {
      this.lastEventAt = now;
      events.push(
        { ts: now, category: 'mined', subject: 'mock.inventory.ore', data: { action: 'mined', amount: 1 } },
        { ts: now, category: 'refined', subject: 'mock.inventory.ualpha', data: { action: 'refined', amount: 1 } },
      );
      if (raidActiveAt(tSec)) {
        events.push({ ts: now, category: 'raid_status', subject: 'mock.planet.2-0000', data: { status: 'raid_armed' } });
      }
    }
    return { events, cursor: now };
  }
}
