export const TAU = Math.PI * 2;

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Exponential approach — frame-rate independent smoothing. */
export const approach = (current: number, target: number, rate: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-rate * dt));

export function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  return (
    (Math.round(lerp(ar, br, t)) << 16) |
    (Math.round(lerp(ag, bg, t)) << 8) |
    Math.round(lerp(ab, bb, t))
  );
}

/** Deterministic 0..1 hash from a string — stable organelle placement. */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Microscopy palette. */
export const PALETTE = {
  background: 0x05090d,
  cytoplasm: 0x102830,
  cytoplasmStressed: 0x2a1a20,
  cytoInner: 0x16333a,
  membraneOuter: 0x6fae9c,
  membraneInner: 0xa8d8c6,
  membraneStressed: 0xc65a4a,
  nucleus: 0x16323e,
  nucleusRim: 0x2c5568,
  nucleolus: 0x0d2029,
  chromatin: 0x3e6a80,
  mito: 0xa3603a,
  mitoRim: 0x7c4527,
  mitoCristae: 0xd98d58,
  er: 0x5f87ad,
  erDot: 0x8fb3d4,
  golgi: 0x7d6aa8,
  vacuole: 0x3b4a52,
  vacuoleRim: 0x5d7684,
  ore: 0xc9a15a,
  alphaSpark: 0x9fe6c8,
  lysosome: 0x8e4f74,
  lysosomeRim: 0xb06a8f,
  vesicle: 0x4a5d66,
  shield: 0x79d2e6,
  phage: 0xd05548,
  dust: 0x2e4a52,
} as const;

/** Aggregate motion state driving the whole cell (spec §7 motion language). */
export interface Motion {
  /** cell-local time in seconds (slows when the cell is low on charge) */
  time: number;
  /** 0 vivid … 1 pale (low charge) */
  pale: number;
  /** 0 calm … 1 raid inbound */
  stress: number;
  mining: boolean;
  refining: boolean;
  /** transient pulses, decay toward 0 */
  minePulse: number;
  refinePulse: number;
  buildPulse: number;
  shieldPulse: number;
}
