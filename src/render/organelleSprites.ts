/**
 * Procedurally-drawn organelles, one class per kind from the mapping module.
 * Each implements the motion language for its state (spec §7): idle drift,
 * mine pulse, ER refine flow, lysosome mobilization, phage docking.
 */

import { Circle, Container, Graphics } from 'pixi.js';
import type { OrganelleKind } from '../mapping/organelles';
import type { StructState } from '../data/types';
import type { Membrane } from './membrane';
import { clamp01, hash01, Motion, PALETTE, TAU } from './util';

export abstract class Organelle extends Container {
  protected g = new Graphics();
  struct: StructState | null = null;
  /** transient damage flash 0..1, decays in animate() */
  flash = 0;
  protected size = 20;

  constructor(
    readonly id: string,
    readonly kind: OrganelleKind,
  ) {
    super();
    this.addChild(this.g);
  }

  setStruct(s: StructState | null): void {
    this.struct = s;
  }

  /** Health/online → vitality dimming shared by all organelles. */
  protected vitality(): number {
    if (!this.struct) return 1;
    if (this.struct.destroyed) return 0.1;
    const hp = this.struct.healthMax > 0 ? this.struct.health / this.struct.healthMax : 1;
    return (this.struct.online ? 1 : 0.45) * (0.5 + 0.5 * hp);
  }

  /** Rebuild static geometry when the cell is laid out. size = base pixel scale. */
  abstract redraw(size: number): void;

  /**
   * Pointer hit region, refreshed after layout. Default is a disc around the
   * organelle; ring/arc-shaped kinds override so overlapping organelles
   * (ER over nucleus, shield arcs on the membrane) stay individually hoverable.
   */
  refreshHitArea(): void {
    this.hitArea = new Circle(0, 0, this.size * 1.35);
  }

  animate(m: Motion, dt: number): void {
    this.flash = Math.max(0, this.flash - dt * 1.6);
    this.alpha = 0.35 + 0.65 * this.vitality();
    this.tick(m, dt);
    if (this.flash > 0) this.g.tint = 0xff8080;
    else this.g.tint = 0xffffff;
  }

  protected abstract tick(m: Motion, dt: number): void;
}

// ---------------------------------------------------------------------------

/** Command Ship → nucleus with nucleolus + chromatin. */
export class Nucleus extends Organelle {
  redraw(size: number): void {
    this.size = size;
    const g = this.g;
    g.clear();
    g.ellipse(0, 0, size, size * 0.84).fill({ color: PALETTE.nucleus, alpha: 0.96 });
    g.ellipse(0, 0, size, size * 0.84).stroke({ width: size * 0.06, color: PALETTE.nucleusRim, alpha: 0.9 });
    // nuclear pores
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      g.circle(Math.cos(a) * size, Math.sin(a) * size * 0.84, size * 0.028).fill({
        color: PALETTE.nucleusRim,
        alpha: 0.9,
      });
    }
    // chromatin squiggles (the "DNA" of the command ship)
    for (let s = 0; s < 3; s++) {
      const ox = (s - 1) * size * 0.3;
      const oy = (s % 2 === 0 ? -1 : 1) * size * 0.12;
      g.moveTo(ox - size * 0.18, oy);
      g.bezierCurveTo(ox - size * 0.05, oy - size * 0.2, ox + size * 0.05, oy + size * 0.2, ox + size * 0.18, oy);
      g.stroke({ width: size * 0.045, color: PALETTE.chromatin, alpha: 0.8, cap: 'round' });
    }
    g.circle(size * 0.28, size * 0.12, size * 0.2).fill({ color: PALETTE.nucleolus, alpha: 0.95 });
  }

  protected tick(m: Motion): void {
    const s = 1 + 0.012 * Math.sin(m.time * 0.55);
    this.scale.set(s);
    this.rotation = 0.03 * Math.sin(m.time * 0.2);
  }

  /** Tight disc so the surrounding ER ribbons keep their own hover region. */
  refreshHitArea(): void {
    this.hitArea = new Circle(0, 0, this.size * 1.02);
  }
}

/** Reactor / charge → mitochondrion; glow tracks available energy (charge). */
export class Mitochondrion extends Organelle {
  /** 0..1 — set from snapshot charge */
  energy = 0.5;
  private glowG = new Graphics();
  private phase = hash01(this.id) * TAU;

  redraw(size: number): void {
    this.size = size;
    if (!this.glowG.parent) this.addChildAt(this.glowG, 0);
    const g = this.g;
    g.clear();
    g.ellipse(0, 0, size, size * 0.55).fill({ color: PALETTE.mito, alpha: 0.95 });
    g.ellipse(0, 0, size, size * 0.55).stroke({ width: size * 0.07, color: PALETTE.mitoRim, alpha: 0.95 });
    // cristae folds
    for (let i = -2; i <= 2; i++) {
      const x = i * size * 0.32;
      g.moveTo(x, -size * 0.36);
      g.quadraticCurveTo(x + size * 0.16, 0, x, size * 0.36);
      g.stroke({ width: size * 0.055, color: PALETTE.mitoCristae, alpha: 0.85, cap: 'round' });
    }
    this.rotation = (hash01(this.id) - 0.5) * 1.6;
  }

  protected tick(m: Motion): void {
    // heartbeat quickens with energy, fades when the cell is pale
    const rate = 0.8 + this.energy * 1.6;
    const beat = Math.sin(m.time * rate + this.phase);
    this.scale.set(1 + 0.035 * beat * (0.4 + this.energy));
    const glow = clamp01(this.energy) * (0.55 + 0.2 * beat) * (1 - 0.6 * m.pale);
    this.glowG.clear();
    this.glowG.ellipse(0, 0, this.size * 1.45, this.size * 0.95).fill({ color: PALETTE.mitoCristae, alpha: 0.22 * glow });
    this.glowG.ellipse(0, 0, this.size * 1.15, this.size * 0.72).fill({ color: 0xffc98a, alpha: 0.18 * glow });
  }
}

/** Ore Extractor → intake vacuole; pulses while a mine proof is being hashed. */
export class ExtractorVacuole extends Organelle {
  redraw(size: number): void {
    this.size = size;
    const g = this.g;
    g.clear();
    g.circle(0, 0, size).fill({ color: PALETTE.vacuole, alpha: 0.9 });
    g.circle(0, 0, size).stroke({ width: size * 0.09, color: PALETTE.vacuoleRim, alpha: 0.95 });
    // ore chunks settled inside
    const chunks = [
      [-0.3, 0.25, 0.28],
      [0.25, 0.3, 0.22],
      [0.05, -0.2, 0.18],
      [-0.15, -0.05, 0.13],
    ];
    for (const [cx, cy, cr] of chunks) {
      g.circle(cx * size, cy * size, cr * size).fill({ color: PALETTE.ore, alpha: 0.85 });
    }
    // intake mouth notch
    g.arc(0, 0, size * 1.02, -0.5, 0.5).stroke({ width: size * 0.16, color: PALETTE.vacuoleRim, alpha: 0.5 });
  }

  protected tick(m: Motion): void {
    const active = this.struct?.mining ?? false;
    const pulse = active ? 0.05 * Math.sin(m.time * 3.2) : 0.012 * Math.sin(m.time * 0.8);
    this.scale.set(1 + pulse + m.minePulse * 0.09);
  }
}

/** Ore Refinery → endoplasmic reticulum ribbons around the nucleus. */
export class ErRefinery extends Organelle {
  /** nucleus-relative arc geometry; refine particles flow along the mid arc */
  private radii = [1.25, 1.42, 1.6];
  private start = Math.PI * 0.55;
  private span = Math.PI * 0.85;
  private nucleusSize = 60;

  layoutAroundNucleus(nucleusSize: number, index: number): void {
    this.nucleusSize = nucleusSize;
    this.start = Math.PI * 0.55 + index * Math.PI * 0.5;
  }

  /** world-space point along the middle ribbon, s: 0..1 (for flow particles) */
  pathPoint(s: number): { x: number; y: number } {
    const a = this.start + s * this.span;
    const r = this.nucleusSize * this.radii[1];
    return { x: this.x + Math.cos(a) * r, y: this.y + Math.sin(a) * r * 0.92 };
  }

  redraw(size: number): void {
    this.size = size;
    this.drawRibbons(0);
  }

  private drawRibbons(t: number): void {
    const g = this.g;
    const N = this.nucleusSize;
    g.clear();
    this.radii.forEach((rr, i) => {
      const r = N * rr;
      const segs = 26;
      g.moveTo(
        Math.cos(this.start) * r,
        Math.sin(this.start) * r * 0.92,
      );
      for (let sIdx = 1; sIdx <= segs; sIdx++) {
        const a = this.start + (sIdx / segs) * this.span;
        const und = Math.sin(a * 7 + t * 1.4 + i) * N * 0.035;
        g.lineTo(Math.cos(a) * (r + und), Math.sin(a) * (r + und) * 0.92);
      }
      g.stroke({ width: N * 0.075, color: PALETTE.er, alpha: 0.75 - i * 0.12, cap: 'round' });
      // studded ribosomes on the outer ribbon
      if (i === 2) {
        for (let d = 0; d <= 10; d++) {
          const a = this.start + (d / 10) * this.span;
          g.circle(Math.cos(a) * (r + N * 0.055), Math.sin(a) * (r + N * 0.055) * 0.92, N * 0.028).fill({
            color: PALETTE.erDot,
            alpha: 0.9,
          });
        }
      }
    });
  }

  protected tick(m: Motion): void {
    const active = this.struct?.refining ?? false;
    // undulate faster while refining; refinePulse adds a surge
    this.drawRibbons(m.time * (active ? 1.6 : 0.5) + m.refinePulse * 2);
    this.g.alpha = 0.85 + 0.15 * Math.sin(m.time * (active ? 2.2 : 0.6));
  }

  /** Ring band over the ribbons only — the nucleus underneath stays hoverable. */
  refreshHitArea(): void {
    this.hitArea = {
      contains: (x: number, y: number): boolean => {
        const N = this.nucleusSize;
        const r = Math.hypot(x, y / 0.92);
        if (r < N * 1.1 || r > N * 1.78) return false;
        let d = (Math.atan2(y / 0.92, x) - this.start) % TAU;
        if (d < 0) d += TAU;
        return d <= this.span + 0.2 || d >= TAU - 0.2;
      },
    };
  }

  get refining(): boolean {
    return this.struct?.refining ?? false;
  }
}

/** Builders → Golgi stack + ribosome dots; buds a vesicle on build events. */
export class RibosomeGolgi extends Organelle {
  private bud = new Graphics();
  private budT = -1;

  redraw(size: number): void {
    this.size = size;
    if (!this.bud.parent) this.addChild(this.bud);
    const g = this.g;
    g.clear();
    // stacked Golgi cisternae
    for (let i = 0; i < 4; i++) {
      const w = size * (1.5 - i * 0.22);
      const y = (i - 1.5) * size * 0.34;
      g.moveTo(-w / 2, y);
      g.quadraticCurveTo(0, y - size * 0.22, w / 2, y);
      g.stroke({ width: size * 0.14, color: PALETTE.golgi, alpha: 0.85 - i * 0.1, cap: 'round' });
    }
    for (let i = 0; i < 7; i++) {
      const a = hash01(this.id + i) * TAU;
      const r = size * (0.9 + hash01(this.id + 'r' + i) * 0.5);
      g.circle(Math.cos(a) * r, Math.sin(a) * r * 0.7 - size * 0.1, size * 0.07).fill({
        color: PALETTE.erDot,
        alpha: 0.85,
      });
    }
  }

  protected tick(m: Motion, dt: number): void {
    this.scale.set(1 + 0.02 * Math.sin(m.time * 0.9) + m.buildPulse * 0.06);
    if (m.buildPulse > 0.9 && this.budT < 0) this.budT = 0; // start a bud
    this.bud.clear();
    if (this.budT >= 0) {
      this.budT += dt * 0.5;
      if (this.budT >= 1) this.budT = -1;
      else {
        const d = this.budT * this.size * 2.2;
        this.bud
          .circle(d * 0.7, -d, this.size * 0.22 * (1 - this.budT * 0.4))
          .fill({ color: PALETTE.golgi, alpha: 0.8 * (1 - this.budT) });
      }
    }
  }
}

/** Defensive structs → lysosomes that patrol, and mobilize under stress. */
export class Lysosome extends Organelle {
  /** home position set by layout; drifts around it, surges outward on raid */
  home = { x: 0, y: 0 };
  private phase = hash01(this.id) * TAU;

  redraw(size: number): void {
    this.size = size;
    const g = this.g;
    g.clear();
    g.circle(0, 0, size).fill({ color: PALETTE.lysosome, alpha: 0.92 });
    g.circle(0, 0, size).stroke({ width: size * 0.12, color: PALETTE.lysosomeRim, alpha: 0.95 });
    for (let i = 0; i < 4; i++) {
      g.circle((hash01(this.id + i) - 0.5) * size, (hash01(this.id + 'y' + i) - 0.5) * size, size * 0.14).fill({
        color: PALETTE.lysosomeRim,
        alpha: 0.7,
      });
    }
  }

  protected tick(m: Motion): void {
    const drift = this.size * 0.9;
    const px = Math.cos(m.time * 0.4 + this.phase) * drift;
    const py = Math.sin(m.time * 0.31 + this.phase * 2) * drift;
    // mobilize: surge outward toward the membrane when raided
    const surge = 1 + m.stress * 0.28;
    this.position.set(this.home.x * surge + px, this.home.y * surge + py);
    this.scale.set(1 + 0.03 * Math.sin(m.time * 1.3 + this.phase) + m.stress * 0.1);
  }
}

/** Shield generators → glowing reinforcement arcs riding the membrane. */
export class ShieldArc extends Organelle {
  dockAngle = 0;
  private membrane: Membrane | null = null;
  /** latest docked radius (from tick) — drives the pointer hit band */
  private lastR = 0;

  attach(membrane: Membrane, angle: number): void {
    this.membrane = membrane;
    this.dockAngle = angle;
  }

  redraw(size: number): void {
    this.size = size;
  }

  /** Arc band riding the membrane (the container itself never moves). */
  refreshHitArea(): void {
    this.hitArea = {
      contains: (x: number, y: number): boolean => {
        if (this.lastR <= 0) return false;
        if (Math.abs(Math.hypot(x, y) - this.lastR) > this.size * 1.5) return false;
        let d = Math.abs(Math.atan2(y, x) - this.dockAngle) % TAU;
        if (d > Math.PI) d = TAU - d;
        return d <= 0.52;
      },
    };
  }

  protected tick(m: Motion): void {
    if (!this.membrane) return;
    this.lastR = this.membrane.radiusAt(this.dockAngle, m);
    const g = this.g;
    const spread = 0.42;
    const online = this.struct?.online ?? true;
    const alpha = (online ? 0.55 : 0.15) + 0.2 * Math.sin(m.time * 1.7 + this.dockAngle) + m.shieldPulse * 0.3;
    g.clear();
    const segs = 14;
    for (let i = 0; i <= segs; i++) {
      const a = this.dockAngle - spread + (i / segs) * spread * 2;
      const r = this.membrane.radiusAt(a, m) - this.size * 0.1;
      if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.stroke({ width: this.size * 0.5, color: PALETTE.shield, alpha: clamp01(alpha) * 0.7, cap: 'round' });
  }
}

/** Unknown struct types → generic vesicle. */
export class Vesicle extends Organelle {
  redraw(size: number): void {
    this.size = size;
    this.g.clear();
    this.g.circle(0, 0, size).fill({ color: PALETTE.vesicle, alpha: 0.7 });
    this.g.circle(0, 0, size).stroke({ width: size * 0.1, color: PALETTE.vacuoleRim, alpha: 0.6 });
  }

  protected tick(m: Motion): void {
    this.scale.set(1 + 0.02 * Math.sin(m.time + hash01(this.id) * TAU));
  }
}

/** Incoming raid → phages docked on the membrane exterior. */
export class Phage extends Container {
  private g = new Graphics();
  private phase = Math.random() * TAU;
  fade = 0;

  constructor(
    readonly dockAngle: number,
    private membrane: Membrane,
    private size: number,
  ) {
    super();
    this.addChild(this.g);
    const g = this.g;
    const s = size;
    // icosahedral-ish head
    const head: number[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      head.push(Math.cos(a) * s * 0.55, Math.sin(a) * s * 0.55 - s);
    }
    g.poly(head).fill({ color: PALETTE.phage, alpha: 0.95 });
    g.poly(head).stroke({ width: s * 0.08, color: 0x7c2c24 });
    // tail
    g.moveTo(0, -s * 0.45);
    g.lineTo(0, s * 0.15);
    g.stroke({ width: s * 0.14, color: PALETTE.phage, cap: 'round' });
    // legs splayed onto the membrane
    for (const dir of [-1, -0.4, 0.4, 1]) {
      g.moveTo(0, s * 0.05);
      g.quadraticCurveTo(dir * s * 0.5, s * 0.3, dir * s * 0.75, s * 0.62);
      g.stroke({ width: s * 0.08, color: PALETTE.phage, cap: 'round' });
    }
  }

  update(m: Motion, dt: number, dying: boolean): boolean {
    this.fade = clamp01(this.fade + (dying ? -dt * 1.2 : dt * 0.8));
    const r = this.membrane.radiusAt(this.dockAngle, m) + this.size * 0.15;
    const bob = Math.sin(m.time * 2.3 + this.phase) * this.size * 0.1;
    this.position.set(Math.cos(this.dockAngle) * (r + bob), Math.sin(this.dockAngle) * (r + bob));
    this.rotation = this.dockAngle + Math.PI / 2 + Math.sin(m.time * 3 + this.phase) * 0.12;
    this.alpha = this.fade;
    return dying && this.fade <= 0; // true = remove me
  }
}
