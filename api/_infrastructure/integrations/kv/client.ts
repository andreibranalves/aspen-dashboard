import { kv as vercelKv } from '@vercel/kv';

export type KvClient = typeof vercelKv;

export function getKvClient(): KvClient {
  return vercelKv;
}
