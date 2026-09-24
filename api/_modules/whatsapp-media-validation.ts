import { createHash } from 'node:crypto';
import { MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES, safeMediaFilename } from './postgres-media.js';

// The upload travels through a Vercel Function as JSON; 3 MiB stays below
// its 4.5 MiB body limit after base64 expansion.
export const MAX_OPERATOR_ATTACHMENT_BYTES = 3 * 1024 * 1024;
export const MAX_RECEIVED_AUDIO_BYTES = 5 * 1024 * 1024;

export function detectedWhatsappMediaMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  if (bytes.toString('ascii', 0, 4) === 'OggS' && bytes.includes(Buffer.from('OpusHead'))) return 'audio/ogg';
  return null;
}

export function whatsappMediaAllowed(type: string, mime: string): boolean {
  if (type === 'image') return ['image/jpeg', 'image/png', 'image/webp'].includes(mime);
  if (type === 'document') return mime === 'application/pdf';
  if (type === 'audio') return mime === 'audio/ogg';
  return false;
}

export function whatsappMediaLimit(type: string): number {
  return type === 'document' ? MAX_DOCUMENT_BYTES : type === 'audio' ? MAX_RECEIVED_AUDIO_BYTES : MAX_IMAGE_BYTES;
}

export function validateOperatorMedia(input: { base64: string; mimeType: string; fileName: string }) {
  const { base64, mimeType, fileName } = input;
  if (!base64 || base64.length > Math.ceil(MAX_OPERATOR_ATTACHMENT_BYTES * 4 / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error('INVALID_MEDIA');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > MAX_OPERATOR_ATTACHMENT_BYTES || bytes.toString('base64') !== base64) {
    throw new Error('INVALID_MEDIA');
  }
  const detected = detectedWhatsappMediaMime(bytes);
  if (!detected || detected !== mimeType || !whatsappMediaAllowed(detected === 'application/pdf' ? 'document' : 'image', detected)) {
    throw new Error('INVALID_MEDIA');
  }
  if (typeof fileName !== 'string' || fileName.length > 255) throw new Error('INVALID_MEDIA');
  return {
    bytes,
    mimeType: detected,
    mediaType: detected === 'application/pdf' ? 'document' as const : 'image' as const,
    fileName: safeMediaFilename(fileName, detected, 'anexo'),
    sizeBytes: bytes.length,
    checksum: createHash('sha256').update(bytes).digest('hex'),
  };
}
