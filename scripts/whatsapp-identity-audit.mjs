import 'dotenv/config';
import { LIVE_DEPS } from '../api/_modules/whatsapp-conversations-store.js';
import { auditWhatsappIdentities } from '../api/_modules/whatsapp-identity-audit.js';

const report = await auditWhatsappIdentities(LIVE_DEPS);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
