import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import {
  AlertTriangle,
  FileText,
  Image as ImageIcon,
  Loader2,
  MapPin,
  PackagePlus,
  RotateCcw,
  Search,
  Settings,
  Trash2,
} from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api/api';
import { listQuotationTemplates, type QuotationTemplateMetadata } from '@/lib/api/quotationTemplatesApi';
import { listOrderTemplates, type OrderTemplate } from '@/lib/api/orderTemplatesApi';
import { inlineTemplateSelections } from '@/features/quotations/orderTemplateSelections';
import OrderTemplateManager from '@/features/quotations/components/OrderTemplateManager';
import SplitResultCard from '@/features/quotations/components/SplitResultCard';
import { useImageInput } from '@/hooks/useImageInput';
import { useExtractionDrafts } from '@/hooks/useExtractionDrafts';
import { loadAutoQuoteDrafts, saveAutoQuoteDrafts } from '@/lib/storage/autoQuoteDraftStorage';
import { buildQuotePayload, getQuotationIssue, issuePersistedDraft, QuotationIssueApiError } from '@/lib/api/quotationIssueApi';
import type { Draft, DraftEdited, DraftItem, OrcamentoResponse, Product, StoredAutoQuoteDraft } from '@/types/domain';
import { formatBRL, formatPhoneInput, normalizePhoneDigits, fmtPhone } from '@/lib/formatting/formatters';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import { DetailDrawer } from '@/features/customers/components/DetailDrawer';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { useToast } from '@/components/shared/toast';
import { isUnpricedProduct, searchProducts } from '@/lib/api/productCache';
import {
  EMPTY_ADDRESS,
  LEAD_SOURCES,
  formatAddressSummary,
  hasAnyAddressField,
  isValidCnpj,
  isValidLeadSource,
  formatCnpj,
  normalizeAddress,
  normalizeCnpj,
  type Address,
} from '@/lib/clientMetadata';
import {
  clearQuotationOriginPrefill,
  loadQuotationOriginPrefill,
  type QuotationOriginPrefill,
} from '@/features/crm/quotationOriginPrefill';
import { useRouteGuardContext } from '@/hooks/useHashRoute';
import {
  clearManualQuoteDraft,
  loadManualQuoteDraft,
  saveManualQuoteDraft,
} from '@/lib/storage/manualQuoteDraftStorage';

export type NewQuotationMode = 'conversation' | 'manual';

interface Client {
  id: string;
  nome: string;
  email?: string;
  telefone?: string;
  cnpj?: string;
}

interface CartItem {
  _key: string;
  sku: string;
  nome: string;
  qty: number;
  rate: number;
  _rateManual: boolean;
}

interface ManualForm {
  clientType: 'new' | 'existing';
  clientSearch: string;
  selectedClient: Client | null;
  newClient: { nome: string; email: string; telefone: string };
  leadSource: string;
  cnpj: string;
  address: Address;
  showAddress: boolean;
  items: CartItem[];
  prazo: string;
  pagamento?: string;
  entrega?: string;
  frete?: string;
  validadeDias?: number;
  observacoes: string;
  urgente: boolean;
  templateKey: string;
  originPrefill: QuotationOriginPrefill | null;
}

const CLIENT_TYPE = { NEW: 'new', EXISTING: 'existing' } as const;
const DEFAULT_QTY = 30;

function emptyManual(): ManualForm {
  return {
    clientType: CLIENT_TYPE.NEW,
    clientSearch: '',
    selectedClient: null,
    newClient: { nome: '', email: '', telefone: '' },
    leadSource: '',
    cnpj: '',
    address: { ...EMPTY_ADDRESS },
    showAddress: false,
    items: [],
    prazo: '',
    pagamento: '',
    entrega: '',
    frete: '',
    validadeDias: undefined,
    observacoes: '',
    urgente: false,
    templateKey: '',
    originPrefill: null,
  };
}

function loadInitialAutoDrafts(): StoredAutoQuoteDraft[] {
  try {
    return typeof window === 'undefined' ? [] : loadAutoQuoteDrafts(window.sessionStorage);
  } catch {
    return [];
  }
}

function makeKey(value: string): string {
  return `${value}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function draftHasWork(draft: Draft | null | undefined): boolean {
  if (!draft) return false;
  return Boolean(
    draft.edited.nome.trim() ||
      draft.edited.email.trim() ||
      draft.edited.telefone.trim() ||
      draft.edited.items.some((item) => item.item_code || item.item_name || item.qty > 0) ||
      draft.edited.origem ||
      draft.edited.prazo_producao ||
      draft.edited.observacoes,
  );
}

function manualHasWork(form: ManualForm): boolean {
  return Boolean(
    form.items.length ||
      form.newClient.nome.trim() ||
      form.selectedClient?.nome ||
      form.leadSource ||
      form.cnpj ||
      hasAnyAddressField(form.address) ||
      form.prazo ||
      form.observacoes.trim(),
  );
}

function cloneManual(form: ManualForm): ManualForm {
  return {
    ...form,
    newClient: { ...form.newClient },
    selectedClient: form.selectedClient ? { ...form.selectedClient } : null,
    address: { ...form.address },
    items: form.items.map((item) => ({ ...item })),
    originPrefill: form.originPrefill ? { ...form.originPrefill } : null,
  };
}

function draftToManual(draft: Draft): ManualForm {
  const edited = draft.edited;
  const clientId = edited.client_id;
  const selectedClient = clientId
    ? { id: clientId, nome: edited.nome, email: edited.email, telefone: edited.telefone, cnpj: edited.cnpj }
    : null;
  return {
    clientType: selectedClient ? CLIENT_TYPE.EXISTING : CLIENT_TYPE.NEW,
    clientSearch: selectedClient ? `${edited.nome} (${edited.email || edited.telefone || clientId})` : '',
    selectedClient,
    newClient: { nome: edited.nome, email: edited.email, telefone: edited.telefone },
    leadSource: edited.origem,
    cnpj: edited.cnpj,
    address: { ...edited.endereco },
    showAddress: Boolean(edited._showAddr || hasAnyAddressField(edited.endereco)),
    items: edited.items.map((item) => ({
      _key: makeKey(item.item_code || 'item'),
      sku: item.item_code,
      nome: item.item_name || item.item_code,
      qty: Number(item.qty) || DEFAULT_QTY,
      rate: Number(item.rate) || 0,
      _rateManual: item._rateManual === true,
    })),
    prazo: edited.prazo_producao,
    pagamento: edited.pagamento || '',
    entrega: edited.entrega || '',
    frete: edited.frete || '',
    validadeDias: edited.validade_dias,
    observacoes: edited.observacoes || '',
    urgente: edited.urgente,
    templateKey: edited.template_key || '',
    originPrefill: edited.quote_lead_id && edited.crm_deal_id
      ? {
          quoteLeadId: edited.quote_lead_id,
          crmDealId: edited.crm_deal_id,
          leadName: edited.nome,
          email: edited.email,
          telefone: edited.telefone,
          source: edited.origem,
        }
      : null,
  };
}

function sameEditableDraft(left: DraftEdited, right: DraftEdited): boolean {
  const comparable = (edited: DraftEdited) => ({
    nome: edited.nome,
    email: edited.email,
    telefone: edited.telefone,
    urgente: edited.urgente,
    origem: edited.origem,
    cnpj: edited.cnpj,
    endereco: edited.endereco,
    items: edited.items.map((item) => ({
      item_code: item.item_code,
      item_name: item.item_name || '',
      qty: item.qty,
      rate: item.rate,
      _rateManual: item._rateManual === true,
    })),
    prazo_producao: edited.prazo_producao,
    pagamento: edited.pagamento || '',
    entrega: edited.entrega || '',
    observacoes: edited.observacoes || '',
    frete: edited.frete || '',
    validade_dias: edited.validade_dias ?? null,
    template_key: edited.template_key || '',
    _showAddr: edited._showAddr === true,
    client_id: edited.client_id || '',
    quote_lead_id: edited.quote_lead_id || '',
    crm_deal_id: edited.crm_deal_id || '',
  });
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

function manualToEdited(form: ManualForm): DraftEdited {
  const client = form.clientType === CLIENT_TYPE.EXISTING && form.selectedClient
    ? form.selectedClient
    : { nome: form.newClient.nome, email: form.newClient.email, telefone: form.newClient.telefone };
  return {
    nome: client.nome.trim(),
    email: client.email || '',
    telefone: client.telefone || '',
    urgente: form.urgente,
    origem: form.leadSource,
    cnpj: form.cnpj,
    endereco: { ...form.address },
    _showAddr: form.showAddress,
    client_id: form.clientType === CLIENT_TYPE.EXISTING ? form.selectedClient?.id : undefined,
    quote_lead_id: form.originPrefill?.quoteLeadId,
    crm_deal_id: form.originPrefill?.crmDealId,
    items: form.items.map((item) => ({
      item_code: item.sku,
      item_name: item.nome,
      qty: item.qty,
      rate: item.rate,
      _rateManual: item._rateManual,
    })),
    prazo_producao: form.prazo,
    pagamento: form.pagamento || undefined,
    entrega: form.entrega || undefined,
    observacoes: form.observacoes.trim() || undefined,
    frete: form.frete || undefined,
    validade_dias: form.validadeDias,
    template_key: form.templateKey || undefined,
  };
}

function draftFromManual(form: ManualForm, index: number, base?: Draft): Draft {
  const edited = manualToEdited(form);
  const unchanged = base ? sameEditableDraft(base.edited, edited) : false;
  return {
    index,
    original: base?.original || {},
    edited,
    approved: unchanged && base ? base.approved : false,
    discarded: false,
    ...(unchanged && base ? {
      status: base.status,
      result: base.result,
      ...(base as StoredAutoQuoteDraft).saved ? { saved: (base as StoredAutoQuoteDraft).saved } : {},
      ...(base as StoredAutoQuoteDraft).issue ? { issue: (base as StoredAutoQuoteDraft).issue } : {},
      ...(base as StoredAutoQuoteDraft).issueIdempotencyKey ? { issueIdempotencyKey: (base as StoredAutoQuoteDraft).issueIdempotencyKey } : {},
    } : {}),
  };
}

export default function NewQuotationPage({ initialMode }: { initialMode: NewQuotationMode }) {
  const { toast } = useToast();
  const { setNavigationGuard } = useRouteGuardContext();
  const [mode, setMode] = useState<NewQuotationMode>(initialMode);
  const [initialDrafts] = useState<StoredAutoQuoteDraft[]>(loadInitialAutoDrafts);
  const {
    drafts,
    setDrafts,
    fetchPricing,
    refetchDraftPricing,
    updateDraftItem,
    addDraftItem,
    removeDraftItem,
    updateDraftField,
    selectProduct,
    buildDraftsFromOrders,
  } = useExtractionDrafts(initialDrafts);
  const [activeDraftIndex, setActiveDraftIndex] = useState<number | null>(
    initialMode === 'conversation' ? initialDrafts.at(-1)?.index ?? null : null,
  );
  const [manual, setManual] = useState<ManualForm>(emptyManual);
  const [manualStorageHydrated, setManualStorageHydrated] = useState(false);
  const [manualIssuing, setManualIssuing] = useState(false);
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);
  const [pendingExtraction, setPendingExtraction] = useState<Draft[]>([]);
  const [text, setText] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<QuotationTemplateMetadata[]>([]);
  const [templateKey, setTemplateKey] = useState('');
  const [templateLoading, setTemplateLoading] = useState(true);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [orderTemplates, setOrderTemplates] = useState<OrderTemplate[]>([]);
  const [orderTemplateOpen, setOrderTemplateOpen] = useState(false);
  const [savingDraft, setSavingDraft] = useState<Record<number, boolean>>({});
  const [issueErrorByDraft, setIssueErrorByDraft] = useState<Record<number, string>>({});
  const issueInFlight = useRef(new Set<number>());
  const saveInFlight = useRef(new Map<number, Promise<StoredAutoQuoteDraft | null>>());
  const recoveryInFlight = useRef(new Set<number>());
  const recoveredIssues = useRef(new Set<number>());
  const recoveryTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const recoveryAttempts = useRef(new Map<number, number>());
  const manualIssueKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const previousInitialMode = useRef(initialMode);
  const extractionGeneration = useRef(0);
  const nextPendingId = useRef(-1);
  const pendingPricingVersions = useRef<Record<number, number>>({});
  const manualSourceDraft = useRef<number | null>(null);
  const restoredManual = useRef(false);
  const manualPricingVersion = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const clientPanelInput = useRef<HTMLInputElement>(null);
  const [clientPanel, setClientPanel] = useState<'existing' | 'new' | 'address' | null>(null);
  const [drawerManual, setDrawerManual] = useState<ManualForm | null>(null);
  const [clientResults, setClientResults] = useState<Client[]>([]);
  const [clientSearching, setClientSearching] = useState(false);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState<Product[]>([]);
  const [productSearching, setProductSearching] = useState(false);
  const [addingSku, setAddingSku] = useState<string | null>(null);
  const clientTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const productTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { imageData, imagePreview, clearImage, handleImageFile, imageInputRef } = useImageInput();

  const activeDrafts = useMemo(() => drafts.filter((draft) => !draft.discarded), [drafts]);
  const activeDraft = activeDrafts.find((draft) => draft.index === activeDraftIndex) || null;
  const draftCountLabel = activeDrafts.length === 1 ? '1 rascunho' : `${activeDrafts.length} rascunhos`;

  useEffect(() => {
    if (activeDraft || activeDrafts.length === 0) return;
    setActiveDraftIndex(activeDrafts.at(-1)?.index ?? null);
  }, [activeDraft, activeDrafts]);

  const loadTemplates = useCallback(async () => {
    setTemplateLoading(true);
    setTemplateError(null);
    try {
      const result = await listQuotationTemplates(true);
      const available = result.templates || result.data || [];
      setTemplates(available);
      const selected = result.default_key || available.find((item) => item.is_default)?.key || '';
      setTemplateKey(selected);
      setManual((current) => ({ ...current, templateKey: current.templateKey || selected }));
    } catch {
      setTemplateError('Não foi possível carregar os modelos de orçamento.');
    } finally {
      setTemplateLoading(false);
    }
  }, []);

  const loadOrderTemplates = useCallback(async () => {
    try {
      const result = await listOrderTemplates();
      setOrderTemplates((result.data || []).filter((item) => !item.archived));
    } catch {
      setOrderTemplates([]);
    }
  }, []);

  useEffect(() => { void loadTemplates(); void loadOrderTemplates(); }, [loadOrderTemplates, loadTemplates]);

  useEffect(() => {
    if (mode !== 'manual' || restoredManual.current) return;
    const prefill = loadQuotationOriginPrefill();
    const restored = prefill ? null : loadManualQuoteDraft();
    if (prefill) {
      setManual((current) => ({
        ...current,
        originPrefill: prefill,
        newClient: { nome: prefill.leadName, email: prefill.email, telefone: formatPhoneInput(prefill.telefone) },
      }));
    } else if (restored) {
      setManual({ ...restored, originPrefill: restored.originPrefill || null });
    }
    restoredManual.current = true;
    setManualStorageHydrated(true);
  }, [mode]);

  useEffect(() => {
    let raw: string | null;
    try {
      raw = window.sessionStorage.getItem('aspen_quote_prefill');
      if (raw !== null) window.sessionStorage.removeItem('aspen_quote_prefill');
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const prefill = JSON.parse(raw) as { nome?: unknown; email?: unknown; telefone?: unknown };
      const nome = typeof prefill.nome === 'string' ? prefill.nome.trim() : '';
      const email = typeof prefill.email === 'string' ? prefill.email.trim() : '';
      const telefone = typeof prefill.telefone === 'string' ? prefill.telefone.trim() : '';
      if (!nome && !email && !telefone) return;
      setText((current) => current.trim() ? current : [`Nome: ${nome}`, `E-mail: ${email}`, `Telefone: ${telefone}`].join('\n'));
    } catch {
      // Prefill malformado é ignorado sem bloquear a entrada.
    }
  }, []);

  useEffect(() => {
    if (!manualStorageHydrated || mode !== 'manual') return;
    if (!manualHasWork(manual)) {
      clearManualQuoteDraft();
      return;
    }
    saveManualQuoteDraft(window.localStorage, {
      clientType: manual.clientType,
      clientSearch: manual.clientSearch,
      selectedClient: manual.selectedClient,
      newClient: manual.newClient,
      leadSource: manual.leadSource,
      cnpj: manual.cnpj,
      address: manual.address,
      showAddress: manual.showAddress,
      items: manual.items,
      prazo: manual.prazo,
      observacoes: manual.observacoes,
      urgente: manual.urgente,
      templateKey: manual.templateKey,
      originPrefill: manual.originPrefill || undefined,
    });
  }, [manual, manualStorageHydrated, mode]);

  useEffect(() => {
    if (mode !== 'conversation') return;
    saveAutoQuoteDrafts(window.sessionStorage, drafts as StoredAutoQuoteDraft[]);
  }, [drafts, mode]);

  const navigateToQuotation = useCallback((quotationId: string) => {
    setNavigationGuard(null);
    window.location.hash = `/quotations/${encodeURIComponent(quotationId)}`;
  }, [setNavigationGuard]);

  const recoverQuotationIssue = useCallback(async (draft: StoredAutoQuoteDraft) => {
    const key = draft.issueIdempotencyKey;
    if (!key || draft.issue || draft.status === 'processing' || recoveredIssues.current.has(draft.index) || recoveryInFlight.current.has(draft.index)) return;
    recoveryInFlight.current.add(draft.index);
    try {
      const state = await getQuotationIssue(key);
      if (state.state === 'processing') {
        const attempt = (recoveryAttempts.current.get(draft.index) || 0) + 1;
        recoveryAttempts.current.set(draft.index, attempt);
        if (attempt > 3) {
          recoveredIssues.current.add(draft.index);
          setDrafts((current) => current.map((item) => item.index === draft.index ? { ...item, status: undefined, result: { success: false, error: 'A emissão continua em processamento. Tente novamente quando estiver pronta.' } } : item));
          return;
        }
        setDrafts((current) => current.map((item) => item.index === draft.index ? { ...item, status: 'processing' } : item));
        const timer = setTimeout(() => {
          recoveryTimers.current.delete(draft.index);
          void recoverQuotationIssue({ ...draft, status: undefined });
        }, Math.min(10_000, Math.max(500, state.retryAfterMs || 500)));
        recoveryTimers.current.set(draft.index, timer);
        return;
      }
      recoveredIssues.current.add(draft.index);
      if (state.state === 'completed') {
        setDrafts((current) => current.map((item) => item.index === draft.index ? { ...item, issue: state, status: 'done', result: { success: true, data: { businessNumber: state.businessNumber, quotationId: state.quotationId, revisionId: state.revisionId, revisionNumber: state.revisionNumber, status: state.status } } } as StoredAutoQuoteDraft : item));
        navigateToQuotation(state.quotationId);
      } else {
        setDrafts((current) => current.map((item) => item.index === draft.index ? { ...item, result: { success: false, error: state.error } } : item));
      }
    } catch {
      recoveredIssues.current.add(draft.index);
      setDrafts((current) => current.map((item) => item.index === draft.index ? { ...item, result: { success: false, error: 'Não foi possível consultar a emissão. Tente novamente.' } } : item));
    } finally {
      recoveryInFlight.current.delete(draft.index);
    }
  }, [navigateToQuotation, setDrafts]);

  useEffect(() => () => {
    for (const timer of recoveryTimers.current.values()) clearTimeout(timer);
    recoveryTimers.current.clear();
  }, []);

  useEffect(() => {
    if (mode !== 'conversation') return;
    for (const draft of activeDrafts as StoredAutoQuoteDraft[]) void recoverQuotationIssue(draft);
  }, [activeDrafts, mode, recoverQuotationIssue]);

  useEffect(() => {
    try {
      window.localStorage.removeItem('aspen_drafts');
    } catch {
      // Keep the existing legacy cleanup behavior; it is not a new storage path.
    }
  }, []);

  const hasWork = Boolean(activeDraft && draftHasWork(activeDraft)) || manualHasWork(manual);
  useEffect(() => {
    if (!hasWork) {
      setNavigationGuard(null);
      setPendingRoute(null);
      return () => setNavigationGuard(null);
    }
    setNavigationGuard((nextRoute) => {
      setPendingRoute(nextRoute);
      return false;
    });
    return () => setNavigationGuard(null);
  }, [hasWork, setNavigationGuard]);

  const setManualValue = useCallback(<K extends keyof ManualForm>(key: K, value: ManualForm[K]) => {
    setManual((current) => ({ ...current, [key]: value }));
  }, []);

  const repriceManualAutomatic = useCallback(async (requested: ManualForm) => {
    const version = ++manualPricingVersion.current;
    const priced = await fetchPricing([draftFromManual(requested, -1)], requested.urgente);
    if (manualPricingVersion.current !== version || !priced[0]) return;
    setManual((current) => {
      if (current.urgente !== requested.urgente || current.items.length !== requested.items.length) return current;
      const items = current.items.map((item, index) => {
        const requestedItem = requested.items[index];
        const pricedItem = priced[0].edited.items[index];
        if (!requestedItem || !pricedItem || item._key !== requestedItem._key || item.sku !== requestedItem.sku || item.qty !== requestedItem.qty || item._rateManual) return item;
        const rate = Number(pricedItem.rate);
        return Number.isFinite(rate) && rate > 0
          ? { ...item, rate, nome: item.nome || pricedItem.item_name || item.nome }
          : item;
      });
      return { ...current, items };
    });
  }, [fetchPricing]);

  const setManualUrgente = useCallback((urgent: boolean) => {
    const next = { ...manual, urgente: urgent };
    setManual(next);
    void repriceManualAutomatic(next);
  }, [manual, repriceManualAutomatic]);

  const openClientPanel = useCallback((panel: 'existing' | 'new' | 'address') => {
    setDrawerManual(cloneManual(manual));
    setClientSearchTerm('');
    setClientResults([]);
    setClientPanel(panel);
  }, [manual]);

  const closeClientPanel = useCallback(() => {
    setClientPanel(null);
    setDrawerManual(null);
    setClientResults([]);
  }, []);

  const applyClientPanel = useCallback(() => {
    if (drawerManual) setManual(drawerManual);
    closeClientPanel();
  }, [closeClientPanel, drawerManual]);

  const switchMode = useCallback((nextMode: NewQuotationMode) => {
    if (nextMode === mode) return;
    if (nextMode === 'manual') {
      if (activeDraft) {
        if ((activeDraft as StoredAutoQuoteDraft).issue) {
          navigateToQuotation((activeDraft as StoredAutoQuoteDraft).issue!.quotationId);
          return;
        }
        manualSourceDraft.current = activeDraft.index;
        setManual(draftToManual(activeDraft));
      } else {
        manualSourceDraft.current = null;
      }
    } else {
      const source = manualSourceDraft.current;
      const sourceDraft = source === null ? null : drafts.find((draft) => draft.index === source);
      if (source !== null && sourceDraft) {
        const nextDraft = draftFromManual(manual, source, sourceDraft) as StoredAutoQuoteDraft;
        if (nextDraft.issue && sameEditableDraft(sourceDraft.edited, nextDraft.edited)) {
          navigateToQuotation(nextDraft.issue.quotationId);
          return;
        }
        setDrafts((current) => current.map((draft) => draft.index === source ? nextDraft : draft));
        setActiveDraftIndex(source);
      } else if (manualHasWork(manual)) {
        const index = Math.max(-1, ...drafts.map((draft) => draft.index)) + 1;
        const created = draftFromManual(manual, index);
        setDrafts((current) => [...current, created]);
        setActiveDraftIndex(index);
        manualSourceDraft.current = index;
      }
    }
    setMode(nextMode);
  }, [activeDraft, drafts, manual, mode, navigateToQuotation, setDrafts]);

  useEffect(() => {
    if (previousInitialMode.current === initialMode) return;
    previousInitialMode.current = initialMode;
    switchMode(initialMode);
  }, [initialMode, switchMode]);

  const onModeKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>, current: NewQuotationMode) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' || (event.key === 'ArrowLeft' && current === 'manual')
      ? 'conversation'
      : 'manual';
    switchMode(next);
    (event.currentTarget.parentElement?.querySelector(`[data-mode="${next}"]`) as HTMLElement | null)?.focus();
  }, [switchMode]);

  const updatePendingField = useCallback((draftIdx: number, field: keyof DraftEdited, value: unknown) => {
    setPendingExtraction((current) => current.map((draft) => draft.index === draftIdx
      ? { ...draft, edited: { ...draft.edited, [field]: value } }
      : draft));
  }, []);

  const updatePendingItem = useCallback((draftIdx: number, itemIdx: number, field: keyof DraftItem, value: unknown) => {
    setPendingExtraction((current) => current.map((draft) => {
      if (draft.index !== draftIdx) return draft;
      const items = draft.edited.items.map((item, index) => index === itemIdx
        ? { ...item, [field]: value, ...(field === 'rate' ? { _rateManual: true } : {}) }
        : item);
      return { ...draft, edited: { ...draft.edited, items } };
    }));
  }, []);

  const updatePendingProduct = useCallback((draftIdx: number, itemIdx: number, product: Product) => {
    if (isUnpricedProduct(product)) return;
    const current = pendingExtraction.find((draft) => draft.index === draftIdx);
    if (!current || !current.edited.items[itemIdx]) return;
    const updated = {
      ...current,
      edited: {
        ...current.edited,
        items: current.edited.items.map((item, index) => index === itemIdx
          ? { ...item, item_code: product.sku, item_name: product.nome || product.sku, _rateManual: undefined }
          : item),
      },
    };
    setPendingExtraction((all) => all.map((draft) => draft.index === draftIdx ? updated : draft));
    const version = (pendingPricingVersions.current[draftIdx] || 0) + 1;
    pendingPricingVersions.current[draftIdx] = version;
    void fetchPricing([updated], updated.edited.urgente).then((priced) => {
      if (pendingPricingVersions.current[draftIdx] !== version || !priced[0]) return;
      setPendingExtraction((all) => all.map((draft) => {
        if (draft.index !== draftIdx || draft.edited.urgente !== updated.edited.urgente) return draft;
        const items = draft.edited.items.map((item, index) => {
          const requested = updated.edited.items[index];
          const pricedItem = priced[0].edited.items[index];
          return requested && pricedItem && item.item_code === requested.item_code && item.qty === requested.qty && !item._rateManual
            ? { ...item, rate: pricedItem.rate, item_name: item.item_name || pricedItem.item_name }
            : item;
        });
        return { ...draft, edited: { ...draft.edited, items } };
      }));
    });
  }, [fetchPricing, pendingExtraction]);

  const refetchPendingPricing = useCallback(async (draftIdx: number): Promise<Draft | undefined> => {
    const current = pendingExtraction.find((draft) => draft.index === draftIdx);
    if (!current) return undefined;
    const requested = { ...current, edited: { ...current.edited, items: current.edited.items.map((item) => ({ ...item })) } };
    const version = (pendingPricingVersions.current[draftIdx] || 0) + 1;
    pendingPricingVersions.current[draftIdx] = version;
    const priced = await fetchPricing([requested], requested.edited.urgente);
    if (pendingPricingVersions.current[draftIdx] !== version || !priced[0]) return priced[0];
    setPendingExtraction((all) => all.map((draft) => {
      if (draft.index !== draftIdx || draft.edited.urgente !== requested.edited.urgente) return draft;
      const items = draft.edited.items.map((item, index) => {
        const requestedItem = requested.edited.items[index];
        const pricedItem = priced[0].edited.items[index];
        if (!requestedItem || !pricedItem || item.item_code !== requestedItem.item_code || item.qty !== requestedItem.qty || Boolean(item._rateManual) !== Boolean(requestedItem._rateManual)) return item;
        return { ...item, rate: pricedItem.rate, item_name: item.item_name || pricedItem.item_name };
      });
      return { ...draft, edited: { ...draft.edited, items } };
    }));
    return priced[0];
  }, [fetchPricing, pendingExtraction]);

  const appendOrQueueExtraction = useCallback((newDrafts: Draft[]) => {
    const current = activeDrafts.find((draft) => draft.index === activeDraftIndex);
    if ((current && draftHasWork(current)) || pendingExtraction.length > 0) {
      const pending = newDrafts.map((draft) => ({ ...draft, index: nextPendingId.current-- }));
      setPendingExtraction((previous) => [...previous, ...pending]);
      return;
    }
    const start = Math.max(-1, ...drafts.map((draft) => draft.index)) + 1;
    const appended = newDrafts.map((draft, offset) => ({ ...draft, index: start + offset }));
    setDrafts((previous) => [...previous, ...appended]);
    setActiveDraftIndex(appended[0]?.index ?? null);
  }, [activeDraftIndex, activeDrafts, drafts, pendingExtraction.length, setDrafts]);

  const handleExtract = useCallback(async () => {
    if (!text.trim() && !imageData) return;
    const inline = inlineTemplateSelections(text, orderTemplates);
    if (inline.unknown.length) {
      setExtractError(`Modelo não encontrado: ${inline.unknown.join(', ')}.`);
      return;
    }
    const generation = ++extractionGeneration.current;
    setExtracting(true);
    setExtractError(null);
    try {
      const response = await apiPost<{ orders?: Record<string, unknown>[] }>('/extract', {
        text: text || null,
        imageBase64: imageData?.base64 || null,
        imageMimeType: imageData?.mime || null,
        ...(inline.selections.length ? { orderTemplateSelections: inline.selections } : {}),
      });
      if (generation !== extractionGeneration.current) return;
      if (!response.orders?.length) {
        setExtractError('Nenhum pedido identificado no texto.');
        return;
      }
      const extracted = buildDraftsFromOrders(response.orders, '', templateKey);
      const nonUrgent = extracted.filter((draft) => !draft.edited.urgente);
      const urgent = extracted.filter((draft) => draft.edited.urgente);
      const pricedNonUrgent = nonUrgent.length ? await fetchPricing(nonUrgent, false) : [];
      if (generation !== extractionGeneration.current) return;
      const pricedUrgent = urgent.length ? await fetchPricing(urgent, true) : [];
      if (generation !== extractionGeneration.current) return;
      const priced = new Map([...pricedNonUrgent, ...pricedUrgent].map((draft) => [draft.index, draft]));
      appendOrQueueExtraction(extracted.map((draft) => priced.get(draft.index) || draft));
    } catch {
      if (generation === extractionGeneration.current) setExtractError('Não foi possível extrair os pedidos. Tente novamente.');
    } finally {
      if (generation === extractionGeneration.current) setExtracting(false);
    }
  }, [appendOrQueueExtraction, buildDraftsFromOrders, fetchPricing, imageData, orderTemplates, templateKey, text]);

  const applyPending = useCallback((pending: Draft) => {
    const index = Math.max(-1, ...drafts.map((draft) => draft.index)) + 1;
    const applied = { ...pending, index };
    setDrafts((current) => [...current, applied]);
    setActiveDraftIndex(index);
    setPendingExtraction((current) => current.filter((draft) => draft.index !== pending.index));
  }, [drafts, setDrafts]);

  const discardPending = useCallback((draftIdx: number) => {
    setPendingExtraction((current) => {
      return current.filter((draft) => draft.index !== draftIdx);
    });
  }, []);

  const responseSaved = useCallback((response: OrcamentoResponse) => {
    const quotationId = [response.quotation_uuid, response.quote_id].find((value) => typeof value === 'string' && value)?.toString() || '';
    const businessNumber = typeof response.quotation_id === 'string' ? response.quotation_id : '';
    const revisionId = typeof response.revision_id === 'string' ? response.revision_id : '';
    const concurrencyToken = typeof response.concurrency_token === 'string' ? response.concurrency_token : '';
    return quotationId && businessNumber && revisionId && concurrencyToken
      ? { quotationId, businessNumber, revisionId, concurrencyToken }
      : null;
  }, []);

  const saveDraft = useCallback(async (draft: Draft): Promise<StoredAutoQuoteDraft | null> => {
    const index = draft.index;
    const existing = drafts.find((candidate) => candidate.index === index) as StoredAutoQuoteDraft | undefined;
    const existingSaved = (draft as StoredAutoQuoteDraft).saved || (
      existing && sameEditableDraft(existing.edited, draft.edited) ? existing.saved : undefined
    );
    if (existingSaved?.quotationId && existingSaved.businessNumber && existingSaved.revisionId && existingSaved.concurrencyToken) {
      return { ...draft, saved: existingSaved } as StoredAutoQuoteDraft;
    }
    const pending = saveInFlight.current.get(index);
    if (pending) return pending;
    let operation!: Promise<StoredAutoQuoteDraft | null>;
    operation = (async () => {
      setSavingDraft((current) => ({ ...current, [index]: true }));
      try {
        const response = await apiPost<OrcamentoResponse>('/orcamento', buildQuotePayload(draft));
        const saved = responseSaved(response);
        if (!saved) throw new Error('Resposta inválida ao salvar o rascunho.');
        const next = { ...draft, saved, result: undefined, ...(draft.status ? { status: draft.status } : {}) } as StoredAutoQuoteDraft;
        setDrafts((current) => current.some((item) => item.index === index)
          ? current.map((item) => item.index === index && sameEditableDraft(item.edited, draft.edited) ? next : item)
          : [...current, next]);
        return next;
      } catch {
        setIssueErrorByDraft((current) => ({ ...current, [index]: 'Não foi possível salvar o rascunho. Tente novamente.' }));
        return null;
      } finally {
        setSavingDraft((current) => {
          const next = { ...current };
          delete next[index];
          return next;
        });
        if (saveInFlight.current.get(index) === operation) saveInFlight.current.delete(index);
      }
    })();
    saveInFlight.current.set(index, operation);
    return operation;
  }, [drafts, responseSaved, setDrafts]);

  const issueDraft = useCallback(async (input: Draft) => {
    const draftIndex = input.index;
    if (issueInFlight.current.has(draftIndex)) return;
    issueInFlight.current.add(draftIndex);
    const existing = drafts.find((draft) => draft.index === draftIndex) as StoredAutoQuoteDraft | undefined;
    const sameExisting = existing ? sameEditableDraft(existing.edited, input.edited) : false;
    const key = (input as StoredAutoQuoteDraft).issueIdempotencyKey || (sameExisting ? existing?.issueIdempotencyKey : undefined) || globalThis.crypto.randomUUID();
    const requestDraft = { ...input, issueIdempotencyKey: key, status: 'processing', result: undefined } as StoredAutoQuoteDraft;
    setIssueErrorByDraft((current) => { const next = { ...current }; delete next[draftIndex]; return next; });
    setDrafts((current) => current.some((draft) => draft.index === draftIndex)
      ? current.map((draft) => draft.index === draftIndex ? { ...requestDraft, status: 'processing', result: undefined } : draft)
      : [...current, { ...requestDraft, status: 'processing' }]);
    try {
      const saved = requestDraft.saved || existing?.saved || (await saveDraft(requestDraft))?.saved;
      if (!saved?.quotationId || !saved.businessNumber || !saved.revisionId || !saved.concurrencyToken) throw new Error('Resposta inválida ao salvar o rascunho.');
      const issue = await issuePersistedDraft(saved.revisionId, saved.concurrencyToken, key);
      setDrafts((current) => current.map((draft) => draft.index === draftIndex
        ? { ...draft, issue, result: { success: true, data: { businessNumber: issue.businessNumber, quotationId: issue.quotationId, revisionId: issue.revisionId, revisionNumber: issue.revisionNumber, status: issue.status } }, status: 'done' } as StoredAutoQuoteDraft
        : draft));
      clearManualQuoteDraft();
      clearQuotationOriginPrefill();
      navigateToQuotation(issue.quotationId);
    } catch (error) {
      const message = error instanceof QuotationIssueApiError && error.status === 409
        ? 'O orçamento mudou ou já está em processamento. Tente novamente.'
        : 'Não foi possível emitir o orçamento. Tente novamente.';
      setIssueErrorByDraft((current) => ({ ...current, [draftIndex]: message }));
      setDrafts((current) => current.map((draft) => draft.index === draftIndex ? { ...draft, status: undefined, result: { success: false, error: message } } : draft));
      if (error instanceof QuotationIssueApiError && error.status === 409 && existing?.issueIdempotencyKey) {
        try {
          const recovered = await getQuotationIssue(existing.issueIdempotencyKey);
          if (recovered.state === 'completed') {
            setDrafts((current) => current.map((draft) => draft.index === draftIndex ? { ...draft, issue: recovered, status: 'done', result: { success: true, data: recovered as unknown as Record<string, unknown> } } as StoredAutoQuoteDraft : draft));
          }
        } catch {
          // Keep the safe retry message; no second issue is attempted.
        }
      }
    } finally {
      issueInFlight.current.delete(draftIndex);
      if (mode === 'manual') setManualIssuing(false);
    }
  }, [drafts, mode, navigateToQuotation, saveDraft, setDrafts]);

  const currentManualDraft = useCallback((): Draft => {
    const base = manualSourceDraft.current === null
      ? undefined
      : drafts.find((draft) => draft.index === manualSourceDraft.current);
    const index = base?.index ?? (Math.max(-1, ...drafts.map((draft) => draft.index)) + 1);
    return draftFromManual(manual, index, base);
  }, [drafts, manual]);

  const handleManualSave = useCallback(async () => {
    const draft = currentManualDraft();
    if (!draft.edited.nome) { toast('Informe o cliente para continuar.', 'error'); return; }
    if (!draft.edited.items.length) { toast('Adicione ao menos um item para continuar.', 'error'); return; }
    if (!isValidLeadSource(draft.edited.origem)) { toast('Selecione a origem para continuar.', 'error'); return; }
    if (draft.edited.cnpj && !isValidCnpj(draft.edited.cnpj)) { toast('CNPJ informado é inválido. Corrija ou deixe em branco.', 'error'); return; }
    const saved = await saveDraft(draft);
    if (saved) {
      manualSourceDraft.current = saved.index;
      clearManualQuoteDraft();
      clearQuotationOriginPrefill();
      navigateToQuotation(saved.saved!.quotationId);
    }
  }, [currentManualDraft, navigateToQuotation, saveDraft, toast]);

  const handleManualIssue = useCallback(() => {
    if (manualIssuing) return;
    const draft = currentManualDraft();
    const fingerprint = JSON.stringify(buildQuotePayload(draft));
    const current = manualIssueKey.current;
    const key = current?.fingerprint === fingerprint ? current.key : globalThis.crypto.randomUUID();
    manualIssueKey.current = { fingerprint, key };
    setManualIssuing(true);
    void issueDraft({ ...draft, issueIdempotencyKey: key } as StoredAutoQuoteDraft);
  }, [currentManualDraft, issueDraft, manualIssuing]);

  const handleManualReview = useCallback(() => {
    const draft = currentManualDraft();
    void saveDraft(draft).then((saved) => {
      if (!saved?.saved) return;
      navigateToQuotation(saved.saved.quotationId);
    });
  }, [currentManualDraft, navigateToQuotation, saveDraft]);

  const handleAutoSave = useCallback((draftIndex: number) => {
    const draft = drafts.find((item) => item.index === draftIndex);
    if (draft) void saveDraft(draft).then((saved) => {
      if (saved?.saved) navigateToQuotation(saved.saved.quotationId);
    });
  }, [drafts, navigateToQuotation, saveDraft]);

  const handleAutoIssue = useCallback((draftIndex: number) => {
    const draft = drafts.find((item) => item.index === draftIndex);
    if (draft) void issueDraft(draft);
  }, [drafts, issueDraft]);

  const handleAutoReview = useCallback((draftIndex: number) => {
    const draft = drafts.find((item) => item.index === draftIndex);
    if (!draft) return;
    const saved = (draft as StoredAutoQuoteDraft).saved;
    void (saved ? Promise.resolve({ saved }) : saveDraft(draft)).then((savedDraft) => {
      if (savedDraft?.saved) navigateToQuotation(savedDraft.saved.quotationId);
    });
  }, [drafts, navigateToQuotation, saveDraft]);

  const searchClientsLocal = useCallback(async (term: string) => {
    if (term.trim().length < 2) { setClientResults([]); return; }
    setClientSearching(true);
    try {
      const result = await apiGet<{ data?: Client[] }>(`/leads-clients?search=${encodeURIComponent(term)}&limit=10`);
      setClientResults(result.data || []);
    } catch {
      setClientResults([]);
    } finally {
      setClientSearching(false);
    }
  }, []);

  const onClientSearch = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setClientSearchTerm(value);
    if (clientTimer.current) clearTimeout(clientTimer.current);
    clientTimer.current = setTimeout(() => void searchClientsLocal(value), 300);
  }, [searchClientsLocal]);

  const chooseClient = useCallback((client: Client) => {
    setDrawerManual((current) => current ? ({
      ...current,
      clientType: CLIENT_TYPE.EXISTING,
      selectedClient: client,
      clientSearch: `${client.nome} (${client.email || client.telefone || client.id})`,
      cnpj: current.cnpj || normalizeCnpj(client.cnpj || ''),
    }) : current);
    setClientResults([]);
  }, []);

  const searchProductsLocal = useCallback(async (term: string) => {
    if (term.trim().length < 2) { setProductResults([]); return; }
    setProductSearching(true);
    try { setProductResults(await searchProducts(term, 8)); } catch { setProductResults([]); } finally { setProductSearching(false); }
  }, []);

  const onProductSearch = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setProductSearch(value);
    if (productTimer.current) clearTimeout(productTimer.current);
    productTimer.current = setTimeout(() => void searchProductsLocal(value), 300);
  }, [searchProductsLocal]);

  const addProduct = useCallback(async (product: Product) => {
    if (!product.sku || addingSku || isUnpricedProduct(product)) return;
    setAddingSku(product.sku);
    try {
      const result = await apiPost<{ items?: Array<{ rate?: number | string }> }>('/pricing-lookup', { items: [{ item_code: product.sku, qty: DEFAULT_QTY }], urgent: manual.urgente });
      const rate = Number(result.items?.[0]?.rate);
      if (!Number.isFinite(rate) || rate <= 0) throw new Error('Preço indisponível');
      setManual((current) => ({
        ...current,
        items: [...current.items, { _key: makeKey(product.sku), sku: product.sku, nome: product.nome || product.sku, qty: DEFAULT_QTY, rate, _rateManual: false }],
      }));
      setProductSearch('');
      setProductResults([]);
    } catch {
      toast('Preço indisponível para este produto.', 'error');
    } finally {
      setAddingSku(null);
    }
  }, [addingSku, manual.urgente, toast]);

  const updateManualItem = useCallback((key: string, field: 'qty' | 'rate', value: string) => {
    const parsed = Number(value.replace(',', '.'));
    const next = {
      ...manual,
      items: manual.items.map((item) => item._key === key ? {
        ...item,
        [field]: field === 'qty' ? Math.max(0.001, Number.isFinite(parsed) ? parsed : 0.001) : Math.max(0, Number.isFinite(parsed) ? parsed : 0),
        ...(field === 'rate' ? { _rateManual: true } : {}),
      } : item),
    };
    setManual(next);
    ++manualPricingVersion.current;
    const item = manual.items.find((candidate) => candidate._key === key);
    if (field === 'qty' && item && !item._rateManual) void repriceManualAutomatic(next);
  }, [manual, repriceManualAutomatic]);

  const resetManualRate = useCallback(async (key: string) => {
    const item = manual.items.find((candidate) => candidate._key === key);
    if (!item) return;
    const version = ++manualPricingVersion.current;
    try {
      const result = await apiPost<{ items?: Array<{ rate?: number | string }> }>('/pricing-lookup', { items: [{ item_code: item.sku, qty: item.qty }], urgent: manual.urgente });
      const rate = Number(result.items?.[0]?.rate);
      if (!Number.isFinite(rate) || rate <= 0) return;
      setManual((current) => ({ ...current, items: current.items.map((candidate) => candidate._key === key && version === manualPricingVersion.current && candidate.sku === item.sku && candidate.qty === item.qty ? { ...candidate, rate, _rateManual: false } : candidate) }));
    } catch {
      // Keep the displayed price when repricing is unavailable.
    }
  }, [manual.items, manual.urgente]);

  useEffect(() => {
    if (!clientPanel) return;
    const frame = window.requestAnimationFrame(() => clientPanelInput.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [clientPanel]);

  const subtotal = manual.items.reduce((sum, item) => sum + item.qty * item.rate, 0);
  const manualBlockMessage = !manualToEdited(manual).nome && !manual.items.length
    ? 'Informe o cliente e adicione ao menos um item para continuar.'
    : !manualToEdited(manual).nome
      ? 'Informe o cliente para continuar.'
      : !manual.items.length
        ? 'Adicione ao menos um item para continuar.'
        : !manual.leadSource || !isValidLeadSource(manual.leadSource)
          ? 'Selecione a origem para continuar.'
          : null;
  const manualCanSubmit = !manualBlockMessage && !manual.items.some((item) => item.rate === 0);
  const manualActionDraftIndex = manualSourceDraft.current ?? (Math.max(-1, ...drafts.map((draft) => draft.index)) + 1);

  const headlineDescription = mode === 'conversation'
    ? activeDraft ? `Da conversa · ${draftCountLabel} · ativo: ${activeDraft.edited.nome || 'cliente não informado'}` : 'Da conversa · revise antes de salvar ou emitir'
    : 'Manual · rascunho em edição';

  return (
    <PageShell className="min-w-0 max-w-full space-y-4 overflow-x-hidden">
      <PageHeader
        title="Novo orçamento"
        description={headlineDescription}
        actions={
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            {mode === 'conversation' && activeDrafts.length > 0 && (
              <label className="flex min-w-0 max-w-full flex-[1_1_12rem] items-center gap-2 text-xs text-fg-muted">
                <span>Rascunho ativo</span>
                <Select
                  aria-label="Rascunho ativo"
                  value={activeDraftIndex ?? ''}
                  onChange={(event) => setActiveDraftIndex(Number(event.target.value))}
                  className="max-w-full flex-1"
                >
                  {activeDrafts.map((draft) => <option key={draft.index} value={draft.index}>{draft.edited.nome || 'Cliente'} · #{draft.index + 1}</option>)}
                </Select>
              </label>
            )}
            <div role="tablist" aria-label="Modo de criação" className="flex max-w-full shrink-0 rounded-md border border-line bg-surface p-0.5">
              {(['conversation', 'manual'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="tab"
                  id={`quotation-mode-tab-${option}`}
                  data-mode={option}
                  aria-selected={mode === option}
                  aria-controls={`quotation-mode-panel-${option}`}
                  tabIndex={mode === option ? 0 : -1}
                  onClick={() => switchMode(option)}
                  onKeyDown={(event) => onModeKeyDown(event, option)}
                  className={cn('h-8 rounded-sm px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', mode === option ? 'bg-primary/10 text-link' : 'text-fg-muted hover:bg-surface-hover hover:text-fg')}
                >
                  {option === 'conversation' ? 'Da conversa' : 'Manual'}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {manual.originPrefill && (
        <p className="text-sm text-fg-muted" role="status">
          Origem: {manual.originPrefill.source === 'site_form' ? 'Formulário do site' : manual.originPrefill.source || 'Oportunidade CRM'}
        </p>
      )}

      {extractError && mode === 'conversation' && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{extractError}</span>
        </div>
      )}
      {templateError && mode === 'conversation' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          <span>{templateError}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadTemplates()}>Tentar novamente</Button>
        </div>
      )}

      {mode === 'conversation' ? (
        <div id="quotation-mode-panel-conversation" role="tabpanel" aria-labelledby="quotation-mode-tab-conversation" tabIndex={0} className="grid min-h-0 grid-cols-1 gap-4 xl:grid-cols-2">
          <section aria-label="Conversa" className="min-w-0 rounded-lg border border-line bg-surface p-4 md:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-fg">Conversa</h2>
                <p className="mt-1 text-sm text-fg-muted">Texto ou imagem da solicitação</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setOrderTemplateOpen(true)}>
                <Settings size={14} /> Gerenciar modelos
              </Button>
            </div>
            <div className="mt-4">
              <input ref={imageInputRef} id="new-quotation-image" type="file" accept="image/*" className="sr-only" onChange={(event) => handleImageFile(event.target.files?.[0] || null)} />
              <label htmlFor="new-quotation-image" className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-sm border border-border-control bg-surface px-3 text-sm font-medium text-fg hover:bg-surface-hover focus-within:outline-none focus-within:ring-2 focus-within:ring-primary">Selecionar imagem</label>
            </div>
            {imageData && (
              <div className="mt-3 flex items-center gap-3 rounded-md bg-surface-subtle p-3">
                {imagePreview ? <img src={imagePreview} alt="Prévia da solicitação" className="h-16 w-16 rounded object-cover" /> : <ImageIcon size={18} />}
                <span className="min-w-0 flex-1 text-sm text-fg-muted">Imagem carregada</span>
                <Button type="button" variant="ghost" size="sm" onClick={clearImage}>Remover</Button>
              </div>
            )}
            <Textarea
              ref={textareaRef}
              aria-label="Mensagem do cliente para extração"
              value={text}
              disabled={extracting}
              onChange={(event) => setText(event.target.value)}
              onPaste={(event: ClipboardEvent<HTMLTextAreaElement>) => {
                for (const item of Array.from(event.clipboardData?.items || [])) {
                  if (item.type.startsWith('image/')) { event.preventDefault(); handleImageFile(item.getAsFile()); break; }
                }
              }}
              placeholder="Cole aqui a mensagem do cliente..."
              className="mt-3 min-h-[180px] py-3 leading-6"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button type="button" onClick={() => void handleExtract()} disabled={extracting || (!text.trim() && !imageData)}>
                {extracting ? <><Loader2 size={14} className="animate-spin" /> Extraindo…</> : <><PackagePlus size={14} /> Extrair dados</>}
              </Button>
              {(text || imageData) && <Button type="button" variant="ghost" size="sm" onClick={() => { extractionGeneration.current += 1; setText(''); clearImage(); setExtractError(null); }}>Limpar</Button>}
            </div>
          </section>

          <section aria-label="Resultado da conversa" className="min-w-0 rounded-lg border border-line bg-page p-4 md:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-fg">Resultado</h2>
                <p className="mt-1 text-sm text-fg-muted">{activeDrafts.length ? `Resultados (${activeDrafts.length})` : 'Os itens aparecerão aqui após a extração.'}</p>
              </div>
              {activeDrafts.length > 0 && <span className="text-xs text-fg-muted">Identidade ativa preservada</span>}
            </div>
            {!activeDraft && pendingExtraction.length === 0 && (
              <div className="flex min-h-[360px] flex-col items-center justify-center rounded-md border border-dashed border-line px-5 text-center text-fg-muted">
                <FileText size={28} />
                <p className="mt-3 text-sm">Nenhum pedido extraído</p>
              </div>
            )}
            {activeDraft && (
              <SplitResultCard
                draft={activeDraft}
                displayIdx={activeDrafts.findIndex((draft) => draft.index === activeDraft.index)}
                totalDrafts={activeDrafts.length}
                isProcessing={activeDraft.status === 'processing'}
                onUpdateField={updateDraftField}
                onUpdateItem={updateDraftItem}
                onRemoveItem={removeDraftItem}
                onAddItem={addDraftItem}
                selectProduct={selectProduct}
                onRefetchPricing={refetchDraftPricing}
                onCreateQuote={handleAutoIssue}
                onSaveDraft={handleAutoSave}
                isSavingDraft={Boolean(savingDraft[activeDraft.index])}
                onReviewQuote={handleAutoReview}
                issue={(activeDraft as StoredAutoQuoteDraft).issue}
                issueError={issueErrorByDraft[activeDraft.index] || activeDraft.result?.error}
                templates={templates}
                templateLoading={templateLoading}
                templateError={templateError}
                onRetryTemplates={loadTemplates}
              />
            )}
            {pendingExtraction.map((pending, index) => (
              <div key={pending.index} className="mt-4 border-t border-line pt-4">
                <p className="mb-2 text-sm font-medium text-fg">Novo resultado para revisão ({index + 1}/{pendingExtraction.length})</p>
                <SplitResultCard
                  draft={pending}
                  displayIdx={index}
                  totalDrafts={pendingExtraction.length}
                  reviewOnly
                  onApply={() => applyPending(pending)}
                  onDiscard={() => discardPending(pending.index)}
                  onUpdateField={updatePendingField}
                  onUpdateItem={updatePendingItem}
                  onRemoveItem={(draftIndex, itemIndex) => setPendingExtraction((current) => current.map((draft) => draft.index === draftIndex ? { ...draft, edited: { ...draft.edited, items: draft.edited.items.filter((_, i) => i !== itemIndex) } } : draft))}
                  onAddItem={(draftIndex) => setPendingExtraction((current) => current.map((draft) => draft.index === draftIndex ? { ...draft, edited: { ...draft.edited, items: [...draft.edited.items, { item_code: '', qty: DEFAULT_QTY, rate: null, _rateManual: true }] } } : draft))}
                  selectProduct={updatePendingProduct}
                  onRefetchPricing={refetchPendingPricing}
                  onCreateQuote={() => undefined}
                  onReviewQuote={() => undefined}
                />
              </div>
            ))}
          </section>
        </div>
      ) : (
        <div id="quotation-mode-panel-manual" role="tabpanel" aria-labelledby="quotation-mode-tab-manual" tabIndex={0} className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-4">
            <section aria-label="Seleção de cliente" className="rounded-lg border border-line bg-surface p-4 md:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 className="text-base font-semibold text-fg">Dados do orçamento</h2></div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => openClientPanel('existing')}>Buscar cliente existente</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => openClientPanel('new')}>Novo cliente</Button>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-xs font-medium text-fg-muted">Cliente
                  <Input aria-label="Nome do cliente" value={manual.clientType === 'existing' && manual.selectedClient ? manual.selectedClient.nome : manual.newClient.nome} onChange={(event) => setManual((current) => ({ ...current, clientType: 'new', selectedClient: null, newClient: { ...current.newClient, nome: event.target.value } }))} />
                </label>
                <label className="space-y-1 text-xs font-medium text-fg-muted"><span>Origem *</span>
                  <Select aria-label="Origem *" value={manual.leadSource} onChange={(event) => setManualValue('leadSource', event.target.value)} className="w-full"><option value="">Selecione a origem…</option>{LEAD_SOURCES.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}</Select>
                </label>
              </div>
              {manual.clientType === 'existing' && manual.selectedClient && <p className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-2 text-sm text-fg">{manual.selectedClient.nome} · {manual.selectedClient.email || fmtPhone(manual.selectedClient.telefone || '')}</p>}
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-xs font-medium text-fg-muted">CNPJ (opcional)<Input aria-label="CNPJ (opcional)" value={manual.cnpj ? formatCnpj(manual.cnpj) : ''} onChange={(event) => setManualValue('cnpj', normalizeCnpj(event.target.value))} /></label>
                <div className="flex items-end"><Button type="button" variant="ghost" size="sm" onClick={() => openClientPanel('address')}><MapPin size={14} /> {manual.showAddress ? 'Editar endereço' : 'Endereço opcional'}</Button></div>
              </div>
              {!manual.showAddress && hasAnyAddressField(manual.address) && <p className="mt-2 text-xs text-fg-muted">{formatAddressSummary(manual.address)}</p>}
            </section>

            <section aria-label="Itens do orçamento" className="rounded-lg border border-line bg-surface p-4 md:p-5">
              <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-fg">Itens do orçamento</h2></div><span className="text-sm text-fg-muted">{manual.items.length} {manual.items.length === 1 ? 'item' : 'itens'}</span></div>
              <div className="relative mt-4"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" /><Input aria-label="Buscar produto para adicionar ao orçamento" className="pl-9" value={productSearch} onChange={onProductSearch} placeholder="Buscar SKU ou nome…" />{productSearching && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-fg-muted" />}</div>
              {productResults.length > 0 && <div className="mt-2 divide-y divide-border overflow-hidden rounded-md border border-line">{productResults.map((product) => <div key={product.sku} className="flex items-center justify-between gap-3 p-3"><span className="min-w-0 truncate text-sm"><span className="font-mono text-primary">{product.sku}</span> · {product.nome}</span><div className="flex shrink-0 items-center gap-2">{isUnpricedProduct(product) && <span className="text-xs text-fg-muted">Preço indisponível</span>}<Button type="button" size="sm" aria-label={`Adicionar ${product.sku} ao orçamento`} onClick={() => void addProduct(product)} disabled={Boolean(addingSku) || isUnpricedProduct(product)}>{addingSku === product.sku ? 'Adicionando…' : 'Adicionar'}</Button></div></div>)}</div>}
              {manual.items.length === 0 ? <div className="mt-4 rounded-md border border-dashed border-line px-4 py-10 text-center text-sm text-fg-muted">Nenhum produto na tabela</div> : <div className="mt-4"><Table className="min-w-[620px] text-sm"><TableHeader><TableRow><TableHead>Produto</TableHead><TableHead className="w-28 text-right">Quantidade</TableHead><TableHead className="w-40 text-right">Unitário</TableHead><TableHead className="w-32 text-right">Total</TableHead><TableHead className="w-10" /></TableRow></TableHeader><TableBody>{manual.items.map((item) => <TableRow key={item._key}><TableCell><span className="font-mono text-xs text-primary">{item.sku}</span><p className="text-sm font-medium text-fg">{item.nome}</p>{item._rateManual && <span className="text-[11px] text-warning">preço manual</span>}</TableCell><TableCell className="text-right"><Input type="number" min="0.001" step="0.001" className="ml-auto w-24 text-right" aria-label={`Quantidade de ${item.sku}`} value={item.qty} onChange={(event) => updateManualItem(item._key, 'qty', event.target.value)} /></TableCell><TableCell className="text-right"><div className="flex items-center justify-end gap-1"><Input type="number" min="0" step="0.01" className="w-32 text-right" aria-label={`Preço unitário de ${item.sku}`} value={item.rate} onChange={(event) => updateManualItem(item._key, 'rate', event.target.value)} />{item._rateManual && <button type="button" className="min-h-9 min-w-9 rounded-sm text-fg-muted hover:bg-surface-hover" aria-label={`Recalcular preço de ${item.sku}`} onClick={() => void resetManualRate(item._key)}><RotateCcw size={14} /></button>}</div></TableCell><TableCell className="text-right font-medium tabular-nums">{formatBRL(item.qty * item.rate)}</TableCell><TableCell className="text-right"><button type="button" className="min-h-9 min-w-9 rounded-sm text-fg-muted hover:bg-destructive/10 hover:text-destructive" aria-label={`Remover ${item.sku}`} onClick={() => setManual((current) => ({ ...current, items: current.items.filter((candidate) => candidate._key !== item._key) }))}><Trash2 size={14} /></button></TableCell></TableRow>)}</TableBody></Table></div>}
            </section>

            <section aria-label="Condições do orçamento" className="rounded-lg border border-line bg-surface p-4 md:p-5">
              <h2 className="text-base font-semibold text-fg">Condições e fechamento</h2>
              {templateError && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-destructive"><p role="alert">{templateError}</p><Button type="button" variant="outline" size="sm" onClick={() => void loadTemplates()}>Tentar novamente</Button></div>}
              <div className="mt-4 grid gap-3 md:grid-cols-2"><label className="space-y-1 text-xs font-medium text-fg-muted">Prazo de produção<Input aria-label="Prazo de produção" value={manual.prazo} onChange={(event) => setManualValue('prazo', event.target.value)} /></label><label className="space-y-1 text-xs font-medium text-fg-muted">Modelo de orçamento<Select aria-label="Modelo de orçamento" value={manual.templateKey} disabled={templateLoading || !templates.length} onChange={(event) => { setTemplateKey(event.target.value); setManualValue('templateKey', event.target.value); }} className="w-full">{templates.map((template) => <option key={template.key} value={template.key}>{template.name}</option>)}</Select></label></div>
              <label className="mt-4 flex items-center justify-between gap-3 rounded-md border border-line p-3 text-sm"><span><span className="block font-medium text-fg">Pedido urgente</span><span className="block text-xs text-fg-muted">Itens com preço automático recebem +30%.</span></span><input type="checkbox" aria-label="Pedido urgente" checked={manual.urgente} onChange={(event) => setManualUrgente(event.target.checked)} className="h-4 w-4 accent-primary" /></label>
              <label className="mt-4 block space-y-1 text-xs font-medium text-fg-muted">Observações<Textarea aria-label="Observações do orçamento" value={manual.observacoes} onChange={(event) => setManualValue('observacoes', event.target.value)} /></label>
              {manualBlockMessage && <p id="manual-quotation-action-status" className="mt-3 rounded-md border border-line bg-surface-subtle p-3 text-xs text-fg-muted">{manualBlockMessage}</p>}
            </section>
          </div>
          <aside aria-label="Resumo e ações do orçamento" className="min-w-0 rounded-lg border border-line bg-surface p-4 md:p-5 xl:sticky xl:top-4">
            <h2 className="text-base font-semibold text-fg">Resumo</h2>
            <dl className="mt-4 space-y-3 text-sm tabular-nums"><div className="flex justify-between gap-3"><dt className="text-fg-muted">Cliente</dt><dd className="max-w-[180px] truncate">{manualToEdited(manual).nome || 'Não informado'}</dd></div><div className="flex justify-between gap-3"><dt className="text-fg-muted">Itens</dt><dd>{manual.items.length}</dd></div><div className="flex justify-between gap-3"><dt className="text-fg-muted">Subtotal</dt><dd>{formatBRL(subtotal)}</dd></div><div className="flex justify-between gap-3 border-t border-line pt-3 text-xl font-semibold"><dt>Total</dt><dd>{formatBRL(subtotal)}</dd></div></dl>
            {issueErrorByDraft[manualActionDraftIndex] && <p role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{issueErrorByDraft[manualActionDraftIndex]}</p>}
            <div className="mt-5 space-y-2"><Button type="button" variant="outline" className="w-full" disabled={!manualCanSubmit || manualIssuing} onClick={handleManualReview}>Revisar orçamento</Button><Button type="button" className="w-full" disabled={!manualCanSubmit || manualIssuing || Boolean(savingDraft[manualActionDraftIndex])} onClick={() => void handleManualSave()}>{savingDraft[manualActionDraftIndex] ? 'Salvando…' : 'Salvar rascunho'}</Button><Button type="button" variant="success" aria-label="Emitir orçamento" className="w-full" disabled={!manualCanSubmit || manualIssuing} onClick={handleManualIssue}>{manualIssuing ? 'Emitindo…' : 'Emitir orçamento'}</Button></div>
          </aside>
        </div>
      )}

      {clientPanel && (
        <DetailDrawer open title={clientPanel === 'address' ? 'Endereço opcional' : 'Cliente do orçamento'} onClose={closeClientPanel}>
          {clientPanel === 'existing' && drawerManual && (
            <div className="mt-5 space-y-3">
              <label className="block text-xs font-medium text-fg-muted">Nome, e-mail ou telefone<Input ref={clientPanelInput} aria-label="Buscar cliente" value={clientSearchTerm} onChange={onClientSearch} /></label>
              {clientSearching && <p className="text-xs text-fg-muted">Buscando…</p>}
              {clientResults.map((client) => <button key={client.id} type="button" aria-label={`Selecionar ${client.nome}`} className="block w-full rounded-md border border-line p-3 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => chooseClient(client)}><span className="block font-medium text-fg">{client.nome}</span><span className="block text-xs text-fg-muted">{client.email || 'E-mail não informado'} · {fmtPhone(client.telefone || '')}</span></button>)}
              <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => setClientPanel('new')}>Novo cliente</Button><Button type="button" onClick={applyClientPanel} disabled={!drawerManual?.selectedClient}>Aplicar ao rascunho</Button><Button type="button" variant="ghost" onClick={closeClientPanel}>Cancelar</Button></div>
            </div>
          )}
          {clientPanel === 'new' && drawerManual && (
            <div className="mt-5 space-y-4">
              <label className="block space-y-1 text-xs font-medium text-fg-muted">Nome *<Input ref={clientPanelInput} aria-label="Nome do cliente" value={drawerManual.newClient.nome} onChange={(event) => setDrawerManual((current) => current ? ({ ...current, clientType: 'new', selectedClient: null, newClient: { ...current.newClient, nome: event.target.value } }) : current)} /></label>
              <label className="block space-y-1 text-xs font-medium text-fg-muted">E-mail<Input type="email" aria-label="E-mail do cliente" value={drawerManual.newClient.email} onChange={(event) => setDrawerManual((current) => current ? ({ ...current, newClient: { ...current.newClient, email: event.target.value } }) : current)} /></label>
              <label className="block space-y-1 text-xs font-medium text-fg-muted">Telefone<Input aria-label="Telefone do cliente" inputMode="tel" value={formatPhoneInput(drawerManual.newClient.telefone)} onChange={(event) => setDrawerManual((current) => current ? ({ ...current, newClient: { ...current.newClient, telefone: normalizePhoneDigits(event.target.value) } }) : current)} /></label>
              <label className="block space-y-1 text-xs font-medium text-fg-muted">CNPJ (opcional)<Input aria-label="CNPJ (opcional)" value={drawerManual.cnpj ? formatCnpj(drawerManual.cnpj) : ''} onChange={(event) => setDrawerManual((current) => current ? ({ ...current, cnpj: normalizeCnpj(event.target.value) }) : current)} /></label>
              <div className="flex flex-wrap gap-2"><Button type="button" onClick={applyClientPanel}>Aplicar ao rascunho</Button><Button type="button" variant="ghost" onClick={closeClientPanel}>Cancelar</Button></div>
            </div>
          )}
          {clientPanel === 'address' && drawerManual && (
            <div className="mt-5 space-y-3">
              {(['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf'] as const).map((field) => <label key={field} className="block space-y-1 text-xs font-medium capitalize text-fg-muted">{field === 'uf' ? 'Estado' : field}<Input ref={field === 'cep' ? clientPanelInput : undefined} aria-label={field === 'uf' ? 'Estado' : field} value={drawerManual.address[field]} onChange={(event) => setDrawerManual((current) => current ? ({ ...current, showAddress: true, address: normalizeAddress({ ...current.address, [field]: field === 'uf' ? event.target.value.toUpperCase().slice(0, 2) : event.target.value }) }) : current)} /></label>)}
              <div className="flex flex-wrap gap-2"><Button type="button" onClick={applyClientPanel}>Aplicar ao rascunho</Button><Button type="button" variant="ghost" onClick={closeClientPanel}>Cancelar</Button></div>
            </div>
          )}
        </DetailDrawer>
      )}

      <OrderTemplateManager open={orderTemplateOpen} templates={orderTemplates} onClose={() => setOrderTemplateOpen(false)} onChanged={async () => { try { const result = await listOrderTemplates(); setOrderTemplates((result.data || []).filter((item) => !item.archived)); } catch { /* manager owns its error state */ } }} />
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
