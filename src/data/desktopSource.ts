/**
 * Local data source: the Structs desktop app's MCP server on :8420.
 *
 * Entity reads use `structs_intel` raw queries (JSON, same envelopes the LCD
 * returns); the live animation feed uses `structs_events` (NATS-backed,
 * cursor-paged). This is the only source that can *act* — the desktop app
 * holds the keys, so `submitAction` routes through its signing surface.
 *
 * The snapshot/portal/scan logic itself lives in `StructsSource`.
 */

import type { AppConfig } from '../config/endpoints';
import { McpError, McpHttpClient } from './mcpClient';
import { EventsPage, Identity, RegistryType, StructsSource, num } from './source';
import type { CellEvent } from './types';

export class DesktopSource extends StructsSource {
  readonly kind = 'desktop' as const;
  private client: McpHttpClient;
  private pinnedPlayerId: string;

  constructor(cfg: AppConfig) {
    super();
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

  protected async rawQuery<T>(type: string, id: string): Promise<T> {
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

  protected async rawListPage<T>(
    type: RegistryType,
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
