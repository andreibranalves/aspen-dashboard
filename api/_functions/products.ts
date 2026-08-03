import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_lib/types.js';
import { handler as legacyHandler } from './products-legacy.js';
import { handler as coreHandler } from './products-core.js';
import { isProductsCoreEnabled, responseMetadata } from './products-mode.js';
import { isCoreQuotesEnabled } from './orcamento-mode.js';

function annotate(result: FunctionResult): FunctionResult {
  if (!result.body) return result;
  try {
    const payload = JSON.parse(result.body) as unknown;
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return result;
    return { ...result, body: JSON.stringify({ ...(payload as Record<string, unknown>), ...responseMetadata('legacy') }) };
  } catch {
    return result;
  }
}

/** Feature-flagged boundary. A core error is returned as-is; it never falls back to Frappe. */
export interface ProductsHandlerDependencies {
  core?: LegacyHandler;
  legacy?: LegacyHandler;
}

export function createHandler(dependencies: ProductsHandlerDependencies = {}): LegacyHandler {
  const selectedCore = dependencies.core || coreHandler;
  const selectedLegacy = dependencies.legacy || legacyHandler;
  return async (event: FunctionEvent): Promise<FunctionResult> => {
    const productsCoreEnabled = isProductsCoreEnabled();
    const quotesCoreEnabled = isCoreQuotesEnabled();
    // Quote editing searches the PostgreSQL catalog. During the quote
    // rollout only GET is promoted; product writes remain controlled by the
    // products flag until that surface is explicitly enabled.
    const useCore = productsCoreEnabled || (quotesCoreEnabled && event.httpMethod === 'GET');
    if (useCore) return selectedCore(event);
    return annotate(await selectedLegacy(event));
  };
}

export const handler = createHandler();
