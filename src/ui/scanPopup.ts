/**
 * UNIVERSE SCAN popup: search the live planet/player/guild registries with
 * facet filters modeled on the structs-webapp search (ore, shield, defenses,
 * owner activity). Read-only — clicking a result portals to that cell via
 * the VIEW CELL loader.
 */

import type { ScanFilters, ScanResult, ScanRow } from '../data/desktopSource';
import { esc } from './dom';

export class ScanPopup {
  private modal = document.getElementById('scan-modal')!;
  private q = document.getElementById('scan-q') as HTMLInputElement;
  private kind = document.getElementById('scan-kind') as HTMLSelectElement;
  private ore = document.getElementById('scan-ore') as HTMLInputElement;
  private shield = document.getElementById('scan-shield') as HTMLInputElement;
  private def = document.getElementById('scan-def') as HTMLInputElement;
  private active = document.getElementById('scan-active') as HTMLSelectElement;
  private status = document.getElementById('scan-status')!;
  private results = document.getElementById('scan-results')!;
  private busy = false;

  constructor(
    private onScan: (query: string, filters: ScanFilters) => Promise<ScanResult>,
    private onPortal: (planetId: string) => void,
  ) {
    document.getElementById('scan-close')!.addEventListener('click', () => this.close());
    document.getElementById('scan-go')!.addEventListener('click', () => void this.run());
    this.q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.run();
      if (e.key === 'Escape') this.close();
    });
  }

  open(): void {
    this.modal.classList.add('open');
    this.q.focus();
    this.q.select();
  }

  close(): void {
    this.modal.classList.remove('open');
  }

  toggle(): void {
    if (this.modal.classList.contains('open')) this.close();
    else this.open();
  }

  private filters(): ScanFilters {
    return {
      kind: this.kind.value as ScanFilters['kind'],
      minOre: Number(this.ore.value) || 0,
      minShield: Number(this.shield.value) || 0,
      minDefenses: Number(this.def.value) || 0,
      maxBlocksSinceAction: Number(this.active.value) || 0,
    };
  }

  private async run(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.setStatus('scanning the registries…', 'busy');
    this.results.innerHTML = '';
    try {
      const res = await this.onScan(this.q.value, this.filters());
      this.renderRows(res.rows);
      this.setStatus(
        res.rows.length === 0 ? `no cells passed the filters — ${res.note}` : res.note,
        res.rows.length === 0 ? 'err' : '',
      );
    } catch (e) {
      this.setStatus(e instanceof Error ? e.message : String(e), 'err');
    } finally {
      this.busy = false;
    }
  }

  private setStatus(text: string, cls: '' | 'err' | 'busy' = ''): void {
    this.status.textContent = text;
    this.status.className = cls;
  }

  private renderRows(rows: ScanRow[]): void {
    this.results.innerHTML = '';
    if (rows.length === 0) return;
    const head = document.createElement('div');
    head.className = 'scan-head';
    head.innerHTML =
      '<span>CELL</span><span>OWNER</span><span>ORE</span><span>SHIELD</span><span>DEF</span><span>STRUCTS</span><span>LAST ACTION</span>';
    this.results.appendChild(head);
    for (const r of rows) {
      const el = document.createElement('div');
      el.className = 'scan-item';
      el.title = `portal to ${r.planetId}`;
      const activity =
        r.blocksSinceAction === null ? '—' : `${r.blocksSinceAction.toLocaleString()} blk ago`;
      el.innerHTML =
        `<span class="s-name"><span class="s-kind">${esc(r.kind)}</span>${esc(r.name)} ` +
        `<span class="s-id">${esc(r.planetId)}</span>${r.raidActive ? ' <span class="s-raid">⚠ RAID</span>' : ''}</span>` +
        `<span>${esc(r.ownerName)}${r.guildId ? ` <span class="s-id">${esc(r.guildId)}</span>` : ''}</span>` +
        `<span>${r.ore.toLocaleString()}</span>` +
        `<span>${r.shield.toLocaleString()}</span>` +
        `<span>${r.defenses}</span>` +
        `<span>${r.structs}</span>` +
        `<span>${esc(activity)}</span>`;
      el.addEventListener('click', () => {
        this.close();
        this.onPortal(r.planetId);
      });
      this.results.appendChild(el);
    }
  }
}
