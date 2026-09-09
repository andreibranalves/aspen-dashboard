export interface SanityQuoteRequestsEnvironment {
  SANITY_PROJECT_ID?: string;
  SANITY_DATASET?: string;
  SANITY_API_TOKEN?: string;
}

export interface SanityQuoteRequestsPageParameters {
  from: string;
  to: string;
  cursorDate: string;
  cursorId: string;
  limit: number;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildSanityQuoteRequestsQuery(): string {
  return `*[_type == "quoteRequest" && createdAt >= $from && createdAt < $to &&
    !(_id in path("drafts.**")) && !(_id in path("versions.**")) &&
    (createdAt > $cursorDate || (createdAt == $cursorDate && _id > $cursorId))]
    | order(createdAt asc, _id asc)[0...$limit]{
      _id, createdAt, payloadFingerprint, name, email, whatsapp, product, quantity,
      deadline, message, consentGiven, utmSource, utmMedium, utmCampaign, utmContent,
      utmTerm, gclid, gbraid, wbraid, fbclid, pageUrl, adConsent
    }`;
}

export function createSanityQuoteRequestsPageReader(
  environment: SanityQuoteRequestsEnvironment,
  fetchImpl: typeof fetch = fetch
): (parameters: SanityQuoteRequestsPageParameters) => Promise<unknown[]> {
  const project = text(environment.SANITY_PROJECT_ID);
  const dataset = text(environment.SANITY_DATASET);
  const token = text(environment.SANITY_API_TOKEN);
  if (!/^[a-z0-9-]+$/.test(project) || !/^[a-z0-9_-]+$/.test(dataset) || !token) {
    throw new Error('Configuração Sanity incompleta.');
  }

  return async (parameters) => {
    const url = new URL(`https://${project}.api.sanity.io/v2024-10-01/data/query/${dataset}`);
    url.searchParams.set('query', buildSanityQuoteRequestsQuery());
    for (const [key, value] of Object.entries(parameters)) {
      url.searchParams.set(`$${key}`, JSON.stringify(value));
    }
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('sanity_read_failed');
    const payload = (await response.json()) as { result?: unknown };
    if (!payload || !Array.isArray(payload.result)) throw new Error('sanity_contract_failed');
    return payload.result;
  };
}
