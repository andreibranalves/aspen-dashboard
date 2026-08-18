import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { handler as coreHandler } from './product-detail-core.js';

type Handler = (event: FunctionEvent) => Promise<FunctionResult>;

export interface ProductDetailHandlerDependencies {
  core?: Handler;
}

export function createHandler(dependencies: ProductDetailHandlerDependencies = {}): Handler {
  return dependencies.core || coreHandler;
}

export const handler = createHandler();
