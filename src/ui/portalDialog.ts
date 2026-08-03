/**
 * VIEW CELL portal dialog: type a cell id (2-3034 / 1-471) or a player or
 * planet name and the view portals to that planet's living cell. The last
 * five visited cells persist in localStorage as quick-pick chips.
 */

import { esc } from './dom';

export interface PortalResult {
  planetId: string;
  label: string;
}

interface Visit {
  planetId: string;
  label: string;
  at: number;
}

const HISTORY_KEY = 'cellstructs.visited.v1';
const HISTORY_MAX = 5;

export class PortalDialog {
  private modal = document.getElementById('portal')!;
  private input = document.getElementById('portal-input') as HTMLInputElement;
  private status = document.getElementById('portal-status')!;
  private recent = document.getElementById('portal-recent')!;
  private busy = false;

  constructor(
    private onPortal: (query: string) => Promise<PortalResult>,
    onHome: () => Promise<void>,
    private onRecenter: () => void,
  ) {
    document.getElementById('portal-close')!.addEventListener('click', () => this.close());
    document.getElementById('portal-go')!.addEventListener('click', () => void this.go(this.input.value));
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.go(this.input.value);
      if (e.key === 'Escape') this.close();
    });
    document.getElementById('portal-home')!.addEventListener('click', () => {
      this.setStatus('returning home…', 'busy');
      void onHome().then(
        () => {
          this.setStatus('');
          this.close();
          onRecenter();
        },
        (e: unknown) => this.setStatus(e instanceof Error ? e.message : String(e), 'err'),
      );
    });
    document.getElementById('portal-recenter')!.addEventListener('click', () => {
      onRecenter();
      this.close();
    });
  }

  open(): void {
    this.renderChips();
    this.setStatus('');
    this.modal.classList.add('open');
    this.input.focus();
    this.input.select();
  }

  close(): void {
    this.modal.classList.remove('open');
  }

  toggle(): void {
    if (this.modal.classList.contains('open')) this.close();
    else this.open();
  }

  /** Portal to a cell query — also the entry point for SCAN result clicks. */
  async go(query: string): Promise<void> {
    const q = query.trim();
    if (!q || this.busy) return;
    this.busy = true;
    this.setStatus(`searching for '${q}'…`, 'busy');
    try {
      const hit = await this.onPortal(q);
      this.remember(hit);
      this.setStatus('');
      this.close();
      this.onRecenter();
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

  // -- visit history --------------------------------------------------------

  private history(): Visit[] {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) return (JSON.parse(raw) as Visit[]).filter((v) => v.planetId);
    } catch {
      /* corrupted history — start fresh */
    }
    return [];
  }

  private remember(hit: PortalResult): void {
    const rest = this.history().filter((v) => v.planetId !== hit.planetId);
    const next = [{ ...hit, at: Date.now() }, ...rest].slice(0, HISTORY_MAX);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  }

  private renderChips(): void {
    const visits = this.history();
    if (visits.length === 0) {
      this.recent.innerHTML = '';
      return;
    }
    this.recent.innerHTML = '<span class="chips-label">RECENT CELLS</span>';
    for (const v of visits) {
      const chip = document.createElement('button');
      chip.innerHTML =
        v.label && v.label !== v.planetId
          ? `${esc(v.label)} <span style="opacity:.55">${esc(v.planetId)}</span>`
          : esc(v.planetId);
      chip.addEventListener('click', () => void this.go(v.planetId));
      this.recent.appendChild(chip);
    }
  }
}
