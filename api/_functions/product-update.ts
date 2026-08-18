import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { handler as coreHandler } from './product-update-core.js';

type Handler = (event: FunctionEvent) => Promise<FunctionResult>;

export interface ProductUpdateHandlerDependencies {
  core?: Handler;
}

export function createHandler(dependencies: ProductUpdateHandlerDependencies = {}): Handler {
  return dependencies.core || coreHandler;
}

export const handler = createHandler();
