import { assertExternalWritesAllowed } from '../../../_shared/external-writes.js';
import {
  sanitizeTransportDetail,
  sanitizeDiagnosticCounts,
  sanitizeTransportCode,
  sanitizeTransportWarnings,
  type GoogleDataManagerDiagnosticResult,
  type GoogleDataManagerPayload,
  type GoogleDataManagerTransport,
  type OfflineTransportAccepted,
  type OfflineTransportError,
} from '../../../_modules/ads-offline-core.js';
import {
  getGoogleDataManagerConfig,
  isGoogleDataManagerConfigured,
  type GoogleDataManagerConfig,
} from './config.js';

export class GoogleDataManagerTransportError extends Error {
  readonly kind: OfflineTransportError['kind'];
  readonly code: string;
  readonly httpStatus?: number;

  constructor(
    kind: OfflineTransportError['kind'],
    code: string,
    detail?: string,
    httpStatus?: number
  ) {
    super(sanitizeTransportDetail(detail));
    this.name = 'GoogleDataManagerTransportError';
    this.kind = kind;
    this.code = sanitizeTransportCode(code);
    this.httpStatus = httpStatus;
  }
}

export interface GoogleDataManagerClientOptions {
  getConfig?: () => GoogleDataManagerConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  assertWritesAllowed?: () => void;
  apiBaseUrl?: string;
}

const DEFAULT_API_BASE_URL = 'https://datamanager.googleapis.com';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function errorKindForStatus(status: number): OfflineTransportError['kind'] {
  if (status === 429) return 'transient';
  if (status >= 500) return 'ambiguous';
  return 'permanent';
}

function statusCode(status: number): string {
  return `GOOGLE_DM_HTTP_${status}`;
}

function parseStatus(value: unknown): GoogleDataManagerDiagnosticResult['status'] | null {
  if (value === 'PROCESSING') return 'processing';
  if (value === 'SUCCESS') return 'success';
  if (value === 'PARTIAL_SUCCESS') return 'partial_success';
  if (value === 'FAILED') return 'failure';
  return null;
}

async function jsonBody(response: Response): Promise<Record<string, unknown> | null> {
  const value = await response.json().catch(() => null);
  return asRecord(value);
}

function abortAfter(timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function refreshAccessToken(
  config: GoogleDataManagerConfig,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<string> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: 'refresh_token',
  });
  const timeout = abortAfter(timeoutMs);
  try {
    const response = await fetchImpl(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: timeout.signal,
    });
    if (!response.ok) {
      throw new GoogleDataManagerTransportError(
        errorKindForStatus(response.status),
        `GOOGLE_DM_OAUTH_${response.status}`,
        undefined,
        response.status
      );
    }
    const payload = await jsonBody(response);
    const token = typeof payload?.access_token === 'string' ? payload.access_token.trim() : '';
    if (!token) throw new GoogleDataManagerTransportError('ambiguous', 'GOOGLE_DM_OAUTH_RESPONSE');
    return token;
  } catch (error) {
    if (error instanceof GoogleDataManagerTransportError) throw error;
    throw new GoogleDataManagerTransportError(
      'ambiguous',
      timeout.signal.aborted ? 'GOOGLE_DM_OAUTH_TIMEOUT' : 'GOOGLE_DM_OAUTH_NETWORK'
    );
  } finally {
    timeout.cancel();
  }
}

export function getGoogleDataManagerClient(
  options: GoogleDataManagerClientOptions = {}
): GoogleDataManagerTransport {
  const getConfig = options.getConfig || getGoogleDataManagerConfig;
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || 15_000;
  const apiBaseUrl = options.apiBaseUrl || DEFAULT_API_BASE_URL;
  const assertWrites =
    options.assertWritesAllowed || (() => assertExternalWritesAllowed('google-data-manager'));

  async function request(
    config: GoogleDataManagerConfig,
    accessToken: string,
    path: string,
    options: { method: 'GET' | 'POST'; body?: unknown }
  ): Promise<Response> {
    const timeout = abortAfter(timeoutMs);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };
    const init: RequestInit = {
      method: options.method,
      headers,
      signal: timeout.signal,
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    try {
      return await fetchImpl(`${apiBaseUrl}/${config.apiVersion}${path}`, init);
    } catch {
      throw new GoogleDataManagerTransportError(
        'ambiguous',
        timeout.signal.aborted ? 'GOOGLE_DM_TIMEOUT' : 'GOOGLE_DM_NETWORK'
      );
    } finally {
      timeout.cancel();
    }
  }

  return {
    async ingest(payload: GoogleDataManagerPayload): Promise<OfflineTransportAccepted> {
      assertWrites();
      const config = getConfig();
      if (!isGoogleDataManagerConfigured(config)) {
        throw new GoogleDataManagerTransportError('permanent', 'GOOGLE_DM_CONFIG_INCOMPLETE');
      }
      const accessToken = await refreshAccessToken(config, fetchImpl, timeoutMs);
      const response = await request(config, accessToken, '/events:ingest', {
        method: 'POST',
        body: payload,
      });
      const parsed = await jsonBody(response);
      if (!response.ok) {
        throw new GoogleDataManagerTransportError(
          errorKindForStatus(response.status),
          statusCode(response.status),
          undefined,
          response.status
        );
      }
      if (response.status !== 200) {
        throw new GoogleDataManagerTransportError(
          'ambiguous',
          `GOOGLE_DM_UNEXPECTED_${response.status}`,
          undefined,
          response.status
        );
      }
      const requestId = typeof parsed?.requestId === 'string' ? parsed.requestId.trim() : '';
      if (!requestId)
        throw new GoogleDataManagerTransportError(
          'ambiguous',
          'GOOGLE_DM_MISSING_REQUEST_ID',
          undefined,
          200
        );
      return {
        kind: 'accepted',
        requestId: requestId.slice(0, 255),
        httpStatus: 200,
        fieldWarnings: sanitizeTransportWarnings(parsed?.fieldWarnings),
      };
    },

    async retrieveStatus(requestId: string): Promise<GoogleDataManagerDiagnosticResult> {
      assertWrites();
      const config = getConfig();
      if (!isGoogleDataManagerConfigured(config)) {
        throw new GoogleDataManagerTransportError('permanent', 'GOOGLE_DM_CONFIG_INCOMPLETE');
      }
      const accessToken = await refreshAccessToken(config, fetchImpl, timeoutMs);
      const normalizedRequestId = requestId.trim().slice(0, 255);
      if (!normalizedRequestId) {
        throw new GoogleDataManagerTransportError('permanent', 'GOOGLE_DM_REQUEST_ID_INVALID');
      }
      const response = await request(
        config,
        accessToken,
        `/requestStatus:retrieve?requestId=${encodeURIComponent(normalizedRequestId)}`,
        { method: 'GET' }
      );
      const parsed = await jsonBody(response);
      if (!response.ok) {
        throw new GoogleDataManagerTransportError(
          errorKindForStatus(response.status),
          statusCode(response.status),
          undefined,
          response.status
        );
      }
      if (response.status !== 200) {
        throw new GoogleDataManagerTransportError(
          'ambiguous',
          `GOOGLE_DM_UNEXPECTED_${response.status}`,
          undefined,
          response.status
        );
      }
      const statuses =
        parsed?.requestStatusPerDestination ?? parsed?.request_status_per_destination;
      const first = Array.isArray(statuses) ? asRecord(statuses[0]) : null;
      const status = parseStatus(first?.requestStatus ?? first?.request_status ?? parsed?.status);
      if (!status)
        throw new GoogleDataManagerTransportError(
          'ambiguous',
          'GOOGLE_DM_INVALID_DIAGNOSTIC_RESPONSE'
        );
      const errorInfo = asRecord(first?.errorInfo ?? first?.error_info);
      const warningInfo = asRecord(first?.warningInfo ?? first?.warning_info);
      return {
        status,
        errorCounts: sanitizeDiagnosticCounts(
          errorInfo?.errorCounts ?? errorInfo?.error_counts,
          'error'
        ),
        warningCounts: sanitizeDiagnosticCounts(
          warningInfo?.warningCounts ?? warningInfo?.warning_counts,
          'warning'
        ),
      };
    },
  };
}
