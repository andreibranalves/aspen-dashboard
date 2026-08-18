// ── Logout handler ───────────────────────────────────────────────────────────
import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { clearSessionCookie } from '../_shared/session.js';

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Método não permitido.' }),
    };
  }

  const cookie = clearSessionCookie();

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie,
    },
    body: JSON.stringify({ success: true }),
  };
}
