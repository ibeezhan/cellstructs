/**
 * Cytoskeleton + ribosome speckle field — the fine interior structure that
 * reads as "real cell" in the reference microscopy art (docs/assets):
 * pale filaments webbing out from the nuclear region to the membrane, with
 * free ribosomes dusted through the cytoplasm.
 *
 * Geometry is generated once per layout (it is the expensive part) and only
 * its alpha/scale breathe per frame, so the detail costs no per-frame paths.
 */

import { Container, Graphics } from 'pixi.js';
import { hash01, Motion, PALETTE, TAU } from './util';

const FILAMENTS = 34;
const SPECKLES = 150;

export class Cytoskeleton extends Container {
  private filamentG = new Graphics();
  private speckleG = new Graphics();
  private radius = 200;

  constructor() {
    super();
    this.addChild(this.filamentG, this.speckleG);
  }

  /** Rebuild the network for a new cell radius (layout-time only). */
  rebuild(R: number): void {
    this.radius = R;
    const f = this.filamentG;
    f.clear();
    for (let i = 0; i < FILAMENTS; i++) {
      const a0 = (i / FILAMENTS) * TAU + (hash01(`fil-a${i}`) - 0.5) * 0.4;
      // each filament runs from just outside the nuclear envelope to the cortex
      const r0 = R * (0.3 + hash01(`fil-r${i}`) * 0.12);
      const r1 = R * (0.82 + hash01(`fil-e${i}`) * 0.13);
      const bend = (hash01(`fil-b${i}`) - 0.5) * 0.9;
      const steps = 7;
      f.moveTo(Math.cos(a0) * r0, Math.sin(a0) * r0);
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        // bow the strand sideways so the web looks woven, not radial
        const a = a0 + bend * Math.sin(t * Math.PI) * 0.55;
        const r = r0 + (r1 - r0) * t;
        f.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      f.stroke({
        width: R * (0.0035 + hash01(`fil-w${i}`) * 0.003),
        color: PALETTE.filament,
        alpha: 0.16 + hash01(`fil-al${i}`) * 0.14,
        cap: 'round',
      });
      // junction nodes where strands cross the cortex
      f.circle(Math.cos(a0 + bend * 0.3) * r1, Math.sin(a0 + bend * 0.3) * r1, R * 0.006).fill({
        color: PALETTE.filament,
        alpha: 0.3,
      });
    }

    const sp = this.speckleG;
    sp.clear();
    for (let i = 0; i < SPECKLES; i++) {
      // uniform-ish disc sampling, biased away from the nuclear footprint
      const a = hash01(`spk-a${i}`) * TAU;
      const r = R * (0.22 + Math.sqrt(hash01(`spk-r${i}`)) * 0.72);
      const size = R * (0.0025 + hash01(`spk-s${i}`) * 0.0045);
      sp.circle(Math.cos(a) * r, Math.sin(a) * r, size).fill({
        color: hash01(`spk-c${i}`) > 0.6 ? PALETTE.erDot : PALETTE.ribosome,
        alpha: 0.35 + hash01(`spk-al${i}`) * 0.35,
      });
    }
  }

  /** Per-frame: only cheap transform/alpha work — the network shimmers. */
  update(m: Motion): void {
    const breath = 1 + 0.008 * Math.sin(m.time * 0.7);
    this.scale.set(breath);
    this.rotation = 0.02 * Math.sin(m.time * 0.11);
    // filaments tense up (brighter) under raid stress, fade when the cell pales
    this.filamentG.alpha = (0.75 + 0.3 * m.stress) * (1 - 0.45 * m.pale);
    this.speckleG.alpha = (0.8 + 0.1 * Math.sin(m.time * 0.5)) * (1 - 0.35 * m.pale);
  }

  get cellRadius(): number {
    return this.radius;
  }
}
