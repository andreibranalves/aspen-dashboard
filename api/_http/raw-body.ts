import type { IncomingMessage } from 'node:http';

export const MAX_SITE_QUOTE_BODY_BYTES = 16_384;

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super('request_body_too_large');
    this.name = 'RequestBodyTooLargeError';
  }
}

export function readRawBody(
  request: IncomingMessage,
  maxBytes = Number.POSITIVE_INFINITY
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let byteLength = 0;
    let oversized = false;
    let settled = false;

    request.on('data', (chunk: Buffer | string) => {
      if (oversized) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += bytes.byteLength;
      if (byteLength > maxBytes) {
        oversized = true;
        chunks.length = 0;
        return;
      }
      chunks.push(bytes);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      if (oversized) reject(new RequestBodyTooLargeError());
      else resolve(Buffer.concat(chunks, byteLength));
    });
    request.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

export function sendBodyTooLarge(response: {
  status(code: number): unknown;
  json(body: unknown): unknown;
}): void {
  response.status(413);
  response.json({ error: 'Corpo da requisição excede o limite permitido.' });
}
