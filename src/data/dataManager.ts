/**
 * Orchestrates the data sources (spec §1 state store): the primary chain
 * source first — the desktop app locally, the public LCD in a hosted build —
 * with the bundled mock fixture as fallback and a CosmJS RPC probe as a
 * secondary signal. Emits normalized snapshots + live events to the render
 * layer.
 */

import { READ_ONLY, type AppConfig } from '../config/endpoints';
import { DesktopSource } from './desktopSource';
import { LcdSource } from './lcdSource';
import { MockSource } from './mockSource';
import { RpcProbe } from './cosmosSource';
import type { ScanFilters, ScanResult, StructsSource } from './source';
import type { CellEvent, CellSnapshot } from './types';

const SNAPSHOT_INTERVAL_MS = 10_000;
const EVENTS_INTERVAL_MS = 4_000;

export interface DataListener {
  onSnapshot(snapshot: CellSnapshot): void;
  onEvents(events: CellEvent[]): void;
}

/** Why the primary source is needed, phrased for the mode we're running in. */
const PRIMARY_DOWN = READ_ONLY
  ? 'public Structs node unreachable through the read-only proxy'
  : 'desktop app (:8420) unreachable';

export class DataManager {
  private primary: StructsSource;
  private desktop: DesktopSource | null;
  private mock = new MockSource();
  private rpc: RpcProbe;
  private listener: DataListener;

  private active: 'primary' | 'mock' = 'primary';
  private eventCursor = 0;
  private timers: number[] = [];
  private busySnapshot = false;
  private busyEvents = false;
  private primaryWarned = false;
  private supportedActions: Promise<Set<string> | null> | null = null;
  /** planet id being viewed through the portal; null = own planet */
  private viewTarget: string | null = null;

  constructor(cfg: AppConfig, listener: DataListener) {
    // A hosted build has no signing surface at all — it reads the chain
    // directly over REST and never constructs the desktop transport.
    this.desktop = READ_ONLY ? null : new DesktopSource(cfg);
    this.primary = this.desktop ?? new LcdSource(cfg);
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
   * the honest reason) in a hosted read-only build, and while running on the
   * mock fixture — there is nothing real to sign against.
   */
  async submitAction(action: string, args: Record<string, unknown>): Promise<string> {
    if (!this.desktop) {
      throw new Error('hosted read-only build — actions need the Structs desktop app; run cellstructs locally to act');
    }
    if (this.active !== 'primary') {
      throw new Error(`${PRIMARY_DOWN} — actions need its signing surface; showing mock data only`);
    }
    return this.desktop.submitAction(action, args);
  }

  /**
   * Which actions the desktop app's `structs_action` tool exposes (from its
   * live schema). Resolves to null when :8420 is unreachable — "unknown", so
   * the UI keeps buttons enabled and submits report the honest error instead.
   * A hosted build has no action surface at all, so it resolves to an empty set.
   */
  async getSupportedActions(): Promise<Set<string> | null> {
    if (!this.desktop) return new Set();
    if (!this.supportedActions) {
      this.supportedActions = this.desktop.fetchSupportedActions().catch((e) => {
        console.warn('cellstructs: could not read structs_action schema', e);
        this.supportedActions = null; // retry on next call
        return null;
      });
    }
    return this.supportedActions;
  }

  /** Menu SCAN: immediate snapshot + event re-read, outside the poll cadence. */
  async refreshNow(): Promise<void> {
    await this.refreshSnapshot();
    await this.refreshEvents();
  }

  isRemoteView(): boolean {
    return this.viewTarget !== null;
  }

  /**
   * VIEW CELL portal: resolve a cell id/name to a planet and switch the
   * snapshot loop to it. Resolution errors (unknown id/name, mock mode)
   * propagate to the caller for honest display.
   */
  async portalTo(query: string): Promise<{ planetId: string; label: string }> {
    if (this.active !== 'primary') {
      throw new Error(`${PRIMARY_DOWN} — the portal needs live chain data`);
    }
    const target = await this.primary.resolveCellQuery(query);
    this.viewTarget = target.planetId;
    await this.refreshSnapshot();
    return target;
  }

  /** Return the view to the signed-in player's own planet. */
  async portalHome(): Promise<void> {
    this.viewTarget = null;
    await this.refreshSnapshot();
  }

  /** UNIVERSE SCAN (read-only) — needs the live registries. */
  async scanUniverse(query: string, filters: ScanFilters): Promise<ScanResult> {
    if (this.active !== 'primary') {
      throw new Error(`${PRIMARY_DOWN} — the scan needs live chain data`);
    }
    return this.primary.scanUniverse(query, filters);
  }

  private async refreshSnapshot(): Promise<void> {
    if (this.busySnapshot) return;
    this.busySnapshot = true;
    try {
      const snapshot = await this.primary.fetchSnapshot(this.viewTarget ?? undefined);
      if (this.active !== 'primary') {
        this.eventCursor = 0; // fresh cursor when switching feeds
        console.info('cellstructs: chain source back — switching to live data');
      }
      this.active = 'primary';
      this.primaryWarned = false;
      this.listener.onSnapshot(snapshot);
    } catch (e) {
      if (!this.primaryWarned) {
        this.primaryWarned = true;
        console.warn(`cellstructs: ${PRIMARY_DOWN}, falling back to mock fixture`, e);
      }
      if (this.active !== 'mock') this.eventCursor = 0;
      this.active = 'mock';
      const snapshot = await this.mock.fetchSnapshot();
      snapshot.note = `${PRIMARY_DOWN} — showing bundled mock fixture.`;
      // Secondary path: if the chain RPC answers, surface its real height.
      const height = await this.rpc.getHeight();
      if (height !== null) {
        snapshot.blockHeight = height;
        snapshot.note = `${PRIMARY_DOWN} — mock entities, live RPC block height.`;
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
      const source = this.active === 'primary' ? this.primary : this.mock;
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
