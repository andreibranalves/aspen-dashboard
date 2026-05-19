import { handler } from '../netlify/functions/leads-clients.js';
import { wrapNetlifyHandler } from './_lib/netlify-adapter.js';

export default wrapNetlifyHandler(handler);
