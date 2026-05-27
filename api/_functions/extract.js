// ── Regras de extração padrão (editáveis via UI) ──
const DEFAULT_RULES = `Rule 0 — SKU Explícito tem Precedência: Se o usuário informar SKUs explícitos (ex: CNG-SAL-70), use exatamente esses SKUs sem expandir.

Rule 1 — Quantidade Mínima: Se a quantidade solicitada for < 30, use 30 (mínimo para produção).

Rule 2 — Quantidade no campo qty: Use a quantidade EXATA solicitada pelo cliente. NÃO mapeie a quantidade para faixas — o sistema já aplica as faixas de precificação (30, 100, 300, 500, 1000) automaticamente para calcular o preço unitário. Ex: se o cliente pedir 50, use qty:50.

Rule 3 — Regras por Produto:
- Lenços: Se o cliente mencionar "laser", usar LNC-SED-LAS-70 (ou o tamanho correspondente). Caso contrário, cotar DUAS opções: LNC-SED-70 (Sedinha 70x70 - econômico) e LNC-CSD-70 (Cetim de Seda 70x70 - premium). Se 55x55cm pedido, cotar 50x50cm.
- Chapéus: Sempre cotar TRÊS opções: CHP-PAN, CHP-PNR, CHP-BAM (exceto se SKU especificado).
- Cangas: Se mencionar "laser", usar CNG-SAL-LAS-70 ou CNG-SAL-LAS-100. Caso contrário (se < 100 unidades): Cotar CNG-SAL-70 e CNG-SAL-100. Cangas >= 100: Cotar CNG-SAL-70, CNG-SAL-100, CNG-VIS-70, CNG-VIS-100.
- Toalhas (Praia): Sempre duas opções: TWL-210 e TWL-280.
- Toalhas de Banho: Sempre três opções: TBH-LEM (Leme 375g/m² - econômico), TBH-URC (Urca 405g/m² - intermediário), TBH-IPA (Ipanema 450g/m² - premium).
- Bonés < 100: Cotar apenas BNE-TAC-VNL. Bonés >= 100: Cotar BNE-TAC-SUB, BNE-BRI, BNE-PRE.
- Cachecóis: Sempre quatro opções: CHC-SOF-140 (Soft 140x20cm - econômico), CHC-SOF-180 (Soft 180x20cm - intermediário), CHC-LAA-COU (Lã com etiqueta de couro) e CHC-LAA-BOR (Lã com bordado - premium).
- Ecobags: Sempre três opções: ECO-30, ECO-35, ECO-50.

Rule 4 — Múltiplas Quantidades: Se o cliente pedir o mesmo produto em quantidades diferentes (ex: "80 e 100 lenços"), inclua TODAS as combinações como linhas separadas no MESMO objeto de pedido. Ex: LNC-SED-70 qty:80, LNC-CSD-70 qty:80, LNC-SED-70 qty:100, LNC-CSD-70 qty:100 — tudo num único objeto do array.

Formato Brindice: Se encontrar colunas PRODUTO | CÓD | QTD | NOME | TEL | E-MAIL, ignore a coluna CÓD. Use NOME como nome do cliente.

Urgência: urgente=true se prazo < 15 dias úteis (aplica +30% no preço).`;

function buildSystemPrompt(customRules) {
  const rules = customRules?.trim() || DEFAULT_RULES;
  return `Você é um assistente de cotação da Aspen Estamparia. Extraia os dados do pedido e aplique as regras de negócio.

REGRAS DE NEGÓCIO:

${rules}

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

function createHttpError(statusCode, publicMessage, logMessage) {
  const error = new Error(publicMessage);
  error.statusCode = statusCode;
  error.logMessage = logMessage || publicMessage;
  return error;
}

function estimateBase64Bytes(base64) {
  const normalized = (base64 || '').replace(/\s+/g, '');
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function parseJsonSafely(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function unwrapJsonText(raw) {
  const trimmed = String(raw || '').trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function validateInput(text, imageBase64, imageMimeType) {
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

function normalizeOrdersPayload(parsed) {
  const orders = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.orders) ? parsed.orders : null;

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

function buildUserContent(text, imageBase64, imageMimeType) {
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

function extractAssistantText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(part => part?.type === 'text' && typeof part.text === 'string')
      .map(part => part.text)
      .join('');
  }
  return '';
}

async function extractWithOpenRouter(text, imageBase64, imageMimeType, customRules) {
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
      { role: 'system', content: buildSystemPrompt(customRules) },
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

export async function handler(event) {
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
    const orders = await extractWithOpenRouter(
      payload.text,
      payload.imageBase64,
      payload.imageMimeType,
      payload.rules
    );
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders }),
    };
  } catch (err) {
    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[extract]', err?.logMessage || err?.message || err);
    return {
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err?.message || 'Erro interno na extração.' }),
    };
  }
}
