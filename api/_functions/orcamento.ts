import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import { createCoreHandler } from './orcamento-core.js';

type Handler = (event: FunctionEvent) => Promise<FunctionResult>;

export interface OrcamentoHandlerDependencies {
  core?: Handler;
}

export function createHandler(dependencies: OrcamentoHandlerDependencies = {}): Handler {
  return dependencies.core || createCoreHandler();
}

export const handler = createHandler();
