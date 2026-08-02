import { clients } from './schema.js';

export { clients } from './schema.js';

// Singular aliases keep the module convenient for callers that refer to the
// domain entity rather than the SQL table name.
export const client = clients;
export const appClients = clients;

export {
  ADDRESS_LIMITS,
  CLIENT_DOCUMENT_LENGTHS,
  CLIENT_EMAIL_MAX_LENGTH,
  CLIENT_NAME_MAX_LENGTH,
  CLIENT_NOTES_MAX_LENGTH,
  CLIENT_PHONE_MAX_LENGTH,
  CLIENT_PHONE_MIN_LENGTH,
  normalizeClientAddress,
  normalizeClientAddressPatch,
  normalizeClientDocument,
  normalizeClientEmail,
  normalizeClientName,
  normalizeClientNotes,
  normalizeClientPhone,
} from '../_functions/client-schema.js';

export type ClientRow = typeof clients.$inferSelect;
export type ClientInsert = typeof clients.$inferInsert;
