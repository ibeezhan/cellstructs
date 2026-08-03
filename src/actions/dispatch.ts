/**
 * Struct action dispatch. Per spec §6 all actions must route through the
 * existing Structs signing surface (desktop app / CosmJS signing path) —
 * cellstructs never signs or re-implements transactions.
 *
 * TODO(actions): wire these to the desktop app's action tools once its
 * read-write MCP surface is exposed. Until then every action is a stub:
 * it logs the intent and reports "not wired" — success is never faked.
 */

export type StructAction = 'mine' | 'refine' | 'build' | 'defend' | 'activate' | 'deactivate';

export interface DispatchResult {
  dispatched: false;
  note: string;
}

export function dispatchAction(action: StructAction, structId: string): DispatchResult {
  const note = `"${action}" on struct ${structId}: not dispatched — signing path not wired yet (TODO)`;
  console.warn(`cellstructs action stub: ${note}`);
  return { dispatched: false, note };
}
