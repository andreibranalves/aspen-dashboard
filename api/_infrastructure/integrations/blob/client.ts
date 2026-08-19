import { del as blobDelete, head as blobHead } from '@vercel/blob';
import { handleUpload as blobHandleUpload } from '@vercel/blob/client';

export interface BlobClient {
  head: typeof blobHead;
  del: typeof blobDelete;
  handleUpload: typeof blobHandleUpload;
}

export function getBlobClient(overrides: Partial<BlobClient> = {}): BlobClient {
  return {
    head: overrides.head || blobHead,
    del: overrides.del || blobDelete,
    handleUpload: overrides.handleUpload || blobHandleUpload,
  };
}
