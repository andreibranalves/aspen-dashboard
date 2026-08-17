export interface SendQuotationEmailTransportInput {
  recipient: string;
  customerName: string;
  businessNumber: string;
  publicUrl: string;
  attachmentUrl: string;
  attemptId: string;
}

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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!);
}

export function renderQuotationEmailHtml(
  input: Pick<SendQuotationEmailTransportInput, 'customerName' | 'businessNumber' | 'publicUrl'>
): string {
  const customerName = escapeHtml(input.customerName);
  const businessNumber = escapeHtml(input.businessNumber);
  const publicUrl = escapeHtml(input.publicUrl);
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1f2937"><p>Olá, ${customerName}.</p><p>Segue o orçamento ${businessNumber} em anexo.</p><p><a href="${publicUrl}" style="display:inline-block;padding:12px 18px;background:#166534;color:#fff;text-decoration:none;border-radius:6px">Ver orçamento</a></p><p>Atenciosamente,<br>Aspen</p></body></html>`;
}

export async function sendQuotationEmailViaResend(
  input: SendQuotationEmailTransportInput,
  dependencies: ResendTransportDependencies = {}
): Promise<{ id: string }> {
  const env = dependencies.env || process.env;
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
        subject: `Orçamento ${input.businessNumber} - Aspen`,
        html: renderQuotationEmailHtml(input),
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
    throw new ResendTransportError('A Resend não aceitou o e-mail.', 'rejected');
  }
  const payload = await response.json().catch(() => null) as { id?: unknown } | null;
  if (!payload || typeof payload.id !== 'string' || !payload.id.trim()) {
    throw new ResendTransportError('O resultado do envio não pôde ser confirmado.', 'uncertain');
  }
  return { id: payload.id.trim() };
}
