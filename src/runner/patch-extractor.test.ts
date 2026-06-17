/**
 * Tests for the unified-diff patch extractor.
 *
 * The extractor parses UNTRUSTED model output, so alongside functional
 * coverage we assert bounded-time behaviour on an adversarial ~200k-char
 * input to guard against polynomial-backtracking ReDoS
 * (CodeQL js/polynomial-redos).
 */
import { describe, it, expect } from 'vitest';
import { extractPatch } from './patch-extractor.js';

describe('extractPatch — functional', () => {
  it('extracts a fenced ```diff block', () => {
    const response = [
      'Here is the fix:',
      '```diff',
      '--- a/foo.py',
      '+++ b/foo.py',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '```',
      'Done.',
    ].join('\n');
    expect(extractPatch(response)).toBe(
      '--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-old\n+new\n'
    );
  });

  it('extracts a fenced ```patch block', () => {
    const response = '```patch\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n```';
    expect(extractPatch(response)).toBe('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n');
  });

  it('extracts a bare unified diff that opens the response', () => {
    const response = '--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-old\n+new\n';
    expect(extractPatch(response)).toBe(response);
  });

  it('extracts a bare unified diff preceded by prose', () => {
    const response =
      'Sure, apply this:\n--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-old\n+new';
    expect(extractPatch(response)).toBe(
      '--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-old\n+new\n'
    );
  });

  it('returns empty string when no patch is present', () => {
    expect(extractPatch('I could not find a fix.')).toBe('');
    expect(extractPatch('')).toBe('');
  });
});

describe('extractPatch — ReDoS resistance (untrusted input)', () => {
  it('completes in bounded time on a ~200k-char adversarial input', () => {
    // Adversarial shapes that target the diff-header quantifiers: a long run
    // of whitespace after a `---` token, and a long repetition of partial
    // header prefixes. Either pattern could trigger super-linear backtracking
    // in a vulnerable regex.
    const cases = [
      '--- ' + ' '.repeat(200_000),
      '--- a\n'.repeat(40_000),
      '--- a/x\n+++ ' + 'b'.repeat(200_000),
      '```diff\n' + '-'.repeat(200_000),
    ];
    for (const input of cases) {
      expect(input.length).toBeGreaterThan(190_000);
      const start = performance.now();
      extractPatch(input);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(250);
    }
  });

  it('still extracts a real patch buried after large untrusted prose', () => {
    const noise = 'x'.repeat(100_000);
    const response = `${noise}\n--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-old\n+new\n`;
    expect(extractPatch(response)).toBe(
      '--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-old\n+new\n'
    );
  });
});
