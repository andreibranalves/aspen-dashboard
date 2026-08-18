// Shared runtime types for the legacy Lambda handler contract.
// Used by function-adapter, auth, rate-limit, and every _functions/* handler.


export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'OPTIONS';

export type FunctionHeaders = Record<string, string | string[] | undefined>;

export interface FunctionEvent {
  httpMethod: HttpMethod | string;
  headers: FunctionHeaders;
  queryStringParameters: Record<string, string | undefined>;
  body: string;
  url?: string;
}

export interface FunctionResult {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
}

export type LegacyHandler = (event: FunctionEvent) => Promise<FunctionResult>;

// ── Minimal Vercel/Express request shape ──
// auth.ts, rate-limit.ts, and the router use these without importing express types.

export interface VercelRequestLike {
  method?: string;
  url?: string | null;
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface VercelResponseLike {
  status(code: number): VercelResponseLike;
  json(data: unknown): void;
  send(data: unknown): void;
  setHeader(key: string, value: string | number | string[]): void;
}

// ── Shared handler utilities ──

/** Generic JSON-serializable value (for response bodies). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** jsonResponse helper used by many handlers. */
export type JsonResponseFn = (statusCode: number, body: unknown) => FunctionResult;
