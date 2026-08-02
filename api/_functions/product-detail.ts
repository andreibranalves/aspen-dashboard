import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_lib/types.js';
import { handler as legacyHandler } from './product-detail-legacy.js';
import { handler as coreHandler } from './product-detail-core.js';
import { isProductsCoreEnabled, responseMetadata } from './products-mode.js';

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

export interface ProductDetailHandlerDependencies {
  core?: LegacyHandler;
  legacy?: LegacyHandler;
}

export function createHandler(dependencies: ProductDetailHandlerDependencies = {}): LegacyHandler {
  const selectedCore = dependencies.core || coreHandler;
  const selectedLegacy = dependencies.legacy || legacyHandler;
  return async (event: FunctionEvent): Promise<FunctionResult> => {
    if (isProductsCoreEnabled()) return selectedCore(event);
    return annotate(await selectedLegacy(event));
  };
}

export const handler = createHandler();
