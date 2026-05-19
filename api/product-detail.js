import { handler } from '../netlify/functions/product-detail.js';
import { wrapNetlifyHandler } from './_lib/netlify-adapter.js';

export default wrapNetlifyHandler(handler);
