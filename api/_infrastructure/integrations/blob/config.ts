export interface BlobConfig {
  token?: string;
  storeId?: string;
}

type Environment = typeof process.env;

export function getBlobConfig(env: Environment = process.env): BlobConfig {
  return {
    token: env.BLOB_READ_WRITE_TOKEN?.trim() || undefined,
    storeId: env.BLOB_STORE_ID?.trim() || undefined,
  };
}
