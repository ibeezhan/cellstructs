/** Microscope-slide HUD: planet identity, live/mock badge, vitals. */

import type { CellSnapshot } from '../data/types';

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

export class Hud {
  update(snap: CellSnapshot): void {
    $('planet-name').textContent = snap.planet.name;
    $('planet-id').textContent = `planet ${snap.planet.id}` + (snap.player ? ` · ${snap.player.name}` : '');

    const badge = $('badge');
    const live = snap.source === 'desktop';
    badge.textContent = live ? 'LIVE' : 'MOCK';
    badge.className = live ? 'live' : 'mock';

    $('stat-block').textContent = snap.blockHeight.toLocaleString();
    $('stat-charge').textContent = snap.player ? snap.player.charge.toLocaleString() : '—';
    $('stat-ore').textContent = snap.player ? `${snap.player.ore}` : '—';
    $('stat-alpha').textContent = snap.player ? `${(snap.player.alphaU / 1_000_000).toFixed(2)}` : '—';
    $('stat-shield').textContent = `${snap.planet.shield}${snap.planet.raidActive ? ' ⚠ RAID' : ''}`;
    $('stat-structs').textContent = `${snap.structs.length}`;

    const note = $('note');
    note.style.display = snap.note ? 'block' : 'none';
    note.textContent = snap.note ?? '';
  }
}
