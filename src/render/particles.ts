/**
 * Lightweight particle system: ore intake (mine), ER flow + alpha sparks
 * (refine), all drawn into a single Graphics per frame.
 */

import { Graphics } from 'pixi.js';
import { PALETTE } from './util';

type Vec = { x: number; y: number };

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: number;
  /** homing target (ore intake) */
  target?: Vec;
  /** parametric path (ER flow); s advances 0→1 */
  path?: (s: number) => Vec;
  s?: number;
  speed?: number;
  onDone?: (p: Particle) => void;
}

const MAX_PARTICLES = 400;

export class ParticleSystem {
  readonly g = new Graphics();
  private particles: Particle[] = [];

  /** Ore chunks drifting from the membrane into the extractor vacuole. */
  spawnOreIntake(from: Vec, to: Vec, count = 6): void {
    for (let i = 0; i < count; i++) {
      this.push({
        x: from.x + (Math.random() - 0.5) * 18,
        y: from.y + (Math.random() - 0.5) * 18,
        vx: 0,
        vy: 0,
        life: 4,
        maxLife: 4,
        size: 2 + Math.random() * 2.5,
        color: PALETTE.ore,
        target: to,
      });
    }
  }

  /** Alpha (ATP) sparks bursting outward. */
  spawnAlphaSparks(at: Vec, count = 8): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 12 + Math.random() * 26;
      this.push({
        x: at.x,
        y: at.y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 1.4,
        maxLife: 1.4,
        size: 1.5 + Math.random() * 1.5,
        color: PALETTE.alphaSpark,
      });
    }
  }

  /** A particle flowing along the ER; emits an alpha spark when it arrives. */
  spawnRefineFlow(path: (s: number) => Vec, onArrive?: (end: Vec) => void): void {
    this.push({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 10,
      maxLife: 10,
      size: 2.2,
      color: PALETTE.alphaSpark,
      path,
      s: 0,
      speed: 0.22 + Math.random() * 0.1,
      onDone: (p) => onArrive?.({ x: p.x, y: p.y }),
    });
  }

  private push(p: Particle): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  update(dt: number): void {
    const alive: Particle[] = [];
    this.g.clear();
    for (const p of this.particles) {
      p.life -= dt;
      let done = p.life <= 0;
      if (p.path && p.s !== undefined) {
        p.s += (p.speed ?? 0.2) * dt;
        if (p.s >= 1) {
          p.s = 1;
          done = true;
        }
        const pos = p.path(p.s);
        p.x = pos.x;
        p.y = pos.y;
      } else if (p.target) {
        const dx = p.target.x - p.x;
        const dy = p.target.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d < 6) done = true;
        const pull = 55 / Math.max(d, 12);
        p.vx += dx * pull * dt;
        p.vy += dy * pull * dt;
        p.vx *= 0.96;
        p.vy *= 0.96;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      } else {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.97;
        p.vy *= 0.97;
      }
      if (done) {
        p.onDone?.(p);
        continue;
      }
      const fade = Math.min(1, p.life / (p.maxLife * 0.4));
      this.g.circle(p.x, p.y, p.size).fill({ color: p.color, alpha: 0.85 * fade });
      alive.push(p);
    }
    this.particles = alive;
  }
}
