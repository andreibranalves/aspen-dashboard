import { handler } from '../netlify/functions/product-pricing-update.js';
import { wrapNetlifyHandler } from './_lib/netlify-adapter.js';

export default wrapNetlifyHandler(handler);
