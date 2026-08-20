import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { handler as coreHandler } from './quotations-core.js';

type Handler = (event: FunctionEvent) => Promise<FunctionResult>;

export interface QuotationsHandlerDependencies {
  core?: Handler;
}

export function createHandler(dependencies: QuotationsHandlerDependencies = {}): Handler {
  return dependencies.core || coreHandler;
}

export const handler = createHandler();
