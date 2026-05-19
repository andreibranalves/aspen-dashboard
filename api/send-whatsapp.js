import { handler } from '../netlify/functions/send-whatsapp.js';
import { wrapNetlifyHandler } from './_lib/netlify-adapter.js';

export default wrapNetlifyHandler(handler);
