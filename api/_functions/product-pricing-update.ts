import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import {
  createCoreHandler as createPricingCoreHandler,
  type ProductPricingCoreDependencies,
} from './product-pricing.js';

type Handler = (event: FunctionEvent) => Promise<FunctionResult>;

export function createCoreHandler(
  dependencies?: ProductPricingCoreDependencies,
): Handler {
  return createPricingCoreHandler(dependencies);
}

export const coreHandler = createCoreHandler();

export interface ProductPricingUpdateHandlerDependencies {
  core?: Handler;
}

export function createHandler(dependencies: ProductPricingUpdateHandlerDependencies = {}): Handler {
  return dependencies.core || coreHandler;
}

export const handler = createHandler();
