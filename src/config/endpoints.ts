/**
 * Endpoint configuration (spec §2). Priority: localStorage (settings panel)
 * > .env build-time defaults > per-mode defaults.
 *
 * Two build modes, one codebase:
 *
 *  - `local` (default) — talks to the Structs desktop app on :8420 through the
 *    dev-server's same-origin proxy. Full feature set, including actions: the
 *    desktop app holds the keys and does the signing.
 *  - `hosted` — the Cloudflare Pages build. Reads come from the public Structs
 *    node through the read-only Cloudflare Worker proxy; there is no signing
 *    surface, so actions are disabled in the UI (see `READ_ONLY`).
 *
 * Selected at build time with CELLSTRUCTS_MODE (see webpack.config.js).
 */

export type AppMode = 'local' | 'hosted';

export const APP_MODE: AppMode = process.env.CELLSTRUCTS_MODE === 'hosted' ? 'hosted' : 'local';

/** Hosted builds never sign — the UI renders actions as read-only. */
export const READ_ONLY = APP_MODE === 'hosted';

/** Base URL of the read-only Worker proxy (hosted builds only). */
const PROXY_BASE = (process.env.CELLSTRUCTS_PROXY_URL || '').replace(/\/+$/, '');

export interface AppConfig {
  /** Base URL of the desktop app HTTP API (MCP server). '/desktop' = dev proxy to :8420. */
  desktopApiUrl: string;
  /** Bearer token — lives in .env / localStorage only, never in the repo. */
  desktopApiToken: string;
  /** Cosmos LCD/REST base used by the hosted read-only source. */
  lcdUrl: string;
  /** Tendermint RPC for the CosmJS secondary path. '/rpc' = dev proxy to :26657. */
  rpcUrl: string;
  /** Optional pinned player ID; empty = auto-detect (local) / featured cell (hosted). */
  playerId: string;
}

const STORAGE_KEY = 'cellstructs.config.v1';

const LOCAL_DEFAULTS: AppConfig = {
  desktopApiUrl: process.env.CELLSTRUCTS_DESKTOP_API_URL || '/desktop',
  desktopApiToken: process.env.CELLSTRUCTS_DESKTOP_API_TOKEN || '',
  lcdUrl: process.env.CELLSTRUCTS_LCD_URL || '',
  rpcUrl: process.env.CELLSTRUCTS_RPC_URL || '/rpc',
  playerId: process.env.CELLSTRUCTS_PLAYER_ID || '',
};

const HOSTED_DEFAULTS: AppConfig = {
  desktopApiUrl: `${PROXY_BASE}/desktop`,
  // No token is ever shipped in a hosted bundle; the Worker injects upstream
  // credentials from its own secrets.
  desktopApiToken: '',
  lcdUrl: process.env.CELLSTRUCTS_LCD_URL || `${PROXY_BASE}/lcd`,
  rpcUrl: process.env.CELLSTRUCTS_RPC_URL || `${PROXY_BASE}/rpc`,
  playerId: process.env.CELLSTRUCTS_PLAYER_ID || '',
};

export const ENV_DEFAULTS: AppConfig = READ_ONLY ? HOSTED_DEFAULTS : LOCAL_DEFAULTS;

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
