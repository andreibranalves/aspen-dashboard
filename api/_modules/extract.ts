import type { FunctionResult, LegacyHandler } from '../_http/types.js';
import { getOpenRouterClient } from '../_infrastructure/integrations/openrouter/client.js';
import { getOpenRouterConfig } from '../_infrastructure/integrations/openrouter/config.js';
import {
  createOrderTemplateRepository,
  type OrderTemplateRecord,
  type OrderTemplateRepository,
} from '../_infrastructure/db/repositories/order-template-repository.js';
import { safeErrorSummary, safeLogMessage } from '../_shared/safe-error.js';

// ── Regras de extração padrão ──
export const DEFAULT_RULES = `Rule 0 — SKU Explícito (TEXTO): Se o cliente informar SKUs explícitos NO CORPO DO TEXTO (ex: alguém digitou "CNG-SAL-70"), use exatamente esses SKUs sem expandir.

Rule 0a — IMAGENS: Ao processar uma IMAGEM (print de tabela, foto de catálogo, screenshot), NUNCA use códigos de produto que aparecem na imagem como item_code. Códigos visíveis em imagens (ex: "LENCO9090", "BRD-123") são códigos internos do sistema de origem (Brindice, etc) e NÃO são SKUs da Aspen. Em vez disso, identifique o TIPO DE PRODUTO pelo nome/descrição visível na imagem e aplique as regras de negócio abaixo para mapear para os SKUs corretos da Aspen.

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

Formato Brindice: Se encontrar colunas PRODUTO | CÓD | QTD | NOME | TEL | E-MAIL, ignore a coluna CÓD. Use NOME como nome do cliente.`;

export interface ExtractionOrderTemplate {
  id: string;
  name: string;
  items: Array<{ sku: string; name: string; position: number }>;
}

export function buildSystemPrompt(
  customRules?: string,
  existingItems?: Array<{ item_code: string; qty: number }> | null,
  orderTemplate?: ExtractionOrderTemplate | null
): string {
  const rules = customRules?.trim() || DEFAULT_RULES;
  let mergeInstruction = '';
  let orderTemplateInstruction = '';
  if (orderTemplate) {
    const skus = orderTemplate.items
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((item) => `- ${item.sku}`)
      .join('\n');
    orderTemplateInstruction = `

TEMPLATE DE PEDIDO SELECIONADO: ${orderTemplate.name}
SKUs autorizados, na ordem:
${skus}

Ignore qualquer produto ou SKU mencionado no pedido.
Extraia as quantidades solicitadas e use apenas os SKUs autorizados nos itens.
Aplique cada quantidade a todos os SKUs autorizados.`;
  }
  if (Array.isArray(existingItems) && existingItems.length > 0) {
    const itemsText = existingItems
      .filter((it) => it && it.item_code)
      .map((it) => `- ${it.item_code}: ${it.qty || 0} un`)
      .join('\n');
    mergeInstruction = `\n\nO usuário está COMPLEMENTANDO um pedido já existente. Os itens já presentes são:\n${itemsText}\n\nINSTRUÇÕES DE MERGE:\n- Retorne APENAS os novos itens no campo "items".\n- NÃO repita SKUs que já existem na lista acima; se o novo texto pedir algo idêntico, ignore.\n- NÃO altere nome, empresa, e-mail, telefone, origem, CNPJ ou endereço do pedido original.\n- Se o novo texto não adicionar nenhum item novo, retorne "items": [] e mantenha os dados do cliente.`;
  }
  return `Você é um assistente de cotação da Aspen Estamparia. Extraia os dados do pedido e aplique as regras de negócio.

REGRAS DE NEGÓCIO:

${rules}${mergeInstruction}${orderTemplateInstruction}

Prazo pedido: se o cliente mencionar prazo ou data de entrega, copie em "prazo_pedido" o trecho exato da mensagem (ex.: "preciso para 12/12"); caso contrário, null. Não defina prazo nem preço.

RETORNE APENAS JSON válido — um array com um objeto por cliente/pedido:
[
  {
    "nome": "string",
    "empresa": "string ou null",
    "email": "string ou null",
    "telefone": "string ou null",
    "prazo_pedido": "string ou null",
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

Regras para empresa (campo "empresa"):
- Extraia apenas quando o nome da empresa estiver explícito no texto.
- Não confunda o nome da pessoa de contato com o nome da empresa.
- NUNCA invente empresa.

Regras para endereço (campo "endereco"):
- Extraia APENAS se houver dados de endereço no texto (CEP, rua, número, bairro, cidade, UF).
- Preencha apenas os campos encontrados; deixe os demais como string vazia.
- NUNCA invente endereço.

Se houver apenas um pedido, retorne igualmente um array com um único elemento.`;
}

const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_TEXT_LENGTH = 12000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_CUSTOM_RULES_LENGTH = 4000;
const MAX_EXISTING_ITEMS = 100;
const MAX_EXTRACTION_ORDERS = 20;
const MAX_ITEMS_PER_ORDER = 100;
const MAX_ITEM_CODE_LENGTH = 120;
const MAX_TEXT_FIELD_LENGTH = 4000;
const EXTRACTION_TIMEOUT_MS = 20_000;

interface HttpError extends Error {
  statusCode: number;
  expose: boolean;
  logMessage: string;
}

function createHttpError(
  statusCode: number,
  publicMessage: string,
  logMessage?: string
): HttpError {
  const error = new Error(publicMessage) as HttpError;
  error.statusCode = statusCode;
  error.expose = statusCode < 500;
  error.logMessage = logMessage || publicMessage;
  return error;
}

function estimateBase64Bytes(base64: string): number {
  const normalized = (base64 || '').replace(/\s+/g, '');
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

interface ValidatedExtractionInput {
  text?: string;
  imageBase64?: string;
  imageMimeType: string;
}

function validateInput(
  text?: string,
  imageBase64?: string,
  imageMimeType?: string
): ValidatedExtractionInput {
  if (text !== undefined && text !== null && typeof text !== 'string') {
    throw createHttpError(400, 'Texto de extração inválido.');
  }
  if (imageBase64 !== undefined && imageBase64 !== null && typeof imageBase64 !== 'string') {
    throw createHttpError(400, 'Imagem de extração inválida.');
  }
  if (imageMimeType !== undefined && imageMimeType !== null && typeof imageMimeType !== 'string') {
    throw createHttpError(400, 'Formato de imagem inválido.');
  }

  const normalizedText = text?.trim() || undefined;
  const normalizedImage = imageBase64?.replace(/\s+/g, '') || undefined;
  const normalizedMime = imageMimeType?.trim().toLowerCase() || 'image/png';

  if (!normalizedText && !normalizedImage) {
    throw createHttpError(400, 'Envie texto ou imagem para extrair o pedido.');
  }

  if (normalizedText && normalizedText.length > MAX_TEXT_LENGTH) {
    throw createHttpError(400, 'Texto muito longo para extração.');
  }

  if (!normalizedImage) {
    return { text: normalizedText, imageMimeType: normalizedMime };
  }

  if (!ALLOWED_IMAGE_MIME_TYPES.has(normalizedMime)) {
    throw createHttpError(400, 'Formato de imagem não suportado.');
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalizedImage)) {
    throw createHttpError(400, 'Imagem em base64 inválida.');
  }

  if (estimateBase64Bytes(normalizedImage) > MAX_IMAGE_BYTES) {
    throw createHttpError(400, 'Imagem muito grande para extração.');
  }

  return {
    text: normalizedText,
    imageBase64: normalizedImage,
    imageMimeType: normalizedMime,
  };
}

interface OrderItem {
  item_code: string;
  qty: number;
}

interface Order {
  nome: string;
  empresa: string | null;
  email: string | null;
  telefone: string | null;
  prazo_pedido: string | null;
  origem: string | null;
  cnpj: string | null;
  endereco: Record<string, string | null>;
  items: OrderItem[];
}

type ExtractedOrder = Partial<Omit<Order, 'items'>> & { items: OrderItem[] };

function parseTemplateQuantity(value: unknown): number | null {
  const quantity =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())
        ? Number(value.trim())
        : NaN;
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
}

export function applyOrderTemplate(
  orders: ExtractedOrder[],
  template: Pick<OrderTemplateRecord, 'items'>
): ExtractedOrder[] {
  const orderedItems = template.items.slice().sort((a, b) => a.position - b.position);

  if (orderedItems.length === 0) {
    throw createHttpError(422, 'O template de pedido não contém produtos.');
  }

  return orders.map((order) => {
    const quantities: number[] = [];
    const seen = new Set<number>();
    for (const item of Array.isArray(order.items) ? order.items : []) {
      const quantity = parseTemplateQuantity(item?.qty);
      if (quantity === null) continue;
      const normalized = quantity < 30 ? 30 : quantity;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      quantities.push(normalized);
    }

    if (quantities.length === 0) {
      throw createHttpError(422, 'Nenhuma quantidade válida identificada para o template.');
    }

    return {
      ...order,
      items: quantities.flatMap((qty) => orderedItems.map(({ sku }) => ({ item_code: sku, qty }))),
    };
  });
}

function providerResponseError(detail: string): never {
  throw createHttpError(502, 'Resposta inválida do provedor de IA.', detail);
}

function normalizeProviderString(
  value: unknown,
  field: string,
  maxLength = MAX_TEXT_FIELD_LENGTH
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') providerResponseError(`${field} deve ser texto`);
  const normalized = value.trim();
  if (normalized.length > maxLength) providerResponseError(`${field} excede o limite`);
  return normalized;
}

function normalizeProviderAddress(value: unknown): Record<string, string | null> | undefined {
  if (value === undefined) return undefined;
  if (value === null) return {};
  if (!isRecord(value)) providerResponseError('endereco deve ser objeto');

  const address: Record<string, string | null> = {};
  const fields = ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf'];
  for (const field of fields) {
    if (!(field in value)) continue;
    const normalized = normalizeProviderString(value[field], `endereco.${field}`);
    address[field] = normalized ?? null;
  }
  return address;
}

function normalizeProviderOrderItem(value: unknown, orderIndex: number, itemIndex: number): OrderItem {
  if (!isRecord(value)) providerResponseError(`Item ${orderIndex + 1}.${itemIndex + 1} inválido`);
  const itemCode = normalizeProviderString(
    value.item_code,
    `item_code ${orderIndex + 1}.${itemIndex + 1}`,
    MAX_ITEM_CODE_LENGTH
  );
  if (!itemCode) providerResponseError(`item_code ${orderIndex + 1}.${itemIndex + 1} obrigatório`);

  const quantity = parseTemplateQuantity(value.qty);
  if (quantity === null) providerResponseError(`qty ${orderIndex + 1}.${itemIndex + 1} inválido`);

  return { item_code: itemCode, qty: quantity < 30 ? 30 : quantity };
}

function normalizeProviderOrder(value: unknown, orderIndex: number): ExtractedOrder {
  if (!isRecord(value)) providerResponseError(`Pedido ${orderIndex + 1} inválido`);
  if (!Array.isArray(value.items)) providerResponseError(`Pedido ${orderIndex + 1} sem items`);
  if (value.items.length > MAX_ITEMS_PER_ORDER) {
    providerResponseError(`Pedido ${orderIndex + 1} excede o limite de itens`);
  }

  const order: ExtractedOrder = {
    items: value.items.map((item, itemIndex) => normalizeProviderOrderItem(item, orderIndex, itemIndex)),
  };
  const nome = normalizeProviderString(value.nome, 'nome', 255);
  const empresa = normalizeProviderString(value.empresa, 'empresa', 200);
  const email = normalizeProviderString(value.email, 'email', 320);
  const telefone = normalizeProviderString(value.telefone, 'telefone', 64);
  const origem = normalizeProviderString(value.origem, 'origem', 120);
  const cnpj = normalizeProviderString(value.cnpj, 'cnpj', 32);
  // Trecho livre do cliente: truncado em vez de invalidar a extração inteira.
  const prazoPedidoRaw = normalizeProviderString(value.prazo_pedido, 'prazo_pedido', Infinity);
  const prazoPedido = typeof prazoPedidoRaw === 'string' ? prazoPedidoRaw.slice(0, 300) || null : prazoPedidoRaw;
  const endereco = normalizeProviderAddress(value.endereco);

  if (nome !== undefined && nome !== null) order.nome = nome;
  if (empresa !== undefined) order.empresa = empresa;
  if (email !== undefined) order.email = email;
  if (telefone !== undefined) order.telefone = telefone;
  if (origem !== undefined) order.origem = origem;
  if (cnpj !== undefined) order.cnpj = cnpj;
  if (prazoPedido !== undefined) order.prazo_pedido = prazoPedido;
  if (endereco !== undefined) order.endereco = endereco;
  return order;
}

function normalizeOrdersPayload(parsed: unknown): ExtractedOrder[] {
  const orders = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.orders)
      ? parsed.orders
      : null;

  if (!orders) providerResponseError('Payload sem array de pedidos');
  if (orders.length > MAX_EXTRACTION_ORDERS) {
    providerResponseError('Quantidade de pedidos excede o limite');
  }

  return orders.map((order, orderIndex) => normalizeProviderOrder(order, orderIndex));
}

function buildUserContent(
  text?: string,
  imageBase64?: string,
  imageMimeType?: string
): string | Array<Record<string, unknown>> {
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
  const content = (
    (data?.choices as Array<Record<string, unknown>>)?.[0]?.message as
      | Record<string, unknown>
      | undefined
  )?.content as string | Array<Record<string, unknown>> | undefined;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
  }
  return '';
}

async function extractWithOpenRouter(
  text?: string,
  imageBase64?: string,
  imageMimeType?: string,
  customRules?: string,
  existingItems?: Array<{ item_code: string; qty: number }> | null,
  orderTemplate?: ExtractionOrderTemplate | null
): Promise<ExtractedOrder[]> {
  const config = getOpenRouterConfig();
  const input = validateInput(text, imageBase64, imageMimeType);

  if (!config.apiKey) {
    throw createHttpError(
      500,
      'Serviço de extração indisponível.',
      'OPENROUTER_API_KEY não configurada'
    );
  }

  const body = {
    model: config.model,
    messages: [
      {
        role: 'system',
        content: buildSystemPrompt(customRules, existingItems, orderTemplate),
      },
      {
        role: 'user',
        content: buildUserContent(input.text, input.imageBase64, input.imageMimeType),
      },
    ],
    temperature: 0.1,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTRACTION_TIMEOUT_MS);

  try {
    const res = await getOpenRouterClient().request(body, {
      title: 'Aspen Orcamento App',
      signal: controller.signal,
    });
    const responseText = await res.text();
    const data = parseJsonSafely(responseText) as Record<string, unknown>;

    if (!res.ok) {
      throw createHttpError(
        502,
        'Falha ao extrair pedido no provedor de IA.',
        `OpenRouter HTTP ${res.status}`
      );
    }

    const raw = extractAssistantText(data);
    if (!raw) {
      throw createHttpError(
        502,
        'Resposta inválida do provedor de IA.',
        'Resposta sem conteúdo textual'
      );
    }

    const parsed = parseJsonSafely(unwrapJsonText(raw));
    if (parsed == null) {
      throw createHttpError(
        502,
        'Resposta inválida do provedor de IA.',
        'JSON inválido retornado pelo provedor'
      );
    }

    return normalizeOrdersPayload(parsed);
  } catch (error) {
    if (isRecord(error) && Number.isInteger(error.statusCode)) throw error;
    if (controller.signal.aborted) {
      throw createHttpError(
        504,
        'O serviço de extração demorou demais. Tente novamente.',
        'OpenRouter timeout'
      );
    }
    const kind = safeErrorSummary(error);
    throw createHttpError(
      502,
      'Falha ao conectar ao provedor de IA. Tente novamente.',
      `OpenRouter request failed: ${kind}`
    );
  } finally {
    clearTimeout(timeout);
  }
}

function json(statusCode: number, payload: object): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function extractionErrorResponse(error: unknown): FunctionResult {
  const typed = (error || {}) as {
    statusCode?: number;
    expose?: boolean;
    logMessage?: string;
    message?: string;
  };
  const isPublic =
    Number.isInteger(typed.statusCode) &&
    (typed.expose === true || typeof typed.logMessage === 'string');
  console.error('[extract]', safeLogMessage(error));
  return json(isPublic ? typed.statusCode! : 500, {
    error: isPublic && typed.message ? typed.message : 'Erro interno na extração.',
  });
}

interface ExtractionPayload {
  text?: string;
  imageBase64?: string;
  imageMimeType?: string;
  customRules?: string;
  existingItems?: Array<{ item_code: string; qty: number }>;
  orderTemplateId?: string;
  orderTemplateSelections?: Array<{ id: string; quantity: number }>;
}

function normalizeExistingItems(value: unknown): Array<{ item_code: string; qty: number }> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw createHttpError(400, 'existingItems deve ser um array.');
  if (value.length > MAX_EXISTING_ITEMS) {
    throw createHttpError(400, 'Quantidade de itens existentes excede o limite.');
  }

  return value.map((item, index) => {
    if (!isRecord(item)) throw createHttpError(400, `Item existente ${index + 1} inválido.`);
    const itemCode = item.item_code;
    if (typeof itemCode !== 'string' || !itemCode.trim() || itemCode.trim().length > MAX_ITEM_CODE_LENGTH) {
      throw createHttpError(400, `SKU do item existente ${index + 1} inválido.`);
    }
    const quantity = parseTemplateQuantity(item.qty);
    if (quantity === null) throw createHttpError(400, `Quantidade do item existente ${index + 1} inválida.`);
    return { item_code: itemCode.trim(), qty: quantity };
  });
}

function normalizeExtractionPayload(value: unknown): ExtractionPayload {
  if (!isRecord(value)) throw createHttpError(400, 'Envie um payload válido.');

  const text = value.text === undefined || value.text === null
    ? undefined
    : typeof value.text === 'string'
      ? value.text.trim() || undefined
      : (() => { throw createHttpError(400, 'Texto de extração inválido.'); })();
  const imageBase64 = value.imageBase64 === undefined || value.imageBase64 === null
    ? undefined
    : typeof value.imageBase64 === 'string'
      ? value.imageBase64
      : (() => { throw createHttpError(400, 'Imagem de extração inválida.'); })();
  const imageMimeType = value.imageMimeType === undefined || value.imageMimeType === null
    ? undefined
    : typeof value.imageMimeType === 'string'
      ? value.imageMimeType.trim().toLowerCase() || undefined
      : (() => { throw createHttpError(400, 'Formato de imagem inválido.'); })();
  const customRules = value.rules === undefined || value.rules === null
    ? undefined
    : typeof value.rules === 'string'
      ? value.rules.trim() || undefined
      : (() => { throw createHttpError(400, 'Regras de extração inválidas.'); })();

  if (customRules && customRules.length > MAX_CUSTOM_RULES_LENGTH) {
    throw createHttpError(400, 'Regras de extração muito longas.');
  }

  const orderTemplateId = value.orderTemplateId === undefined || value.orderTemplateId === null
    ? undefined
    : typeof value.orderTemplateId === 'string'
      ? value.orderTemplateId.trim() || undefined
      : (() => { throw createHttpError(400, 'Template de pedido inválido.'); })();
  const orderTemplateSelections = value.orderTemplateSelections === undefined
    ? undefined
    : Array.isArray(value.orderTemplateSelections) && value.orderTemplateSelections.length <= 20
      ? value.orderTemplateSelections.map((selection, index) => {
          if (!isRecord(selection) || typeof selection.id !== 'string' || !selection.id.trim()) {
            throw createHttpError(400, `Template inline ${index + 1} inválido.`);
          }
          const quantity = parseTemplateQuantity(selection.quantity);
          if (quantity === null) throw createHttpError(400, `Quantidade do template inline ${index + 1} inválida.`);
          return { id: selection.id.trim(), quantity: Math.max(30, quantity) };
        })
      : (() => { throw createHttpError(400, 'Templates inline inválidos.'); })();

  if (orderTemplateId && orderTemplateSelections?.length) {
    throw createHttpError(400, 'Use o seletor ou templates inline, não os dois ao mesmo tempo.');
  }

  return {
    text,
    imageBase64,
    imageMimeType,
    customRules,
    existingItems: normalizeExistingItems(value.existingItems),
    orderTemplateId,
    orderTemplateSelections,
  };
}

export interface ExtractHandlerDependencies {
  extractOrders: typeof extractWithOpenRouter;
  orderTemplates: Pick<OrderTemplateRepository, 'getForExtraction'>;
}

export function createExtractHandler(
  dependencies: ExtractHandlerDependencies = {
    extractOrders: extractWithOpenRouter,
    orderTemplates: createOrderTemplateRepository(),
  }
): LegacyHandler {
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return json(405, { error: 'Método não permitido.' });
    }

    let rawPayload: unknown;
    try {
      rawPayload = JSON.parse(event.body || '');
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
    }

    try {
      const payload = normalizeExtractionPayload(rawPayload);
      const template = payload.orderTemplateId
        ? await dependencies.orderTemplates.getForExtraction(payload.orderTemplateId)
        : undefined;
      const inlineTemplates = await Promise.all(
        (payload.orderTemplateSelections || []).map(async ({ id, quantity }) => ({
          template: await dependencies.orderTemplates.getForExtraction(id),
          quantity,
        }))
      );
      const args = [
        payload.text,
        payload.imageBase64,
        payload.imageMimeType,
        payload.customRules,
        payload.existingItems,
      ] as const;
      const orders = template
        ? await dependencies.extractOrders(...args, template)
        : await dependencies.extractOrders(...args);
      const resolvedOrders = inlineTemplates.length
        ? orders.map((order) => ({
            ...order,
            items: inlineTemplates.flatMap(({ template: inlineTemplate, quantity }) =>
              inlineTemplate.items
                .slice()
                .sort((a, b) => a.position - b.position)
                .map(({ sku }) => ({ item_code: sku, qty: quantity }))
            ),
          }))
        : template ? applyOrderTemplate(orders, template) : orders;
      return json(200, { orders: resolvedOrders });
    } catch (error) {
      return extractionErrorResponse(error);
    }
  };
}

export const handler = createExtractHandler();
