# Technical Spec (v0 — living document)

## 0. Grounding: how the real Structs webapp works

From [`playstructs/structs-webapp`](https://github.com/playstructs/structs-webapp):

- **Backend:** PHP 8.2 / Symfony 6.3 / Doctrine. Serves the app + an API. Runs in Docker (`localhost:8080`).
- **Frontend:** **vanilla TypeScript**, bundled with **Webpack** (`ts-loader`), organized as **Symfony Stimulus** controllers (`assets/controllers`, `bootstrap.js`). No React/Vue.
- **Chain access (browser):** **CosmJS** — `@cosmjs/stargate`, `@cosmjs/tendermint-rpc`, `@cosmjs/proto-signing`, `@cosmjs/amino`. Signing via `bip39` + crypto libs in-browser.
- **Types:** **protobuf** generated from the `structsd` protos via `@bufbuild/*` (`buf generate` → `src/js/ts/structs.structs/`). Pinned to `structsd v0.17.0`.
- **Realtime:** **NATS** (`@nats-io/nats-core`) — the live event bus. This is what we subscribe to for animation triggers.
- **Reference clients:** `structsd` (Go LCD/RPC), `structs-desktop` (Rust; running locally on this machine with its MCP + API), `structs-control` (TS advanced tooling).

**Implication:** cellstructs reuses the *same* proto types + CosmJS query clients + NATS subscription the real app uses. We are not inventing a data layer — we're adding a rendering layer on top of the existing one.

## 1. Architecture

```
┌─────────────────────────── cellstructs (TS) ───────────────────────────┐
│  Render layer:  PixiJS (WebGL 2D) — cells, organelles, membrane shaders │
│  View layer:    Planet view → Guild view → Remote view (phased)         │
│  State store:   normalized chain snapshot + event queue                 │
│  Data layer:    ── reuses structs-webapp primitives ──                  │
│     • CosmJS query clients (LCD/RPC)  → snapshot reads                   │
│     • protobuf types (from structsd)  → typed entities                  │
│     • NATS subscription               → live event → animation triggers │
│     • Endpoint config (see §2)        → local desktop app OR remote      │
└─────────────────────────────────────────────────────────────────────────┘
```

Two shipping targets, one codebase:
- **Standalone webapp** — its own Webpack/TS build, connects to a configurable endpoint.
- **Embeddable** — packaged as a Stimulus controller / asset bundle that can drop into `structs-webapp` later.

## 2. Data source + remote access (per Shayan)

- **Default:** connect to the **local Structs desktop app** running on this machine (its API + MCP endpoints).
- **Configurable via UI:** endpoint selector so a user can point cellstructs at a **remote** node/API instead of localhost.
- **Future:** remote access as a **paid subscription service** — a hosted proxy that fronts LCD/RPC/NATS for users who don't run their own node. Auth + billing TBD; spec'd later.
- All reads are **read-only**. Actions (§6) are routed through the existing signing surface, never re-implemented.

Config shape (draft):
```ts
interface EndpointConfig {
  mode: 'local-desktop' | 'remote';
  lcdUrl: string;        // e.g. http://localhost:1317
  rpcUrl: string;        // e.g. http://localhost:26657
  natsUrl: string;       // live event bus
  apiUrl?: string;       // structs-webapp / desktop API
  auth?: { subscriptionToken?: string };  // remote/paid mode
}
```

## 3. Rendering engine

- **PixiJS (WebGL 2D)** + custom shaders for membrane wobble, cytoplasm drift, organelle glow. Chosen over Three.js: the reference art is 2D microscopy; Pixi is lighter and better for many soft-bodied animated sprites.
- Organelles = sprites/meshes with per-type shader params. Membrane = a deformable blob (noise-driven vertex displacement).

## 4. Organelle → struct mapping (canonical)

| Biology | Structs entity |
|---|---|
| Cell | Planet |
| Nucleus / DNA | Command Ship |
| Mitochondria | Reactor / charge (energy production) |
| Cell membrane | Shields / Orbital Shield Generators |
| Ribosomes · Golgi | Builders (struct construction / build queue) |
| Ore Extractor | Ore vacuole / intake organelle |
| Endoplasmic reticulum | Ore Refinery (ore → alpha) |
| Alpha matter | ATP / energy currency |
| Lysosomes | Defensive structs (Tank, PDC, cannon) |
| Cell division (mitosis) | Expansion / exploring new planet |
| Phages / infection | Incoming raid |
| Immune response | Counterattack / home guard |
| Tissue / colony | Guild |
| Foreign organism | Remote player planet |

## 5. View phases

- **Phase 1 — Planet view (single cell).** One planet, all organelles mapped to live struct data, idle/active animation states. **"This is real" milestone.**
- **Phase 2 — Guild view (tissue / colony).** Member planets as connected cells; shared substation/power shown as intercellular flow.
- **Phase 3 — Remote cell / player view.** Scout another player's planet as a foreign organism; feeds raid/combat planning.

## 6. Actionable items (layered per view)

Each view progressively exposes real actions as organelle interactions: mine (poke extractor), refine (ER flow), build (ribosome spawn), defend, raid. All actions dispatch through the existing CosmJS signing path — cellstructs only builds the message; the wallet/desktop app signs.

## 7. Motion language

| State | Animation |
|---|---|
| Idle | slow membrane breathing + cytoplasm drift |
| Active mine | extractor organelle pulses; ore particles spawn |
| Refine | flow along the ER; alpha particles emitted |
| Build | ribosome/Golgi buds a new organelle |
| Raid inbound | phages dock at membrane; membrane reddens/stresses |
| Low charge | cell pales, motion slows |
| Counter / defend | lysosomes mobilize toward threat |

## 8. Open items

- Confirm exact local desktop API + NATS URLs/ports on this machine.
- Confirm `structsd` proto version to pin against (webapp is on v0.17.0).
- Decide standalone-first vs embed-first for Phase 1.
- Paid remote proxy: auth model + hosting (later).
