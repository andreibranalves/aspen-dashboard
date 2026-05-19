import { handler } from '../netlify/functions/edit-draft.js';
import { wrapNetlifyHandler } from './_lib/netlify-adapter.js';

export default wrapNetlifyHandler(handler);
