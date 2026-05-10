/**
 * Public types for the SWE-bench harness.
 *
 * Mirrors the published `princeton-nlp/SWE-bench*` HuggingFace dataset
 * row shape, normalised into camelCase. The original (snake_case) shape
 * comes from upstream and is preserved for serialisation back to the
 * standard prediction format.
 *
 * @module types
 */

export type SweBenchVariant = 'lite' | 'verified' | 'full';

/**
 * One SWE-bench instance. Shape from princeton-nlp/SWE-bench HF dataset.
 *
 * Note the camelCase canonical form here. The serialised dataset uses
 * snake_case (`instance_id`, `problem_statement`, `base_commit`, …);
 * the loader normalises into this shape, and the prediction writer
 * de-normalises back to snake_case for harness consumption.
 */
export interface SweBenchInstance {
  /** Stable identifier — `<repo>-<issue>` shape, e.g. `astropy__astropy-12907`. */
  readonly instanceId: string;
  /** GitHub repo slug, e.g. `astropy/astropy`. */
  readonly repo: string;
  /** Commit hash to start from. */
  readonly baseCommit: string;
  /** Natural-language problem statement (issue body). */
  readonly problemStatement: string;
  /** Test patch the harness will run against the candidate patch. */
  readonly testPatch: string;
  /** Reference fix (ground truth). */
  readonly patch: string;
  /** Optional hints text bundled with the dataset. */
  readonly hintsText?: string;
  /** Version of the dataset row. */
  readonly version?: string;
  /** Repo-level Python/Node version (when the dataset records it). */
  readonly environmentSetupCommit?: string;
  /** Test names that PASS_TO_PASS / FAIL_TO_PASS in the harness eval. */
  readonly passToPass?: readonly string[];
  readonly failToPass?: readonly string[];
}

/**
 * A SWE-bench prediction. Matches the standard predictions-file shape
 * the upstream harness consumes (snake_case fields).
 */
export interface SweBenchPrediction {
  readonly instance_id: string;
  readonly model_name_or_path: string;
  readonly model_patch: string;
}

/**
 * Verdict shape for one run.
 *
 * MVP scope: `generationCompleted` reflects whether the model produced a
 * non-empty patch. Real test-based pass/fail requires running the SWE-bench
 * Docker harness against the predictions file — out-of-scope for v0.2; see
 * the README for the harness command line.
 */
export interface SweBenchEvalResult {
  readonly instanceId: string;
  readonly generationCompleted: boolean;
  readonly prediction: SweBenchPrediction;
  readonly error?: string;
  readonly durationMs: number;
}

/**
 * Configuration for SweBenchAdapter.
 */
export interface SweBenchAdapterConfig {
  /** Dataset variant. Default: 'lite'. */
  readonly variant?: SweBenchVariant;
  /**
   * Where to load the dataset from:
   *   - 'huggingface' (default): fetch via HF Hub
   *   - absolute path to a `.jsonl` file: load from disk
   */
  readonly dataset?: 'huggingface' | string;
  /** Local cache directory. Default: `~/.nexus-eval-swebench/cache/`. */
  readonly cacheDir?: string;
}
