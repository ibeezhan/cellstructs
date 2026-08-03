/**
 * Primary data source: the local Structs desktop app's MCP server.
 * Snapshot reads use `structs_intel` raw entity queries (JSON); the live
 * animation feed uses `structs_events` (NATS-backed, cursor-paged).
 */

import type { AppConfig } from '../config/endpoints';
import { McpError, McpHttpClient } from './mcpClient';
import type {
  Ambit,
  CellEvent,
  CellSnapshot,
  FleetQueryResult,
  PlanetQueryResult,
  PlayerQueryResult,
  RawPlanet,
  RawPlayer,
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

export interface EventsPage {
  events: CellEvent[];
  cursor: number;
}

const num = (v: string | number | undefined | null): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export class DesktopSource {
  readonly kind = 'desktop' as const;
  private client: McpHttpClient;
  private pinnedPlayerId: string;

  constructor(cfg: AppConfig) {
    this.client = new McpHttpClient(cfg.desktopApiUrl, cfg.desktopApiToken);
    this.pinnedPlayerId = cfg.playerId;
  }

  /**
   * Submit a signed player action through the desktop app's `structs_action`
   * tool (preflight → CosmJS signing bridge → broadcast). Returns the raw
   * reply text; throws McpError with the server's real error on failure.
   */
  async submitAction(action: string, args: Record<string, unknown>): Promise<string> {
    return this.client.callTool('structs_action', { action, args });
  }

  /**
   * The action names `structs_action` actually accepts, read from the live
   * tool schema (its `action` enum) so the UI can disable anything the
   * desktop app doesn't expose instead of failing at submit time.
   */
  async fetchSupportedActions(): Promise<Set<string>> {
    const tools = await this.client.listTools();
    const tool = tools.find((t) => t.name === 'structs_action');
    if (!tool) throw new McpError('structs_action tool not present on :8420');
    const actions = tool.inputSchema?.properties?.action?.enum ?? [];
    if (actions.length === 0) throw new McpError('structs_action schema has no action enum');
    return new Set(actions);
  }

  private async rawQuery<T>(type: string, id: string): Promise<T> {
    const text = await this.client.callTool('structs_intel', {
      query: 'query',
      args: { type, id },
    });
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new McpError(`raw query ${type}/${id}: non-JSON reply: ${text.slice(0, 160)}`);
    }
  }

  /** Paged entity list (LCD-style pagination via next_key). */
  private async rawList<T>(
    type: 'player' | 'planet' | 'guild',
    limit: number,
    paginationKey?: string,
  ): Promise<{ items: T[]; next: string | null }> {
    const text = await this.client.callTool('structs_intel', {
      query: 'query',
      args: { type, limit, ...(paginationKey ? { pagination_key: paginationKey } : {}) },
    });
    const j = JSON.parse(text) as Record<string, unknown>;
    const key = type.charAt(0).toUpperCase() + type.slice(1);
    const items = (j[key] ?? []) as T[];
    const next = (j.pagination as { next_key?: string } | undefined)?.next_key ?? null;
    return { items, next };
  }

  /** Collect every entity of a type, bounded by MAX_PAGES × page size. */
  private async collect<T>(type: 'player' | 'planet' | 'guild', maxPages = 12): Promise<T[]> {
    const all: T[] = [];
    let key: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const { items, next } = await this.rawList<T>(type, 400, key);
      all.push(...items);
      if (!next) break;
      key = next;
    }
    return all;
  }

  /** whoami is plain text; parse the labelled fields. */
  async fetchIdentity(): Promise<Identity> {
    const text = await this.client.callTool('structs_intel', { query: 'whoami' });
    const grab = (label: string): string =>
      text.match(new RegExp(`${label}:\\s*(\\S+)`))?.[1] ?? '';
    const identity = {
      playerId: this.pinnedPlayerId || grab('Player ID'),
      planetId: grab('Planet'),
      blockHeight: num(grab('Block height')),
    };
    if (!identity.playerId) throw new McpError('whoami: could not detect player ID');
    return identity;
  }

  /**
   * Normalized snapshot of a planet-as-cell. With no argument this is the
   * signed-in player's own planet; with `targetPlanetId` it renders any
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
      if (!planetQ.Planet?.id) throw new McpError(`planet ${targetPlanetId} not found`);
      viewPlayerId = planetQ.Planet.owner_type === 'Player' ? planetQ.Planet.owner : '';
      playerQ = viewPlayerId
        ? await this.rawQuery<PlayerQueryResult>('player', viewPlayerId).catch(() => null)
        : null;
    } else {
      viewPlayerId = identity.playerId;
      playerQ = await this.rawQuery<PlayerQueryResult>('player', viewPlayerId);
      const planetId = playerQ.Player?.planetId || identity.planetId;
      if (!planetId) throw new McpError('player has no planet');
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

    return {
      source: 'desktop',
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
      ...(targetPlanetId
        ? { note: `Viewing remote cell ${planetQ.Planet.name || planetQ.Planet.id} (${planetQ.Planet.id}) — VIEW CELL → home to return.` }
        : {}),
    };
  }

  /**
   * Resolve a VIEW CELL query — a planet id (2-…), a player id (1-…), or a
   * player/planet name — to a concrete planet id, verifying it exists.
   * Name search pages through the planet and player registries (bounded).
   */
  async resolveCellQuery(q: string): Promise<{ planetId: string; label: string }> {
    const query = q.trim();
    if (!query) throw new McpError('empty cell query');

    if (/^2-\d+$/.test(query)) {
      const p = await this.rawQuery<PlanetQueryResult>('planet', query);
      if (!p.Planet?.id) throw new McpError(`planet ${query} not found`);
      return { planetId: p.Planet.id, label: p.Planet.name || p.Planet.id };
    }
    if (/^1-\d+$/.test(query)) {
      const p = await this.rawQuery<PlayerQueryResult>('player', query);
      const planetId = p.Player?.planetId;
      if (!planetId) throw new McpError(`player ${query} has no planet`);
      return { planetId, label: p.Player.name || query };
    }
    if (/^\d+-\d+$/.test(query)) {
      throw new McpError(`'${query}' is not a planet (2-…) or player (1-…) id`);
    }

    // Name search: exact (case-insensitive) wins, else first substring match.
    const needle = query.toLowerCase();
    let substring: { planetId: string; label: string } | null = null;
    const MAX_PAGES = 12;
    for (const type of ['planet', 'player'] as const) {
      let key: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const { items, next } = await this.rawList<RawPlanet | RawPlayer>(type, 400, key);
        for (const it of items) {
          const name = (it.name ?? '').toLowerCase();
          if (!name || !name.includes(needle)) continue;
          const planetId = type === 'planet' ? (it as RawPlanet).id : (it as RawPlayer).planetId;
          if (!planetId) continue;
          const hit = { planetId, label: it.name };
          if (name === needle) return hit;
          substring ??= hit;
        }
        if (!next) break;
        key = next;
      }
    }
    if (substring) return substring;
    throw new McpError(`no planet or player named '${query}' found`);
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
            ownerId: p.owner_type === 'Player' ? p.owner : undefined,
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

  /**
   * Event lines look like:
   *   [1785718564438] refined — structs.inventory.ore.0-1.1-920.structs1…  {"action":"refined",…}
   * The trailing JSON may be display-truncated, so parse defensively.
   */
  async pollEvents(since: number): Promise<EventsPage> {
    const text = await this.client.callTool('structs_events', {
      since: since || undefined,
      mine_only: true,
      limit: 40,
    });
    const events: CellEvent[] = [];
    const lineRe = /^\s*\[(\d+)\]\s+(\S+)\s+—\s+(\S+)(?:\s+(\{.*))?$/;
    for (const line of text.split('\n')) {
      const m = line.match(lineRe);
      if (!m) continue;
      let data: Record<string, unknown> = {};
      if (m[4]) {
        try {
          data = JSON.parse(m[4]) as Record<string, unknown>;
        } catch {
          // truncated JSON — salvage the fields the renderer cares about
          for (const kv of m[4].matchAll(/"(\w+)":("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null)/g)) {
            try {
              data[kv[1]] = JSON.parse(kv[2]);
            } catch {
              /* skip */
            }
          }
        }
      }
      events.push({ ts: num(m[1]), category: m[2], subject: m[3], data });
    }
    const cursor = num(text.match(/next_cursor:\s*(\d+)/)?.[1]) || since;
    return { events, cursor };
  }
}
