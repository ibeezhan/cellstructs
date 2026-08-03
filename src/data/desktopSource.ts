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

  async fetchSnapshot(): Promise<CellSnapshot> {
    const identity = await this.fetchIdentity();
    const playerQ = await this.rawQuery<PlayerQueryResult>('player', identity.playerId);
    const planetId = playerQ.Player?.planetId || identity.planetId;
    if (!planetId) throw new McpError('player has no planet');
    const planetQ = await this.rawQuery<PlanetQueryResult>('planet', planetId);

    const slotIds = AMBITS.flatMap((a) => planetQ.Planet[a] ?? []).filter(Boolean);

    // The command ship (nucleus) and combat structs live in the player's
    // fleet, not in planet slots — include them while the fleet is on station
    // at this planet.
    const fleetId = playerQ.Player?.fleetId;
    if (fleetId) {
      try {
        const fleetQ = await this.rawQuery<FleetQueryResult>('fleet', fleetId);
        if (fleetQ.Fleet?.locationId === planetId) {
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

    const lastAction = num(playerQ.gridAttributes?.lastAction);
    const alphaU = Object.values(playerQ.playerInventory ?? {})
      .filter((i) => i.denom === 'ualpha')
      .reduce((sum, i) => sum + num(i.amount), 0);

    return {
      source: 'desktop',
      fetchedAt: Date.now(),
      blockHeight: identity.blockHeight,
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
      player: {
        id: identity.playerId,
        name: playerQ.Player?.name ?? identity.playerId,
        ore: num(playerQ.gridAttributes?.ore),
        alphaU,
        charge: lastAction > 0 ? Math.max(0, identity.blockHeight - lastAction) : 0,
        capacity: num(playerQ.gridAttributes?.capacity),
        load: num(playerQ.gridAttributes?.load),
      },
      structs,
    };
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
