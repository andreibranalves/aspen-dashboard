import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_lib/types.js';
import { createCoreHandler } from './orcamento-core.js';
import { isCoreQuotesEnabled } from './orcamento-mode.js';
import { handler as legacyHandler } from './orcamento-legacy.js';

export interface OrcamentoHandlerDependencies {
  core?: LegacyHandler;
  legacy?: LegacyHandler;
}

/** Injectable rollout boundary. Core errors are returned directly and never
 * fall back to Frappe; only the exact feature flag selects core mode. */
export function createHandler(
  dependencies: OrcamentoHandlerDependencies = {},
): LegacyHandler {
  const core = dependencies.core || createCoreHandler();
  const legacy = dependencies.legacy || legacyHandler;
  return async (event: FunctionEvent): Promise<FunctionResult> => {
    if (isCoreQuotesEnabled()) return core(event);
    return legacy(event);
  };
}

export const handler = createHandler();
