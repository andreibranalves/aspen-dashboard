// ── Login handler ────────────────────────────────────────────────────────────
import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import { getAuthConfiguration } from '../_lib/auth.js';
import { isValidPasswordInput, verifyPassword } from '../_lib/password.js';
import { createSessionCookie, createSessionToken } from '../_lib/session.js';

function jsonResponse(statusCode: number, body: Record<string, unknown>): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function authenticationUnavailable(): FunctionResult {
  return jsonResponse(500, { error: 'Autenticação indisponível. Tente novamente mais tarde.' });
}

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Método não permitido.' });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'JSON inválido.' });
  }

  const configuration = getAuthConfiguration();
  if (!configuration.isValid || !configuration.passwordHash || !configuration.sessionSecret) {
    console.error('Configuração de autenticação indisponível.');
    return authenticationUnavailable();
  }

  const password =
    payload !== null && typeof payload === 'object'
      ? (payload as Record<string, unknown>).password
      : undefined;
  if (!isValidPasswordInput(password) || !(await verifyPassword(password, configuration.passwordHash))) {
    return jsonResponse(401, { error: 'Senha incorreta.' });
  }

  const token = createSessionToken(configuration.sessionSecret);
  const cookie = token ? createSessionCookie(token) : null;
  if (!cookie) {
    console.error('Não foi possível emitir a sessão autenticada.');
    return authenticationUnavailable();
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie,
    },
    body: JSON.stringify({ success: true }),
  };
}
