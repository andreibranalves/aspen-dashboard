const EXTENSION_ORIGIN_PATTERN = /^(?:chrome-extension:\/\/[a-z0-9-]{1,64}|https:\/\/[^/]+|http:\/\/localhost(?::\d+)?)$/i;

export function configuredWhatsappContextOrigin(env: typeof process.env = process.env): string {
  const value = String(env.WHATSAPP_CONTEXT_EXTENSION_ORIGIN || '').trim();
  return EXTENSION_ORIGIN_PATTERN.test(value) ? value : '';
}

export function whatsappContextCorsHeaders(
  requestOrigin: string | undefined,
  env: typeof process.env = process.env,
): Record<string, string> {
  const configured = configuredWhatsappContextOrigin(env);
  if (!configured || !requestOrigin || requestOrigin !== configured) return {};
  return {
    'Access-Control-Allow-Origin': configured,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type',
    Vary: 'Origin',
  };
}

export function requestOrigin(
  headers: Record<string, string | string[] | undefined> = {},
): string {
  const value = headers.origin ?? headers.Origin;
  return Array.isArray(value) ? String(value[0] || '').trim() : String(value || '').trim();
}
