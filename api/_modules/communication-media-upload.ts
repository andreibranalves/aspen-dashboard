// POST /api/communication-media-upload
import type { FunctionEvent, FunctionResult, JsonResponseFn } from '../_http/types.js';
//
// Vercel Blob client upload token generation using handleUpload from @vercel/blob/client.
//
// Flow:
//   1. Browser calls this endpoint → gets upload token
//   2. Browser uses @vercel/blob/client upload() with the token → file goes direct to Blob
//   3. Browser creates metadata via POST /api/communication-media (single write path)
//
// onUploadCompleted is intentionally a no-op — the frontend handles the single metadata write.
//
// Requires BLOB_READ_WRITE_TOKEN env var (set by Vercel when Blob store is linked).

import { getBlobClient } from '../_infrastructure/integrations/blob/client.js';
import { listActiveProductCategories } from '../_infrastructure/db/repositories/products-repository.js';
import { createHttpError, isPublicHttpError } from '../_shared/http-error.js';
import {
  ALLOWED_MIME_TYPES,
  MAX_SIZE_IMAGE,
  MAX_SIZE_VIDEO,
  mediaGroupPathSegment,
} from './media-schema.js';

// ── JSON response helper ───────────────────────────────────────────────────

const jsonResponse: JsonResponseFn = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// ── Handler ─────────────────────────────────────────────────────────────────

export interface CommunicationMediaUploadDependencies {
  blobClient?: ReturnType<typeof getBlobClient>;
  listCategories?: () => Promise<string[]>;
}

function normalizeCategory(value: string): string {
  return value.trim().toLocaleLowerCase('pt-BR');
}

export async function handler(
  event: FunctionEvent,
  dependencies: CommunicationMediaUploadDependencies = {}
): Promise<FunctionResult> {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Método não permitido.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'JSON inválido.' });
  }

  // Build a synthetic Request for handleUpload (it needs request.url for origin validation)
  const host = event.headers?.host || 'localhost';
  const proto = String(event.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const requestUrl = `${proto}://${host}/api/communication-media-upload`;

  try {
    const result = await (dependencies.blobClient || getBlobClient()).handleUpload({
      body,
      request: { url: requestUrl } as unknown as Request,
      onBeforeGenerateToken: async (pathname /* , clientPayload */) => {
        // Validate pathname has a valid product group prefix
        const safePathname = String(Array.isArray(pathname) ? pathname[0] : pathname || '')
          .replace(/^\/+/, '');
        let parts: string[];
        try {
          parts = safePathname.split('/').map((part) => decodeURIComponent(part));
        } catch {
          throw createHttpError(400, 'Caminho de upload inválido.');
        }
        const pathGroup = parts[1]?.toLowerCase(); // aspen-media/{group key}/...

        const categories = await (dependencies.listCategories || listActiveProductCategories)();
        const productGroup = categories
          .map(normalizeCategory)
          .find((category) => pathGroup === category || pathGroup === mediaGroupPathSegment(category));
        if (
          parts[0] !== 'aspen-media' ||
          parts.length < 3 ||
          parts.some((part) => !part || part === '.' || part === '..') ||
          !productGroup
        ) {
          throw createHttpError(
            400,
            'Grupo de produto inválido no caminho.',
            '[comm-media-upload] product group not found in active catalog'
          );
        }

        const isVideo = /\.(mp4|mov|webm)$/i.test(safePathname);
        const maxSize = isVideo ? MAX_SIZE_VIDEO : MAX_SIZE_IMAGE;

        return {
          allowedContentTypes: ALLOWED_MIME_TYPES,
          maximumSizeInBytes: maxSize,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            product_group: productGroup,
            uploaded_at: new Date().toISOString(),
          }),
        };
      },
      onUploadCompleted: async (_blob) => {
        // Metadata is written by the frontend via POST /api/communication-media
        // after the client upload completes. This callback is intentionally a no-op
        // to prevent duplicate metadata writes.
        console.log('[comm-media-upload] upload complete callback ignored — metadata written by frontend');
      },
    });

    return jsonResponse(200, result);
  } catch (err: unknown) {
    const code = isPublicHttpError(err) ? err.statusCode : 503;
    const message = isPublicHttpError(err) ? err.message : 'Erro ao gerar token de upload.';
    console.error('[comm-media-upload] falha ao gerar token de upload.');
    return jsonResponse(code, { error: message });
  }
}
