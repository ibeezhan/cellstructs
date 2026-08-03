/**
 * Shared chain-source layer.
 *
 * Every entity read in cellstructs is the same handful of queries — planet,
 * player, fleet, struct, plus paged registry listings — so the snapshot,
 * portal-resolve and universe-scan logic lives here once, on top of two
 * abstract primitives (`rawQuery` / `rawListPage`). Transports plug in
 * underneath: `DesktopSource` speaks MCP to the local desktop app,
 * `LcdSource` speaks Cosmos REST to a public node (directly or via the
 * hosted read-only Worker proxy).
 *
 * Everything in this module is read-only. Writes (signing, broadcasting)
 * belong to the transport that has keys — see `DesktopSource.submitAction`.
 */

import type {
  Ambit,
  CellSnapshot,
  FleetQueryResult,
  PlanetQueryResult,
  PlayerQueryResult,
  RawPlanet,
  RawPlayer,
  SourceKind,
  StructQueryResult,
  StructState,
} from './types';
import { AMBITS } from './types';

export interface Identity {
  playerId: string;
  planetId: string;
  blockHeight: number;
}

/** UNIVERSE SCAN filters, modeled on the structs-webapp search facets. */
export interface ScanFilters {
  kind: 'all' | 'planet' | 'player' | 'guild';
  minOre: number;
  minShield: number;
  minDefenses: number;
  /** owner acted within this many blocks; 0 = any */
  maxBlocksSinceAction: number;
}

export interface ScanRow {
  kind: 'planet' | 'player' | 'guild';
  entityId: string;
  name: string;
  /** portal target */
  planetId: string;
  ownerName: string;
  guildId: string;
  /** owner's grid ore */
  ore: number;
  shield: number;
  /** planet defense installations (cannon / interceptor / jamming networks…) */
  defenses: number;
  /** occupied planet slots */
  structs: number;
  raidActive: boolean;
  blocksSinceAction: number | null;
}

export interface ScanResult {
  rows: ScanRow[];
  totalMatches: number;
  enriched: number;
  note: string;
}

export interface EventsPage {
  events: import('./types').CellEvent[];
  cursor: number;
}

interface ScanCandidate {
  kind: ScanRow['kind'];
  id: string;
  name: string;
  planetId?: string;
  ownerId?: string;
}

interface RawGuild {
  id: string;
  name: string;
  owner: string;
}

export type RegistryType = 'player' | 'planet' | 'guild';

export const num = (v: string | number | undefined | null): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * A planet's owning player id, or '' when a guild/other entity owns it.
 * The desktop API tags ownership with `owner_type`; raw LCD documents don't,
 * so fall back to the id namespace (players are `1-…`).
 */
export function ownerPlayerId(planet: RawPlanet): string {
  if (planet.owner_type) return planet.owner_type === 'Player' ? planet.owner : '';
  return /^1-\d+$/.test(planet.owner ?? '') ? planet.owner : '';
}

/** Read-only chain access, transport-agnostic. */
export abstract class StructsSource {
  abstract readonly kind: SourceKind;

  /** Appended to every snapshot note (e.g. hosted read-only caveats). */
  protected sourceNote: string | null = null;

  /** How long a full registry sweep may be reused by SCAN; 0 = never. */
  protected collectTtlMs = 0;

  private collectCache = new Map<RegistryType, { at: number; items: unknown[] }>();

  /** One entity document by type + id. */
  protected abstract rawQuery<T>(type: string, id: string): Promise<T>;

  /** One page of a registry listing, LCD-style `next_key` pagination. */
  protected abstract rawListPage<T>(
    type: RegistryType,
    limit: number,
    paginationKey?: string,
  ): Promise<{ items: T[]; next: string | null }>;

  /** Who/where/when we are reading as. */
  abstract fetchIdentity(): Promise<Identity>;

  /** Live event feed page; sources without a bus return an empty page. */
  abstract pollEvents(since: number): Promise<EventsPage>;

  /** Collect every entity of a type, bounded by maxPages × page size. */
  protected async collect<T>(type: RegistryType, maxPages = 16): Promise<T[]> {
    const hit = this.collectCache.get(type);
    if (hit && this.collectTtlMs > 0 && Date.now() - hit.at < this.collectTtlMs) {
      return hit.items as T[];
    }
    const all: T[] = [];
    let key: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const { items, next } = await this.rawListPage<T>(type, 400, key);
      all.push(...items);
      if (!next) break;
      key = next;
    }
    if (this.collectTtlMs > 0) this.collectCache.set(type, { at: Date.now(), items: all });
    return all;
  }

  /**
   * Normalized snapshot of a planet-as-cell. With no argument this is the
   * signed-in/pinned player's own planet; with `targetPlanetId` it renders any
   * planet in the universe (VIEW CELL portal) — the owner's player record
   * supplies the identity/vitals when it resolves.
   */
  async fetchSnapshot(targetPlanetId?: string): Promise<CellSnapshot> {
    const identity = await this.fetchIdentity();
    let planetQ: PlanetQueryResult;
    let playerQ: PlayerQueryResult | null;
    let viewPlayerId: string;
    if (targetPlanetId) {
      planetQ = await this.rawQuery<PlanetQueryResult>('planet', targetPlanetId);
      if (!planetQ.Planet?.id) throw new Error(`planet ${targetPlanetId} not found`);
      viewPlayerId = ownerPlayerId(planetQ.Planet);
      playerQ = viewPlayerId
        ? await this.rawQuery<PlayerQueryResult>('player', viewPlayerId).catch(() => null)
        : null;
    } else {
      viewPlayerId = identity.playerId;
      playerQ = await this.rawQuery<PlayerQueryResult>('player', viewPlayerId);
      const planetId = playerQ.Player?.planetId || identity.planetId;
      if (!planetId) throw new Error('player has no planet');
      planetQ = await this.rawQuery<PlanetQueryResult>('planet', planetId);
    }

    const slotIds = AMBITS.flatMap((a) => planetQ.Planet[a] ?? []).filter(Boolean);

    // The command ship (nucleus) and combat structs live in the player's
    // fleet, not in planet slots — include them while the fleet is on station
    // at this planet.
    const fleetId = playerQ?.Player?.fleetId;
    if (fleetId) {
      try {
        const fleetQ = await this.rawQuery<FleetQueryResult>('fleet', fleetId);
        if (fleetQ.Fleet?.locationId === planetQ.Planet.id) {
          if (fleetQ.Fleet.commandStruct) slotIds.push(fleetQ.Fleet.commandStruct);
          slotIds.push(...AMBITS.flatMap((a) => fleetQ.Fleet[a] ?? []).filter(Boolean));
        }
      } catch (e) {
        console.warn('cellstructs: fleet query failed (continuing without fleet)', e);
      }
    }

    const structQs = await Promise.all(
      [...new Set(slotIds)].map((id) =>
        this.rawQuery<StructQueryResult>('struct', id).catch((e) => {
          console.warn(`cellstructs: struct ${id} query failed`, e);
          return null;
        }),
      ),
    );

    const structs: StructState[] = structQs
      .filter((q): q is StructQueryResult => q !== null && !!q.Struct)
      .map((q) => ({
        id: q.Struct.id,
        typeName: q.Struct.type_name,
        ambit: (q.Struct.operatingAmbit || 'land') as Ambit,
        slot: num(q.Struct.slot),
        health: num(q.structAttributes?.health),
        healthMax: num(q.Struct.health_max),
        online: q.structAttributes?.isOnline === true,
        built: q.structAttributes?.isBuilt === true,
        destroyed: q.structAttributes?.isDestroyed === true,
        mining: num(q.structAttributes?.blockStartOreMine) > 0,
        refining: num(q.structAttributes?.blockStartOreRefine) > 0,
        building: q.structAttributes?.isBuilt !== true && num(q.structAttributes?.blockStartBuild) > 0,
      }));

    const lastAction = num(playerQ?.gridAttributes?.lastAction);
    const alphaU = Object.values(playerQ?.playerInventory ?? {})
      .filter((i) => i.denom === 'ualpha')
      .reduce((sum, i) => sum + num(i.amount), 0);

    const notes: string[] = [];
    if (targetPlanetId) {
      const label = planetQ.Planet.name || planetQ.Planet.id;
      notes.push(`Viewing remote cell ${label} (${planetQ.Planet.id}) — VIEW CELL → home to return.`);
    }
    if (this.sourceNote) notes.push(this.sourceNote);

    return {
      source: this.kind,
      fetchedAt: Date.now(),
      blockHeight: identity.blockHeight,
      remoteView: !!targetPlanetId,
      planet: {
        id: planetQ.Planet.id,
        name: planetQ.Planet.name || planetQ.Planet.id,
        shield: num(planetQ.planetAttributes?.planetaryShield),
        raidActive: num(planetQ.planetAttributes?.blockStartRaid) > 0,
        maxOre: num(planetQ.Planet.maxOre),
        slots: {
          land: num(planetQ.Planet.landSlots),
          water: num(planetQ.Planet.waterSlots),
          air: num(planetQ.Planet.airSlots),
          space: num(planetQ.Planet.spaceSlots),
        },
      },
      player: playerQ
        ? {
            id: viewPlayerId,
            name: playerQ.Player?.name || viewPlayerId,
            ore: num(playerQ.gridAttributes?.ore),
            alphaU,
            charge: lastAction > 0 ? Math.max(0, identity.blockHeight - lastAction) : 0,
            capacity: num(playerQ.gridAttributes?.capacity),
            load: num(playerQ.gridAttributes?.load),
          }
        : null,
      structs,
      ...(notes.length > 0 ? { note: notes.join(' · ') } : {}),
    };
  }

  /**
   * Resolve a VIEW CELL query — a planet id (2-…), a player id (1-…), or a
   * player/planet name — to a concrete planet id, verifying it exists.
   * Name search pages through the planet and player registries (bounded).
   */
  async resolveCellQuery(q: string): Promise<{ planetId: string; label: string }> {
    const query = q.trim();
    if (!query) throw new Error('empty cell query');

    if (/^2-\d+$/.test(query)) {
      const p = await this.rawQuery<PlanetQueryResult>('planet', query);
      if (!p.Planet?.id) throw new Error(`planet ${query} not found`);
      return { planetId: p.Planet.id, label: p.Planet.name || p.Planet.id };
    }
    if (/^1-\d+$/.test(query)) {
      const p = await this.rawQuery<PlayerQueryResult>('player', query);
      const planetId = p.Player?.planetId;
      if (!planetId) throw new Error(`player ${query} has no planet`);
      return { planetId, label: p.Player.name || query };
    }
    if (/^\d+-\d+$/.test(query)) {
      throw new Error(`'${query}' is not a planet (2-…) or player (1-…) id`);
    }

    // Name search: exact (case-insensitive) wins, else first substring match.
    const needle = query.toLowerCase();
    let substring: { planetId: string; label: string } | null = null;
    for (const type of ['planet', 'player'] as const) {
      for (const it of await this.collect<RawPlanet | RawPlayer>(type)) {
        const name = (it.name ?? '').toLowerCase();
        if (!name || !name.includes(needle)) continue;
        const planetId = type === 'planet' ? (it as RawPlanet).id : (it as RawPlayer).planetId;
        if (!planetId) continue;
        const hit = { planetId, label: it.name };
        if (name === needle) return hit;
        substring ??= hit;
      }
    }
    if (substring) return substring;
    throw new Error(`no planet or player named '${query}' found`);
  }

  /**
   * UNIVERSE SCAN (read-only): sweep the live planet/player/guild registries
   * for a name/id match, then enrich the top candidates with planet + owner
   * reads so the facet filters (ore/shield/defenders/activity) can apply.
   * Numeric filters only see enriched rows — the note reports that honestly.
   */
  async scanUniverse(query: string, filters: ScanFilters, maxRows = 12): Promise<ScanResult> {
    const identity = await this.fetchIdentity();
    const q = query.trim().toLowerCase();
    const wantKind = (k: ScanRow['kind']): boolean => filters.kind === 'all' || filters.kind === k;
    const matches = (id: string, name: string): boolean =>
      !q || id.toLowerCase().startsWith(q) || name.toLowerCase().includes(q);

    const candidates: ScanCandidate[] = [];
    if (wantKind('planet')) {
      for (const p of await this.collect<RawPlanet>('planet')) {
        if (matches(p.id, p.name)) {
          candidates.push({
            kind: 'planet',
            id: p.id,
            name: p.name || p.id,
            planetId: p.id,
            ownerId: ownerPlayerId(p) || undefined,
          });
        }
      }
    }
    if (wantKind('player')) {
      for (const p of await this.collect<RawPlayer>('player')) {
        if (p.planetId && matches(p.id, p.name)) {
          candidates.push({ kind: 'player', id: p.id, name: p.name || p.id, planetId: p.planetId, ownerId: p.id });
        }
      }
    }
    if (wantKind('guild')) {
      for (const g of await this.collect<RawGuild>('guild')) {
        if (matches(g.id, g.name)) {
          candidates.push({ kind: 'guild', id: g.id, name: g.name || g.id, ownerId: g.owner });
        }
      }
    }

    // Newest entities first — high indices are the live, active corner of the
    // universe; registry order would spend the enrich budget on dead planets.
    const indexOf = (id: string): number => num(id.split('-')[1]);
    candidates.sort((a, b) => indexOf(b.id) - indexOf(a.id));

    const hasNumericFilter =
      filters.minOre > 0 || filters.minShield > 0 || filters.minDefenses > 0 || filters.maxBlocksSinceAction > 0;
    const rows: ScanRow[] = [];
    let enriched = 0;
    const ENRICH_BUDGET = hasNumericFilter ? 48 : maxRows;
    for (let i = 0; i < candidates.length && rows.length < maxRows && enriched < ENRICH_BUDGET; i += 8) {
      const batch = candidates.slice(i, Math.min(i + 8, candidates.length));
      const settled = await Promise.all(batch.map((c) => this.enrichCandidate(c, identity.blockHeight)));
      enriched += batch.length;
      for (const row of settled) {
        if (!row || rows.length >= maxRows) continue;
        if (row.ore < filters.minOre) continue;
        if (row.shield < filters.minShield) continue;
        if (row.defenses < filters.minDefenses) continue;
        if (
          filters.maxBlocksSinceAction > 0 &&
          (row.blocksSinceAction === null || row.blocksSinceAction > filters.maxBlocksSinceAction)
        ) {
          continue;
        }
        rows.push(row);
      }
    }

    const noteParts = [`${candidates.length} match${candidates.length === 1 ? '' : 'es'} in the live registries`];
    if (candidates.length > enriched) {
      noteParts.push(`facets checked on the first ${enriched}`);
    }
    return { rows, totalMatches: candidates.length, enriched, note: noteParts.join(' · ') };
  }

  /** Planet + owner reads for one scan candidate; null when it can't resolve. */
  private async enrichCandidate(c: ScanCandidate, blockHeight: number): Promise<ScanRow | null> {
    try {
      let ownerQ: PlayerQueryResult | null = null;
      let planetId = c.planetId;
      if (c.ownerId) {
        ownerQ = await this.rawQuery<PlayerQueryResult>('player', c.ownerId).catch(() => null);
        planetId ||= ownerQ?.Player?.planetId;
      }
      if (!planetId) return null;
      const planetQ = await this.rawQuery<PlanetQueryResult>('planet', planetId);
      if (!planetQ.Planet?.id) return null;
      const attrs = planetQ.planetAttributes ?? {};
      let defenses = 0;
      for (const [k, v] of Object.entries(attrs)) {
        if (/Quantity$/.test(k)) defenses += num(v);
      }
      const occupied = AMBITS.flatMap((a) => planetQ.Planet[a] ?? []).filter(Boolean).length;
      const lastAction = num(ownerQ?.gridAttributes?.lastAction);
      return {
        kind: c.kind,
        entityId: c.id,
        name: c.name,
        planetId,
        ownerName: ownerQ?.Player?.name || ownerQ?.Player?.id || planetQ.Planet.owner || '—',
        guildId: ownerQ?.Player?.guildId ?? '',
        ore: num(ownerQ?.gridAttributes?.ore),
        shield: num(attrs.planetaryShield),
        defenses,
        structs: occupied,
        raidActive: num(attrs.blockStartRaid) > 0,
        blocksSinceAction: lastAction > 0 ? Math.max(0, blockHeight - lastAction) : null,
      };
    } catch {
      return null;
    }
  }
}
