import { handler } from '../netlify/functions/pricing-lookup.js';
import { wrapNetlifyHandler } from './_lib/netlify-adapter.js';

export default wrapNetlifyHandler(handler);
