// ── Login handler ────────────────────────────────────────────────────────────

const APP_PASSWORD = process.env.APP_PASSWORD;
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 dias

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Método não permitido.' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'JSON inválido.' }),
    };
  }

  if (!APP_PASSWORD) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'APP_PASSWORD não configurada no servidor.' }),
    };
  }

  const { password } = payload;
  if (!password || password !== APP_PASSWORD) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Senha incorreta.' }),
    };
  }

  // ponytail: Secure only on HTTPS — Vercel dev is HTTP so browser rejects Secure cookies
  const isHttps = (event.headers?.['x-forwarded-proto'] || event.headers?.['X-Forwarded-Proto'] || 'http') === 'https';
  const secureFlag = isHttps ? 'Secure; ' : '';
  const cookie =
    `aspen_token=${APP_PASSWORD}; HttpOnly; ${secureFlag}SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}; Path=/`;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie,
    },
    body: JSON.stringify({ success: true }),
  };
}
