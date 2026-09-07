import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type ChangeEvent,
} from 'react';
import {
  AlertTriangle,
  Building2,
  Calculator,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  MapPin,
  PackagePlus,
  Plus,
  RotateCcw,
  Search,
  ShoppingCart,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api/api';
import { issuePersistedDraft } from '@/lib/api/quotationIssueApi';
import { listQuotationTemplates, type QuotationTemplateMetadata } from '@/lib/api/quotationTemplatesApi';
import {
  isUnpricedProduct,
  searchProducts as cachedSearchProducts,
} from '@/lib/api/productCache';
import { useRouteGuardContext } from '@/hooks/useHashRoute';
import type { OrcamentoResponse, Product } from '@/types/domain';
import { formatBRL, fmtPhone, capitalize, formatPhoneInput, normalizePhoneDigits } from '@/lib/formatting/formatters';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import PageShell from '@/components/shared/PageShell';
import { useToast } from '@/components/shared/toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  LEAD_SOURCES,
  EMPTY_ADDRESS,
  isValidLeadSource,
  normalizeCnpj,
  isValidCnpj,
  formatCnpj,
  normalizeAddress,
  hasAnyAddressField,
  formatAddressSummary,
  type Address,
} from '@/lib/clientMetadata';
import {
  clearQuotationOriginPrefill,
  loadQuotationOriginPrefill,
  type QuotationOriginPrefill,
} from '@/features/crm/quotationOriginPrefill';

// ── Constants ──
const CLIENT_TYPE = { EXISTING: 'existing', NEW: 'new' } as const;
const DEFAULT_QTY = 30;

interface Client {
  id: string;
  nome: string;
  email?: string;
  telefone?: string;
  cnpj?: string;
  tipo?: string;
}

interface NewClient {
  nome: string;
  email: string;
  telefone: string;
}

interface CartItem {
  _key: string;
  sku: string;
  nome: string;
  qty: number;
  rate: number;
  _rateManual: boolean;
}

interface PricingLookupResponse {
  items?: Array<{ rate?: number | string }>;
}

interface LeadsClientsResponse {
  data?: Client[];
}

function toNumber(value: string | number, fallback = 0): number {
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function makeItemKey(sku: string): string {
  return `${sku}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// ── Draft persistence (manual quotation) ──
// Same philosophy as autoQuoteDraftStorage: losing a filled form to an
// accidental navigation is unacceptable. Storage failures never block editing.
const MANUAL_DRAFT_STORAGE_KEY = 'aspen_manual_draft';
const MANUAL_DRAFT_STORAGE_VERSION = 1;

interface ManualDraft {
  version: number;
  clientType: string;
  clientSearch: string;
  selectedClient: Client | null;
  newClient: NewClient;
  leadSource: string;
  cnpj: string;
  address: Address;
  showAddress: boolean;
  items: CartItem[];
  prazo: string;
  observacoes: string;
  urgente: boolean;
  templateKey: string;
  originPrefill?: QuotationOriginPrefill;
}

function isNewClient(value: unknown): value is NewClient {
  if (typeof value !== 'object' || value === null) return false;
  const client = value as Record<string, unknown>;
  return typeof client.nome === 'string' && typeof client.email === 'string' && typeof client.telefone === 'string';
}

function isCartItem(value: unknown): value is CartItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item._key === 'string' &&
    typeof item.sku === 'string' &&
    typeof item.nome === 'string' &&
    typeof item.qty === 'number' && Number.isFinite(item.qty) && item.qty > 0 &&
    typeof item.rate === 'number' && Number.isFinite(item.rate) && item.rate >= 0 &&
    typeof item._rateManual === 'boolean'
  );
}

function isManualDraft(value: unknown): value is ManualDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Record<string, unknown>;
  const originPrefill = draft.originPrefill;
  const hasValidOriginPrefill = originPrefill === undefined || (
    typeof originPrefill === 'object' &&
    originPrefill !== null &&
    typeof (originPrefill as Record<string, unknown>).quoteLeadId === 'string' &&
    typeof (originPrefill as Record<string, unknown>).crmDealId === 'string' &&
    typeof (originPrefill as Record<string, unknown>).leadName === 'string' &&
    typeof (originPrefill as Record<string, unknown>).email === 'string' &&
    typeof (originPrefill as Record<string, unknown>).telefone === 'string' &&
    typeof (originPrefill as Record<string, unknown>).source === 'string'
  );
  return (
    draft.version === MANUAL_DRAFT_STORAGE_VERSION &&
    typeof draft.clientType === 'string' &&
    isNewClient(draft.newClient) &&
    Array.isArray(draft.items) &&
    draft.items.every(isCartItem) &&
    hasValidOriginPrefill
  );
}

function loadManualDraft(): ManualDraft | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MANUAL_DRAFT_STORAGE_KEY) || 'null');
    return isManualDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function saveManualDraft(draft: ManualDraft): void {
  try {
    window.localStorage.setItem(MANUAL_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // localStorage indisponível ou cheio; a edição continua.
  }
}

function clearManualDraft(): void {
  try {
    window.localStorage.removeItem(MANUAL_DRAFT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export default function ManualOrcamentoPage() {
  const { toast } = useToast();
  // ── Client state ──
  const [clientType, setClientType] = useState<string>(CLIENT_TYPE.NEW);
  const [clientSearch, setClientSearch] = useState<string>('');
  const [clientResults, setClientResults] = useState<Client[]>([]);
  const [clientSearching, setClientSearching] = useState<boolean>(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [newClient, setNewClient] = useState<NewClient>({ nome: '', email: '', telefone: '' });
  const [originPrefill, setOriginPrefill] = useState<QuotationOriginPrefill | null>(null);
  const clientTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Client metadata ──
  const [leadSource, setLeadSource] = useState<string>('');
  const [cnpj, setCnpj] = useState<string>('');
  const [address, setAddress] = useState<Address>({ ...EMPTY_ADDRESS });
  const [showAddress, setShowAddress] = useState<boolean>(false);

  // ── Product state ──
  const [productSearch, setProductSearch] = useState<string>('');
  const [productResults, setProductResults] = useState<Product[]>([]);
  const [productSearching, setProductSearching] = useState<boolean>(false);
  const [addingSku, setAddingSku] = useState<string | null>(null);
  const [pricingRows, setPricingRows] = useState<Set<string>>(new Set());
  const productTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Cart state ──
  const [items, setItems] = useState<CartItem[]>([]); // { sku, nome, qty, rate, _key, _rateManual }

  // ── Form state ──
  const [prazo, setPrazo] = useState<string>('');
  const [observacoes, setObservacoes] = useState<string>('');
  const [urgente, setUrgente] = useState<boolean>(false);

  // ── Quotation template ──
  const [templates, setTemplates] = useState<QuotationTemplateMetadata[]>([]);
  const [templateKey, setTemplateKey] = useState<string>('');
  const [templateLoading, setTemplateLoading] = useState<boolean>(true);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const templateOverrideRef = useRef<string | null>(null);
  // ── Destructive-action confirmation ──
  const [confirmClear, setConfirmClear] = useState<boolean>(false);
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setTemplateLoading(true);
    setTemplateError(null);
    try {
      const response = await listQuotationTemplates(true);
      const available = response.templates || response.data || [];
      setTemplates(available);
      const defaultKey = response.default_key || available.find((template) => template.is_default)?.key || '';
      setTemplateKey(templateOverrideRef.current ?? defaultKey);
    } catch {
      setTemplateError('Não foi possível carregar os modelos de orçamento.');
    } finally {
      setTemplateLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  // ── Submit state ──
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [issuing, setIssuing] = useState<boolean>(false);
  const manualIssueInFlight = useRef(false);
  const manualIssueKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const pricingVersionsRef = useRef<Record<string, number>>({});
  const nextPricingVersion = useCallback((_key: string): number => {
    const version = (pricingVersionsRef.current[_key] || 0) + 1;
    pricingVersionsRef.current[_key] = version;
    return version;
  }, []);
  const [result, setResult] = useState<OrcamentoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Pricing helpers ──
  const lookupRate = useCallback(async (sku: string, qty: number, urgentValue = urgente): Promise<number> => {
    const res = await apiPost<PricingLookupResponse>('/pricing-lookup', {
      items: [{ item_code: sku, qty }],
      urgent: urgentValue,
    });
    const priced = res.items?.[0];
    const rate = priced?.rate == null ? Number.NaN : Number(priced.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error('Preço indisponível para este produto.');
    }
    return rate;
  }, [urgente]);

  const repriceAutoItems = useCallback(async (urgentValue: boolean) => {
    const autoItems = items.filter(item => !item._rateManual);
    if (autoItems.length === 0) return;

    setPricingRows(new Set(autoItems.map(item => item._key)));
    const requested = autoItems.map((item) => ({
      ...item,
      version: nextPricingVersion(item._key),
    }));
    try {
      const pricedItems = await Promise.all(requested.map(async (item) => ({
        _key: item._key,
        sku: item.sku,
        qty: item.qty,
        version: item.version,
        rate: await lookupRate(item.sku, item.qty, urgentValue),
      })));
      const priceMap = new Map(pricedItems.map(item => [item._key, item]));
      setItems(prev => prev.map(item => {
        const priced = priceMap.get(item._key);
        if (!priced || pricingVersionsRef.current[item._key] !== priced.version) return item;
        if (item.sku !== priced.sku || item.qty !== priced.qty || item._rateManual) return item;
        return { ...item, rate: priced.rate };
      }));
    } catch {
      // mantém os preços atuais se a precificação não responder
    } finally {
      setPricingRows(new Set());
    }
  }, [items, lookupRate, nextPricingVersion]);

  // ── Client search ──
  const searchClients = useCallback(async (term: string) => {
    if (!term || term.length < 2) { setClientResults([]); return; }
    setClientSearching(true);
    try {
      const res = await apiGet<LeadsClientsResponse>(`/leads-clients?search=${encodeURIComponent(term)}&limit=10`);
      setClientResults(res.data || []);
    } catch {
      setClientResults([]);
    } finally {
      setClientSearching(false);
    }
  }, []);

  const onClientSearchChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setClientSearch(val);
    setSelectedClient(null);
    if (clientTimer.current) clearTimeout(clientTimer.current);
    clientTimer.current = setTimeout(() => searchClients(val), 300);
  }, [searchClients]);

  const selectClient = useCallback((c: Client) => {
    setSelectedClient(c);
    setClientSearch(`${c.nome} (${c.email || c.telefone || c.id})`);
    setClientResults([]);
    setClientType(CLIENT_TYPE.EXISTING);
    // Preencher CNPJ se o cliente tiver e o campo estiver vazio
    if (c.cnpj && !cnpj) {
      setCnpj(normalizeCnpj(c.cnpj));
    }
  }, [cnpj]);

  // ── Product search ──
  const searchProductsLocal = useCallback(async (term: string) => {
    if (!term || term.length < 2) { setProductResults([]); return; }
    setProductSearching(true);
    try {
      const data = await cachedSearchProducts(term, 8);
      setProductResults(data);
    } catch {
      setProductResults([]);
    } finally {
      setProductSearching(false);
    }
  }, []);

  const onProductSearchChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setProductSearch(val);
    if (productTimer.current) clearTimeout(productTimer.current);
    productTimer.current = setTimeout(() => searchProductsLocal(val), 300);
  }, [searchProductsLocal]);

  // ── Item operations ──
  const addProduct = useCallback(async (product: Product) => {
    if (!product?.sku || addingSku) return;
    setAddingSku(product.sku);
    setError(null);

    try {
      if (isUnpricedProduct(product)) {
        throw new Error('Preço indisponível para este produto.');
      }
      const rate = await lookupRate(product.sku, DEFAULT_QTY, urgente);
      setItems(prev => [
        ...prev,
        {
          _key: makeItemKey(product.sku),
          sku: product.sku,
          nome: product.nome || product.sku,
          qty: DEFAULT_QTY,
          rate,
          _rateManual: false,
        },
      ]);
      setProductSearch('');
      setProductResults([]);
    } catch {
      // An unavailable lookup must not create a zero-rate line. The user can
      // retry after pricing is configured while the cart remains consistent.
      setError('Preço indisponível para este produto.');
    } finally {
      setAddingSku(null);
    }
  }, [addingSku, lookupRate, urgente]);

  const updateItemQty = useCallback(async (_key: string, value: string | number) => {
    const parsedQty = toNumber(value, 1);
    const qty = Math.max(0.001, Math.round(parsedQty * 1000) / 1000);
    const current = items.find(item => item._key === _key);
    if (!current) return;

    setItems(prev => prev.map(item => (item._key === _key ? { ...item, qty } : item)));
    if (current._rateManual) return;

    const requestVersion = nextPricingVersion(_key);
    const requestedSku = current.sku;
    setPricingRows(prev => new Set(prev).add(_key));
    try {
      const rate = await lookupRate(requestedSku, qty, urgente);
      setItems(prev => prev.map(item => (
        item._key === _key &&
        pricingVersionsRef.current[_key] === requestVersion &&
        item.sku === requestedSku &&
        item.qty === qty &&
        !item._rateManual
          ? { ...item, rate }
          : item
      )));
    } catch {
      // mantém preço atual
    } finally {
      setPricingRows(prev => {
        const next = new Set(prev);
        next.delete(_key);
        return next;
      });
    }
  }, [items, lookupRate, nextPricingVersion, urgente]);

  const updateItemRate = useCallback((_key: string, value: string | number) => {
    nextPricingVersion(_key);
    const rate = Math.max(0, toNumber(value, 0));
    setItems(prev => prev.map(item => (
      item._key === _key ? { ...item, rate, _rateManual: true } : item
    )));
  }, [nextPricingVersion]);

  const resetItemRate = useCallback(async (_key: string) => {
    const current = items.find(item => item._key === _key);
    if (!current) return;
    const requestVersion = nextPricingVersion(_key);
    const requestedSku = current.sku;
    const requestedQty = current.qty;
    setPricingRows(prev => new Set(prev).add(_key));
    try {
      const rate = await lookupRate(requestedSku, requestedQty, urgente);
      setItems(prev => prev.map(item => (
        item._key === _key &&
        pricingVersionsRef.current[_key] === requestVersion &&
        item.sku === requestedSku &&
        item.qty === requestedQty
          ? { ...item, rate, _rateManual: false }
          : item
      )));
    } catch {
      // mantém preço atual
    } finally {
      setPricingRows(prev => {
        const next = new Set(prev);
        next.delete(_key);
        return next;
      });
    }
  }, [items, lookupRate, nextPricingVersion, urgente]);

  const removeItem = useCallback((_key: string) => {
    setItems(prev => prev.filter(item => item._key !== _key));
  }, []);

  const onUrgenteChange = useCallback((checked: boolean) => {
    setUrgente(checked);
    repriceAutoItems(checked);
  }, [repriceAutoItems]);

  // ── Computed ──
  const subtotal = items.reduce((sum, item) => sum + item.qty * item.rate, 0);
  const manualPriceCount = items.filter(item => item._rateManual).length;
  const hasZeroPrice = items.some(item => Number(item.rate) === 0);

  // ── Active client info ──
  const getClientInfo = useCallback((): { nome: string; email: string; telefone: string } => {
    if (clientType === CLIENT_TYPE.EXISTING && selectedClient) {
      return {
        nome: selectedClient.nome,
        email: selectedClient.email || '',
        telefone: selectedClient.telefone || '',
      };
    }
    return {
      nome: newClient.nome.trim(),
      email: newClient.email.trim(),
      telefone: newClient.telefone.trim(),
    };
  }, [clientType, selectedClient, newClient]);

  const hasClient = Boolean(getClientInfo().nome);
  const hasItems = items.length > 0;
  const actionBlockMessage = !hasClient && !hasItems
    ? 'Informe o cliente e adicione ao menos um item para continuar.'
    : !hasClient
      ? 'Informe o cliente para continuar.'
      : !hasItems
        ? 'Adicione ao menos um item para continuar.'
        : !leadSource
          ? 'Selecione a origem para continuar.'
          : !isValidLeadSource(leadSource)
            ? 'Selecione uma origem válida para continuar.'
            : null;
  const canSubmit = !actionBlockMessage && !submitting;

  const buildManualPayload = useCallback(() => {
    const { nome, email, telefone } = getClientInfo();
    return {
      extracted: {
        nome,
        email: email || null,
        telefone: telefone || null,
        urgente,
        origem: leadSource || undefined,
        cnpj: cnpj || undefined,
        endereco: hasAnyAddressField(address) ? address : undefined,
        items: items.map(item => ({
          item_code: item.sku,
          item_name: item.nome,
          qty: item.qty,
          rate: item.rate,
          manual_rate: item._rateManual,
        })),
        ...(clientType === CLIENT_TYPE.EXISTING && selectedClient ? { client_id: selectedClient.id } : {}),
        prazo_producao: prazo || undefined,
        pagamento: undefined,
        entrega: undefined,
        frete: undefined,
        validade_dias: undefined,
        ...(templateKey ? { template_key: templateKey } : {}),
        ...(observacoes.trim() ? { observacoes: observacoes.trim() } : {}),
        ...(originPrefill
          ? { quote_lead_id: originPrefill.quoteLeadId, crm_deal_id: originPrefill.crmDealId }
          : {}),
      },
    };
  }, [address, cnpj, clientType, getClientInfo, items, leadSource, observacoes, originPrefill, prazo, selectedClient, templateKey, urgente]);

  // ── Submit ──
  const handleSubmit = useCallback(async () => {
    const { nome } = getClientInfo();
    if (!nome) { toast('Informe o cliente para continuar.', 'error'); return; }
    if (items.length === 0) { toast('Adicione ao menos um item para continuar.', 'error'); return; }
    if (!leadSource) { toast('Selecione a origem para continuar.', 'error'); return; }
    if (!isValidLeadSource(leadSource)) { toast('Origem selecionada não é válida.', 'error'); return; }
    if (cnpj && !isValidCnpj(cnpj)) { toast('CNPJ informado é inválido. Corrija ou deixe em branco.', 'error'); return; }

    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const res = await apiPost<OrcamentoResponse>('/orcamento', buildManualPayload());
      setResult(res);
      clearManualDraft();
      clearQuotationOriginPrefill();
    } catch {
      setError('Não foi possível salvar o rascunho. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  }, [buildManualPayload, cnpj, getClientInfo, items, leadSource, toast]);

  const handlePreview = useCallback(() => {
    const { nome } = getClientInfo();
    if (!nome) { toast('Informe o nome do cliente.', 'error'); return; }
    if (items.length === 0) { toast('Adicione ao menos um produto.', 'error'); return; }
    if (cnpj && !isValidCnpj(cnpj)) { toast('CNPJ informado é inválido.', 'error'); return; }
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/api/quotation-preview?format=html';
    form.target = '_blank';
    form.style.display = 'none';
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'payload';
    input.value = JSON.stringify(buildManualPayload());
    form.append(input);
    document.body.append(form);
    form.submit();
    form.remove();
  }, [buildManualPayload, cnpj, getClientInfo, items.length, toast]);

  const handleIssue = useCallback(async () => {
    const { nome } = getClientInfo();
    if (!nome) { toast('Informe o cliente para continuar.', 'error'); return; }
    if (items.length === 0) { toast('Adicione ao menos um item para continuar.', 'error'); return; }
    if (!leadSource) { toast('Selecione a origem para continuar.', 'error'); return; }
    if (!isValidLeadSource(leadSource)) { toast('Origem selecionada não é válida.', 'error'); return; }
    if (manualIssueInFlight.current) return;
    const payload = buildManualPayload();
    const fingerprint = JSON.stringify(payload);
    const current = manualIssueKey.current;
    const key = current?.fingerprint === fingerprint ? current.key : globalThis.crypto.randomUUID();
    manualIssueKey.current = { fingerprint, key };
    manualIssueInFlight.current = true;
    setIssuing(true);
    setError(null);
    try {
      // Same transition as every other flow: persist the draft first, then
      // issue it by reference so the server owns the commercial content.
      const created = await apiPost<OrcamentoResponse>('/orcamento', payload);
      const revisionId = String(created.revision_id || '');
      const concurrencyToken = String(created.concurrency_token || '');
      if (!revisionId || !concurrencyToken) throw new Error('Resposta inválida ao salvar o rascunho do orçamento.');
      const issue = await issuePersistedDraft(revisionId, concurrencyToken, key);
      clearManualDraft();
      clearQuotationOriginPrefill();
      setResult({ success: true, quotation_id: issue.businessNumber, quotation_uuid: issue.quotationId, revision_id: issue.revisionId, revision: issue.revisionNumber, status: issue.status });
    } catch {
      setError('Não foi possível emitir o orçamento. Tente novamente.');
    } finally {
      manualIssueInFlight.current = false;
      setIssuing(false);
    }
  }, [buildManualPayload, getClientInfo, items.length, leadSource, toast]);

  // ── Reset all ──
  const resetForm = useCallback(() => {
    manualIssueKey.current = null;
    setItems([]);
    setResult(null);
    setError(null);
    setPrazo('');
    setObservacoes('');
    setUrgente(false);
    setSelectedClient(null);
    setClientSearch('');
    setClientResults([]);
    setNewClient({ nome: '', email: '', telefone: '' });
    setClientType(CLIENT_TYPE.NEW);
    setLeadSource('');
    setCnpj('');
    setAddress({ ...EMPTY_ADDRESS });
    setShowAddress(false);
    setProductSearch('');
    setProductResults([]);
    setAddingSku(null);
    setPricingRows(new Set());
    clearManualDraft();
    clearQuotationOriginPrefill();
    setOriginPrefill(null);
    if (window.location.hash.includes('?')) window.history.replaceState(null, '', '#/manual');
  }, []);

  // ── Draft persistence ──
  const draftRestoredRef = useRef<boolean>(false);
  useEffect(() => {
    if (draftRestoredRef.current) return;
    draftRestoredRef.current = true;
    const prefill = loadQuotationOriginPrefill();
    if (prefill) {
      setOriginPrefill(prefill);
      setClientType(CLIENT_TYPE.NEW);
      setNewClient({
        nome: prefill.leadName,
        email: prefill.email,
        telefone: formatPhoneInput(prefill.telefone),
      });
      return;
    }
    const draft = loadManualDraft();
    if (!draft) return;
    if (Array.isArray(draft.items)) setItems(draft.items);
    if (draft.clientType) setClientType(draft.clientType);
    setSelectedClient(draft.selectedClient ?? null);
    setClientSearch(draft.clientSearch || '');
    setNewClient(draft.newClient ?? { nome: '', email: '', telefone: '' });
    if (draft.leadSource) setLeadSource(draft.leadSource);
    if (draft.cnpj) setCnpj(draft.cnpj);
    if (draft.address) setAddress(draft.address);
    setShowAddress(Boolean(draft.showAddress));
    if (draft.prazo) setPrazo(draft.prazo);
    if (draft.observacoes) setObservacoes(draft.observacoes);
    setUrgente(Boolean(draft.urgente));
    if (draft.originPrefill) setOriginPrefill(draft.originPrefill);
    if (draft.templateKey) {
      templateOverrideRef.current = draft.templateKey;
      setTemplateKey(draft.templateKey);
    }
  }, []);

  const hasFormData = Boolean(
    items.length > 0 ||
    getClientInfo().nome ||
    leadSource ||
    cnpj ||
    hasAnyAddressField(address) ||
    prazo ||
    observacoes.trim(),
  );

  useEffect(() => {
    if (result) return;
    if (!hasFormData) {
      clearManualDraft();
      return;
    }
    saveManualDraft({
      version: MANUAL_DRAFT_STORAGE_VERSION,
      clientType,
      clientSearch,
      selectedClient,
      newClient,
      leadSource,
      cnpj,
      address,
      showAddress,
      items,
      prazo,
      observacoes,
      urgente,
      templateKey,
      originPrefill: originPrefill || undefined,
    });
  }, [result, hasFormData, clientType, clientSearch, selectedClient, newClient, leadSource, cnpj, address, showAddress, items, prazo, observacoes, urgente, templateKey, originPrefill]);

  // ── Navigation guard: filled form must never die silently ──
  const { setNavigationGuard } = useRouteGuardContext();
  useEffect(() => {
    if (!hasFormData || result) {
      setNavigationGuard(null);
      setPendingRoute(null);
      return;
    }
    setNavigationGuard((nextRoute) => {
      setPendingRoute(nextRoute);
      return false;
    });
    return () => setNavigationGuard(null);
  }, [hasFormData, result, setNavigationGuard]);

  // ── Render ──
  return (
    <PageShell className="space-y-6">
      {!result && (
        <header>
          <h1 className="text-xl font-semibold tracking-tight text-fg">Novo orçamento</h1>
          {originPrefill && (
            <p className="mt-2 text-sm text-fg-muted" role="status">
              Origem: {originPrefill.source === 'site_form' ? 'Formulário do site' : originPrefill.source || 'Oportunidade CRM'}
            </p>
          )}
        </header>
      )}

      {/* ══ Success Result ══ */}
      {result && (
        <div className="bg-success/10 border border-success/30 rounded-lg p-5 space-y-4" role="status" aria-live="polite">
          {(() => {
            const businessNumber = result.quotation_id || '';
            return (
              <>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-success flex items-center justify-center">
              <Check size={18} className="text-on-solid" />
            </div>
            <div>
              <p className="font-semibold text-success">{result.status === 'emitido' ? 'Orçamento emitido' : 'Rascunho salvo'}</p>
              <p className="text-sm text-success">
                {capitalize(result.cliente || '')} · {businessNumber}
                {result.revision ? ` · Revisão ${result.revision}` : ''}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={resetForm}>
              Novo orçamento
            </Button>
            {(result.quotation_id || result.quotation_uuid) && (
              <Button
                size="sm"
                onClick={() => {
                  window.location.hash = `/quotations/${result.quotation_uuid || result.quotation_id}`;
                }}
              >
                Abrir orçamento
              </Button>
            )}
          </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ══ Error ══ */}
      {error && !result && (
        <div className="bg-red-50 border border-red-200 dark:bg-red-500/10 dark:border-red-800/40 rounded-lg p-4 flex items-start gap-3" role="alert">
          <AlertTriangle size={20} className="text-destructive shrink-0" />
          <div>
            <p className="font-medium text-destructive">Erro ao salvar ou emitir orçamento</p>
            <p className="text-sm text-destructive">{error}</p>
          </div>
        </div>
      )}

      {!result && (
        <>
          <div className="w-full max-w-[1060px] grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">
            <div className="space-y-5 min-w-0">
              {/* ══ 1. Cliente ══ */}
              <section aria-label="Seleção de cliente" className="rounded-lg border border-line bg-surface p-5 space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-card-foreground flex items-center gap-2">
                      <UserPlus size={18} /> 1. Cliente
                    </h2>
                    <p className="text-sm text-fg-muted mt-1">Use um cadastro existente ou crie o contato nesta venda.</p>
                  </div>

                  <div className="flex gap-1 bg-surface-muted/60 border border-line rounded-lg p-0.5 w-fit">
                    <button
                      onClick={() => { setClientType(CLIENT_TYPE.NEW); setSelectedClient(null); setClientSearch(''); }}
                      className={cn(
                        'px-3 py-1.5 text-sm rounded-md transition-colors',
                        clientType === CLIENT_TYPE.NEW ? 'bg-surface shadow-sm font-medium text-fg border border-line/60' : 'text-fg-muted hover:text-fg',
                      )}
                      aria-label="Cadastrar novo cliente"
                    >
                      Novo cliente
                    </button>
                    <button
                      onClick={() => { setClientType(CLIENT_TYPE.EXISTING); setNewClient({ nome: '', email: '', telefone: '' }); }}
                      className={cn(
                        'px-3 py-1.5 text-sm rounded-md transition-colors',
                        clientType === CLIENT_TYPE.EXISTING ? 'bg-surface shadow-sm font-medium text-fg border border-line/60' : 'text-fg-muted hover:text-fg',
                      )}
                      aria-label="Buscar cliente existente"
                    >
                      Buscar existente
                    </button>
                  </div>
                </div>

                {clientType === CLIENT_TYPE.EXISTING ? (
                  <div className="space-y-3">
                    <div className="relative w-full">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
                      <Input
                        placeholder="Buscar por nome, email ou telefone…"
                        value={clientSearch}
                        onChange={onClientSearchChange}
                        className="pl-9 w-full"
                        aria-label="Buscar cliente"
                      />
                      {clientSearching && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <Loader2 size={14} className="animate-spin text-fg-muted" />
                        </div>
                      )}
                    </div>

                    {clientResults.length > 0 && (
                      <div className="border border-line rounded-lg divide-y divide-border max-h-60 overflow-y-auto bg-surface">
                        {clientResults.map(client => (
                          <button
                            key={client.id}
                            onClick={() => selectClient(client)}
                            className={cn(
                              'w-full text-left px-3 py-3 hover:bg-surface-muted/50 transition-colors flex items-center justify-between gap-3',
                              selectedClient?.id === client.id && 'bg-primary/5',
                            )}
                            aria-label={`Selecionar ${client.nome}`}
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{client.nome || client.id}</p>
                              <p className="text-xs text-fg-muted truncate">
                                {[client.email, client.telefone ? fmtPhone(client.telefone) : '', 'Cliente']
                                  .filter(Boolean).join(' · ')}
                              </p>
                            </div>
                            <span className={cn(
                              'text-[10px] px-2 py-1 rounded-full shrink-0',
                              'bg-success/10 text-success',
                            )}>
                              Cliente
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    <div>
                      <label className="text-xs text-fg-muted mb-1 block">Nome *</label>
                      <Input
                        placeholder="Nome completo"
                        value={newClient.nome}
                        onChange={e => setNewClient(prev => ({ ...prev, nome: e.target.value }))}
                        aria-label="Nome do cliente"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-fg-muted mb-1 block">E-mail</label>
                      <Input
                        type="email"
                        placeholder="email@exemplo.com"
                        value={newClient.email}
                        onChange={e => setNewClient(prev => ({ ...prev, email: e.target.value }))}
                        aria-label="E-mail do cliente"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-fg-muted mb-1 block">Telefone</label>
                      <Input
                        placeholder="(11) 99999-9999"
                        value={formatPhoneInput(newClient.telefone)}
                        onChange={e => setNewClient(prev => ({ ...prev, telefone: normalizePhoneDigits(e.target.value) }))}
                        inputMode="tel"
                        autoComplete="tel"
                        aria-label="Telefone do cliente"
                      />
                    </div>
                  </div>
                )}

                {selectedClient && clientType === CLIENT_TYPE.EXISTING && (
                  <div className="flex flex-wrap items-center gap-2 text-sm bg-primary/5 border border-primary/20 text-fg rounded-lg px-3 py-2">
                    <Check size={14} className="text-primary" />
                    <span className="font-medium">{selectedClient.nome}</span>
                    {selectedClient.email && <span className="text-fg-muted">· {selectedClient.email}</span>}
                    {selectedClient.telefone && <span className="text-fg-muted">· {fmtPhone(selectedClient.telefone)}</span>}
                    {selectedClient.cnpj && (
                      <span className="text-fg-muted text-xs font-mono">· CNPJ {formatCnpj(selectedClient.cnpj)}</span>
                    )}
                  </div>
                )}
                {selectedClient?.cnpj && cnpj && normalizeCnpj(selectedClient.cnpj) !== cnpj && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-800/40 dark:bg-amber-500/10 dark:text-amber-300 flex items-start gap-2">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    CNPJ informado ({formatCnpj(cnpj)}) difere do CNPJ cadastrado ({formatCnpj(selectedClient.cnpj)}). O CNPJ do cadastro será mantido.
                  </div>
                )}

                {/* ── Origem (obrigatória para compatibilidade com CRM) ── */}
                <div className="space-y-1 pt-3 border-t border-line">
                  <label htmlFor="manual-lead-source" className="text-xs font-medium text-fg-muted">Origem *</label>
                  <div className="relative">
                  <select
                    id="manual-lead-source"
                    className="w-full appearance-none rounded-sm border border-line bg-surface pl-3 pr-8 py-2 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page"
                    value={leadSource}
                    onChange={e => setLeadSource(e.target.value)}
                  >
                    <option value="">Selecione a origem…</option>
                    {LEAD_SOURCES.map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted" />
                  </div>
                </div>

                {/* ── CNPJ (opcional) ── */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">CNPJ (opcional)</label>
                  <div className="relative">
                    <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
                    <Input
                      className="h-10 pl-9 text-sm"
                      value={cnpj ? formatCnpj(cnpj) : ''}
                      onChange={e => setCnpj(normalizeCnpj(e.target.value))}
                      placeholder="00.000.000/0000-00"
                      autoComplete="off"
                    />
                  </div>
                  {cnpj && !isValidCnpj(cnpj) && (
                    <p className="text-xs text-destructive">CNPJ inválido. Corrija ou deixe em branco.</p>
                  )}
                </div>

                {/* ── Endereço colapsável ── */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowAddress(!showAddress)}
                    className="flex items-center gap-2 text-xs font-medium text-fg-muted hover:text-fg transition-colors"
                  >
                    <MapPin size={14} />
                    Endereço opcional
                    {showAddress ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  {showAddress && (
                    <div className="mt-2 grid gap-3 md:grid-cols-2">
                      <label className="space-y-1">
                        <span className="text-[10px] text-fg-muted">CEP</span>
                        <Input
                          className="h-9 text-sm font-mono"
                          value={address.cep}
                          onChange={e => setAddress(prev => normalizeAddress({ ...prev, cep: e.target.value }))}
                          placeholder="00000-000"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-fg-muted">Logradouro</span>
                        <Input
                          className="h-9 text-sm"
                          value={address.logradouro}
                          onChange={e => setAddress(prev => normalizeAddress({ ...prev, logradouro: e.target.value }))}
                          placeholder="Rua, Avenida"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-fg-muted">Número</span>
                        <Input
                          className="h-9 text-sm"
                          value={address.numero}
                          onChange={e => setAddress(prev => normalizeAddress({ ...prev, numero: e.target.value }))}
                          placeholder="123"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-fg-muted">Complemento</span>
                        <Input
                          className="h-9 text-sm"
                          value={address.complemento}
                          onChange={e => setAddress(prev => normalizeAddress({ ...prev, complemento: e.target.value }))}
                          placeholder="Apto, Sala"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-fg-muted">Bairro</span>
                        <Input
                          className="h-9 text-sm"
                          value={address.bairro}
                          onChange={e => setAddress(prev => normalizeAddress({ ...prev, bairro: e.target.value }))}
                          placeholder="Bairro"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-fg-muted">Cidade</span>
                        <Input
                          className="h-9 text-sm"
                          value={address.cidade}
                          onChange={e => setAddress(prev => normalizeAddress({ ...prev, cidade: e.target.value }))}
                          placeholder="Cidade"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-fg-muted">UF</span>
                        <Input
                          className="h-9 text-sm w-20"
                          value={address.uf}
                          onChange={e => setAddress(prev => normalizeAddress({ ...prev, uf: e.target.value.toUpperCase().slice(0, 2) }))}
                          placeholder="SP"
                          maxLength={2}
                        />
                      </label>
                    </div>
                  )}
                  {!showAddress && hasAnyAddressField(address) && (
                    <p className="mt-1 text-xs text-fg-muted">{formatAddressSummary(address)}</p>
                  )}
                </div>
              </section>

              {/* ══ 2. Itens ══ */}
              <section aria-label="Itens do orçamento" className="rounded-lg border border-line bg-surface p-5 space-y-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-card-foreground flex items-center gap-2">
                      <PackagePlus size={18} /> 2. Itens do orçamento
                    </h2>
                    <p className="text-sm text-fg-muted mt-1">
                      Busque o produto e ajuste quantidade ou preço na própria tabela.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-fg-muted">
                    <ShoppingCart size={15} />
                    {items.length} {items.length === 1 ? 'item' : 'itens'}
                  </div>
                </div>

                <div className="relative w-full">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
                  <Input
                    placeholder="Digite SKU ou nome para adicionar um produto…"
                    value={productSearch}
                    onChange={onProductSearchChange}
                    className="pl-9 pr-10 w-full"
                    aria-label="Buscar produto para adicionar ao orçamento"
                  />
                  {productSearching && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <Loader2 size={14} className="animate-spin text-fg-muted" />
                    </div>
                  )}
                </div>

                {productResults.length > 0 && (
                  <div className="border border-line rounded-lg overflow-hidden bg-surface divide-y divide-border max-h-72 overflow-y-auto">
                    {productResults.map(product => (
                      <div key={product.sku} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between hover:bg-surface-muted/30 transition-colors">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-fg">
                            <span className="font-mono text-primary">{product.sku}</span>
                            <span className="text-fg-muted"> · </span>
                            {product.nome}
                          </p>
                          {Boolean(product.categoria) && <p className="text-xs text-fg-muted mt-0.5">{String(product.categoria)}</p>}
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => addProduct(product)}
                          disabled={Boolean(addingSku) || isUnpricedProduct(product)}
                          title={isUnpricedProduct(product) ? 'Preço indisponível para este produto.' : undefined}
                          className="w-full sm:w-auto"
                          aria-label={`Adicionar ${product.sku} ao orçamento`}
                        >
                          {isUnpricedProduct(product) ? (
                            'Preço indisponível'
                          ) : (
                            <>
                              {addingSku === product.sku ? (
                                <Loader2 size={14} className="animate-spin mr-1.5" />
                              ) : (
                                <Plus size={14} className="mr-1.5" />
                              )}
                              {addingSku === product.sku ? 'Adicionando…' : 'Adicionar'}
                            </>
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {items.length > 0 ? (
                  <>
                    <div className="hidden md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Produto</TableHead>
                            <TableHead className="w-28 text-right">Qtd</TableHead>
                            <TableHead className="w-40 text-right">Unitário</TableHead>
                            <TableHead className="w-36 text-right">Total</TableHead>
                            <TableHead className="w-16" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {items.map(item => {
                            const rowLoading = pricingRows.has(item._key);
                            return (
                              <TableRow key={item._key}>
                                <TableCell className="min-w-[280px]">
                                  <div className="space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="font-mono text-xs text-primary">{item.sku}</span>
                                      {item._rateManual && (
                                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-300">
                                          preço manual
                                        </span>
                                      )}
                                      {Number(item.rate) === 0 && (
                                        <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-destructive dark:text-red-300">
                                          sem preço
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-sm font-medium text-fg">{item.nome}</p>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">
                                  <Input
                                    type="number"
                                    min="0.001"
                                    step="0.001"
                                    className="h-9 w-24 ml-auto text-right"
                                    value={item.qty}
                                    onChange={e => updateItemQty(item._key, e.target.value)}
                                    aria-label={`Quantidade de ${item.sku}`}
                                  />
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center justify-end gap-2">
                                    {rowLoading && <Loader2 size={14} className="animate-spin text-fg-muted" />}
                                    <div className="relative w-32">
                                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-fg-muted">R$</span>
                                      <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        className="h-9 w-full pl-7 text-right font-mono"
                                        value={item.rate}
                                        onChange={e => updateItemRate(item._key, e.target.value)}
                                        aria-label={`Preço unitário de ${item.sku}`}
                                      />
                                    </div>
                                    {item._rateManual && (
                                      <button
                                        type="button"
                                        onClick={() => resetItemRate(item._key)}
                                        className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-primary transition-colors"
                                        aria-label={`Recalcular preço de ${item.sku}`}
                                      >
                                        <RotateCcw size={14} />
                                      </button>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right font-semibold">
                                  {formatBRL(item.qty * item.rate)}
                                </TableCell>
                                <TableCell className="text-right">
                                  <button
                                    type="button"
                                    onClick={() => removeItem(item._key)}
                                    className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-md text-fg-muted hover:bg-destructive/10 hover:text-destructive transition-colors"
                                    aria-label={`Remover ${item.sku}`}
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>

                    <div className="md:hidden space-y-3">
                      {items.map(item => {
                        const rowLoading = pricingRows.has(item._key);
                        return (
                          <div key={item._key} className="border border-line rounded-lg p-3 space-y-3 bg-surface">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-mono text-xs text-primary">{item.sku}</span>
                                  {item._rateManual && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-300">preço manual</span>}
                                </div>
                                <p className="text-sm font-medium mt-1">{item.nome}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeItem(item._key)}
                                className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-md text-fg-muted hover:bg-destructive/10 hover:text-destructive transition-colors"
                                aria-label={`Remover ${item.sku}`}
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-xs text-fg-muted mb-1 block">Quantidade</label>
                                <Input
                                  type="number"
                                  min="0.001"
                                  step="0.001"
                                  className="h-9"
                                  value={item.qty}
                                  onChange={e => updateItemQty(item._key, e.target.value)}
                                  aria-label={`Quantidade de ${item.sku}`}
                                />
                              </div>
                              <div>
                                <label className="text-xs text-fg-muted mb-1 flex items-center gap-1">
                                  Unitário {rowLoading && <Loader2 size={11} className="animate-spin" />}
                                </label>
                                <div className="relative">
                                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-fg-muted">R$</span>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    className="h-9 pl-7"
                                    value={item.rate}
                                    onChange={e => updateItemRate(item._key, e.target.value)}
                                    aria-label={`Preço unitário de ${item.sku}`}
                                  />
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center justify-between border-t border-line pt-2">
                              {item._rateManual ? (
                                <button
                                  type="button"
                                  onClick={() => resetItemRate(item._key)}
                                  className="inline-flex items-center gap-1.5 text-xs text-primary"
                                >
                                  <RotateCcw size={12} /> Recalcular tabela
                                </button>
                              ) : <span className="text-xs text-fg-muted">Preço da tabela</span>}
                              <span className="font-semibold">{formatBRL(item.qty * item.rate)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg border border-dashed border-line bg-surface-muted/20 overflow-hidden">
                    <div className="grid grid-cols-[1fr_88px_120px_120px] gap-3 border-b border-line bg-surface-muted/30 px-4 py-3 text-xs font-medium uppercase tracking-wide text-fg-muted max-md:hidden">
                      <span>Produto</span>
                      <span className="text-right">Qtd</span>
                      <span className="text-right">Unitário</span>
                      <span className="text-right">Total</span>
                    </div>
                    <div className="px-4 py-10 text-center text-fg-muted">
                      <ShoppingCart size={36} className="mx-auto text-fg-muted/40" />
                      <p className="mt-3 font-medium text-fg">Nenhum produto na tabela</p>
                      <p className="mt-1 text-sm">Pesquise acima e selecione o produto nos resultados da busca. Depois edite quantidade e preço direto na linha do item.</p>
                    </div>
                  </div>
                )}
              </section>

              {/* ══ 3. Condições ══ */}
              <section aria-label="Condições do orçamento" className="rounded-lg border border-line bg-surface p-5 space-y-4">
                <h2 className="text-base font-semibold text-card-foreground flex items-center gap-2">
                  <FileText size={18} /> 3. Condições e fechamento
                </h2>

                {hasZeroPrice && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-500/10 dark:text-red-200 flex items-start gap-2">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    Existe item com preço R$ 0,00. Revise o preço unitário antes de salvar ou emitir.
                  </div>
                )}

                {templateError && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-800/40 dark:bg-amber-500/10 dark:text-amber-300">
                    <span>{templateError}</span>
                    <Button type="button" variant="outline" size="sm" onClick={loadTemplates}>Tentar novamente</Button>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-fg-muted mb-1 block">Prazo de produção</label>
                    <Input
                      placeholder="Ex: 10 a 15 dias"
                      value={prazo}
                      onChange={e => setPrazo(e.target.value)}
                      aria-label="Prazo de produção"
                    />
                  </div>
                  <div>
                    <label htmlFor="manual-quotation-template" className="text-xs text-fg-muted mb-1 block">Modelo de orçamento</label>
                    <select
                      id="manual-quotation-template"
                      className="w-full rounded-sm border border-line bg-surface px-3 py-2 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page"
                      value={templateKey}
                      onChange={(event) => {
                        templateOverrideRef.current = event.target.value;
                        setTemplateKey(event.target.value);
                      }}
                      disabled={templateLoading || templates.length === 0}
                      aria-label="Modelo de orçamento"
                    >
                      {!templateKey && <option value="">Modelo padrão</option>}
                      {templates.map((template) => (
                        <option key={template.key} value={template.key}>{template.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="rounded-lg border border-line bg-surface px-3 py-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Pedido urgente</p>
                      <p className="text-xs text-fg-muted">Recalcula itens com preço automático em +30%.</p>
                    </div>
                    <label className="relative inline-flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        checked={urgente}
                        onChange={e => onUrgenteChange(e.target.checked)}
                        className="peer sr-only"
                      />
                      <span className="h-6 w-11 rounded-full bg-surface-muted transition-colors peer-checked:bg-primary" />
                      <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
                    </label>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-fg-muted mb-1 block">Observações</label>
                  <textarea
                    className="w-full min-h-[88px] rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page resize-y"
                    placeholder="Detalhes de arte, entrega, acabamentos ou condições comerciais…"
                    value={observacoes}
                    onChange={e => setObservacoes(e.target.value)}
                    aria-label="Observações do orçamento"
                  />
                </div>

                {!canSubmit && (
                  <div className="rounded-lg border border-line bg-surface-muted/20 px-3 py-2 text-sm text-fg-muted">
                    Informe cliente e ao menos um item para liberar as ações.
                  </div>
                )}
              </section>
            </div>

            {/* ══ Side Summary ══ */}
            <aside className="xl:sticky xl:top-0 rounded-lg border border-line bg-surface p-5 space-y-4" aria-label="Resumo e ações do orçamento">
              <div className="flex items-center gap-2 text-sm font-semibold text-card-foreground">
                <Calculator size={17} /> Resumo
              </div>

              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-fg-muted">Cliente</span>
                  <span className={cn('font-medium text-right truncate max-w-[180px]', !getClientInfo().nome && 'text-fg-muted/60')}>
                    {getClientInfo().nome || 'Não informado'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-fg-muted">Itens</span>
                  <span className="font-medium">{items.length}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-fg-muted">Urgência</span>
                  <span className={cn('font-medium', urgente ? 'text-primary' : 'text-fg')}>{urgente ? '+30%' : 'Normal'}</span>
                </div>
                {manualPriceCount > 0 && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-fg-muted">Preços manuais</span>
                    <span className="font-medium text-amber-600 dark:text-amber-300">{manualPriceCount}</span>
                  </div>
                )}
              </div>

              <div className="border-t border-line pt-4">
                <div className="flex items-end justify-between gap-3">
                  <span className="text-sm text-fg-muted">Subtotal</span>
                  <span className="text-2xl font-bold tracking-tight [font-variant-numeric:tabular-nums]">
                    {formatBRL(subtotal)}
                  </span>
                </div>
                <p className="text-xs text-fg-muted mt-2">
                  Os preços e totais são confirmados ao salvar ou emitir.
                </p>
              </div>

              <div className="border-t border-line pt-4 space-y-2">
                <Button
                  variant="outline"
                  onClick={handlePreview}
                  disabled={!canSubmit}
                  className="min-h-[44px] w-full"
                  aria-label="Pré-visualizar orçamento"
                  aria-describedby="manual-quotation-action-status"
                >
                  Pré-visualizar
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!canSubmit || issuing}
                  className="min-h-[44px] w-full"
                  aria-label="Salvar rascunho"
                  aria-describedby="manual-quotation-action-status"
                >
                  {submitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin mr-2" />
                      Salvando…
                    </>
                  ) : (
                    'Salvar rascunho'
                  )}
                </Button>
                <Button
                  variant="success"
                  onClick={handleIssue}
                  disabled={!canSubmit || submitting || issuing}
                  className="min-h-[44px] w-full"
                  aria-label="Emitir orçamento"
                  aria-describedby="manual-quotation-action-status"
                >
                  {issuing ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
                  {issuing ? 'Emitindo…' : 'Emitir orçamento'}
                </Button>
                <Button variant="outline" onClick={() => setConfirmClear(true)} disabled={submitting || issuing} className="w-full">
                  Limpar tudo
                </Button>
                <p id="manual-quotation-action-status" className="text-xs text-fg-muted text-left">
                  {actionBlockMessage || 'Pronto para salvar ou emitir.'}
                </p>
              </div>
            </aside>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmClear}
        title="Limpar o formulário?"
        message="Todos os dados preenchidos neste orçamento serão descartados. Um rascunho permanece salvo neste navegador até ser concluído ou descartado."
        confirmLabel="Limpar tudo"
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={() => {
          setConfirmClear(false);
          resetForm();
        }}
        onCancel={() => setConfirmClear(false)}
      />

      <ConfirmDialog
        open={pendingRoute !== null}
        title="Sair sem concluir o orçamento?"
        message="O rascunho permanece salvo neste navegador e será restaurado quando você voltar."
        confirmLabel="Sair da página"
        cancelLabel="Continuar editando"
        variant="default"
        onConfirm={() => {
          const target = pendingRoute;
          setPendingRoute(null);
          setNavigationGuard(null);
          if (target) window.location.hash = target;
        }}
        onCancel={() => setPendingRoute(null)}
      />
    </PageShell>
  );
}
