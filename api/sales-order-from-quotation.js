import { handler } from '../netlify/functions/sales-order-from-quotation.js';
import { wrapNetlifyHandler } from './_lib/netlify-adapter.js';

export default wrapNetlifyHandler(handler);
