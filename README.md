# cellstructs 🧬

A living-cell **lens over [Structs](https://structs.gg)** — your on-chain empire rendered as biology. Planets become cells, structs become organelles, and the whole thing breathes: mining, refining, charging, raiding, and defending shown as realistic animated cellular behaviour.

Primarily a **skin / visualization layer** that reads live Structs chain state (read-only) and renders it beautifully. Actions are routed back through the existing Structs signing surface. Over time we may propose protocol-side changes where the cell model wants something the chain doesn't yet expose.

## Status

**Phase 1 shipped**: one planet rendered as a living cell, driven by live data from the local Structs desktop app. See [`docs/vision.md`](docs/vision.md) for the concept and [`docs/spec.md`](docs/spec.md) for the technical spec.

**Interactivity pass shipped** on the Planet view:

- **Hover tooltips** — every organelle shows a cursor-following tip with struct
  name, biology type, id, HP, ambit·slot, and live status (mining/refining/…).
- **Click → detail panel** — full struct stats plus an ACTIONS section with the
  real action set for the type (Mine ore / Refine ore / Build struct / Defend /
  Activate–Deactivate). Buttons are honest stubs: the signing path isn't wired
  yet, so they log the intent and say so (`src/actions/dispatch.ts` TODO).
- **SCAN menu item** — immediate re-read of chain state outside the poll
  cadence, with a sweep-ring pulse over the cell.
- **VIEW CELL menu item** — reframes the cell to the default view (the canvas
  now supports drag-pan and wheel-zoom; VIEW CELL resets the camera).

## Running it

```bash
npm install
cp .env.example .env   # then paste your desktop-app bearer token into .env
npm run dev            # → http://localhost:8421
npm run build          # production bundle in dist/
```

The bearer token lives on your machine in
`~/Library/Application Support/structs-app/mcp_config.json` (macOS). `.env` is
gitignored — **never commit the token**. You can also set/change the endpoint
and token at runtime via the ⚙ settings panel (persisted to localStorage,
overrides `.env`).

### Endpoints

| Setting | Default | Meaning |
|---|---|---|
| Desktop API URL | `/desktop` | Structs desktop app HTTP API. `/desktop` is proxied by the dev server to `http://127.0.0.1:8420` (the API rejects cross-origin preflight, so same-origin proxying is required in dev; a remote endpoint must support CORS). |
| Bearer token | — | Auth for the desktop API. |
| Tendermint RPC | `/rpc` | CosmJS secondary path, dev-proxied to `http://127.0.0.1:26657`. Phase 1 uses it only as a block-height/liveness probe. |
| Player ID | auto | Pin a player; blank auto-detects via `whoami`. |

If the desktop API is unreachable the app falls back to a bundled **mock
planet fixture** (clearly badged `MOCK` in the HUD) so the cell always renders.
Pointing at a remote node (future paid tier) is just a settings change.

## Architecture (Phase 1)

```
src/
  config/endpoints.ts      endpoint config: localStorage > .env > defaults
  data/
    mcpClient.ts           typed client for the desktop app's MCP-over-HTTP API
                           (JSON-RPC 2.0 at POST /mcp, SSE-framed, session header)
    desktopSource.ts       snapshot reads (structs_intel raw entity queries:
                           player → planet → fleet → structs) + live event feed
                           (structs_events, cursor-paged, NATS-backed)
    cosmosSource.ts        CosmJS (@cosmjs/stargate) RPC probe — secondary path
    mockSource.ts          bundled mock fixture (fallback, badged MOCK)
    dataManager.ts         source orchestration, polling, fallback switching
    types.ts               stub entity types for structsd v0.20.0 (Therovis) —
                           TODO: swap for buf-generated protos
  mapping/organelles.ts    canonical organelle ↔ struct mapping (spec §4)
  actions/dispatch.ts      struct action dispatch — stub until the signing
                           surface is wired (logs intent, never fakes success)
  render/                  PixiJS (WebGL): membrane blob (simplex noise),
                           procedural organelles, particles, motion language,
                           pointer picking + camera (pan/zoom/reframe)
  ui/                      HUD (LIVE/MOCK badge, vitals), settings panel,
                           hover tooltip, organelle detail panel
```

Motion language implemented per spec §7: idle membrane breathing + cytoplasm
drift, extractor pulse + ore intake particles while mining, ER flow + alpha
sparks while refining, Golgi budding on build events, phages docking + membrane
reddening on raids, lysosome mobilization under stress, and low-charge pallor
(the cell desaturates and literally slows down, recovering as charge builds).

**Not covered yet:** guild/tissue view, remote player cells, actually
dispatching actions (the UI renders per-type action buttons but the signing
path is a logged TODO stub), NATS websocket subscription (events are polled
through the desktop API instead), and generated protobuf types.

## The metaphor

| Biology | Structs |
|---|---|
| Cell | Planet |
| Nucleus / DNA | Command Ship (player identity + core) |
| Mitochondria | Reactor / energy (charge production) |
| Cell membrane | Shields / Orbital Shield Generators |
| Ribosomes · Golgi | Builders (struct construction) |
| Ore / vacuoles | Ore Extractors + stored ore |
| Endoplasmic reticulum | Refineries (ore → alpha) |
| Lysosomes | Defensive structs (Tanks, PDC, cannons) |
| Cell division (mitosis) | Expansion / new planets |
| Infection / phages | Incoming raids |
| Immune response | Counterattack / home guard |
| Tissue / colony | Guild |
| Other organisms | Remote players |

## Pillars (from the founding interview)

1. **Lens-first** — mirror real Structs state, not a separate game. Protocol suggestions come later, if ever.
2. **Visual & alive** — realistic, animated cellular behaviour is the headline. Biology-flavored mechanics layer on top.
3. **Both surfaces** — a web app built in the same environment as the current Structs app/web.
4. **Realistic aesthetic** — microscopy-style, in the spirit of the reference art (not cute/abstract).
5. **Phased views** — Planet (single cell) → Guild (tissue/colony) → Remote cell/player, with actionable items layered onto each view.
