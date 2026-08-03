/**
 * Click-to-open organelle detail panel: full struct stats + the action set
 * for the struct type (spec §6 layered actions). Buttons submit through the
 * real ActionPipeline (desktop app :8420 signs + broadcasts); the status
 * area tracks submitting → submitted → confirmed/failed with the tx hash
 * from the tx_settled receipt. Errors show the server's real message.
 */

import { ActionExtras, ActionPipeline, ActionState, StructAction } from '../actions/dispatch';
import { METAPHOR, OrganelleKind, OrganellePick, statusLabel } from '../mapping/organelles';
import type { CellSnapshot, StructState } from '../data/types';
import { esc } from './dom';

interface ActionSpec {
  action: StructAction;
  label: string;
  /** needs an inline form for extra args before submitting */
  form?: 'attack' | 'defend' | 'build';
}

/** Type-specific actions; every struct also gets activate/deactivate + defend. */
const KIND_ACTIONS: Partial<Record<OrganelleKind, ActionSpec[]>> = {
  'extractor-vacuole': [{ action: 'mine', label: 'Mine ore' }],
  'er-refinery': [{ action: 'refine', label: 'Refine ore' }],
  'ribosome-golgi': [{ action: 'build', label: 'Build struct', form: 'build' }],
  lysosome: [
    { action: 'attack', label: 'Attack', form: 'attack' },
    { action: 'defend', label: 'Defend', form: 'defend' },
  ],
};

const PHASE_CLASS: Record<ActionState['phase'], string> = {
  submitting: 'pending',
  submitted: 'pending',
  confirmed: 'ok',
  failed: 'err',
};

export class DetailPanel {
  private panel = document.getElementById('detail')!;
  private pick: OrganellePick | null = null;
  private snapshot: CellSnapshot | null = null;
  /** open inline form, if any */
  private form: ActionSpec | null = null;
  /** actions the :8420 surface exposes; null = not discovered (assume all) */
  private supported: Set<string> | null = null;

  constructor(private pipeline: ActionPipeline) {
    document.getElementById('detail-close')!.addEventListener('click', () => this.close());
    pipeline.onUpdate = (st) => {
      if (this.pick?.struct?.id === st.structId) this.render();
    };
  }

  /** Live-discovered `structs_action` enum; unlisted actions render disabled. */
  setSupportedActions(actions: Set<string> | null): void {
    this.supported = actions;
    if (this.pick) this.render();
  }

  show(pick: OrganellePick): void {
    if (this.pick?.id !== pick.id) this.form = null;
    this.pick = pick;
    this.render();
    this.panel.classList.add('open');
  }

  close(): void {
    this.pick = null;
    this.form = null;
    this.panel.classList.remove('open');
  }

  /** Keep an open panel in sync with each fresh snapshot. */
  refresh(snap: CellSnapshot): void {
    this.snapshot = snap;
    if (!this.pick?.struct || !this.panel.classList.contains('open')) return;
    const s = snap.structs.find((x) => x.id === this.pick!.struct!.id);
    if (s) {
      this.pick.struct = s;
      this.render();
    }
  }

  private commandShipId(): string {
    return this.snapshot?.structs.find((s) => /command\s*ship/i.test(s.typeName))?.id ?? '';
  }

  private render(): void {
    const pick = this.pick;
    if (!pick) return;
    const s = pick.struct;
    const meta = METAPHOR[pick.kind];
    // cell-biology identity is primary; the Structs name is the subtitle
    document.getElementById('detail-name')!.textContent = meta.biology;
    document.getElementById('detail-type')!.textContent = `${s ? s.typeName : meta.structs} · ${pick.kind}`;

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

    this.renderActions(s);
    this.renderStatus(s);
  }

  private renderActions(s: StructState | null): void {
    const actionsEl = document.getElementById('detail-actions')!;
    actionsEl.innerHTML = '';
    if (!s) {
      actionsEl.innerHTML = '<span class="none">ambient organelle — no struct to act on</span>';
      return;
    }
    if (this.form) {
      this.renderForm(actionsEl, s, this.form);
      return;
    }
    const busy = this.pipeline.isBusy(s.id);
    const actions = [...(KIND_ACTIONS[this.pick!.kind] ?? [])];
    actions.push(
      s.online ? { action: 'deactivate', label: 'Deactivate' } : { action: 'activate', label: 'Activate' },
    );
    if (!actions.some((a) => a.action === 'defend')) {
      actions.push({ action: 'defend', label: 'Defend', form: 'defend' });
    }
    const unsupported: string[] = [];
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.textContent = a.label;
      const known = this.supported === null || this.supported.has(a.action);
      if (!known) unsupported.push(a.action);
      btn.disabled = busy || !known;
      if (!known) btn.title = `'${a.action}' is not exposed by the desktop app's :8420 action surface`;
      btn.addEventListener('click', () => {
        if (a.form) {
          this.form = a;
          this.render();
        } else {
          void this.pipeline.submit(a.action, s.id);
        }
      });
      actionsEl.appendChild(btn);
    }
    if (unsupported.length > 0) {
      const note = document.createElement('span');
      note.className = 'none';
      note.textContent = `${unsupported.join(', ')}: not exposed over :8420 — disabled`;
      actionsEl.appendChild(note);
    }
  }

  /** Inline form for actions that need extra args (attack/defend/build). */
  private renderForm(host: HTMLElement, s: StructState, spec: ActionSpec): void {
    const wrap = document.createElement('div');
    wrap.className = 'action-form';
    const fields: Array<{ key: keyof ActionExtras; label: string; el: HTMLInputElement | HTMLSelectElement }> = [];

    const addInput = (key: keyof ActionExtras, label: string, value = '', placeholder = ''): void => {
      const lab = document.createElement('label');
      lab.textContent = label;
      const inp = document.createElement('input');
      inp.value = value;
      inp.placeholder = placeholder;
      inp.spellcheck = false;
      wrap.append(lab, inp);
      fields.push({ key, label, el: inp });
    };

    if (spec.form === 'attack') {
      addInput('targetId', 'target struct id', '', 'e.g. 5-2217');
      addInput('weapon', 'weapon (optional)', '', 'blank = default');
    } else if (spec.form === 'defend') {
      addInput('protectedId', 'protect struct id', this.commandShipId(), 'e.g. your Command Ship');
    } else {
      addInput('structType', 'struct type', '', 'e.g. Tank');
      const lab = document.createElement('label');
      lab.textContent = 'ambit';
      const sel = document.createElement('select');
      for (const a of ['land', 'water', 'air', 'space']) {
        const opt = document.createElement('option');
        opt.value = a;
        opt.textContent = a;
        if (a === s.ambit) opt.selected = true;
        sel.appendChild(opt);
      }
      wrap.append(lab, sel);
      fields.push({ key: 'ambit', label: 'ambit', el: sel });
      addInput('slot', 'slot', '0');
    }

    const buttons = document.createElement('div');
    buttons.className = 'form-buttons';
    const go = document.createElement('button');
    go.textContent = `Submit ${spec.action}`;
    go.className = 'primary';
    go.addEventListener('click', () => {
      const extras: ActionExtras = {};
      for (const f of fields) {
        const v = f.el.value.trim();
        if (f.key === 'slot') extras.slot = Number(v) || 0;
        else if (v) extras[f.key] = v as never;
      }
      this.form = null;
      void this.pipeline.submit(spec.action, s.id, extras);
      this.render();
    });
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      this.form = null;
      this.render();
    });
    buttons.append(go, cancel);
    wrap.appendChild(buttons);
    host.appendChild(wrap);
  }

  /** Action status area: phase badge + honest server text + tx hash. */
  private renderStatus(s: StructState | null): void {
    const el = document.getElementById('detail-note')!;
    const st = s ? this.pipeline.latest(s.id) : null;
    if (!st) {
      el.style.display = 'none';
      el.innerHTML = '';
      el.className = '';
      return;
    }
    el.className = PHASE_CLASS[st.phase];
    const badge =
      st.phase === 'submitting'
        ? '⏳ submitting'
        : st.phase === 'submitted'
          ? '📡 submitted — awaiting receipt'
          : st.phase === 'confirmed'
            ? '✓ confirmed on-chain'
            : '✕ failed';
    el.innerHTML =
      `<div class="st-badge">${esc(`${badge} · ${st.action}`)}</div>` +
      `<div class="st-text">${esc(st.summary)}</div>` +
      (st.txHash ? `<div class="st-tx" title="${esc(st.txHash)}">tx ${esc(st.txHash)}</div>` : '');
    el.style.display = 'block';
  }
}
