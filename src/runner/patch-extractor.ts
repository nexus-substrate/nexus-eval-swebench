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

/**
 * Upper bound (chars) on a model response we will run the diff regexes over.
 * The input is UNTRUSTED model output; bounding it before the regex sink caps
 * worst-case matching time and is a defence-in-depth guard against
 * polynomial-backtracking ReDoS (CodeQL js/polynomial-redos). A real
 * unified-diff patch for a SWE-bench instance is well under this size.
 */
const MAX_RESPONSE_CHARS = 512 * 1024;

const FENCED_DIFF_RE = /```(?:diff|patch)\n([\s\S]*?)```/;
// Match the `---`/`+++` file-header pair that opens a bare unified diff, then
// capture the remainder of the input. The header tokens use restricted classes
// (`[^\n]*` / `[ \t]+`) that cannot overlap the surrounding `[\s\S]` runs, so
// there is no ambiguous quantifier nesting and matching stays linear.
const BARE_DIFF_RE = /(?:^|\n)(---[ \t]+\S[^\n]*\n\+\+\+[ \t]+\S[^\n]*(?:\n[\s\S]*)?)/;

export function extractPatch(response: string): string {
  // Bound untrusted input length before any regex runs (ReDoS guard).
  const input =
    response.length > MAX_RESPONSE_CHARS
      ? response.slice(0, MAX_RESPONSE_CHARS)
      : response;
  const fenced = FENCED_DIFF_RE.exec(input);
  if (fenced !== null && fenced[1] !== undefined) {
    return normalise(fenced[1]);
  }
  const bare = BARE_DIFF_RE.exec(input);
  if (bare !== null && bare[1] !== undefined) {
    return normalise(bare[1]);
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
