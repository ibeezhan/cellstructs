/** Tiny DOM helpers shared by the overlay UI. */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/** Minimal HTML escape for text interpolated into overlay templates. */
export const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ESCAPES[c]);
