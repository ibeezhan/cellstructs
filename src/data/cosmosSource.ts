/**
 * Secondary/fallback chain access via CosmJS against Tendermint RPC
 * (spec §0/§1 — same primitives as structs-webapp).
 *
 * Phase 1 uses this only as a liveness/height probe. TODO(protos): once the
 * generated structsd v0.20.0 protos land (see data/types.ts), extend this into
 * a full entity reader via QueryClient ABCI extensions so snapshots can come
 * straight from a node when no desktop app is present.
 */

import { absoluteUrl } from '../config/endpoints';

export class RpcProbe {
  readonly kind = 'rpc' as const;

  constructor(private rpcUrl: string) {}

  /** Returns the current block height, or null if the RPC is unreachable. */
  async getHeight(): Promise<number | null> {
    try {
      // Dynamic import keeps CosmJS out of the critical rendering path.
      const { StargateClient } = await import('@cosmjs/stargate');
      const client = await StargateClient.connect(absoluteUrl(this.rpcUrl));
      const height = await client.getHeight();
      client.disconnect();
      return height;
    } catch (e) {
      console.warn('cellstructs: RPC probe failed', e);
      return null;
    }
  }
}
