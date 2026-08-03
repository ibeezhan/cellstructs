/**
 * Minimal typed client for the Structs desktop app's MCP server
 * (JSON-RPC 2.0 over streamable HTTP at POST <base>/mcp, rmcp 0.15.x).
 * Responses arrive as SSE-framed JSON; sessions via the Mcp-Session-Id header.
 */

export class McpError extends Error {}

interface JsonRpcResponse {
  jsonrpc: string;
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface ToolCallResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export interface ToolInfo {
  name: string;
  inputSchema?: {
    properties?: Record<string, { enum?: string[] }>;
  };
}

export class McpHttpClient {
  private sessionId: string | null = null;
  private nextId = 1;
  private initPromise: Promise<void> | null = null;

  constructor(
    private baseUrl: string,
    private token: string,
    private timeoutMs = 15000,
  ) {}

  private endpoint(): string {
    return this.baseUrl.replace(/\/+$/, '') + '/mcp';
  }

  private async post(body: unknown, expectResult: boolean): Promise<unknown> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.endpoint(), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const sid = res.headers.get('mcp-session-id');
      if (sid) this.sessionId = sid;
      if (!res.ok) throw new McpError(`MCP HTTP ${res.status}`);
      if (!expectResult) return null;

      const text = await res.text();
      const contentType = res.headers.get('content-type') ?? '';
      let payload: JsonRpcResponse | null = null;
      if (contentType.includes('text/event-stream')) {
        for (const line of text.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const chunk = line.slice(5).trim();
          if (!chunk) continue;
          try {
            const parsed = JSON.parse(chunk) as JsonRpcResponse;
            if (parsed.id !== undefined) payload = parsed;
          } catch {
            // keepalive / non-JSON frame
          }
        }
      } else {
        payload = JSON.parse(text) as JsonRpcResponse;
      }
      if (!payload) throw new McpError('no JSON-RPC payload in MCP response');
      if (payload.error) throw new McpError(payload.error.message || 'MCP error');
      return payload.result;
    } finally {
      clearTimeout(timer);
    }
  }

  connect(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.doConnect();
    return this.initPromise;
  }

  private async doConnect(): Promise<void> {
    this.sessionId = null;
    await this.post(
      {
        jsonrpc: '2.0',
        id: this.nextId++,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'cellstructs', version: '0.1.0' },
        },
      },
      true,
    );
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, false);
  }

  reset(): void {
    this.initPromise = null;
    this.sessionId = null;
  }

  /** The server's tool registry — used to discover which actions exist. */
  async listTools(): Promise<ToolInfo[]> {
    await this.connect();
    const result = (await this.post(
      { jsonrpc: '2.0', id: this.nextId++, method: 'tools/list', params: {} },
      true,
    )) as { tools?: ToolInfo[] };
    return result?.tools ?? [];
  }

  /** Call a tool and return its text content. Retries once on session expiry. */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
    await this.connect();
    try {
      return await this.callToolOnce(name, args);
    } catch (e) {
      this.reset();
      await this.connect();
      return this.callToolOnce(name, args);
    }
  }

  private async callToolOnce(name: string, args: Record<string, unknown>): Promise<string> {
    const result = (await this.post(
      {
        jsonrpc: '2.0',
        id: this.nextId++,
        method: 'tools/call',
        params: { name, arguments: args },
      },
      true,
    )) as ToolCallResult;
    const item = result?.content?.find((c) => c.type === 'text' && typeof c.text === 'string');
    if (!item?.text) throw new McpError(`tool ${name}: no text content`);
    if (result.isError) throw new McpError(`tool ${name}: ${item.text.slice(0, 200)}`);
    return item.text;
  }
}
