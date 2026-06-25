/**
 * API wrapper para chamadas ao backend Vercel.
 */

const BASE = '/api';

export interface ApiError extends Error {
  status: number;
  data?: unknown;
}

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

  // 401 → sessão expirada, redirecionar para login
  // Exceto para o próprio endpoint de login (401 é resposta esperada)
  if (res.status === 401 && path !== '/login') {
    window.location.hash = '#/login';
    const err = new Error('Sessão expirada.') as ApiError;
    err.status = 401;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(
      (data as { error?: string })?.error || `Erro ${res.status}`,
    ) as ApiError;
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data as T;
}

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
