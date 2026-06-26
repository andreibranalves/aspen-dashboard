/**
 * API wrapper para chamadas ao backend Vercel.
 */
import { ApiError, createApiError } from '@/types/api';

const BASE = '/api';

async function request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${BASE}${path}`;
  const opts: RequestInit = { method };
  // Only send Content-Type when there is a body. Some servers/proxies reject
  // GET requests that carry an application/json content-type (e.g. 417 Expectation Failed).
  if (body) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  const data = (await res.json().catch(() => null)) as unknown;

  if (res.status === 401 && path !== '/login') {
    window.location.hash = '#/login';
    const err = createApiError(new Error('Sessão expirada.'));
    err.status = 401;
    throw err;
  }

  if (!res.ok) {
    const message = (data as { error?: string })?.error || `Erro ${res.status}`;
    const err = createApiError(new Error(message));
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data as T;
}

export type { ApiError };
export { createApiError };
export function apiGet<T = unknown>(path: string): Promise<T> {
  return request<T>('GET', path);
}
export function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, body);
}
export function apiPut<T = unknown>(path: string, body?: unknown): Promise<T> {
  return request<T>('PUT', path, body);
}
export function apiDelete<T = unknown>(path: string): Promise<T> {
  return request<T>('DELETE', path);
}
