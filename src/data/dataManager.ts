/**
 * Orchestrates the data sources (spec §1 state store): desktop app first,
 * bundled mock fixture as fallback, CosmJS RPC probe as a secondary signal.
 * Emits normalized snapshots + live events to the render layer.
 */

import type { AppConfig } from '../config/endpoints';
import { DesktopSource } from './desktopSource';
import { MockSource } from './mockSource';
import { RpcProbe } from './cosmosSource';
import type { CellEvent, CellSnapshot } from './types';

const SNAPSHOT_INTERVAL_MS = 10_000;
const EVENTS_INTERVAL_MS = 4_000;

export interface DataListener {
  onSnapshot(snapshot: CellSnapshot): void;
  onEvents(events: CellEvent[]): void;
}

export class DataManager {
  private desktop: DesktopSource;
  private mock = new MockSource();
  private rpc: RpcProbe;
  private listener: DataListener;

  private active: 'desktop' | 'mock' = 'desktop';
  private eventCursor = 0;
  private timers: number[] = [];
  private busySnapshot = false;
  private busyEvents = false;
  private desktopWarned = false;

  constructor(cfg: AppConfig, listener: DataListener) {
    this.desktop = new DesktopSource(cfg);
    this.rpc = new RpcProbe(cfg.rpcUrl);
    this.listener = listener;
  }

  start(): void {
    void this.refreshSnapshot();
    this.timers.push(
      window.setInterval(() => void this.refreshSnapshot(), SNAPSHOT_INTERVAL_MS),
      window.setInterval(() => void this.refreshEvents(), EVENTS_INTERVAL_MS),
    );
  }

  stop(): void {
    this.timers.forEach((t) => window.clearInterval(t));
    this.timers = [];
  }

  /**
   * Route a struct action to the desktop app's signing surface. Refused (with
   * the honest reason) while running on the mock fixture — there is nothing
   * real to sign against.
   */
  async submitAction(action: string, args: Record<string, unknown>): Promise<string> {
    if (this.active !== 'desktop') {
      throw new Error('desktop app (:8420) unreachable — actions need its signing surface; showing mock data only');
    }
    return this.desktop.submitAction(action, args);
  }

  /** Menu SCAN: immediate snapshot + event re-read, outside the poll cadence. */
  async refreshNow(): Promise<void> {
    await this.refreshSnapshot();
    await this.refreshEvents();
  }

  private async refreshSnapshot(): Promise<void> {
    if (this.busySnapshot) return;
    this.busySnapshot = true;
    try {
      const snapshot = await this.desktop.fetchSnapshot();
      if (this.active !== 'desktop') {
        this.eventCursor = 0; // fresh cursor when switching feeds
        console.info('cellstructs: desktop API back — switching to live data');
      }
      this.active = 'desktop';
      this.desktopWarned = false;
      this.listener.onSnapshot(snapshot);
    } catch (e) {
      if (!this.desktopWarned) {
        this.desktopWarned = true;
        console.warn('cellstructs: desktop API unreachable, falling back to mock fixture', e);
      }
      if (this.active !== 'mock') this.eventCursor = 0;
      this.active = 'mock';
      const snapshot = await this.mock.fetchSnapshot();
      // Secondary path: if the chain RPC answers, surface its real height.
      const height = await this.rpc.getHeight();
      if (height !== null) {
        snapshot.blockHeight = height;
        snapshot.note = 'Desktop API unreachable — mock entities, live RPC block height.';
      }
      this.listener.onSnapshot(snapshot);
    } finally {
      this.busySnapshot = false;
    }
  }

  private async refreshEvents(): Promise<void> {
    if (this.busyEvents) return;
    this.busyEvents = true;
    try {
      const source = this.active === 'desktop' ? this.desktop : this.mock;
      const page = await source.pollEvents(this.eventCursor);
      const isFirstPage = this.eventCursor === 0;
      this.eventCursor = page.cursor;
      // Skip the backlog on the first page — only animate fresh activity.
      if (!isFirstPage && page.events.length > 0) this.listener.onEvents(page.events);
    } catch (e) {
      console.warn('cellstructs: event poll failed', e);
    } finally {
      this.busyEvents = false;
    }
  }
}
