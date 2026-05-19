import { handler } from '../netlify/functions/orcamento.js';
import { wrapNetlifyHandler } from './_lib/netlify-adapter.js';

export default wrapNetlifyHandler(handler);
