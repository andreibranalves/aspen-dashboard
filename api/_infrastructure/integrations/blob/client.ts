import { del as blobDelete, head as blobHead } from '@vercel/blob';
import { handleUpload as blobHandleUpload } from '@vercel/blob/client';
import { assertExternalWritesAllowed } from '../../../_shared/external-writes.js';

export type { HeadBlobResult } from '@vercel/blob';

export interface BlobClient {
  head: typeof blobHead;
  del: typeof blobDelete;
  handleUpload: typeof blobHandleUpload;
}

export function getBlobClient(
  overrides: Partial<BlobClient> = {},
  env: typeof process.env = process.env,
): BlobClient {
  return {
    head: overrides.head || blobHead,
    del: async (...args) => {
      assertExternalWritesAllowed('blob', env);
      return (overrides.del || blobDelete)(...args);
    },
    handleUpload: async (...args) => {
      assertExternalWritesAllowed('blob', env);
      return (overrides.handleUpload || blobHandleUpload)(...args);
    },
  };
}
