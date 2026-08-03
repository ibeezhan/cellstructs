/**
 * Hosted/read-only data source: the Structs chain's Cosmos SDK LCD (REST).
 *
 * The desktop app's `structs_intel` raw queries are a thin wrapper over these
 * same endpoints and return the same envelopes, so `StructsSource` handles
 * everything above the transport unchanged. Two differences are patched here:
 *
 *  - LCD struct documents carry a numeric `type` instead of the desktop API's
 *    `type_name` / `health_max`, so the struct-type registry is fetched once
 *    and cached to decorate them.
 *  - There is no event bus over REST. `pollEvents` returns an empty page and
 *    the snapshot says so — animation still runs off the polled struct state
 *    (mining/refining/raid flags), just without instant event triggers.
 *
 * There is no signing path here by construction: an LCD can only read.
 */

import type { AppConfig } from '../config/endpoints';
import { EventsPage, Identity, RegistryType, StructsSource, num } from './source';
import type { RawStruct, StructQueryResult } from './types';

/**
 * Public showcase cell used when no player is pinned — planet 2-279 ("E'numa",
 * player 1-303 "Trendy"): a fully built-out cell with extractors, a refinery,
 * shield generators and a fleet on station, so the hosted view lands on
 * something alive. Override with the Player ID field in ⚙ settings.
 */
export const FEATURED_PLAYER_ID = '1-303';

const REGISTRY_TTL_MS = 60_000;

interface StructTypeDoc {
  id: string;
  type: string;
  maxHealth: string;
}

export class LcdSource extends StructsSource {
  readonly kind = 'lcd' as const;
  private base: string;
  private pinnedPlayerId: string;
  private structTypes: Promise<Map<string, StructTypeDoc>> | null = null;

  constructor(cfg: AppConfig) {
    super();
    this.base = cfg.lcdUrl.replace(/\/+$/, '');
    this.pinnedPlayerId = cfg.playerId;
    this.collectTtlMs = REGISTRY_TTL_MS;
    this.sourceNote =
      'Read-only hosted view over the public Structs node — run cellstructs locally against the desktop app for live events and actions.';
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    if (!this.base) throw new Error('no LCD endpoint configured');
    const qs = new URLSearchParams(params).toString();
    const url = `${this.base}${path}${qs ? `?${qs}` : ''}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`LCD ${res.status} on ${path}${res.status === 501 ? ' (not implemented)' : ''}`);
    }
    return (await res.json()) as T;
  }

  /** id → struct type doc, fetched once (22 types today) and reused. */
  private typeRegistry(): Promise<Map<string, StructTypeDoc>> {
    this.structTypes ??= this.get<{ StructType: StructTypeDoc[] }>('/structs/struct_type', {
      'pagination.limit': '500',
    })
      .then((r) => new Map((r.StructType ?? []).map((t) => [t.id, t])))
      .catch((e) => {
        this.structTypes = null; // retry on the next struct read
        throw e;
      });
    return this.structTypes;
  }

  protected async rawQuery<T>(type: string, id: string): Promise<T> {
    const doc = await this.get<T>(`/structs/${type}/${encodeURIComponent(id)}`);
    if (type === 'struct') {
      const q = doc as StructQueryResult;
      if (q?.Struct) {
        const t = (await this.typeRegistry()).get(String(q.Struct.type));
        const s = q.Struct as RawStruct;
        s.type_name = t?.type ?? `type ${q.Struct.type}`;
        s.health_max = num(t?.maxHealth);
      }
    }
    return doc;
  }

  protected async rawListPage<T>(
    type: RegistryType,
    limit: number,
    paginationKey?: string,
  ): Promise<{ items: T[]; next: string | null }> {
    const j = await this.get<Record<string, unknown>>(`/structs/${type}`, {
      'pagination.limit': String(limit),
      ...(paginationKey ? { 'pagination.key': paginationKey } : {}),
    });
    const key = type.charAt(0).toUpperCase() + type.slice(1);
    const items = (j[key] ?? []) as T[];
    const next = (j.pagination as { next_key?: string } | undefined)?.next_key ?? null;
    return { items, next };
  }

  async fetchIdentity(): Promise<Identity> {
    const playerId = this.pinnedPlayerId || FEATURED_PLAYER_ID;
    const block = await this.get<{ block?: { header?: { height?: string } } }>(
      '/cosmos/base/tendermint/v1beta1/blocks/latest',
    );
    return {
      playerId,
      planetId: '', // resolved from the player document by fetchSnapshot
      blockHeight: num(block.block?.header?.height),
    };
  }

  /** REST has no event bus — the hosted view animates from polled state only. */
  async pollEvents(since: number): Promise<EventsPage> {
    return { events: [], cursor: since };
  }
}
