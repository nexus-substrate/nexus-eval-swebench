/**
 * Extract a unified-diff patch from a model response.
 *
 * Handles the common shapes:
 *   1. Fenced ` ```diff ` / ` ```patch ` block (preferred)
 *   2. Bare unified diff (starts with `---` / `+++` headers)
 *   3. Empty / no-patch responses → empty string
 *
 * @module runner/patch-extractor
 */

const FENCED_DIFF_RE = /```(?:diff|patch)\n([\s\S]*?)```/;
const BARE_DIFF_RE = /(^|\n)(---\s+\S[\s\S]*?\n\+\+\+\s+\S[\s\S]*)/;

export function extractPatch(response: string): string {
  const fenced = FENCED_DIFF_RE.exec(response);
  if (fenced !== null && fenced[1] !== undefined) {
    return normalise(fenced[1]);
  }
  const bare = BARE_DIFF_RE.exec(response);
  if (bare !== null && bare[2] !== undefined) {
    return normalise(bare[2]);
  }
  return '';
}

/**
 * Normalise a patch string for harness consumption: trim trailing whitespace
 * per line, ensure exactly one trailing newline, drop leading blank lines.
 */
function normalise(patch: string): string {
  const trimmed = patch
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/^\n+/, '');
  return trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`;
}
