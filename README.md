# cellstructs 🧬

A living-cell **lens over [Structs](https://structs.gg)** — your on-chain empire rendered as biology. Planets become cells, structs become organelles, and the whole thing breathes: mining, refining, charging, raiding, and defending shown as realistic animated cellular behaviour.

Primarily a **skin / visualization layer** that reads live Structs chain state (read-only) and renders it beautifully. Actions are routed back through the existing Structs signing surface. Over time we may propose protocol-side changes where the cell model wants something the chain doesn't yet expose.

## Status

Early ideation. See [`docs/vision.md`](docs/vision.md) for the concept and [`docs/spec.md`](docs/spec.md) for the technical spec (in progress).

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
