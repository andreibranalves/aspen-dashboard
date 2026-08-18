// POST /api/edit-draft — interpret a natural-language edit prompt against
import type { FunctionEvent, FunctionResult } from '../_http/types.js';
// a current draft and return proposed changes.

const EDIT_SYSTEM_PROMPT = `Você é um assistente de edição de cotação da Aspen Estamparia.
Receba um rascunho de cotação e um comando em linguagem natural do operador.
Retorne o rascunho COMPLETO com as alterações aplicadas — preserve todos os campos
que o operador não mencionou. Não expanda produtos nem aplique regras de negócio
automáticas; apenas aplique exatamente o que o operador pediu.

RETORNE APENAS JSON válido — um objeto com o rascunho editado:
{
  "nome": "string",
  "email": "string ou null",
  "telefone": "string ou null",
  "urgente": false,
  "items": [{"item_code": "SKU", "qty": N}]
}`;

function createHttpError(statusCode: number, publicMessage: string, logMessage?: string) {
  const error = new Error(publicMessage) as unknown as Record<string, unknown>;
  error.statusCode = statusCode;
  error.logMessage = logMessage || publicMessage;
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonSafely(raw: unknown): Record<string, unknown> | null {
  try { return JSON.parse(raw as string); } catch { return null; }
}

function unwrapJsonText(raw: unknown): string {
  const trimmed = String(raw || '').trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function extractAssistantText(data: Record<string, unknown>): string {
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const firstChoice = isRecord(choices[0]) ? choices[0] : {};
  const message = isRecord(firstChoice.message) ? firstChoice.message : {};
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => isRecord(part) && part.type === 'text' && typeof part.text === 'string')
      .map((part) => isRecord(part) ? String(part.text) : '')
      .join('');
  }
  return '';
}

function validateDraft(draft: Record<string, unknown>): void {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    throw createHttpError(502, 'Resposta inválida do provedor de IA.', 'Draft não é um objeto');
  }
  if (draft.nome !== undefined && typeof draft.nome !== 'string') {
    throw createHttpError(502, 'Resposta inválida do provedor de IA.', 'Campo "nome" deve ser string');
  }
  if (draft.email !== undefined && draft.email !== null && typeof draft.email !== 'string') {
    throw createHttpError(502, 'Resposta inválida do provedor de IA.', 'Campo "email" deve ser string ou null');
  }
  if (draft.telefone !== undefined && draft.telefone !== null && typeof draft.telefone !== 'string') {
    throw createHttpError(502, 'Resposta inválida do provedor de IA.', 'Campo "telefone" deve ser string ou null');
  }
  if (draft.urgente !== undefined && typeof draft.urgente !== 'boolean') {
    throw createHttpError(502, 'Resposta inválida do provedor de IA.', 'Campo "urgente" deve ser boolean');
  }
  if (draft.items !== undefined) {
    if (!Array.isArray(draft.items)) {
      throw createHttpError(502, 'Resposta inválida do provedor de IA.', 'Campo "items" deve ser array');
    }
    for (let i = 0; i < draft.items.length; i++) {
      const item = draft.items[i];
      if (!item || typeof item !== 'object') {
        throw createHttpError(502, 'Resposta inválida do provedor de IA.', `items[${i}] deve ser objeto`);
      }
      if (typeof item.item_code !== 'string' || !item.item_code) {
        throw createHttpError(502, 'Resposta inválida do provedor de IA.', `items[${i}].item_code inválido`);
      }
      if (typeof item.qty !== 'number' || item.qty <= 0) {
        throw createHttpError(502, 'Resposta inválida do provedor de IA.', `items[${i}].qty inválido`);
      }
    }
  }
}

async function editDraftWithOpenRouter(prompt: string, currentDraft: unknown): Promise<Record<string, unknown>> {
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim() || '';
  const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL?.trim() || 'google/gemini-2.5-flash';

  if (!OPENROUTER_API_KEY) {
    throw createHttpError(500, 'Serviço de edição indisponível.', 'OPENROUTER_API_KEY não configurada');
  }

  if (!prompt?.trim()) {
    throw createHttpError(400, 'Informe um comando de edição.');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'X-OpenRouter-Title': 'Aspen Orcamento App',
  };

  const referer = process.env.OPENROUTER_SITE_URL?.trim() || process.env.URL?.trim() || process.env.DEPLOY_PRIME_URL?.trim();
  if (referer) headers['HTTP-Referer'] = referer;

  const userContent = [
    { type: 'text', text: `Rascunho atual:\n${JSON.stringify(currentDraft, null, 2)}\n\nComando do operador:\n${prompt}` },
  ];

  const body = {
    model: OPENROUTER_MODEL,
    messages: [
      { role: 'system', content: EDIT_SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    temperature: 0.1,
  };

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const responseText = await res.text();
  const data = parseJsonSafely(responseText);

  if (!res.ok) {
    const upstreamMessage = (data?.error as Record<string, unknown>)?.message as string || responseText || `OpenRouter retornou HTTP ${res.status}`;
    throw createHttpError(502, 'Falha ao interpretar edição.', `OpenRouter HTTP ${res.status}: ${upstreamMessage}`);
  }

  const raw = extractAssistantText(data ?? {});
  if (!raw) {
    throw createHttpError(502, 'Resposta inválida do provedor de IA.', 'Resposta sem conteúdo textual');
  }

  const parsed = parseJsonSafely(unwrapJsonText(raw));
  if (parsed == null) {
    throw createHttpError(502, 'Resposta inválida do provedor de IA.', 'JSON inválido retornado pela IA');
  }

  validateDraft(parsed);
  return parsed;
}

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  try {
    const proposed = await editDraftWithOpenRouter(payload.prompt, payload.currentDraft);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposed }),
    };
  } catch (err: unknown) {
    const details = err && typeof err === 'object' ? err as Record<string, unknown> : {};
    const statusCode = Number.isInteger(details.statusCode) ? Number(details.statusCode) : 500;
    const message = typeof details.message === 'string' ? details.message : 'Erro interno na edição.';
    console.error('[edit-draft]', details.logMessage || details.message || err);
    return {
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: message }),
    };
  }
}
