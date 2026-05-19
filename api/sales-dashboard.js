import { handler } from '../netlify/functions/sales-dashboard.js';
import { wrapNetlifyHandler } from './_lib/netlify-adapter.js';

export default wrapNetlifyHandler(handler);
