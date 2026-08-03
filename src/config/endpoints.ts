/**
 * Endpoint configuration (spec §2). Priority: localStorage (settings panel)
 * > .env build-time defaults > hardcoded local-desktop defaults.
 */

export interface AppConfig {
  /** Base URL of the desktop app HTTP API (MCP server). '/desktop' = dev proxy to :8420. */
  desktopApiUrl: string;
  /** Bearer token — lives in .env / localStorage only, never in the repo. */
  desktopApiToken: string;
  /** Tendermint RPC for the CosmJS secondary path. '/rpc' = dev proxy to :26657. */
  rpcUrl: string;
  /** Optional pinned player ID; empty = auto-detect via whoami. */
  playerId: string;
}

const STORAGE_KEY = 'cellstructs.config.v1';

export const ENV_DEFAULTS: AppConfig = {
  desktopApiUrl: process.env.CELLSTRUCTS_DESKTOP_API_URL || '/desktop',
  desktopApiToken: process.env.CELLSTRUCTS_DESKTOP_API_TOKEN || '',
  rpcUrl: process.env.CELLSTRUCTS_RPC_URL || '/rpc',
  playerId: process.env.CELLSTRUCTS_PLAYER_ID || '',
};

export function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...ENV_DEFAULTS, ...(JSON.parse(raw) as Partial<AppConfig>) };
  } catch (e) {
    console.warn('cellstructs: bad stored config, using defaults', e);
  }
  return { ...ENV_DEFAULTS };
}

export function saveConfig(cfg: AppConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function resetConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Resolve possibly-relative endpoint (e.g. '/rpc') to an absolute URL. */
export function absoluteUrl(url: string): string {
  return url.startsWith('/') ? window.location.origin + url : url;
}
