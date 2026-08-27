export interface SendQuotationEmailTransportInput {
  recipient: string;
  businessNumber: string;
  attachmentUrl: string;
  attemptId: string;
  subject: string;
  html: string;
  text: string;
}

import { assertExternalWritesAllowed } from '../_shared/external-writes.js';

export interface ResendTransportDependencies {
  fetchFn?: typeof fetch;
  env?: typeof process.env;
}

export type ResendTransportErrorKind = 'configuration' | 'rejected' | 'uncertain';

export class ResendTransportError extends Error {
  constructor(
    message: string,
    readonly kind: ResendTransportErrorKind
  ) {
    super(message);
  }
}

export async function sendQuotationEmailViaResend(
  input: SendQuotationEmailTransportInput,
  dependencies: ResendTransportDependencies = {}
): Promise<{ id: string }> {
  // Fail-closed em toda tentativa: ambiente ausente, Preview ou contraditório
  // nunca chega ao provider. Somente Production com flag explícita envia.
  const env = dependencies.env || process.env;
  assertExternalWritesAllowed('email', env);
  const apiKey = String(env.RESEND_API_KEY || '').trim();
  const from = String(env.RESEND_FROM_EMAIL || '').trim();
  const replyTo = String(env.RESEND_REPLY_TO || '').trim();
  if (!apiKey || !from) {
    throw new ResendTransportError('Envio por e-mail não configurado.', 'configuration');
  }
  let attachmentUrl: URL;
  try {
    attachmentUrl = new URL(input.attachmentUrl);
  } catch {
    throw new ResendTransportError('URL do PDF inválida.', 'rejected');
  }
  if (attachmentUrl.protocol !== 'https:' || attachmentUrl.searchParams.get('format') !== 'pdf') {
    throw new ResendTransportError('URL do PDF inválida.', 'rejected');
  }

  let response: Response;
  try {
    response = await (dependencies.fetchFn || fetch)('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `quotation-email/${input.attemptId}`,
      },
      body: JSON.stringify({
        from,
        to: [input.recipient],
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
        attachments: [{
          filename: `orcamento-${input.businessNumber}.pdf`,
          path: attachmentUrl.toString(),
        }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ResendTransportError('O resultado do envio não pôde ser confirmado.', 'uncertain');
  }

  if (!response.ok) {
    const kind = response.status >= 500 && response.status <= 599 ? 'uncertain' : 'rejected';
    throw new ResendTransportError(
      kind === 'uncertain'
        ? 'O resultado do envio não pôde ser confirmado.'
        : 'A Resend não aceitou o e-mail.',
      kind,
    );
  }
  const payload = await response.json().catch(() => null) as { id?: unknown } | null;
  if (!payload || typeof payload.id !== 'string' || !payload.id.trim()) {
    throw new ResendTransportError('O resultado do envio não pôde ser confirmado.', 'uncertain');
  }
  return { id: payload.id.trim() };
}
