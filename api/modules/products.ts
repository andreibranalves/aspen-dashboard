import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { handler as coreHandler } from './products-core.js';

type Handler = (event: FunctionEvent) => Promise<FunctionResult>;

export interface ProductsHandlerDependencies {
  core?: Handler;
}

export function createHandler(dependencies: ProductsHandlerDependencies = {}): Handler {
  return dependencies.core || coreHandler;
}

export const handler = createHandler();
