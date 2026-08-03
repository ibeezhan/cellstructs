/**
 * Real struct-action pipeline (spec §6). Builds the action message and
 * submits it to the desktop app's `structs_action` MCP tool over :8420 —
 * the same preflight + signing surface the desktop agent uses. The desktop
 * app signs and broadcasts (keys never enter this webapp); we then watch the
 * `tx_settled` receipts on the event feed for the real tx hash + status.
 *
 * Every phase is reported honestly: the server's own reply text is the
 * status line, and a failure carries the real error — success is never faked.
 */

import type { CellEvent } from '../data/types';

export type StructAction =
  | 'mine'
  | 'refine'
  | 'build'
  | 'attack'
  | 'defend'
  | 'activate'
  | 'deactivate';

/** Extra args for the actions that need more than the struct id. */
export interface ActionExtras {
  targetId?: string;
  weapon?: string;
  protectedId?: string;
  structType?: string;
  ambit?: string;
  slot?: number;
}

export type ActionPhase = 'submitting' | 'submitted' | 'confirmed' | 'failed';

export interface ActionState {
  action: StructAction;
  structId: string;
  phase: ActionPhase;
  /** Honest status: the server reply (trimmed) or the real error message. */
  summary: string;
  txHash?: string;
  at: number;
}

/** The transport the pipeline submits through (DataManager in practice). */
export interface ActionSubmitter {
  submitAction(action: string, args: Record<string, unknown>): Promise<string>;
}

/** tx_settled receipt subjects per action, e.g. "struct_activate 5-21827". */
const RECEIPT_PREFIX: Record<StructAction, string> = {
  mine: 'struct_ore_mine',
  refine: 'struct_ore_refine',
  build: 'struct_build',
  attack: 'struct_attack',
  defend: 'struct_defense',
  activate: 'struct_activate',
  deactivate: 'struct_deactivate',
};

function buildArgs(action: StructAction, structId: string, x: ActionExtras): Record<string, unknown> {
  switch (action) {
    case 'mine':
    case 'refine':
    case 'activate':
    case 'deactivate':
      return { struct_id: structId };
    case 'attack':
      return {
        attacker_id: structId,
        target_id: x.targetId ?? '',
        ...(x.weapon ? { weapon: x.weapon } : {}),
      };
    case 'defend':
      return { defender_id: structId, protected_id: x.protectedId ?? '' };
    case 'build':
      return { struct_type: x.structType ?? '', ambit: x.ambit ?? 'land', slot: x.slot ?? 0 };
  }
}

/** First few informative lines of a server reply, for the status area. */
function condense(text: string, maxLen = 280): string {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 4);
  const joined = lines.join(' · ');
  return joined.length > maxLen ? joined.slice(0, maxLen - 1) + '…' : joined;
}

const TX_HASH_RE = /\b[A-F0-9]{64}\b/;

export class ActionPipeline {
  /** last state per struct id — the panel reads this on render */
  private latestByStruct = new Map<string, ActionState>();
  /** submitted actions awaiting a tx_settled receipt */
  private awaiting: ActionState[] = [];

  onUpdate: ((st: ActionState) => void) | null = null;
  /** fired on accepted submit and again on confirmed receipt — drives animation */
  onEffect: ((action: StructAction, structId: string) => void) | null = null;

  constructor(private submitter: ActionSubmitter) {}

  latest(structId: string): ActionState | null {
    return this.latestByStruct.get(structId) ?? null;
  }

  isBusy(structId: string): boolean {
    return this.latest(structId)?.phase === 'submitting';
  }

  async submit(action: StructAction, structId: string, extras: ActionExtras = {}): Promise<ActionState> {
    let st: ActionState = {
      action,
      structId,
      phase: 'submitting',
      summary: `submitting ${action}…`,
      at: Date.now(),
    };
    this.emit(st);
    try {
      const reply = await this.submitter.submitAction(action, buildArgs(action, structId, extras));
      st = {
        ...st,
        phase: 'submitted',
        summary: condense(reply),
        txHash: reply.match(TX_HASH_RE)?.[0],
      };
      this.awaiting.push(st);
      this.emit(st);
      this.onEffect?.(action, structId);
    } catch (e) {
      st = { ...st, phase: 'failed', summary: e instanceof Error ? e.message : String(e) };
      this.emit(st);
    }
    return st;
  }

  /** Match tx_settled receipts from the live event feed to awaiting actions. */
  handleEvents(events: CellEvent[]): void {
    for (const ev of events) {
      if (ev.category !== 'tx_settled') continue;
      const idx = this.awaiting.findIndex(
        (p) => ev.subject.includes(p.structId) || ev.subject.startsWith(RECEIPT_PREFIX[p.action]),
      );
      if (idx < 0) continue;
      const p = this.awaiting.splice(idx, 1)[0];
      const raw = JSON.stringify(ev.data);
      const status = String(ev.data.status ?? '');
      const dropped = /dropped|fail/i.test(status) || /"status"\s*:\s*"dropped"/i.test(raw);
      const txHash =
        (typeof ev.data.tx_hash === 'string' && ev.data.tx_hash) ||
        (typeof ev.data.txhash === 'string' && ev.data.txhash) ||
        (typeof ev.data.hash === 'string' && ev.data.hash) ||
        raw.match(TX_HASH_RE)?.[0] ||
        p.txHash;
      const st: ActionState = {
        ...p,
        phase: dropped ? 'failed' : 'confirmed',
        summary: dropped
          ? `tx dropped on-chain: ${condense(raw, 160)}`
          : `tx settled: ${ev.subject}`,
        txHash: txHash || undefined,
        at: Date.now(),
      };
      this.emit(st);
      if (!dropped) this.onEffect?.(p.action, p.structId);
    }
  }

  private emit(st: ActionState): void {
    this.latestByStruct.set(st.structId, st);
    this.onUpdate?.(st);
  }
}
