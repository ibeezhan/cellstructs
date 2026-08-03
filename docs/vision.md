# Vision

## One line

Watch your Structs empire the way a biologist watches a cell under a microscope — alive, animated, legible.

## What it is

A **lens** over live Structs chain state. It does not invent its own economy; it re-renders the real game as cellular biology. Every organelle is backed by a real struct or resource; every animation is driven by real on-chain activity (a mine proof landing, a refinery converting ore, charge accumulating, a raid inbound).

## What it is not (yet)

- Not a standalone game with its own rules.
- Not a wallet — signing stays with the existing Structs surface.

Future option: where the cell model wants behaviour the chain doesn't expose, we draft a protocol proposal. Kept out of scope for v1.

## Design pillars

1. **Lens-first.** Source of truth is the chain. We read; we visualize; we route actions through.
2. **Alive & realistic.** Animated, microscopy-style rendering is the product's soul. Organelles pulse, drift, and react to real events.
3. **Both surfaces.** Web app in the same environment/stack as the current Structs app/web.
4. **Reference aesthetic.** Realistic cell art (see `docs/assets/` refs), not stylized-cute or purely abstract-scientific.
5. **Phased views + actions.** Ship views in phases; each view gains actionable controls once its rendering is solid.

## View phases

- **Phase 1 — Planet view (single cell).** One planet as one cell. All organelles mapped, live data, idle/active animation states. This is the "this is real" milestone.
- **Phase 2 — Guild view (tissue / colony).** Multiple cells as a connected colony; shared substation/power as intercellular flow.
- **Phase 3 — Remote cell / player view.** Scout another player's planet as a foreign organism; feeds combat/raid planning.
- **Cross-cutting — Actionable items.** Each view progressively exposes real actions (mine, refine, build, defend, raid) as interactions on the organelles.

## Open technical questions

Tracked in `docs/spec.md`.
