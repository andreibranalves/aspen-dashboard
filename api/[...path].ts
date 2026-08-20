import { handleApiRequest } from './_app/handle-request.js';
import { createVercelHandler } from './_http/vercel-adapter.js';

export default createVercelHandler(handleApiRequest);
