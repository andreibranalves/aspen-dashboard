/** Stable named core module for unit tests and the PostgreSQL client API. */
export {
  createCoreHandler,
  type LeadsClientsHandlerDependencies,
} from './leads-clients.js';

import { createCoreHandler } from './leads-clients.js';
export const handler = createCoreHandler();
