// ── Logout handler ───────────────────────────────────────────────────────────
import type { FunctionEvent, FunctionResult } from '../_lib/types.js';

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Método não permitido.' }),
    };
  }

  const cookie = 'aspen_token=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/';

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie,
    },
    body: JSON.stringify({ success: true }),
  };
}
