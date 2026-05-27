/**
 * API wrapper para chamadas ao backend Vercel.
 */

const BASE = '/api';

async function request(method, path, body) {
  const url = `${BASE}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const data = await res.json().catch(() => null);

  // 401 → sessão expirada, redirecionar para login
  // Exceto para o próprio endpoint de login (401 é resposta esperada)
  if (res.status === 401 && path !== '/login') {
    window.location.hash = '#/login';
    const err = new Error('Sessão expirada.');
    err.status = 401;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Erro ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

export function apiGet(path) {
  return request('GET', path);
}

export function apiPost(path, body) {
  return request('POST', path, body);
}

export function apiPut(path, body) {
  return request('PUT', path, body);
}

export function apiDelete(path) {
  return request('DELETE', path);
}
