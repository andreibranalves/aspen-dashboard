/**
 * WhatsApp Flow Helpers — centralized flow defaults, persistence,
 * payload conversion, summaries, template rendering, and image parsing.
 *
 * Pure TS module — no React imports. Safe in SSR/Node tests where
 * localStorage may be unavailable.
 */

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------
export const LS_WA_FLOWS = 'aspen_wa_flows';
export const LS_WA_SELECTED_FLOW = 'aspen_wa_selected_flow';
const LS_WA_FLOWS_VERSION = 'aspen_wa_flows_v';
const CURRENT_FLOWS_VERSION = 2; // bump on breaking changes to force re-init

// ---------------------------------------------------------------------------
// Step type constants
// ---------------------------------------------------------------------------
export const STEP_TYPES = {
  TEXT: 'text',
  IMAGE: 'image',
  DOCUMENT: 'document',
  PRODUCT_IMAGES: 'product_images',
  PRODUCT_MEDIA: 'product_media',
} as const;

export type StepType = (typeof STEP_TYPES)[keyof typeof STEP_TYPES];

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------
export interface Step {
  id: string;
  type: StepType;
  template: string;
  media: string;
  source: string;
  caption: string;
}

export interface Flow {
  id: string;
  name: string;
  description: string;
  vendor_name: string;
  delay_min_seconds: number;
  delay_max_seconds: number;
  max_images_per_category: number;
  default: boolean;
  steps: Step[];
  sample_images_text: string;
}

export interface SequenceStep {
  type: StepType;
  template?: string;
  source?: string;
  caption?: string;
  media?: string;
}

export interface SequencePayload {
  vendor_name: string;
  delay_min_ms: number;
  delay_max_ms: number;
  max_images_per_category: number;
  sample_images: SampleImages;
  steps: SequenceStep[];
}

export interface TemplateContext {
  Saudacao?: string;
  nome?: string;
  primeiro_nome?: string;
  numero_pedido?: string;
  empresa?: string;
  link_orcamento?: string;
  vendedora?: string;
  produto_resumo?: string;
  produto_adjetivo_personalizado?: string;
  categories?: string[];
  categorias?: string[];
  [key: string]: string | string[] | undefined;
}

export type SampleImages = Record<string, string[]>;

export interface ApiFetchResult {
  flows: Flow[];
  selectedFlowId: string | null;
}

// ---------------------------------------------------------------------------
// Default flow definitions
// ---------------------------------------------------------------------------
export const DEFAULT_WA_FLOWS: Flow[] = [
  {
    id: 'already-talking',
    name: 'Já estou falando com o cliente',
    description: 'Mensagem curta + PDF para conversas já iniciadas no WhatsApp.',
    vendor_name: 'Juliana',
    delay_min_seconds: 1,
    delay_max_seconds: 2,
    max_images_per_category: 0,
    default: true,
    steps: [
      {
        id: 'step-greeting',
        type: 'text',
        template: 'Segue o orçamento solicitado, (primeiro_nome)!',
        media: '',
        source: '',
        caption: '',
      },
      {
        id: 'step-pdf',
        type: 'document',
        template: '',
        media: '',
        source: 'quotation_pdf',
        caption: 'Orçamento (numero_pedido)',
      },
    ],
    sample_images_text: '',
  },
  {
    id: 'email-first-contact',
    name: 'Primeiro contato — pedido veio por e-mail',
    description: 'Apresentação, contexto comercial e envio do orçamento.',
    vendor_name: 'Juliana',
    delay_min_seconds: 5,
    delay_max_seconds: 8,
    max_images_per_category: 2,
    default: false,
    steps: [
      {
        id: 'step-greeting',
        type: 'text',
        template: 'Boa tarde, (primeiro_nome)! Tudo bem?',
        media: '',
        source: '',
        caption: '',
      },
      {
        id: 'step-context',
        type: 'text',
        template:
          'Meu nome é (vendedora), da (empresa). Recebemos seu pedido de orçamento para (produto_resumo) (produto_adjetivo_personalizado).',
        media: '',
        source: '',
        caption: '',
      },
      {
        id: 'step-quotation',
        type: 'text',
        template: 'Segue o orçamento (numero_pedido):\n(link_orcamento)',
        media: '',
        source: '',
        caption: '',
      },
      {
        id: 'step-samples-intro',
        type: 'text',
        template:
          'Também estou te enviando algumas fotos de referência dos modelos para você visualizar melhor as opções.',
        media: '',
        source: '',
        caption: '',
      },
      {
        id: 'step-product-images',
        type: 'product_images',
        template: '',
        media: '',
        source: '',
        caption: '',
      },
    ],
    sample_images_text: '',
  },
];

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------
export function createId(prefix = 'flow'): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 6);
  return `${prefix}_${ts}${rand}`;
}

// ---------------------------------------------------------------------------
// Flow normalization
// ---------------------------------------------------------------------------
const STEP_DEFAULTS: Step = {
  id: '',
  type: 'text',
  template: '',
  media: '',
  source: '',
  caption: '',
};

const FLOW_DEFAULTS: Flow = {
  id: '',
  name: '',
  description: '',
  vendor_name: '',
  delay_min_seconds: 1,
  delay_max_seconds: 3,
  max_images_per_category: 0,
  default: false,
  steps: [],
  sample_images_text: '',
};

/**
 * Ensure a raw flow object has all required fields with safe defaults.
 * Each step is also normalized.
 */
export function normalizeFlow(rawFlow: Partial<Flow>, index = 0): Flow {
  const flow = { ...FLOW_DEFAULTS, ...rawFlow } as Flow;
  flow.id = flow.id || (index !== undefined ? `flow_${index}` : createId());
  flow.name = flow.name || `Sequência ${(index || 0) + 1}`;
  flow.delay_min_seconds = Number(flow.delay_min_seconds) || FLOW_DEFAULTS.delay_min_seconds;
  flow.delay_max_seconds = Number(flow.delay_max_seconds) || FLOW_DEFAULTS.delay_max_seconds;
  flow.max_images_per_category = Number(flow.max_images_per_category) || 0;
  flow.sample_images_text = flow.sample_images_text || '';
  flow.steps = Array.isArray(flow.steps) ? flow.steps.map(normalizeStep) : [];
  return flow;
}

const PRODUCT_CATEGORY_GENDERS: Record<string, 'f' | 'm'> = {
  canga: 'f',
  lenço: 'm',
  boné: 'm',
  toalha: 'f',
  chapéu: 'm',
  ecobag: 'f',
  cachecol: 'm',
};

function normalizeProductSummaryTemplate(template: string | null | undefined): string {
  return typeof template === 'string'
    ? template
        .replace(
          /\(produto_resumo\)\s+personalizado\(a\)/g,
          '(produto_resumo) (produto_adjetivo_personalizado)'
        )
        .replace(
          /\(produto_resumo\)\s+personalizados\(as\)/g,
          '(produto_resumo) (produto_adjetivo_personalizado)'
        )
    : '';
}

function normalizeStep(rawStep: Partial<Step>, index: number): Step {
  const step: Step = { ...STEP_DEFAULTS, ...rawStep };
  step.id = step.id || `step-${index}`;
  step.template = normalizeProductSummaryTemplate(step.template || '');
  step.media = step.media || '';
  step.source = step.source || '';
  step.caption = step.caption || '';
  return step;
}

// ---------------------------------------------------------------------------
// localStorage helpers (with SSR/Node fallback)
// ---------------------------------------------------------------------------
function getLocalStorage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage;
    }
  } catch {
    // localStorage not available (SSR, Node tests)
  }
  return null;
}

/**
 * Load flows from localStorage, falling back to DEFAULT_WA_FLOWS.
 * Returns a deep clone to avoid mutation of defaults.
 * Migrates old versions automatically.
 */
export function loadWhatsappFlows(): Flow[] {
  const ls = getLocalStorage();
  if (ls) {
    try {
      const storedVersion = Number(ls.getItem(LS_WA_FLOWS_VERSION) || 0);
      const stored = ls.getItem(LS_WA_FLOWS);
      if (stored && storedVersion >= CURRENT_FLOWS_VERSION) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((f: Partial<Flow>, i: number) => normalizeFlow(f, i));
        }
      }
      // Version mismatch or corrupted data — reset to defaults
      ls.removeItem(LS_WA_FLOWS);
      ls.removeItem(LS_WA_SELECTED_FLOW);
    } catch {
      // corrupted data, fall through
    }
  }
  // Store fresh defaults
  const defaults = DEFAULT_WA_FLOWS.map((f, i) => normalizeFlow(f, i));
  if (ls) {
    try {
      ls.setItem(LS_WA_FLOWS, JSON.stringify(defaults));
      ls.setItem(LS_WA_FLOWS_VERSION, String(CURRENT_FLOWS_VERSION));
      ls.setItem(LS_WA_SELECTED_FLOW, defaults[0].id);
    } catch {
      /* quota exceeded */
    }
  }
  return defaults;
}

/**
 * Save flows to localStorage. Silently no-ops in SSR/Node.
 */
export function saveWhatsappFlows(flows: Flow[]): void {
  const ls = getLocalStorage();
  if (ls) {
    try {
      ls.setItem(LS_WA_FLOWS, JSON.stringify(flows));
      ls.setItem(LS_WA_FLOWS_VERSION, String(CURRENT_FLOWS_VERSION));
    } catch {
      // quota exceeded or unavailable
    }
  }
}

/**
 * Get the selected flow ID from localStorage, falling back to the first flow's ID.
 */
export function getSelectedFlowId(flows: Flow[]): string | null {
  const ls = getLocalStorage();
  if (ls) {
    try {
      const stored = ls.getItem(LS_WA_SELECTED_FLOW);
      if (stored && flows.some((f) => f.id === stored)) {
        return stored;
      }
    } catch {
      // fall through
    }
  }
  return flows.length > 0 ? flows[0].id : null;
}

/**
 * Save the selected flow ID to localStorage. Silently no-ops in SSR/Node.
 */
export function saveSelectedFlowId(flowId: string | null): void {
  const ls = getLocalStorage();
  if (ls) {
    try {
      ls.setItem(LS_WA_SELECTED_FLOW, String(flowId));
    } catch {
      // unavailable
    }
  }
}

// ---------------------------------------------------------------------------
// Flow summary (human-readable Portuguese)
// ---------------------------------------------------------------------------
/**
 * Return a human-readable Portuguese summary of a flow.
 * Examples: "4 mensagens + fotos por produto", "1 mensagem + PDF"
 */
export function getFlowSummary(flow: { steps?: Step[] } | null | undefined): string {
  if (!flow || !Array.isArray(flow.steps)) return '';

  const textCount = flow.steps.filter(
    (s) => s.type === 'text' && s.template && s.template.trim()
  ).length;
  const pdfCount = flow.steps.filter(
    (s) => s.type === 'document' && s.source === 'quotation_pdf'
  ).length;
  const webpCount = flow.steps.filter(
    (s) => s.type === 'document' && s.source === 'quotation_webp'
  ).length;
  const imageCount = flow.steps.filter((s) => s.type === 'image' && s.media).length;
  const hasProductImages = flow.steps.some(
    (s) => s.type === 'product_images' || s.type === 'product_media'
  );

  const parts: string[] = [];

  if (textCount > 0) {
    parts.push(`${textCount} ${textCount === 1 ? 'mensagem' : 'mensagens'}`);
  }

  if (pdfCount > 0) {
    parts.push('PDF');
  }

  if (webpCount > 0) {
    parts.push('WebP');
  }

  if (imageCount > 0) {
    parts.push(`${imageCount} ${imageCount === 1 ? 'imagem' : 'imagens'}`);
  }

  if (hasProductImages) {
    parts.push('mídia da biblioteca');
  }

  return parts.join(' + ') || 'vazio';
}

// ---------------------------------------------------------------------------
// Payload conversion (flow → backend-accepted sequence payload)
// ---------------------------------------------------------------------------
/**
 * Convert a flow to the payload format accepted by send-whatsapp.js.
 *
 * - Drops steps that are effectively empty (whitespace-only text,
 *   empty media/image, empty source/document).
 * - Parses sample_images_text into the sample_images object.
 * - Converts delay seconds to milliseconds.
 */
export function flowToSequencePayload(flow: Flow): SequencePayload {
  const cleanedSteps = (flow.steps || [])
    .filter((step) => {
      if (step.type === 'text') {
        return step.template && step.template.trim().length > 0;
      }
      if (step.type === 'image') {
        return step.media && step.media.trim().length > 0;
      }
      if (step.type === 'document') {
        return step.source && step.source.trim().length > 0;
      }
      // product_media and other types pass through
      return true;
    })
    .map((step) => {
      // Return a clean object with only relevant fields per type
      const s: SequenceStep = { type: step.type };
      if (step.type === 'text') {
        s.template = step.template;
      } else if (step.type === 'document') {
        s.source = step.source;
        if (step.caption) s.caption = step.caption;
      } else if (step.type === 'image') {
        s.media = step.media;
        if (step.caption) s.caption = step.caption;
      }
      // product_media and product_images have no extra fields
      return s;
    });

  return {
    vendor_name: flow.vendor_name || '',
    delay_min_ms: (flow.delay_min_seconds || 0) * 1000,
    delay_max_ms: (flow.delay_max_seconds || 0) * 1000,
    max_images_per_category: flow.max_images_per_category || 0,
    sample_images: parseSampleImages(flow.sample_images_text),
    steps: cleanedSteps,
  };
}

// ---------------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------------
/**
 * Replace template variables in a string with values from a context object.
 *
 * Supported variables:
 *   (Saudacao), (nome), (primeiro_nome), (numero_pedido),
 *   (empresa), (link_orcamento), (vendedora), (produto_resumo),
 *   (produto_adjetivo_personalizado)
 *
 * (Saudacao) is time-based in America/Sao_Paulo: 5-11:59 → "Bom dia",
 * 12-17:59 → "Boa tarde", 18-4:59 → "Boa noite".
 *
 * Unknown variables are left as-is.
 */
function readTemplateContext(ctx: TemplateContext, plainKey: string, tokenKey: string): string {
  const raw = ctx[plainKey] ?? ctx[tokenKey];
  return typeof raw === 'string' ? raw : '';
}

function productPersonalizationAdjectiveFromCategories(categories: string[] = []): string {
  const genders = categories
    .map((category) => PRODUCT_CATEGORY_GENDERS[category])
    .filter(Boolean) as ('f' | 'm')[];
  return genders.length > 0 && genders.every((gender) => gender === 'f')
    ? 'personalizadas'
    : 'personalizados';
}

export function renderFlowTemplate(
  template: string | null | undefined,
  context: TemplateContext
): string {
  if (!template) return '';

  const ctx: TemplateContext = { ...context };

  // Time-based greeting
  if (!ctx.Saudacao && template.includes('(Saudacao)')) {
    ctx.Saudacao = getTimeBasedGreeting();
  }

  const productCategories = ctx.categories || ctx.categorias || [];
  const productPersonalizationAdjective =
    readTemplateContext(
      ctx,
      'produto_adjetivo_personalizado',
      '(produto_adjetivo_personalizado)'
    ) || productPersonalizationAdjectiveFromCategories(productCategories);

  const variableMap: Record<string, string> = {
    '(Saudacao)': readTemplateContext(ctx, 'Saudacao', '(Saudacao)'),
    '(nome)':
      readTemplateContext(ctx, 'nome', '(nome)') ||
      readTemplateContext(ctx, 'primeiro_nome', '(primeiro_nome)'),
    '(primeiro_nome)':
      readTemplateContext(ctx, 'primeiro_nome', '(primeiro_nome)') ||
      readTemplateContext(ctx, 'nome', '(nome)'),
    '(numero_pedido)': readTemplateContext(ctx, 'numero_pedido', '(numero_pedido)'),
    '(empresa)': readTemplateContext(ctx, 'empresa', '(empresa)'),
    '(link_orcamento)': readTemplateContext(ctx, 'link_orcamento', '(link_orcamento)'),
    '(vendedora)': readTemplateContext(ctx, 'vendedora', '(vendedora)'),
    '(produto_resumo)': readTemplateContext(ctx, 'produto_resumo', '(produto_resumo)'),
    '(produto_adjetivo_personalizado)': productPersonalizationAdjective,
  };

  let result = normalizeProductSummaryTemplate(template);
  for (const [key, value] of Object.entries(variableMap)) {
    result = result.replaceAll(key, value);
  }

  return result;
}

export const WHATSAPP_TIME_ZONE = 'America/Sao_Paulo';

function getHourInTimeZone(date = new Date(), timeZone = WHATSAPP_TIME_ZONE): number {
  const hourPart = new Intl.DateTimeFormat('pt-BR', {
    hour: 'numeric',
    hour12: false,
    timeZone,
  })
    .formatToParts(date)
    .find((part) => part.type === 'hour');

  return Number.parseInt(hourPart?.value || '0', 10);
}

export function getTimeBasedGreeting(
  date = new Date(),
  timeZone = WHATSAPP_TIME_ZONE
): string {
  const hour = getHourInTimeZone(date, timeZone);
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

// ---------------------------------------------------------------------------
// Sample images parsing
// ---------------------------------------------------------------------------
/**
 * Parse sample_images_text format into a category → URL array map.
 *
 * Input format:
 *   canga: https://site/canga-01.jpg, https://site/canga-02.jpg
 *   lenço: https://site/lenco-01.jpg
 *
 * Returns { canga: ['https://...', 'https://...'], lenço: ['https://...'] }
 */
export function parseSampleImages(text: unknown): SampleImages {
  if (!text || typeof text !== 'string') return {};

  const result: SampleImages = {};
  const lines = text.split('\n').filter((line) => line.trim().length > 0);

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const category = line.substring(0, colonIdx).trim();
    const urlsPart = line.substring(colonIdx + 1).trim();

    if (!category || !urlsPart) continue;

    const urls = urlsPart
      .split(',')
      .map((u) => u.trim())
      .filter((u) => u.length > 0);

    if (urls.length > 0) {
      result[category] = urls;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// API-based flow persistence (server-side, replaces localStorage for global state)
// ---------------------------------------------------------------------------

/**
 * Fetch flows from the server API.
 * Returns flows and selected flow ID.
 * Falls back to localStorage if API is unreachable.
 */
export async function fetchFlowsFromApi(): Promise<ApiFetchResult> {
  try {
    const res = await fetch('/api/whatsapp-flows');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      success?: boolean;
      flows?: unknown[];
      selectedFlowId?: string | null;
    };
    if (data.success && Array.isArray(data.flows)) {
      const flows = data.flows.map((f: unknown, i: number) =>
        normalizeFlow(f as Partial<Flow>, i)
      );
      const selectedFlowId = data.selectedFlowId || flows[0]?.id || null;
      return { flows, selectedFlowId };
    }
    throw new Error('Invalid API response');
  } catch (err) {
    console.warn(
      '[whatsappFlows] API fetch failed, falling back to localStorage:',
      (err as Error).message
    );
    const flows = loadWhatsappFlows();
    const selectedFlowId = getSelectedFlowId(flows);
    return { flows, selectedFlowId };
  }
}

/**
 * Save flows to the server API.
 * Returns true on success, false on failure.
 * Also updates localStorage as a fallback mirror.
 */
export async function saveFlowsToApi(
  flows: Flow[],
  selectedFlowId: string | null
): Promise<boolean> {
  try {
    const res = await fetch('/api/whatsapp-flows', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flows, selectedFlowId }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { success?: boolean; error?: string };
    if (data.success) {
      // Mirror to localStorage as fallback
      saveWhatsappFlows(flows);
      saveSelectedFlowId(selectedFlowId);
      return true;
    }
    throw new Error(data.error || 'Unknown error');
  } catch (err) {
    console.error('[whatsappFlows] API save failed:', (err as Error).message);
    // Still save to localStorage so the current user doesn't lose changes
    saveWhatsappFlows(flows);
    saveSelectedFlowId(selectedFlowId);
    return false;
  }
}
