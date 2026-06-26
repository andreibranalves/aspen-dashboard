import type { FunctionEvent, FunctionResult } from '../_lib/types.js';

// ── Regras de extração padrão ──
export const DEFAULT_RULES = `Rule 0 — SKU Explícito: Se o cliente informar SKUs explícitos (ex: CNG-SAL-70), use exatamente esses SKUs sem expandir.

Rule 1 — Quantidade mínima: Se qtd < 30, usar 30.

Rule 2 — Quantidade exata: Usar a qtd EXATA do cliente. O sistema aplica as faixas de precificação (30, 100, 300, 500, 1000) automaticamente.

Rule 3 — Regras por Produto:
- Lenços:
  * Padrão (sem qualificador de tamanho/material/acabamento): LNC-SED-70 + LNC-CSD-70.
  * "seda" → LNC-SED-70 (ou -50/-90 se o tamanho for especificado).
  * "crepe" / "cetim de seda" → LNC-CSD-70 (ou -50/-90 se tamanho especificado).
  * "laser" (sem bainha) → LNC-SED-LAS-70 (ou -50/-90 se tamanho especificado).
  * "bainha" (sem laser) → LNC-SED-70 + LNC-CSD-70.
  * "bainha e laser" / "bainha + laser" → LNC-SED-70 + LNC-CSD-70 + LNC-SED-LAS-70.
  * "viscose" → LNC-VIS-70.
  * Tamanhos reconhecidos: "50cm" / "50x50" / "55x55" → variantes -50; "70cm" / "70x70" → variantes -70; "90cm" / "90x90" → variantes -90. Só interpretar como tamanho quando vier com "cm" ou formato "NxN".
  * A QUANTIDADE é o primeiro número do pedido e NUNCA deve ser confundida com tamanho. Ex: "70 lenços 90x90cm" → qty=70, tamanho=90x90cm.
  * Exemplos:
    - "70 lenços 90x90cm" → qty 70, LNC-SED-90 + LNC-CSD-90
    - "50 lenços laser" → qty 50, LNC-SED-LAS-70
    - "lenços seda 50cm" → LNC-SED-50
- Echarpes: Sempre ECH-SED + ECH-CSD.
- Chapéus: Sempre CHP-PAN + CHP-PNR + CHP-BAM.
- Cangas:
  * Padrão (sem material/tamanho especificado):
    - < 100 un → CNG-SAL-70 + CNG-SAL-100
    - ≥ 100 un → CNG-SAL-70 + CNG-SAL-100 + CNG-VIS-70 + CNG-VIS-100
  * "salinas" ou "salina" → CNG-SAL-70 + CNG-SAL-100, independente da quantidade.
  * "viscose" → CNG-VIS-70 + CNG-VIS-100, independente da quantidade.
  * "atoalhada" / "crepe salinas" → CNG-ATO-70 + CNG-ATO-100.
  * "laser" → CNG-SAL-LAS-70 + CNG-SAL-LAS-100.
  * "140cm" / "140x140" → incluir a variante -140 do material especificado (ou salinas se nenhum material for mencionado).
  * Exemplos:
    - "100 cangas viscose" → CNG-VIS-70 + CNG-VIS-100
    - "50 cangas salinas 140cm" → CNG-SAL-140
    - "100 cangas atoalhada" → CNG-ATO-70 + CNG-ATO-100
- Toalhas de Praia: Sempre TWL-210 + TWL-280.
- Toalhas de Banho: Sempre TBH-LEM + TBH-URC + TBH-IPA.
- Bonés: < 100 un → BNE-TAC-VNL. ≥ 100 un → BNE-TAC-SUB + BNE-BRI + BNE-PRE.
- Cachecóis: Sempre CHC-SOF-140 + CHC-LAA-COU.
- Ecobags: Sempre ECO-30 + ECO-35 + ECO-50.
- Bolsas: Sempre BLS-CAP-POL + BLS-CAP-COR.
- Bandanas: Sempre BND-CRP-50 + BND-CRP-65.
- Gravatas: Sempre GVT-POD.
- Viseiras: < 100 un → BNE-VIS-PLM. ≥ 100 un → BNE-VIS-TAC.

Rule 4 — Múltiplas quantidades: Se o mesmo produto aparecer em qtds diferentes, incluir TODAS as combinações como linhas separadas no MESMO objeto. Ex: LNC-SED-70 qty:80 + LNC-CSD-70 qty:80 + LNC-SED-70 qty:100 + LNC-CSD-70 qty:100.

Formato Brindice: Se encontrar colunas PRODUTO | CÓD | QTD | NOME | TEL | E-MAIL, ignore a coluna CÓD. Use NOME como nome do cliente.

Urgência: urgente=true se prazo < 15 dias úteis (aplica +30% no preço).`;

export function buildSystemPrompt(customRules?: string, existingItems?: Array<{ item_code: string; qty: number }> | null): string {
  const rules = customRules?.trim() || DEFAULT_RULES;
  let mergeInstruction = '';
  if (Array.isArray(existingItems) && existingItems.length > 0) {
    const itemsText = existingItems
      .filter((it) => it && it.item_code)
      .map((it) => `- ${it.item_code}: ${it.qty || 0} un`)
      .join('\n');
    mergeInstruction = `\n\nO usuário está COMPLEMENTANDO um pedido já existente. Os itens já presentes são:\n${itemsText}\n\nINSTRUÇÕES DE MERGE:\n- Retorne APENAS os novos itens no campo "items".\n- NÃO repita SKUs que já existem na lista acima; se o novo texto pedir algo idêntico, ignore.\n- NÃO altere nome, e-mail, telefone, origem, CNPJ ou endereço do pedido original.\n- Se o novo texto não adicionar nenhum item novo, retorne "items": [] e mantenha os dados do cliente.`;
  }
  return `Você é um assistente de cotação da Aspen Estamparia. Extraia os dados do pedido e aplique as regras de negócio.

REGRAS DE NEGÓCIO:

${rules}${mergeInstruction}

RETORNE APENAS JSON válido — um array com um objeto por cliente/pedido:
[
  {
    "nome": "string",
    "email": "string ou null",
    "telefone": "string ou null",
    "urgente": false,
    "origem": "string ou null",
    "cnpj": "string ou null",
    "endereco": {
      "cep": "string ou null",
      "logradouro": "string ou null",
      "numero": "string ou null",
      "complemento": "string ou null",
      "bairro": "string ou null",
      "cidade": "string ou null",
      "uf": "string ou null"
    },
    "items": [{"item_code": "SKU", "qty": N}]
  }
]

Regras para origem (campo "origem"):
- Se o texto tiver formato de tabela Brindice (colunas PRODUTO | CÓD | QTD | NOME | TEL | E-MAIL), usar "Bríndice".
- Se o texto mencionar Google Ads, campanha ou anúncio do Google, usar "Google Ads".
- Se o cliente mencionar que já comprou antes, usar "Cliente recorrente".
- Se não houver evidência clara, deixar origem como string vazia ("").

Regras para CNPJ (campo "cnpj"):
- Extraia APENAS se um CNPJ completo (14 dígitos, com ou sem pontuação) estiver presente no texto.
- NUNCA invente CNPJ.

Regras para endereço (campo "endereco"):
- Extraia APENAS se houver dados de endereço no texto (CEP, rua, número, bairro, cidade, UF).
- Preencha apenas os campos encontrados; deixe os demais como string vazia.
- NUNCA invente endereço.

Se houver apenas um pedido, retorne igualmente um array com um único elemento.`;
}

const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_TEXT_LENGTH = 12000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

interface HttpError extends Error {
  statusCode: number;
  logMessage: string;
}

function createHttpError(statusCode: number, publicMessage: string, logMessage?: string): HttpError {
  const error = new Error(publicMessage) as HttpError;
  error.statusCode = statusCode;
  error.logMessage = logMessage || publicMessage;
  return error;
}

function estimateBase64Bytes(base64: string): number {
  const normalized = (base64 || '').replace(/\s+/g, '');
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function parseJsonSafely(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function unwrapJsonText(raw: string): string {
  const trimmed = String(raw || '').trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function validateInput(text?: string, imageBase64?: string, imageMimeType?: string): void {
  if (!text && !imageBase64) {
    throw createHttpError(400, 'Envie texto ou imagem para extrair o pedido.');
  }

  if (text && text.length > MAX_TEXT_LENGTH) {
    throw createHttpError(400, 'Texto muito longo para extração.');
  }

  if (!imageBase64) return;

  if (!ALLOWED_IMAGE_MIME_TYPES.has(imageMimeType || 'image/png')) {
    throw createHttpError(400, 'Formato de imagem não suportado.');
  }

  const normalized = imageBase64.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+=*$/.test(normalized)) {
    throw createHttpError(400, 'Imagem em base64 inválida.');
  }

  if (estimateBase64Bytes(normalized) > MAX_IMAGE_BYTES) {
    throw createHttpError(400, 'Imagem muito grande para extração.');
  }
}

interface OrderItem {
  item_code: string;
  qty: number;
}

interface Order {
  nome: string;
  email: string | null;
  telefone: string | null;
  urgente: boolean;
  origem: string | null;
  cnpj: string | null;
  endereco: Record<string, string | null>;
  items: OrderItem[];
}

function normalizeOrdersPayload(parsed: unknown): Order[] {
  const orders = Array.isArray(parsed) ? parsed : Array.isArray((parsed as Record<string, unknown>)?.orders) ? (parsed as Record<string, unknown>).orders as Order[] : null;

  if (!orders) {
    throw createHttpError(502, 'Resposta inválida do provedor de IA.', 'Payload sem array de pedidos');
  }

  const isValid = orders.every(order => (
    order &&
    typeof order === 'object' &&
    !Array.isArray(order) &&
    Array.isArray(order.items)
  ));

  if (!isValid) {
    throw createHttpError(502, 'Resposta inválida do provedor de IA.', 'Pedidos sem formato esperado');
  }

  return orders;
}

function buildUserContent(text?: string, imageBase64?: string, imageMimeType?: string): string | Array<Record<string, unknown>> {
  const promptText = text || 'Extraia os dados do pedido de cotação.';
  if (!imageBase64) return promptText;

  return [
    { type: 'text', text: promptText },
    {
      type: 'image_url',
      image_url: {
        url: `data:${imageMimeType || 'image/png'};base64,${imageBase64}`,
      },
    },
  ];
}

function extractAssistantText(data: Record<string, unknown>): string {
  const content = (data?.choices as Array<Record<string, unknown>>)?.[0]?.message?.content as string | undefined;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(part => part?.type === 'text' && typeof part.text === 'string')
      .map(part => part.text)
      .join('');
  }
  return '';
}

async function extractWithOpenRouter(
  text?: string,
  imageBase64?: string,
  imageMimeType?: string,
  customRules?: string,
  existingItems?: Array<{ item_code: string; qty: number }> | null
): Promise<Order[]> {
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim() || '';
  const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL?.trim() || 'google/gemini-2.5-flash';

  if (!OPENROUTER_API_KEY) {
    throw createHttpError(500, 'Serviço de extração indisponível.', 'OPENROUTER_API_KEY não configurada');
  }

  validateInput(text, imageBase64, imageMimeType);

  const headers = {
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'X-OpenRouter-Title': 'Aspen Orcamento App',
  };

  const referer = process.env.OPENROUTER_SITE_URL?.trim() || process.env.URL?.trim() || process.env.DEPLOY_PRIME_URL?.trim();
  if (referer) {
    headers['HTTP-Referer'] = referer;
  }

  const body = {
    model: OPENROUTER_MODEL,
    messages: [
      { role: 'system', content: buildSystemPrompt(customRules, existingItems) },
      { role: 'user', content: buildUserContent(text, imageBase64, imageMimeType) },
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
    const upstreamMessage = data?.error?.message || responseText || `OpenRouter retornou HTTP ${res.status}`;
    throw createHttpError(502, 'Falha ao extrair pedido no provedor de IA.', `OpenRouter HTTP ${res.status}: ${upstreamMessage}`);
  }

  const raw = extractAssistantText(data);
  if (!raw) {
    throw createHttpError(502, 'Resposta inválida do provedor de IA.', 'Resposta sem conteúdo textual');
  }

  const parsed = parseJsonSafely(unwrapJsonText(raw));
  if (parsed == null) {
    throw createHttpError(502, 'Resposta inválida do provedor de IA.', 'JSON inválido retornado pelo provedor');
  }

  return normalizeOrdersPayload(parsed);
}

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  try {
    const orders = await extractWithOpenRouter(
      payload.text as string | undefined,
      payload.imageBase64 as string | undefined,
      payload.imageMimeType as string | undefined,
      payload.rules as string | undefined,
      payload.existingItems as Array<{ item_code: string; qty: number }> | undefined
    );
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders }),
    };
  } catch (err) {
    const typedErr = err as { statusCode?: number; logMessage?: string; message?: string };
    const statusCode = Number.isInteger(typedErr?.statusCode) ? typedErr.statusCode! : 500;
    console.error('[extract]', typedErr?.logMessage || typedErr?.message || err);
    return {
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: typedErr?.message || 'Erro interno na extração.' }),
    };
  }
}
