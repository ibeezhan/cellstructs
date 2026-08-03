/**
 * cellstructs read-only data proxy (Cloudflare Worker).
 *
 * Fronts the public Structs data surfaces so the hosted Pages build can read
 * chain state from a browser: it terminates TLS, adds CORS (the upstreams
 * generally have none), and injects any upstream credential from a Worker
 * secret so nothing sensitive ever reaches the bundle.
 *
 * Read-only is enforced here, not merely by convention: every route has an
 * allowlist, and anything that could submit a transaction, sign, or mutate
 * state is rejected with 403 before the upstream is contacted. See GUARDS.
 *
 * Upstream bases are configuration (wrangler.toml [vars] / `wrangler secret`),
 * never hardcoded. An unconfigured route answers 503 with what to set.
 */

export interface Env {
  /** Tendermint/CometBFT RPC base, e.g. https://rpc.example:26657 */
  UPSTREAM_RPC?: string;
  /** Cosmos SDK LCD/REST base, e.g. https://lcd.example:1317 */
  UPSTREAM_LCD?: string;
  /** Structs Guild API base */
  UPSTREAM_GUILD_API?: string;
  /** MCP-over-HTTP base of a Structs desktop/agent API (read tools only) */
  UPSTREAM_DESKTOP_API?: string;
  /** Comma-separated allowed origins, or '*' */
  ALLOWED_ORIGINS?: string;

  /* --- secrets (wrangler secret put), never in wrangler.toml --- */
  /** Bearer token for RPC/LCD/Guild upstreams, if they require one */
  UPSTREAM_TOKEN?: string;
  /** Bearer token for the MCP desktop upstream, if configured */
  UPSTREAM_DESKTOP_TOKEN?: string;
}

/** Tendermint RPC JSON-RPC methods that only read. Anything else is refused. */
const RPC_READ_METHODS = new Set([
  'abci_info',
  'abci_query',
  'block',
  'block_by_hash',
  'block_results',
  'block_search',
  'blockchain',
  'commit',
  'consensus_params',
  'consensus_state',
  'dump_consensus_state',
  'genesis',
  'genesis_chunked',
  'header',
  'header_by_hash',
  'health',
  'net_info',
  'num_unconfirmed_txs',
  'status',
  'subscribe',
  'tx',
  'tx_search',
  'unconfirmed_txs',
  'unsubscribe',
  'unsubscribe_all',
  'validators',
]);

/** MCP tools the proxy will call. `structs_action` (signing) is not one. */
const MCP_READ_TOOLS = new Set(['structs_intel', 'structs_events']);

/** MCP JSON-RPC methods that don't act. `tools/call` is checked per-tool. */
const MCP_READ_METHODS = new Set([
  'initialize',
  'ping',
  'prompts/list',
  'resources/list',
  'resources/read',
  'tools/list',
]);

interface Route {
  prefix: string;
  /** which env var holds the upstream base */
  upstream: keyof Env;
  /** which secret (if any) is injected as `Authorization: Bearer` */
  token: keyof Env | null;
  /** returns an error message when the request must be refused */
  guard: (req: Request, path: string, body: string | null) => string | null;
  /** whether the guard needs the request body buffered */
  inspectBody: boolean;
}

/** Plain REST reads: GET/HEAD only, nothing else can reach the upstream. */
function guardRest(req: Request): string | null {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return `${req.method} is not allowed on a read-only proxy — GET/HEAD only`;
  }
  return null;
}

/**
 * Tendermint RPC speaks both URI (`GET /status?…`) and JSON-RPC (`POST /`).
 * Both forms can broadcast a transaction, so both are checked against the
 * read allowlist by method name.
 */
function guardRpc(req: Request, path: string, body: string | null): string | null {
  if (req.method === 'GET' || req.method === 'HEAD') {
    const method = path.replace(/^\/+/, '').split('/')[0];
    // '' is the RPC index page (a method listing) — harmless.
    if (method && !RPC_READ_METHODS.has(method)) {
      return `RPC method '${method}' is not read-only`;
    }
    return null;
  }
  if (req.method !== 'POST') {
    return `${req.method} is not allowed on a read-only proxy`;
  }
  const calls = parseJsonRpc(body);
  if (!calls) return 'unparseable JSON-RPC body';
  for (const c of calls) {
    if (!RPC_READ_METHODS.has(c.method)) return `RPC method '${c.method}' is not read-only`;
  }
  return null;
}

/**
 * MCP-over-HTTP: only the handshake, discovery and the read tools pass.
 * `tools/call` for anything outside MCP_READ_TOOLS (notably `structs_action`,
 * the signing surface) is refused here.
 */
function guardMcp(req: Request, path: string, body: string | null): string | null {
  if (req.method === 'GET' || req.method === 'HEAD') return null;
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return `${req.method} is not allowed on a read-only proxy`;
  }
  if (req.method === 'DELETE') return null; // MCP session teardown
  if (!path.replace(/\/+$/, '').endsWith('/mcp')) {
    return 'only the /mcp endpoint is proxied on this route';
  }
  const calls = parseJsonRpc(body);
  if (!calls) return 'unparseable JSON-RPC body';
  for (const c of calls) {
    if (c.method.startsWith('notifications/')) continue;
    if (c.method === 'tools/call') {
      const name = typeof c.params?.name === 'string' ? c.params.name : '';
      if (!MCP_READ_TOOLS.has(name)) {
        return `tool '${name || '(unnamed)'}' is not read-only — this proxy never signs or submits`;
      }
      continue;
    }
    if (!MCP_READ_METHODS.has(c.method)) return `MCP method '${c.method}' is not read-only`;
  }
  return null;
}

const ROUTES: Route[] = [
  { prefix: '/rpc', upstream: 'UPSTREAM_RPC', token: 'UPSTREAM_TOKEN', guard: guardRpc, inspectBody: true },
  { prefix: '/lcd', upstream: 'UPSTREAM_LCD', token: 'UPSTREAM_TOKEN', guard: guardRest, inspectBody: false },
  { prefix: '/guild', upstream: 'UPSTREAM_GUILD_API', token: 'UPSTREAM_TOKEN', guard: guardRest, inspectBody: false },
  {
    prefix: '/desktop',
    upstream: 'UPSTREAM_DESKTOP_API',
    token: 'UPSTREAM_DESKTOP_TOKEN',
    guard: guardMcp,
    inspectBody: true,
  },
];

interface RpcCall {
  method: string;
  params?: Record<string, unknown>;
}

/** Normalize a single or batched JSON-RPC body; null = not parseable. */
function parseJsonRpc(body: string | null): RpcCall[] | null {
  if (body === null) return null;
  if (body.trim() === '') return []; // empty POST reaches no method
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const calls: RpcCall[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) return null;
    const rec = item as Record<string, unknown>;
    if (typeof rec.method !== 'string') return null;
    calls.push({ method: rec.method, params: rec.params as Record<string, unknown> | undefined });
  }
  return calls;
}

const MAX_BODY_BYTES = 256 * 1024;
const UPSTREAM_TIMEOUT_MS = 20_000;

/** Headers worth forwarding upstream; everything else (incl. any client-sent
 *  Authorization) is dropped so only our secret can authenticate. */
const FORWARD_REQUEST_HEADERS = ['content-type', 'accept', 'mcp-session-id', 'mcp-protocol-version'];
const FORWARD_RESPONSE_HEADERS = ['content-type', 'mcp-session-id', 'cache-control'];

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const configured = (env.ALLOWED_ORIGINS ?? '*').trim();
  const origin = req.headers.get('Origin');
  let allow = '*';
  if (configured !== '*') {
    const list = configured.split(',').map((s) => s.trim()).filter(Boolean);
    if (!origin || !list.includes(origin)) return {}; // not allowed: no CORS headers
    allow = origin;
  }
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id',
    'Access-Control-Max-Age': '86400',
    ...(allow === '*' ? {} : { Vary: 'Origin' }),
  };
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (path === '/' || path === '/health') {
      return json(
        {
          service: 'cellstructs-proxy',
          mode: 'read-only',
          routes: ROUTES.map((r) => ({
            prefix: r.prefix,
            upstream: r.upstream,
            configured: Boolean(env[r.upstream]),
          })),
          note: 'Reads only. Any action, signing or tx-broadcast call is rejected with 403.',
        },
        200,
        cors,
      );
    }

    const route = ROUTES.find((r) => path === r.prefix || path.startsWith(r.prefix + '/'));
    if (!route) {
      return json({ error: `no route for ${path}`, routes: ROUTES.map((r) => r.prefix) }, 404, cors);
    }

    let body: string | null = null;
    if (route.inspectBody && request.method !== 'GET' && request.method !== 'HEAD') {
      const raw = await request.arrayBuffer();
      if (raw.byteLength > MAX_BODY_BYTES) {
        return json({ error: 'request body too large' }, 413, cors);
      }
      body = new TextDecoder().decode(raw);
    }

    // Refuse before looking at configuration: what this proxy will not do
    // doesn't depend on which upstreams happen to be wired up.
    const rest = path.slice(route.prefix.length);
    const refusal = route.guard(request, rest || '/', body);
    if (refusal) {
      return json({ error: 'refused by read-only proxy', reason: refusal }, 403, cors);
    }

    const base = (env[route.upstream] as string | undefined)?.trim();
    if (!base) {
      return json(
        {
          error: `upstream not configured for ${route.prefix}`,
          fix: `set ${route.upstream} in worker/wrangler.toml [vars] (or via 'wrangler secret put') and redeploy`,
        },
        503,
        cors,
      );
    }

    const headers = new Headers();
    for (const name of FORWARD_REQUEST_HEADERS) {
      const v = request.headers.get(name);
      if (v) headers.set(name, v);
    }
    const token = route.token ? (env[route.token] as string | undefined) : undefined;
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const target = base.replace(/\/+$/, '') + rest + url.search;
    let upstream: Response;
    try {
      upstream = await fetch(target, {
        method: request.method,
        headers,
        body: body ?? (request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (e) {
      return json(
        { error: 'upstream request failed', reason: e instanceof Error ? e.message : String(e) },
        502,
        cors,
      );
    }

    const out = new Headers(cors);
    for (const name of FORWARD_RESPONSE_HEADERS) {
      const v = upstream.headers.get(name);
      if (v) out.set(name, v);
    }
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
