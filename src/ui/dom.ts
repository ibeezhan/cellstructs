/** Tiny DOM helpers shared by the overlay UI. */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/** Minimal HTML escape for text interpolated into overlay templates. */
export const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ESCAPES[c]);

/**
 * HP as a 6-segment ring (inline SVG) — the standard HP mark wherever HP
 * text shows. Lit segments round to the health fraction, but a damaged
 * struct never shows a full ring and a living one never shows an empty one.
 */
export function hpRing(health: number, max: number, size = 13): string {
  const SEGMENTS = 6;
  const frac = max > 0 ? Math.max(0, Math.min(1, health / max)) : 0;
  let lit = Math.round(frac * SEGMENTS);
  if (health > 0 && lit === 0) lit = 1;
  if (health < max && lit === SEGMENTS) lit = SEGMENTS - 1;
  const color = frac > 0.5 ? '#6fdc9a' : frac > 0.2 ? '#e0a458' : '#e0604a';
  const stroke = size * 0.2;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const gap = (14 * Math.PI) / 180;
  const seg = (Math.PI * 2) / SEGMENTS;
  let paths = '';
  for (let i = 0; i < SEGMENTS; i++) {
    const a0 = -Math.PI / 2 + i * seg + gap / 2;
    const a1 = -Math.PI / 2 + (i + 1) * seg - gap / 2;
    const p = (a: number): string => `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`;
    paths +=
      `<path d="M ${p(a0)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${p(a1)}" ` +
      `stroke="${i < lit ? color : '#2c463f'}" stroke-width="${stroke.toFixed(2)}" fill="none" stroke-linecap="round"/>`;
  }
  return (
    `<svg class="hp-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" ` +
    `role="img" aria-label="HP ${health}/${max}">${paths}</svg>`
  );
}
