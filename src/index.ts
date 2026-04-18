/**
 * Library entry point. Exposes the adapter + types so other projects can
 * compose the SWE-bench harness into their own workflows (e.g., a
 * dashboard that runs multiple benchmarks).
 *
 * @module index
 */

export {
  SweBenchAdapter,
  type SweBenchAdapterConfig,
  type SweBenchAdapterEvalResult,
  type SweBenchInstance,
  type SweBenchPrediction,
} from './adapter.js';
