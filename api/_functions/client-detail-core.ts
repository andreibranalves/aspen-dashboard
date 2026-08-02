/** Stable named core module for unit tests and the PostgreSQL client API. */
export {
  createCoreHandler,
  type ClientDetailHandlerDependencies,
} from './client-detail.js';

import { createCoreHandler } from './client-detail.js';
export const handler = createCoreHandler();
