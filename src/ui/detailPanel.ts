/**
 * Click-to-open organelle detail panel: full struct stats + the action set
 * for the struct type (spec §6 layered actions). Buttons route to the
 * dispatch stub in src/actions/dispatch.ts — intent is logged, never faked
 * as success — until the signing surface is wired.
 */

import { dispatchAction, StructAction } from '../actions/dispatch';
import { METAPHOR, OrganelleKind, OrganellePick, statusLabel } from '../mapping/organelles';
import type { CellSnapshot } from '../data/types';
import { esc } from './dom';

interface ActionSpec {
  action: StructAction;
  label: string;
}

/** Type-specific actions; every struct also gets activate/deactivate + defend. */
const KIND_ACTIONS: Partial<Record<OrganelleKind, ActionSpec[]>> = {
  'extractor-vacuole': [{ action: 'mine', label: 'Mine ore' }],
  'er-refinery': [{ action: 'refine', label: 'Refine ore' }],
  'ribosome-golgi': [{ action: 'build', label: 'Build struct' }],
  lysosome: [{ action: 'defend', label: 'Defend' }],
};

export class DetailPanel {
  private panel = document.getElementById('detail')!;
  private pick: OrganellePick | null = null;
  private note = '';

  constructor() {
    document.getElementById('detail-close')!.addEventListener('click', () => this.close());
  }

  show(pick: OrganellePick): void {
    if (this.pick?.id !== pick.id) this.note = '';
    this.pick = pick;
    this.render();
    this.panel.classList.add('open');
  }

  close(): void {
    this.pick = null;
    this.panel.classList.remove('open');
  }

  /** Keep an open panel in sync with each fresh snapshot. */
  refresh(snap: CellSnapshot): void {
    if (!this.pick?.struct || !this.panel.classList.contains('open')) return;
    const s = snap.structs.find((x) => x.id === this.pick!.struct!.id);
    if (s) {
      this.pick.struct = s;
      this.render();
    }
  }

  private render(): void {
    const pick = this.pick;
    if (!pick) return;
    const s = pick.struct;
    const meta = METAPHOR[pick.kind];
    document.getElementById('detail-name')!.textContent = s ? s.typeName : meta.structs;
    document.getElementById('detail-type')!.textContent = `${meta.biology} · ${pick.kind}`;

    const flag = (b: boolean): string => (b ? 'yes' : 'no');
    const rows: Array<[string, string]> = s
      ? [
          ['struct id', s.id],
          ['hp', `${s.health} / ${s.healthMax}`],
          ['ambit · slot', `${s.ambit} · ${s.slot}`],
          ['status', statusLabel(pick)],
          ['online', flag(s.online)],
          ['built', flag(s.built)],
          ['destroyed', flag(s.destroyed)],
          ['mining', flag(s.mining)],
          ['refining', flag(s.refining)],
          ['building', flag(s.building)],
        ]
      : [
          ['id', pick.id],
          ['status', statusLabel(pick)],
          ...(pick.energy !== undefined
            ? [['energy', `${(pick.energy * 100).toFixed(0)}%`] as [string, string]]
            : []),
        ];
    document.getElementById('detail-body')!.innerHTML = rows
      .map(([k, v]) => `<div class="row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`)
      .join('');

    const actionsEl = document.getElementById('detail-actions')!;
    actionsEl.innerHTML = '';
    if (!s) {
      actionsEl.innerHTML = '<span class="none">ambient organelle — no struct to act on</span>';
    } else {
      const actions = [...(KIND_ACTIONS[pick.kind] ?? [])];
      actions.push(
        s.online ? { action: 'deactivate', label: 'Deactivate' } : { action: 'activate', label: 'Activate' },
      );
      if (!actions.some((a) => a.action === 'defend')) actions.push({ action: 'defend', label: 'Defend' });
      for (const a of actions) {
        const btn = document.createElement('button');
        btn.textContent = a.label;
        btn.addEventListener('click', () => {
          this.note = dispatchAction(a.action, s.id).note;
          this.renderNote();
        });
        actionsEl.appendChild(btn);
      }
    }
    this.renderNote();
  }

  private renderNote(): void {
    const el = document.getElementById('detail-note')!;
    el.textContent = this.note;
    el.style.display = this.note ? 'block' : 'none';
  }
}
