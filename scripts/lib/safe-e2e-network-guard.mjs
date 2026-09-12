// Guarda de egress para o E2E integrado seguro.
//
// Pré-carregada no processo do servidor (e nos filhos, via NODE_OPTIONS) por
// scripts/lib/safe-e2e-env.mjs. Instrumenta o seam real do servidor: qualquer
// fetch global do processo Node. Destinos que não sejam loopback são negados e
// registrados no arquivo de evidência. Um listener de request do browser não
// veria egress do servidor; esta guarda vê.
//
// Escopo declarado: bloqueia o `fetch` global do Node (o transporte usado pelos
// clientes HTTP deste backend). Não afirma bloquear outras stacks de rede
// (net/tls nativos, bibliotecas com socket próprio); o alvo do browser é
// impedido separadamente pelo BASE_URL forçado de loopback.
//
// Ao carregar, escreve um marcador de inicialização no log. Sem esse marcador o
// runner não considera a instrumentação ativa e falha fechado.
import { appendFileSync } from 'node:fs';

const LOG_PATH = process.env.SAFE_E2E_EGRESS_LOG;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

function hostOf(input) {
  try {
    const url =
      typeof input === 'string'
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(String(input?.url || ''));
    return url.hostname.replace(/^\[|\]$/g, '');
  } catch {
    return '';
  }
}

function isLoopback(host) {
  if (!host) return false;
  if (LOOPBACK_HOSTS.has(host)) return true;
  return host.startsWith('127.') || host === '::1';
}

function record(entry) {
  if (!LOG_PATH) return;
  try {
    appendFileSync(LOG_PATH, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  } catch {
    // A evidência nunca pode derrubar o servidor de teste.
  }
}

// Marcador de inicialização: distingue "guarda ativa sem tráfego" de
// "instrumentação ausente/quebrada". Inclui o nonce da execução e o entrypoint
// do processo para que o runner só aceite evidência atribuída ao servidor HTTP
// real (o mesmo NODE_OPTIONS atinge npx/Playwright/Vite, que não servem a API).
record({
  event: 'guard_initialized',
  pid: process.pid,
  runId: process.env.SAFE_E2E_RUN_ID || null,
  entry: process.argv[1] || '',
});

const originalFetch = globalThis.fetch;
if (typeof originalFetch === 'function') {
  globalThis.fetch = function guardedFetch(input, init) {
    const host = hostOf(input);
    if (!isLoopback(host)) {
      record({
        event: 'blocked',
        host,
        url: typeof input === 'string' ? input : String(input?.url || ''),
      });
      return Promise.reject(
        new Error(
          `SAFE_E2E_EGRESS_BLOCKED: destino não-loopback negado (${host || 'desconhecido'}).`
        )
      );
    }
    record({ event: 'allowed', host });
    return originalFetch.call(this, input, init);
  };
}
