# Raid / Siege Animation — Plan

> **Status: planning only.** Nothing here is built yet. This document specifies
> the biological metaphor, the exact live data that drives it, the visual
> states and their timeline, and how it hangs off the action pipeline that
> already exists (`src/actions/dispatch.ts`).

The cell under raid is the most dramatic thing this lens can show, and it is
the one moment where the biology metaphor and the game mechanics line up
almost perfectly: a hostile fleet docking at a planet **is** a phage docking
at a membrane, and the outcome — ore seized, structs destroyed, shield burned
down — reads natively as infection, lysis, and immune response.

## 0. Grounding in the reference art

Two images in `docs/assets/` set the visual target, and the raid sequence
should be built as a *disturbance of* what they depict, never a different
art style dropped on top:

- **`ref-cell-realistic.jpg`** — the translucent blue-violet membrane with its
  granular surface, the deep purple nucleus with a visible nucleolus, the
  cyan filament web, and the neighbouring cells drifting out of focus in the
  background. Two things matter for the raid: (1) the membrane is a
  *thick, soft, semi-transparent shell* — it can bulge, thin, and locally
  rupture rather than just change colour; (2) other cells already exist in
  the field of view, so an attacker arriving from off-screen is consistent
  with the established world.
- **`ref-cell-labeled.jpg`** — the cutaway with cytoplasm, cell membrane,
  mitochondria, nucleus/DNA, ER, Golgi, lysosomes and ribosomes named. This is
  the vocabulary the raid animation must speak in: the lysosomes (teal
  vesicles) are the units that mobilise, the ER/Golgi are the production
  machinery that goes quiet under siege, and the cytoplasm is the medium whose
  contents can be drained.

Current renderer state (already shipped) that the raid builds on:
`Membrane` (noise-displaced outline, bilayer stroke, granular cortex,
shield halo), `Cytoskeleton` (filament web + ribosome speckles), `Phage`
(docked attacker sprite), `Lysosome` (drifts, surges outward under stress),
and the `Motion.stress` channel that already reddens the cytoplasm and
membrane.

## 1. The metaphor, mapped

| Game event | Biology | What the viewer sees |
|---|---|---|
| Hostile fleet arrives in orbit | Phage particles approach the cell | Dark specks drift in from off-screen toward the membrane |
| Raid initiated | Phages **attach** to the membrane | Phages dock, tails plant, membrane dimples under each |
| Planetary shield absorbing | Glycocalyx / surface coat holding | Shield halo flares at each impact, then thins |
| Shield drops to 0 | **Membrane breach** | A local rupture: bilayer parts, cortex grain scatters, cytoplasm leaks |
| Struct takes damage (`struct_health`) | Organelle injury | That organelle flashes, deflates, its HP ring loses a segment |
| Struct destroyed | Organelle lysis | Organelle ruptures into debris vesicles, then fades |
| Defender blocks a shot | Lysosome intercepts | A lysosome darts between phage and target, absorbs the flash |
| Defender counter-attack | **Immune response** | Lysosomes swarm the docked phage; phage recoils/detaches |
| Ore seized | **Cytoplasm drain** | Ore particles stream *outward* through the breach into the phage |
| Attacker retreats / raid ends | Infection cleared | Phages detach and drift off; membrane begins to reseal |
| Shield regenerating | Membrane repair | Rupture knits closed, grain re-forms, halo returns |

The single most important reversal to get right: **during normal mining, ore
particles flow inward** (membrane → extractor vacuole; this is
`ParticleSystem.spawnOreIntake` today). During a successful raid, the same
particle language runs **backwards, through the breach, out to the phage**.
Nothing else needs to be said for a viewer to understand they are being
robbed.

## 2. The data that drives it

All of it is already reachable over the desktop app's `:8420` MCP surface —
the same one the action pipeline submits through. Nothing below is
speculative; every field was read off a **real raid** on planet `2-2671` by
fleet `9-61` (player `1-61`) recorded 2026-07-30, sampled while writing this.

### 2.1 The live feed — `structs_events`

The animation is event-driven off the existing poll in `DataManager`
(`desktopSource.pollEvents`). Relevant categories, with their real payloads:

| Category | Payload (observed) | Drives |
|---|---|---|
| `fleet_arrive` | `{fleet_id, fleet_list, fleet_status}` — `fleet_status:"away"` for a hostile fleet at your planet | **Approach** phase: spawn phages, begin drift-in |
| `raid_status` | `{status, fleet_id, planet_id, seized_ore}` — statuses seen: `initiated`, `attackerRetreated` | Phase transitions; `seized_ore` drives the drain volume |
| `struct_attack` | very rich (see §2.2) | Per-shot impact flashes, blocks, counters, kills |
| `struct_health` | `{struct_id, health, health_old}` | Organelle damage flash + HP ring update |
| `struct_status` | `{struct_id, status, status_old}` — `35` observed on a struct that `scout` then reported `DESTROYED` | Lysis / revival transitions |
| `shield_change` | `{planetary_shield, planetary_shield_old}` — observed `225 → 175` | Shield halo level; a drop to 0 arms the breach |
| `struct_defense_add` / `_remove` | `{defender_struct_id, protected_struct_id}` | Which lysosomes escort which organelle |
| `fleet_depart` | `{fleet_id, …}` | Phage detach + drift-out |

`structs_events` also supports `threats_only: true` with `wait_secs` — a
server-side classifier that returns only `raid_armed` / `struct_lost` /
`taking_damage` / `hostile_inbound` / `shield_drop`, blocking until one lands.
That is a ready-made "cell is under attack" trigger, and is the right way to
run the raid watcher without tightening the normal poll interval. Worth using
as a second, dedicated subscription rather than filtering the main feed
client-side.

### 2.2 `struct_attack` — the per-shot payload

This is the payload that makes shot-level animation possible rather than a
generic "under attack" wash. Real example (trimmed):

```jsonc
{
  "attackerStructId": "5-26273", "attackerStructType": "High Altitude Interceptor",
  "attackerPlayerId": "1-61", "attackerStructOperatingAmbit": "air",
  "weaponSystem": "primaryWeapon", "weaponControl": "guided",
  "eventAttackShotDetail": [{
    "targetStructId": "5-26384", "targetStructType": "Battleship",
    "targetStructOperatingAmbit": "space",
    "damage": "2", "damageDealt": "2", "damageReduction": "0",
    "targetHealthBefore": "3", "targetHealthAfter": "1",
    "evaded": false, "evadedCause": "noUnitDefenses",
    "blocked": false, "blockedByStructId": "",
    "targetCountered": false, "targetCounteredDamage": "0",
    "targetDestroyed": false,
    "evadedByPlanetaryDefenses": false,
    "eventAttackDefenderCounterDetail": []
  }],
  "planetaryDefenseCannonDamage": "0"
}
```

Each field has a distinct visual consequence:

- `evaded: true` → the shot **misses**: a streak passes through and dissipates
  in the cytoplasm; no flash on the organelle. (The real battle log for this
  planet is full of `EVADED (0 dmg)` — a raid where nothing lands must look
  visibly different from one where everything does, or the animation is lying.)
- `blocked: true` + `blockedByStructId` → a **lysosome interposes**: animate
  the blocker darting onto the shot line and taking the flash instead.
- `targetCountered: true` + `eventAttackDefenderCounterDetail` → **immune
  response**: a counter-streak fires back from defender to phage; if
  `targetCounterDestroyedAttacker`, the phage ruptures.
- `targetDestroyed: true` → **lysis** of that organelle.
- `evadedByPlanetaryDefenses` / `planetaryDefenseCannonDamage` → the
  **membrane itself** repels the shot: the halo flares at the impact angle.
- `targetStructOperatingAmbit` (`water`/`land`/`air`/`space`) → where on the
  cell the impact lands. The renderer already places organelles by ambit
  (`AMBIT_ANGLE` in `cellApp.ts`), so shots can be aimed at the correct
  quadrant instead of arriving generically.

### 2.3 Snapshot / query reads

- `structs_intel {query:"query", type:"planet"}` → `planetAttributes`:
  `planetaryShield`, `blockStartRaid` (already consumed as
  `snapshot.planet.raidActive`), and the defense-network quantities
  (`defensiveCannonQuantity`, `lowOrbitBallisticsInterceptorNetworkQuantity`,
  `advancedOrbitalJammingStationQuantity`, `repairNetworkQuantity`, …) that
  should modulate how *thick* the membrane's defensive coat looks.
- `structs_intel {query:"scout", location_id}` → attacker/defender roster with
  HP and ambit — how many phages to spawn and where they dock.
- `structs_intel {query:"battle_log", planet_id}` → authoritative combat
  results, including a **backfill** path: on load, replay a recent raid as a
  fast-forward so a returning player sees what happened rather than a
  silent, already-damaged cell.
- `structs_intel {query:"ruleset"}` → weapon reach masks per ambit and the
  counter/block rules; useful for pre-visualising a raid (`simulate`) without
  waiting for one.

### 2.4 Honesty constraints

The same rule the action pipeline follows applies here: **never animate an
outcome the chain has not reported.** Concretely:

- No damage flash without a `struct_health` / `struct_attack` payload.
- Ore drain volume comes from `raid_status.seized_ore` — in the recorded raid
  above it was `"0"` (the attacker retreated with nothing), and the animation
  must show a *repelled* raid, not a theft, in that case.
- A raid whose shots all evaded shows streaks and no lysis. Tempting to
  "punch it up"; don't.
- If the feed is unreachable, the cell holds its last known state and the HUD
  says so — the existing `note` channel already does this for mock fallback.

## 3. Visual states and timeline

Five phases. Each is entered by a real event and is idempotent (re-entering
on a duplicate event must not double-animate).

```
 APPROACH ──► ATTACHMENT ──► BREACH ──► DRAIN ──► RESOLUTION
 fleet_arrive  raid_status    shield→0   seized_ore  raid_status:
 (status away) initiated      / struct    > 0        attackerRetreated
                              destroyed              | fleet_depart
```

### Phase 1 — APPROACH (`fleet_arrive`, hostile)
*~2 s in.* Phages fade in at the field edge and drift toward the cell. The
membrane's outer halo tightens; the cytoskeleton filaments brighten slightly
(`Motion.stress` easing up from 0 — already implemented, currently triggered
by `raid_status` alone). Background dust drifts faster. No colour shift yet:
this is dread, not damage.

### Phase 2 — ATTACHMENT (`raid_status: initiated`)
*~1.5 s per phage, staggered.* Each phage docks at the membrane angle
matching the attacker's ambit; legs splay; the membrane **dimples inward**
under each dock point (a local negative offset in `Membrane.radiusAt`, which
already takes an angle — the natural extension point). Cytoplasm tint begins
to shift toward `cytoplasmStressed`. Lysosomes stop their idle drift and
begin migrating toward the docked side. Production quiets: the ER's
undulation slows and refine-flow particle emission drops, because a besieged
cell is not refining.

Per `struct_attack`, on a ~0.4 s beat:
- a thin streak from the phage to the target organelle, coloured by
  `weaponControl` (guided = tight bright line; unguided = a spray of shot
  streaks matching the shot count);
- `evaded` → streak passes through and fades;
- `blocked` → the blocker lysosome slides onto the line and flashes;
- otherwise the target flashes (existing `Organelle.flash`), deflates by a
  few percent, and its HP ring loses segments;
- `targetCountered` → a return streak, and the phage recoils on its tether.

### Phase 3 — BREACH (shield hits 0, or first `targetDestroyed`)
*~0.8 s, the sharpest beat in the sequence.* At the worst-hit angle the
bilayer **parts**: the membrane stroke is drawn as two retracting arcs with a
gap, the cortex grain in that arc scatters inward, and the shield halo
extinguishes locally with a hard flash. Any organelle with
`targetDestroyed: true` ruptures — its geometry breaks into 6–10 debris
vesicles that scatter and fade, leaving the slot visibly empty (currently
destroyed structs simply stop being rendered; they should *die on screen*).
Cytoplasm reaches full stress tint. The filament web slackens near the
breach.

### Phase 4 — DRAIN (`raid_status.seized_ore > 0`)
*Duration scaled to the amount seized, clamped to ~4 s.* Ore particles
reverse: they lift out of the extractor vacuole and the cytoplasm, converge
on the breach, and stream out to the attacking phage — the mining flow run
backwards. The cell visibly *deflates*: base radius eases down a few percent
and the cytoplasm's inner glow dims. This is the emotional core of the
sequence and deserves the most tuning time.

If `seized_ore` is `"0"`, this phase is **skipped entirely** and the sequence
goes straight to resolution — see §2.4.

### Phase 5 — RESOLUTION (`raid_status: attackerRetreated` / `fleet_depart`)
*~3 s, then a slow tail.* Phages detach and drift off-screen (the existing
`Phage.update(dying)` fade already does the mechanical part). The membrane
knits: the gap closes, grain re-forms along the healed arc, the halo returns
at whatever level `shield_change` now reports. Lysosomes drift back toward
their home positions. `Motion.stress` decays to 0 — already implemented, on a
30 s timer that should become event-driven instead.

Regeneration is genuinely slow on-chain (shields recover over many blocks), so
the tail should be *long and mostly static*: the cell keeps a faint scar at
the breach angle and a dimmer halo until `shield_change` says otherwise. A
cell that was raided an hour ago should still look like it.

### Motion budget

The `Motion` interface gains a small number of channels, in keeping with the
existing `minePulse`/`refinePulse`/`shieldPulse` pattern:

```ts
raidPhase: 'none' | 'approach' | 'attachment' | 'breach' | 'drain' | 'resolution';
breachAngle: number;   // radians; where the membrane is torn
breachOpen: number;    // 0..1, eased — how far the bilayer has parted
drainRate: number;     // 0..1, from seized_ore
```

Performance follows the rule already established by `Cytoskeleton` and the
membrane grain: **anything static is built once and only transformed per
frame**. Debris vesicles are pooled; shot streaks are short-lived entries in
the existing `ParticleSystem`; the breach is a modification to the existing
outline trace, not an extra full-cell path.

## 4. How this ties into the action pipeline (item 1)

The raid animation is the *receiving* half of the loop the action pipeline
already drives from the sending half. Both should run through the same
plumbing:

1. **Same submit path.** A raid you launch goes out exactly like the actions
   wired today: `ActionPipeline.submit()` → `DataManager.submitAction()` →
   `structs_action` on `:8420` → the desktop app signs and broadcasts. Keys
   never enter the webapp. `structs_action` already exposes `raid
   {target_id}` in its live schema (confirmed in the tool list), so the
   discovery mechanism added in item 1 will enable a Raid button with no
   further wiring — it is currently absent only because no organelle
   surfaces it yet.

2. **Same receipt discipline.** `ActionPipeline` watches `tx_settled`
   receipts and reports `submitting → submitted → confirmed / rejected` with
   the real tx hash and the chain's own error text. A raid is a *slow*
   action whose visible consequences arrive minutes later as `raid_status` /
   `struct_attack` events, so the two-stage design already in place matters
   more here than anywhere: the receipt confirms the raid *launched*; the
   event feed narrates what it *did*.

3. **Same trigger surface, both directions.** `ActionPipeline.onEffect` today
   fires `CellApp.actionEffect(action, structId)` on accept and again on
   confirm. The raid sequence extends the *inbound* equivalent —
   `CellApp.pushEvents()` — so:
   - **Outbound** (you raid someone): while the portal (item 2) is showing
     the target's cell, the phases above play on *their* cell, driven by the
     same events. The remote-view guard added in item 2 needs a matching
     exception so raid events for the viewed planet still animate.
   - **Inbound** (you are raided): the phases play on your own cell, and the
     defensive actions in the info panel — Defend, Activate, Attack — are the
     player's response, submitted through the exact pipeline of item 1. A
     Defend confirmed mid-siege should visibly send a lysosome to escort the
     protected organelle, closing the loop between the button and the biology.

4. **Scan → raid planning.** The SCAN popup (item 3) already surfaces shield,
   defense count, and owner activity per cell, and portals to any of them.
   That is a raid-target picker in everything but name: scout a candidate,
   portal in, and — with `structs_intel simulate` / `strike_options` — preview
   the damage before the pipeline ever builds a message.

## 5. Open questions

- **Multi-attacker raids.** The recorded raid had one hostile fleet. Several
  simultaneously needs a rule for how many phages read as "a lot" before the
  membrane becomes unreadable — probably a cap with a count badge.
- **`struct_status` codes.** `1`, `7`, and `35` were observed; `35`
  corresponds to a struct `scout` reports as `DESTROYED`. The full status
  enum should be read from `structsd` rather than inferred before it drives
  lysis, since guessing wrong means animating a death that did not happen.
- **Backfill pacing.** How fast to replay a missed raid from `battle_log` on
  load — fast-forward, or a compressed summary beat?
- **Off-screen attribution.** The attacker is another player's cell. Phase 3
  of the view plan (remote cell view) plus the portal makes a cut to the
  attacker's cell possible; whether that is thrilling or disorienting is a
  design call to make with a prototype, not on paper.
