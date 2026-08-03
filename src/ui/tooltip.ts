/**
 * Cursor-following hover tooltip for organelles: struct name, biology type,
 * and a compact stat line. Kept small — full detail lives in the click panel.
 */

import { METAPHOR, OrganellePick, statusLabel } from '../mapping/organelles';
import { esc } from './dom';

export class Tooltip {
  private el = document.getElementById('tooltip')!;

  show(pick: OrganellePick, x: number, y: number): void {
    const s = pick.struct;
    const meta = METAPHOR[pick.kind];
    // cell-biology identity is primary; the Structs name is the subtitle
    const structsName = s ? s.typeName : meta.structs;
    const stats = s
      ? `#${s.id} · HP ${s.health}/${s.healthMax} · ${s.ambit}:${s.slot}`
      : pick.energy !== undefined
        ? `charge reserve · energy ${(pick.energy * 100).toFixed(0)}%`
        : `#${pick.id}`;
    this.el.innerHTML =
      `<div class="t-name">${esc(meta.biology)}</div>` +
      `<div class="t-type">${esc(structsName)}</div>` +
      `<div class="t-stats">${esc(stats)}</div>` +
      `<div class="t-status">${esc(statusLabel(pick))}</div>`;
    this.el.style.display = 'block';
    // follow the cursor, clamped so the tip never leaves the viewport
    const pad = 12;
    const px = Math.min(x + 14, window.innerWidth - this.el.offsetWidth - pad);
    const py = Math.min(y + 16, window.innerHeight - this.el.offsetHeight - pad);
    this.el.style.left = `${px}px`;
    this.el.style.top = `${py}px`;
  }

  hide(): void {
    this.el.style.display = 'none';
  }
}
