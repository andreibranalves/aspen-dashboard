import { handler } from '../netlify/functions/crm-update-deal.js';
import { wrapNetlifyHandler } from './_lib/netlify-adapter.js';

export default wrapNetlifyHandler(handler);
