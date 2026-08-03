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
    type: 'player' | 'planet',
    limit: number,
    paginationKey?: string,
  ): Promise<{ items: T[]; next: string | null }> {
    const text = await this.client.callTool('structs_intel', {
      query: 'query',
      args: { type, limit, ...(paginationKey ? { pagination_key: paginationKey } : {}) },
    });
    const j = JSON.parse(text) as Record<string, unknown>;
    const key = type === 'player' ? 'Player' : 'Planet';
    const items = (j[key] ?? []) as T[];
    const next = (j.pagination as { next_key?: string } | undefined)?.next_key ?? null;
    return { items, next };
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
