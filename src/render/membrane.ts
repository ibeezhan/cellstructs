/**
 * The cell membrane: a deformable blob whose outline is displaced by simplex
 * noise, breathing slowly when idle and jittering/reddening under raid stress
 * (spec §3, §7). Also renders the cytoplasm fill and drifting inner blobs.
 */

import { Container, Graphics } from 'pixi.js';
import { createNoise2D } from 'simplex-noise';
import { clamp01, lerpColor, Motion, PALETTE, TAU } from './util';

const POINTS = 72;
const DRIFT_BLOBS = 22;

export class Membrane extends Container {
  private fillG = new Graphics();
  private driftG = new Graphics();
  private strokeG = new Graphics();
  private glowG = new Graphics();
  private noise = createNoise2D();
  private baseRadius = 200;
  /** planetary shield strength, 0..1 normalized */
  shieldGlow = 0;

  constructor() {
    super();
    this.addChild(this.glowG, this.fillG, this.driftG, this.strokeG);
  }

  setRadius(r: number): void {
    this.baseRadius = r;
  }

  get radius(): number {
    return this.baseRadius;
  }

  /** Current deformed radius at a given angle — used to dock phages/shields. */
  radiusAt(angle: number, m: Motion): number {
    const R = this.baseRadius;
    const breath = 1 + 0.02 * Math.sin(m.time * 0.7) * (1 - 0.5 * m.pale);
    const wobble =
      this.noise(Math.cos(angle) * 1.25 + m.time * 0.07, Math.sin(angle) * 1.25 - m.time * 0.05) *
      R *
      0.05;
    const jitter = this.noise(angle * 3.1, m.time * 1.9) * R * 0.022 * m.stress;
    return R * breath + wobble + jitter;
  }

  /** Trace the deformed outline as an explicitly closed path (open polygon
   *  strokes leave a visible seam notch at angle 0). */
  private tracePath(g: Graphics, m: Motion, offset = 0): void {
    for (let i = 0; i < POINTS; i++) {
      const a = (i / POINTS) * TAU;
      const r = this.radiusAt(a, m) + offset;
      if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
  }

  update(m: Motion): void {

    const cyto = lerpColor(PALETTE.cytoplasm, PALETTE.cytoplasmStressed, m.stress * 0.8);
    const memb = lerpColor(PALETTE.membraneOuter, PALETTE.membraneStressed, m.stress);
    const membIn = lerpColor(PALETTE.membraneInner, PALETTE.membraneStressed, m.stress * 0.7);
    const R = this.baseRadius;

    this.fillG.clear();
    this.tracePath(this.fillG, m);
    this.fillG.fill({ color: cyto, alpha: 0.94 });
    // soft inner-glow disc gives the cytoplasm some depth
    this.fillG.circle(0, 0, R * 0.62).fill({ color: PALETTE.cytoInner, alpha: 0.35 });
    this.fillG.circle(-R * 0.18, -R * 0.15, R * 0.4).fill({ color: PALETTE.cytoInner, alpha: 0.22 });

    // lipid bilayer: wide dark stroke + thin light core
    this.strokeG.clear();
    this.tracePath(this.strokeG, m);
    this.strokeG.stroke({ width: R * 0.036, color: memb, alpha: 0.95, join: 'round' });
    this.tracePath(this.strokeG, m);
    this.strokeG.stroke({ width: R * 0.012, color: membIn, alpha: 0.8, join: 'round' });

    // planetary shield halo + transient shimmer on shield_change events
    const glowAlpha = clamp01(this.shieldGlow) * 0.35 + m.shieldPulse * 0.3;
    this.glowG.clear();
    if (glowAlpha > 0.01) {
      this.tracePath(this.glowG, m, R * 0.055);
      this.glowG.stroke({ width: R * 0.05, color: PALETTE.shield, alpha: glowAlpha });
    }

    // cytoplasm drift: translucent blobs slowly orbiting inside (idle motion)
    this.driftG.clear();
    for (let i = 0; i < DRIFT_BLOBS; i++) {
      const seed = i * 37.7;
      const orbit = 0.18 + ((i * 611) % 100) / 100 * 0.55;
      const speed = 0.02 + ((i * 271) % 100) / 100 * 0.03;
      const a = seed + m.time * speed * (i % 2 === 0 ? 1 : -1);
      const x = Math.cos(a) * R * orbit;
      const y = Math.sin(a + seed) * R * orbit * 0.9;
      const size = R * (0.015 + ((i * 131) % 100) / 100 * 0.03);
      this.driftG.circle(x, y, size).fill({ color: PALETTE.cytoInner, alpha: 0.28 });
    }
  }
}
