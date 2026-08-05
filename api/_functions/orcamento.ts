import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_lib/types.js';
import { createCoreHandler } from './orcamento-core.js';
import { resolveEffectiveRolloutState } from './orcamento-mode.js';
import { handler as legacyHandler } from './orcamento-legacy.js';

export interface OrcamentoHandlerDependencies {
  core?: LegacyHandler;
  legacy?: LegacyHandler;
}

/** Injectable rollout boundary. Core errors are returned directly and never
 * fall back to Frappe. The effective rollout state selects the dispatch path:
 * - postgres-write: core handler (create via PostgreSQL)
 * - postgres-read-only: core handler (no POST, returns 405)
 * - rollback-compatible: legacy handler (writes always to Frappe)
 * - legacy: legacy handler (Frappe pipeline)
 */
export function createHandler(
  dependencies: OrcamentoHandlerDependencies = {},
): LegacyHandler {
  const core = dependencies.core || createCoreHandler();
  const legacy = dependencies.legacy || legacyHandler;
  return async (event: FunctionEvent): Promise<FunctionResult> => {
    const state = resolveEffectiveRolloutState();
    if (state === 'postgres-write') return core(event);
    return legacy(event);
  };
}

export const handler = createHandler();
