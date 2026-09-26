import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import {
  ChevronDown,
  Loader2,
  MapPin,
  RotateCcw,
  Search,
  Trash2,
  MessagesSquare,
  PencilLine,
} from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api/api';
import { isApiError } from '@/types/api';
import { listQuotationTemplates, type QuotationTemplateMetadata } from '@/lib/api/quotationTemplatesApi';
import { listOrderTemplates, type OrderTemplate } from '@/lib/api/orderTemplatesApi';
import { fetchFlows, isQuotationDeliveryFlow, type CommunicationFlow } from '@/lib/api/communicationApi';
import { inlineTemplateSelections } from '@/features/quotations/orderTemplateSelections';
import OrderTemplateManager from '@/features/quotations/components/OrderTemplateManager';
import SplitResultCard from '@/features/quotations/components/SplitResultCard';
import ProductionTermsFields from '@/features/quotations/components/ProductionTermsFields';
import { getSettings } from '@/lib/api/settingsApi';
import { DEFAULT_PRODUCTION_DAYS, isProductionDays } from '@/lib/productionDeadline';
import { useImageInput } from '@/hooks/useImageInput';
import { useExtractionDrafts } from '@/hooks/useExtractionDrafts';
import {
  deliveryIdentityKey,
  useQuotationDeliveries,
  useQuotationRevisionDeliveries,
} from '@/hooks/useQuotationDeliveries';
import { loadAutoQuoteDrafts, saveAutoQuoteDrafts } from '@/lib/storage/autoQuoteDraftStorage';
import { buildQuotePayload, getQuotationIssue, issuePersistedDraft, QuotationIssueApiError } from '@/lib/api/quotationIssueApi';
import {
  listClientOpportunities,
  type OpportunityChoice,
} from '@/lib/api/proposalOpportunitiesApi';
import OpportunitySelector from '@/features/quotations/components/OpportunitySelector';
import QuoteOrderStep from '@/features/quotations/components/QuoteOrderStep';
import QuoteSteps, { type QuoteStep } from '@/features/quotations/components/QuoteSteps';
import {
  NEW_DEMAND_SELECTION,
  initialOpportunitySelection,
  isOpportunitySelectionValid,
  opportunitySelectionPayload,
  reconcileOpportunitySelection,
  type OpportunitySelection,
} from '@/features/quotations/opportunitySelection';
import {
  draftOpportunityRequestKey,
  planDraftOpportunityApplication,
  shouldStartDraftOpportunityRequest,
  type DraftOpportunityRequest,
} from '@/features/quotations/draftOpportunityRequest';
import {
  clientResolutionBlockMessage,
  type ClientResolutionView,
} from '@/features/quotations/automaticClientResolution';
import { useAutomaticClientResolution } from '@/features/quotations/useAutomaticClientResolution';
import { draftHasDurableQuotationState } from '@/features/quotations/durableQuotationState';
import { isSendableQuotationStatus, type SendContext } from '@/lib/api/communicationSend';
import type {
  Draft,
  DraftEdited,
  DraftItem,
  OrcamentoResponse,
  Product,
  QuotationSavedSnapshot,
  StoredAutoQuoteDraft,
} from '@/types/domain';
import { formatBRL, formatPhoneInput, normalizePhoneDigits, fmtPhone } from '@/lib/formatting/formatters';
import { Button } from '@/components/ui/button';
import InlineAlert from '@/components/shared/InlineAlert';
import { TabBar } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import { DetailDrawer } from '@/components/shared/DetailDrawer';
import { useToast } from '@/components/shared/toast';
import { isUnpricedProduct, searchProducts } from '@/lib/api/productCache';
import {
  EMPTY_ADDRESS,
  DEFAULT_LEAD_SOURCE,
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
import {
  dispatchAfterDraftPersistence,
  ensureCreationRequestId,
} from '@/features/quotations/creationRequest';
import { Heading } from '@/components/ui/heading';
import { fetchAtendimentoQuoteDraft, type AtendimentoQuoteDraft } from '@/lib/api/atendimentoQuoteDraftApi';
import { MOBILE_MEDIA_QUERY, useMediaQuery } from '@/hooks/useMediaQuery';
import { Field } from '@/components/ui/field';
import { Text } from '@/components/ui/text';
import MobileActionBar from '@/components/shared/MobileActionBar';

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
  /** Ausente usa o padrão das Configurações. */
  prazoDias?: number;
  pagamento?: string;
  entrega?: string;
  frete?: string;
  validadeDias?: number;
  observacoes: string;
  acrescimo: number;
  templateKey: string;
  originPrefill: QuotationOriginPrefill | null;
  opportunity: OpportunitySelection;
  creationRequestId: string;
}

const CLIENT_TYPE = { NEW: 'new', EXISTING: 'existing' } as const;
const DEFAULT_QTY = 30;

function emptyManual(): ManualForm {
  return {
    clientType: CLIENT_TYPE.NEW,
    clientSearch: '',
    selectedClient: null,
    newClient: { nome: '', email: '', telefone: '' },
    leadSource: DEFAULT_LEAD_SOURCE,
    cnpj: '',
    address: { ...EMPTY_ADDRESS },
    showAddress: false,
    items: [],
    prazoDias: undefined,
    pagamento: '',
    entrega: '',
    frete: '',
    validadeDias: undefined,
    observacoes: '',
    acrescimo: 0,
    templateKey: '',
    originPrefill: null,
    opportunity: { ...NEW_DEMAND_SELECTION },
    creationRequestId: globalThis.crypto.randomUUID(),
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
      draft.edited.prazo_producao_dias ||
      draft.edited.observacoes,
  );
}

function draftIssued(draft: Draft): boolean {
  return Boolean((draft as StoredAutoQuoteDraft).issue || (draft.status === 'done' && draft.result?.success));
}

function opportunitySelectionFromDraft(draft: Draft): OpportunitySelection {
  if (draft.edited.opportunity_id) {
    return { mode: 'existing', opportunityId: draft.edited.opportunity_id, demandSummary: '' };
  }
  if (draft.edited.new_demand) {
    return { mode: 'new', opportunityId: null, demandSummary: draft.edited.demand_summary || '' };
  }
  return { mode: 'existing', opportunityId: null, demandSummary: '' };
}

/** An automatic result may only be saved/issued after the operator's explicit
 * demand choice; multiple candidates never default to one of them. */
function draftHasOrigin(draft: Draft): boolean {
  return Boolean(draft.edited.quote_lead_id && draft.edited.crm_deal_id);
}

function conversationOpportunityBlockMessage(
  draft: Draft,
  choices: OpportunityChoice[],
  loading: boolean,
): string | null {
  if (draftHasOrigin(draft)) return null;
  if (loading) return 'Carregando demandas…';
  return isOpportunitySelectionValid(opportunitySelectionFromDraft(draft), choices)
    ? null
    : 'Escolha a oportunidade ou inicie uma nova demanda.';
}

/**
 * Client identity is a persistence precondition: an identity still being
 * checked, awaiting a choice, archived or unconfirmed blocks saving and issuing.
 * A draft with durable state is never blocked here — after saving, the
 * identifier and snapshot returned by the server are the effective reference.
 */
function conversationClientBlockMessage(
  draft: Draft,
  view: ClientResolutionView | undefined,
): string | null {
  if (draftHasDurableQuotationState(draft)) return null;
  return clientResolutionBlockMessage(view ?? { state: 'idle' });
}

function manualHasWork(form: ManualForm): boolean {
  return Boolean(
    form.items.length ||
      form.newClient.nome.trim() ||
      form.selectedClient?.nome ||
      form.leadSource ||
      form.cnpj ||
      hasAnyAddressField(form.address) ||
      form.prazoDias ||
      form.acrescimo ||
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
    opportunity: { ...form.opportunity },
    creationRequestId: form.creationRequestId,
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
    prazoDias: edited.prazo_producao_dias,
    pagamento: edited.pagamento || '',
    entrega: edited.entrega || '',
    frete: edited.frete || '',
    validadeDias: edited.validade_dias,
    observacoes: edited.observacoes || '',
    acrescimo: edited.acrescimo_percent,
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
    opportunity: edited.opportunity_id
      ? { mode: 'existing', opportunityId: edited.opportunity_id, demandSummary: '' }
      : edited.new_demand
        ? { mode: 'new', opportunityId: null, demandSummary: edited.demand_summary || '' }
        : { mode: 'existing', opportunityId: null, demandSummary: '' },
    creationRequestId:
      (draft as StoredAutoQuoteDraft).creationRequestId || globalThis.crypto.randomUUID(),
  };
}

function sameEditableDraft(left: DraftEdited, right: DraftEdited): boolean {
  const comparable = (edited: DraftEdited) => ({
    nome: edited.nome,
    empresa: edited.empresa || '',
    email: edited.email,
    telefone: edited.telefone,
    acrescimo_percent: edited.acrescimo_percent,
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
    prazo_producao_dias: edited.prazo_producao_dias ?? null,
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
    opportunity_id: edited.opportunity_id || '',
    new_demand: edited.new_demand === true,
    demand_summary: edited.demand_summary || '',
    confirm_new_client: edited.confirm_new_client === true,
  });
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

const ISSUE_PERSISTENCE_ERROR = 'Não foi possível preparar a emissão com segurança. Verifique o armazenamento do navegador e tente novamente.';
const SAVE_FAILURE_ERROR = 'Não foi possível salvar o rascunho. Tente novamente.';
const PRE_SAVE_RECOVERY_ERROR = 'Não foi possível confirmar o salvamento do rascunho. Verifique Orçamentos antes de tentar novamente.';
const PRE_SAVE_RECOVERY_ACTION = 'Confirmar ausência e liberar nova tentativa';
const CONVERSATION_EXTRACTION_PRICING = 'extraction';

/**
 * Message the operator sees when a save fails. Identity conflicts (400/404/409)
 * state the next step the server demands — choose the client, fix the document,
 * regularize an archived record. Every other failure keeps the retry wording so
 * no driver text, constraint name or stack trace reaches the operator.
 */
function saveFailureMessage(error: unknown): string {
  if (!isApiError(error)) return SAVE_FAILURE_ERROR;
  if (error.status !== 400 && error.status !== 404 && error.status !== 409) return SAVE_FAILURE_ERROR;
  return error.message.trim() || SAVE_FAILURE_ERROR;
}

function savedSnapshotFromResponse(response: OrcamentoResponse): QuotationSavedSnapshot | undefined {
  if (!Array.isArray(response.items) || response.items.length === 0) return undefined;
  const money = (value: unknown) => {
    if ((typeof value !== 'string' && typeof value !== 'number') || !String(value).trim() || !Number.isFinite(Number(value)) || Number(value) < 0) return undefined;
    return String(value);
  };
  const frete = money(response.frete);
  const total = money(response.total);
  if (!frete || !total) return undefined;
  const items = response.items.map((raw) => {
    const itemCode = raw.item_code ?? raw.sku;
    const qty = Number(raw.qty ?? raw.quantidade);
    const rate = Number(raw.applied_unit_price ?? raw.preco_aplicado ?? raw.rate);
    const itemName = raw.item_name ?? raw.nome ?? '';
    if (typeof itemCode !== 'string' || !itemCode.trim() || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(rate) || rate < 0 || typeof itemName !== 'string') return null;
    if (raw.manual_rate !== undefined && typeof raw.manual_rate !== 'boolean') return null;
    return {
      item_code: itemCode,
      item_name: itemName,
      qty,
      rate,
      ...(typeof raw.manual_rate === 'boolean' ? { _rateManual: raw.manual_rate } : {}),
    } as DraftItem;
  });
  return items.every((item): item is DraftItem => item !== null)
    ? { items, frete, total }
    : undefined;
}

function isAmbiguousIssueError(error: unknown): boolean {
  return !(error instanceof QuotationIssueApiError) || error.status === 409 || error.status >= 500;
}

function manualToEdited(form: ManualForm): DraftEdited {
  const client = form.clientType === CLIENT_TYPE.EXISTING && form.selectedClient
    ? form.selectedClient
    : { nome: form.newClient.nome, email: form.newClient.email, telefone: form.newClient.telefone };
  return {
    nome: client.nome.trim(),
    email: client.email || '',
    telefone: client.telefone || '',
    acrescimo_percent: form.acrescimo,
    origem: form.leadSource,
    cnpj: form.cnpj,
    endereco: { ...form.address },
    _showAddr: form.showAddress,
    client_id: form.clientType === CLIENT_TYPE.EXISTING ? form.selectedClient?.id : undefined,
    // Choosing the new-client path in the manual form IS the explicit
    // confirmation; it is never sent together with an existing link.
    confirm_new_client: form.clientType === CLIENT_TYPE.NEW ? true : undefined,
    quote_lead_id: form.originPrefill?.quoteLeadId,
    crm_deal_id: form.originPrefill?.crmDealId,
    ...(form.originPrefill ? {} : opportunitySelectionPayload(form.opportunity)),
    items: form.items.map((item) => ({
      item_code: item.sku,
      item_name: item.nome,
      qty: item.qty,
      rate: item.rate,
      _rateManual: item._rateManual,
    })),
    prazo_producao_dias: form.prazoDias,
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
    creationRequestId: form.creationRequestId,
    ...(unchanged && base ? {
      status: base.status,
      result: base.result,
      ...(base as StoredAutoQuoteDraft).saved ? { saved: (base as StoredAutoQuoteDraft).saved } : {},
      ...(base as StoredAutoQuoteDraft).issue ? { issue: (base as StoredAutoQuoteDraft).issue } : {},
      ...(base as StoredAutoQuoteDraft).issueIdempotencyKey ? { issueIdempotencyKey: (base as StoredAutoQuoteDraft).issueIdempotencyKey } : {},
      ...((base as StoredAutoQuoteDraft).issueDispatchStarted ? { issueDispatchStarted: true } : {}),
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
    updateDraftSystemField,
    selectProduct,
    buildDraftsFromOrders,
  } = useExtractionDrafts(initialDrafts);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const [activeDraftIndex, setActiveDraftIndex] = useState<number | null>(
    initialMode === 'conversation' ? initialDrafts.at(-1)?.index ?? null : null,
  );
  // O operador reabriu o Pedido com um rascunho ativo; sem rascunho o card já mostra o Pedido.
  const [orderOpen, setOrderOpen] = useState(false);
  const [manual, setManual] = useState<ManualForm>(emptyManual);
  const [manualStorageHydrated, setManualStorageHydrated] = useState(false);
  const [manualIssuing, setManualIssuing] = useState(false);
  const [text, setText] = useState('');
  const [incomingQuoteDraft, setIncomingQuoteDraft] = useState<AtendimentoQuoteDraft | null>(null);
  const [activeQuoteDraft, setActiveQuoteDraft] = useState<AtendimentoQuoteDraft | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<QuotationTemplateMetadata[]>([]);
  const [templateKey, setTemplateKey] = useState('');
  const [defaultProductionDays, setDefaultProductionDays] = useState(DEFAULT_PRODUCTION_DAYS);
  useEffect(() => {
    let active = true;
    getSettings()
      .then((settings) => {
        if (active && isProductionDays(settings.prazo_producao_dias)) setDefaultProductionDays(settings.prazo_producao_dias);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const [templateLoading, setTemplateLoading] = useState(true);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [waFlows, setWaFlows] = useState<CommunicationFlow[]>([]);
  const [defaultWaFlowId, setDefaultWaFlowId] = useState('');
  const [waFlowByDraft, setWaFlowByDraft] = useState<Record<number, string>>({});
  const [orderTemplates, setOrderTemplates] = useState<OrderTemplate[]>([]);
  const [orderTemplateOpen, setOrderTemplateOpen] = useState(false);
  const [savingDraft, setSavingDraft] = useState<Record<number, boolean>>({});
  const [issueErrorByDraft, setIssueErrorByDraft] = useState<Record<number, string>>({});
  const issueInFlight = useRef(new Set<number>());
  const saveInFlight = useRef(new Map<string, Promise<StoredAutoQuoteDraft | null>>());
  const initialIssueKeys = initialDrafts.flatMap((draft) => draft.issueIdempotencyKey && !draft.issue ? [draft.issueIdempotencyKey] : []);
  const initialIssuePending = initialIssueKeys.length > 0;
  const [officialIssuePending, setOfficialIssuePending] = useState(initialIssuePending);
  const officialIssuePendingRef = useRef(initialIssuePending);
  const officialIssueKeys = useRef(new Set(initialIssueKeys));
  const mountedRef = useRef(false);
  const recoveryInFlight = useRef(new Map<number, string>());
  const recoveryHandled = useRef(new Set<string>());
  const recoveryTokens = useRef(new Map<number, symbol>());
  const recoveryTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const recoveryTimerKeys = useRef(new Map<number, string>());
  const recoveryAttempts = useRef(new Map<number, number>());
  const manualIssueKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const previousInitialMode = useRef(initialMode);
  const extractionGeneration = useRef(0);
  const manualSourceDraft = useRef<number | null>(null);
  const restoredManual = useRef(false);
  const opportunityClientRef = useRef<string | null>(null);
  const draftOpportunityRequests = useRef(new Map<number, DraftOpportunityRequest>());
  const manualRef = useRef(manual);
  manualRef.current = manual;
  const unloadingRef = useRef(false);
  const manualPricingVersion = useRef(0);
  const manualPricingPendingRef = useRef(false);
  const [manualPricingPending, setManualPricingPending] = useState(false);
  const [conversationPricingPending, setConversationPricingPending] = useState<Record<string, boolean>>({});
  const clientPanelInput = useRef<HTMLInputElement>(null);
  const [clientPanel, setClientPanel] = useState<'existing' | 'new' | 'address' | null>(null);
  const [drawerManual, setDrawerManual] = useState<ManualForm | null>(null);
  const [clientResults, setClientResults] = useState<Client[]>([]);
  const [clientSearching, setClientSearching] = useState(false);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [opportunityChoices, setOpportunityChoices] = useState<OpportunityChoice[]>([]);
  const [opportunityLoading, setOpportunityLoading] = useState(false);
  const [draftOpportunityChoices, setDraftOpportunityChoices] = useState<
    Record<number, OpportunityChoice[]>
  >({});
  const [draftOpportunityLoading, setDraftOpportunityLoading] = useState<
    Record<number, boolean>
  >({});
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState<Product[]>([]);
  const [productSearching, setProductSearching] = useState(false);
  const [addingSku, setAddingSku] = useState<string | null>(null);
  const clientTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const productTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { imageData, imagePreview, clearImage, handleImageFile, handleDragOver, handleDragLeave, handleDrop } = useImageInput();

  const beginOfficialIssue = useCallback((key: string) => {
    officialIssueKeys.current.add(key);
    officialIssuePendingRef.current = true;
    setOfficialIssuePending(true);
  }, []);
  const finishOfficialIssue = useCallback((key: string) => {
    officialIssueKeys.current.delete(key);
    if (officialIssueKeys.current.size !== 0) return;
    officialIssuePendingRef.current = false;
    if (mountedRef.current) setOfficialIssuePending(false);
  }, []);

  const issueOfficially = useCallback(async (key: string, request: () => Promise<Awaited<ReturnType<typeof issuePersistedDraft>>>) => {
    if (!mountedRef.current) return undefined;
    beginOfficialIssue(key);
    let retainOwnership = false;
    try {
      return await request();
    } catch (error) {
      retainOwnership = !(error instanceof Error && error.message === ISSUE_PERSISTENCE_ERROR)
        && isAmbiguousIssueError(error);
      throw error;
    } finally {
      if (!retainOwnership) finishOfficialIssue(key);
    }
  }, [beginOfficialIssue, finishOfficialIssue]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      extractionGeneration.current += 1;
      for (const timer of recoveryTimers.current.values()) clearTimeout(timer);
      recoveryTimers.current.clear();
      recoveryTimerKeys.current.clear();
      officialIssueKeys.current.clear();
      officialIssuePendingRef.current = false;
      draftOpportunityRequests.current.clear();
      if (clientTimer.current) clearTimeout(clientTimer.current);
      if (productTimer.current) clearTimeout(productTimer.current);
      manualPricingVersion.current += 1;
    };
  }, []);

  const liveDraftOperation = officialIssuePending
    || Object.keys(savingDraft).some((index) => savingDraft[Number(index)])
    || drafts.some((draft) => draft.status === 'processing');

  const activeDrafts = useMemo(() => drafts.filter((draft) => !draft.discarded), [drafts]);
  const activeDraft = activeDrafts.find((draft) => draft.index === activeDraftIndex) || null;
  const compactLayout = useMediaQuery(MOBILE_MEDIA_QUERY);
  const activeIssued = Boolean(activeDraft && draftIssued(activeDraft));
  // Outro pedido da mesma conversa ainda não emitido, oferecido depois do Envio.
  const nextOrder = activeIssued
    ? activeDrafts.find((draft) => draft.index !== activeDraft?.index && !draftIssued(draft))
    : undefined;
  const quoteStep: QuoteStep = !activeDraft || orderOpen ? 'order' : activeIssued ? 'send' : 'review';
  // A troca de etapa desmonta o botão que a causou: o foco vai para o conteúdo
  // da nova etapa e, se o topo do card saiu da tela, a tela sobe até ele.
  const quoteCardRef = useRef<HTMLDivElement>(null);
  const quoteStepBodyRef = useRef<HTMLDivElement>(null);
  const previousQuoteStep = useRef(quoteStep);
  useEffect(() => {
    if (previousQuoteStep.current === quoteStep) return;
    previousQuoteStep.current = quoteStep;
    quoteStepBodyRef.current?.focus({ preventScroll: true });
    if ((quoteCardRef.current?.getBoundingClientRect().top ?? 0) < 0) {
      quoteCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [quoteStep]);
  // Identity resolution for every unsaved automatic card. Frozen while a save
  // or issue is in flight so a pending response cannot change the payload that
  // was already dispatched.
  const clientResolution = useAutomaticClientResolution({
    drafts,
    updateDraftSystemField,
    updateDraftField,
    enabled: !liveDraftOperation,
  });
  const activeClientResolution = activeDraft
    ? clientResolution.views[activeDraft.index]
    : undefined;
  const issuedRevisionIds = useMemo(() => activeDrafts.flatMap((draft) => {
    const stored = draft as StoredAutoQuoteDraft;
    const issue = stored.issue;
    const resultData = draft.result?.data;
    const status = resultData?.status ?? issue?.status;
    const revisionId = typeof resultData?.revisionId === 'string' ? resultData.revisionId : issue?.revisionId || '';
    return revisionId && isSendableQuotationStatus(status)
      ? [revisionId]
      : [];
  }), [activeDrafts]);
  const {
    deliveriesByRevision,
    pendingRevisionIds,
    errorsByRevision,
  } = useQuotationRevisionDeliveries(issuedRevisionIds);
  const deliveryIdentities = useMemo(() => {
    const selectedIdentities = activeDrafts.flatMap((draft) => {
      const stored = draft as StoredAutoQuoteDraft;
      const resultData = draft.result?.data;
      const status = resultData?.status ?? stored.issue?.status;
      const revisionId = typeof resultData?.revisionId === 'string'
        ? resultData.revisionId
        : stored.issue?.revisionId || '';
      const flowId = waFlowByDraft[draft.index] || defaultWaFlowId || waFlows[0]?.id || '';
      return revisionId && flowId && isSendableQuotationStatus(status)
        ? [{ revisionId, flowId }]
        : [];
    });
    const discoveredIdentities = Object.values(deliveriesByRevision).map((delivery) => ({
      revisionId: delivery.revisionId,
      flowId: delivery.flowId,
    }));
    return [...selectedIdentities, ...discoveredIdentities];
  }, [activeDrafts, defaultWaFlowId, deliveriesByRevision, waFlowByDraft, waFlows]);
  const {
    deliveriesByKey,
    pendingKeys: deliveryPendingKeys,
    errorByKey: deliveryErrorsByKey,
    enqueueErrorByKey,
    enqueue: enqueueDelivery,
    resolve: resolveDelivery,
  } = useQuotationDeliveries(deliveryIdentities);

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

  const loadCommunicationFlows = useCallback(async () => {
    try {
      const result = await fetchFlows();
      const flows = Array.isArray(result.flows)
        ? result.flows.filter(isQuotationDeliveryFlow)
        : [];
      setWaFlows(flows);
      const preferred =
        flows.find(
          (flow) =>
            flow.name.localeCompare('Já estou em contato', 'pt-BR', { sensitivity: 'base' }) === 0
        ) || flows.find((flow) => flow.context === 'already_talking');
      const selected = flows.find((flow) => flow.id === result.selectedFlowId);
      setDefaultWaFlowId(preferred?.id || selected?.id || flows[0]?.id || '');
    } catch {
      setWaFlows([]);
      setDefaultWaFlowId('');
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
    void loadOrderTemplates();
    void loadCommunicationFlows();
  }, [loadCommunicationFlows, loadOrderTemplates, loadTemplates]);

  useEffect(() => {
    if (mode !== 'manual' || restoredManual.current) return;
    const pendingIssue = initialDrafts.find((draft) => draft.issueIdempotencyKey && !draft.issue);
    const prefill = loadQuotationOriginPrefill();
    const restored = prefill ? null : loadManualQuoteDraft();
    if (pendingIssue) {
      manualSourceDraft.current = pendingIssue.index;
      opportunityClientRef.current = pendingIssue.edited.client_id || null;
      setManual(draftToManual(pendingIssue));
    } else if (prefill) {
      setManual((current) => ({
        ...current,
        originPrefill: prefill,
        newClient: { nome: prefill.leadName, email: prefill.email, telefone: formatPhoneInput(prefill.telefone) },
      }));
    } else if (restored) {
      opportunityClientRef.current = restored.selectedClient?.id ?? null;
      setManual({
        ...restored,
        originPrefill: restored.originPrefill || null,
        creationRequestId: restored.creationRequestId || globalThis.crypto.randomUUID(),
      });
    }
    restoredManual.current = true;
    setManualStorageHydrated(true);
  }, [mode]);

  useEffect(() => {
    if (new URLSearchParams(window.location.hash.split('?')[1] || '').has('demandId')) return;
    let raw: string | null;
    try {
      raw = window.sessionStorage.getItem('aspen_quote_prefill');
      if (raw !== null) window.sessionStorage.removeItem('aspen_quote_prefill');
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const prefill = JSON.parse(raw) as { nome?: unknown; empresa?: unknown; email?: unknown; telefone?: unknown };
      const nome = typeof prefill.nome === 'string' ? prefill.nome.trim() : '';
      const empresa = typeof prefill.empresa === 'string' ? prefill.empresa.trim() : '';
      const email = typeof prefill.email === 'string' ? prefill.email.trim() : '';
      const telefone = typeof prefill.telefone === 'string' ? prefill.telefone.trim() : '';
      if (!nome && !empresa && !email && !telefone) return;
      setText((current) => current.trim() ? current : [
        `Nome: ${nome}`,
        ...(empresa ? [`Empresa: ${empresa}`] : []),
        `E-mail: ${email}`,
        `Telefone: ${telefone}`,
      ].join('\n'));
    } catch {
      // Prefill malformado é ignorado sem bloquear a entrada.
    }
  }, []);

  useEffect(() => {
    if (mode !== 'conversation') return;
    const demandId = new URLSearchParams(window.location.hash.split('?')[1] || '').get('demandId');
    if (!demandId) return;
    let cancelled = false;
    void fetchAtendimentoQuoteDraft(demandId).then((draft) => {
      if (cancelled) return;
      if (draft.demandId !== demandId) return;
      if (draftsRef.current.some(draftHasWork) || text.trim()) {
        setIncomingQuoteDraft(draft);
        setOrderOpen(true);
      } else {
        setText(draft.text);
        setActiveQuoteDraft(draft);
      }
    }).catch(() => {
      if (!cancelled) setExtractError('Não foi possível carregar a demanda da conversa.');
    });
    return () => { cancelled = true; };
    // The demand is loaded once on arrival; edits to the text never trigger a refetch.
  }, [mode]);

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
      prazoDias: manual.prazoDias,
      observacoes: manual.observacoes,
      acrescimo: manual.acrescimo,
      templateKey: manual.templateKey,
      originPrefill: manual.originPrefill || undefined,
      opportunity: manual.opportunity,
      creationRequestId: manual.creationRequestId,
    });
  }, [manual, manualStorageHydrated, mode]);

  useEffect(() => {
    if (mode !== 'conversation') return;
    saveAutoQuoteDrafts(window.sessionStorage, drafts as StoredAutoQuoteDraft[]);
  }, [drafts, mode]);

  useEffect(() => {
    if (!liveDraftOperation && !manualPricingPending) return;
    const markPageHidden = () => {
      unloadingRef.current = true;
    };
    const restorePage = () => {
      unloadingRef.current = false;
    };
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!liveDraftOperation && !manualPricingPendingRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('pagehide', markPageHidden);
    window.addEventListener('pageshow', restorePage);
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => {
      window.removeEventListener('pagehide', markPageHidden);
      window.removeEventListener('pageshow', restorePage);
      window.removeEventListener('beforeunload', warnBeforeUnload);
    };
  }, [liveDraftOperation, manualPricingPending]);

  const navigateToQuotation = useCallback((quotationId: string) => {
    setNavigationGuard(null);
    window.location.hash = `/quotations/${encodeURIComponent(quotationId)}`;
  }, [setNavigationGuard]);

  const persistDrafts = useCallback((next: StoredAutoQuoteDraft[]) => {
    if (!saveAutoQuoteDrafts(window.sessionStorage, next)) return false;
    draftsRef.current = next;
    setDrafts(next);
    return true;
  }, [setDrafts]);

  const sendContextForDraft = useCallback((draft: Draft, flowId: string): SendContext | null => {
    const stored = draft as StoredAutoQuoteDraft;
    const resultData = draft.result?.data;
    const businessNumber = typeof resultData?.businessNumber === 'string'
      ? resultData.businessNumber
      : stored.issue?.businessNumber || '';
    const revisionId = typeof resultData?.revisionId === 'string'
      ? resultData.revisionId
      : stored.issue?.revisionId || '';
    return businessNumber && revisionId && flowId
      ? { quotationId: businessNumber, revisionId, flowId }
      : null;
  }, []);

  const handleSelectWhatsAppFlow = useCallback((draftIndex: number, flowId: string) => {
    setWaFlowByDraft((current) => ({ ...current, [draftIndex]: flowId }));
  }, []);

  const handleSendWhatsApp = useCallback(async (draftIndex: number) => {
    const draft = draftsRef.current.find((candidate) => candidate.index === draftIndex);
    if (!draft) {
      toast('Pedido não encontrado.', 'error');
      return;
    }
    const flowId = waFlowByDraft[draftIndex] || defaultWaFlowId || waFlows[0]?.id || '';
    const context = sendContextForDraft(draft, flowId);
    if (!context) {
      toast(flowId
        ? 'Não foi possível identificar a revisão emitida do orçamento.'
        : 'Nenhum fluxo de WhatsApp disponível.', 'error');
      return;
    }
    const deliveryKey = deliveryIdentityKey(context);
    if (
      pendingRevisionIds.includes(context.revisionId)
      || Boolean(deliveriesByRevision[context.revisionId])
      || Boolean(errorsByRevision[context.revisionId])
      || deliveryPendingKeys.includes(deliveryKey)
      || Boolean(deliveriesByKey[deliveryKey])
      || Boolean(deliveryErrorsByKey[deliveryKey])
      || Boolean(enqueueErrorByKey[deliveryKey])
    ) return;
    try {
      await enqueueDelivery(context);
    } catch {
      console.error('[NewQuotationPage] failed to enqueue WhatsApp delivery');
    }
  }, [
    defaultWaFlowId,
    deliveriesByKey,
    deliveriesByRevision,
    deliveryErrorsByKey,
    deliveryPendingKeys,
    enqueueDelivery,
    enqueueErrorByKey,
    errorsByRevision,
    pendingRevisionIds,
    sendContextForDraft,
    toast,
    waFlowByDraft,
    waFlows,
  ]);

  const recoverQuotationIssue = useCallback(async (draft: StoredAutoQuoteDraft, force = false) => {
    const key = draft.issueIdempotencyKey;
    const identity = key ? `${draft.index}:${key}` : '';
    if (!key || draft.issue || (!force && issueInFlight.current.has(draft.index)) || recoveryInFlight.current.get(draft.index) === key || recoveryHandled.current.has(identity) || recoveryTimerKeys.current.get(draft.index) === identity) return;
    const matches = (item: Draft) => item.index === draft.index && (item as StoredAutoQuoteDraft).issueIdempotencyKey === key;
    const currentDraft = draftsRef.current.find(matches) as StoredAutoQuoteDraft | undefined;
    const recoveryDraft = currentDraft || draft;
    const previousTimer = recoveryTimers.current.get(draft.index);
    if (previousTimer) clearTimeout(previousTimer);
    recoveryTimers.current.delete(draft.index);
    recoveryTimerKeys.current.delete(draft.index);
    const token = Symbol('quotation-recovery');
    recoveryTokens.current.set(draft.index, token);
    recoveryInFlight.current.set(draft.index, key);
    beginOfficialIssue(key);
    setDrafts((current) => current.map((item) => matches(item) ? { ...item, status: 'processing' } : item));
    const isCurrent = () => mountedRef.current && recoveryTokens.current.get(draft.index) === token
      && draftsRef.current.some(matches);
    try {
      const state = await getQuotationIssue(key);
      if (!isCurrent()) return;
      if (state.state === 'processing') {
        const attempt = (recoveryAttempts.current.get(draft.index) || 0) + 1;
        recoveryAttempts.current.set(draft.index, attempt);
        if (attempt > 3) {
          recoveryHandled.current.add(identity);
          setDrafts((current) => current.map((item) => matches(item) ? { ...item, status: 'processing', result: { success: false, error: 'A emissão continua em processamento. Tente novamente quando estiver pronta.' } } : item));
          return;
        }
        setDrafts((current) => current.map((item) => matches(item) ? { ...item, status: 'processing' } : item));
        const timer = setTimeout(() => {
          if (!mountedRef.current) return;
          if (recoveryTimerKeys.current.get(draft.index) !== identity) return;
          recoveryTimers.current.delete(draft.index);
          recoveryTimerKeys.current.delete(draft.index);
          void recoverQuotationIssue({ ...draft, status: undefined });
        }, Math.min(10_000, Math.max(500, state.retryAfterMs || 500)));
        recoveryTimers.current.set(draft.index, timer);
        recoveryTimerKeys.current.set(draft.index, identity);
        return;
      }
      recoveryHandled.current.add(identity);
      if (state.state === 'completed') {
        setIssueErrorByDraft((current) => {
          const next = { ...current };
          delete next[draft.index];
          return next;
        });
        const completed = draftsRef.current.map((item) => matches(item)
          ? { ...item, issue: state, status: 'done', result: { success: true, data: { businessNumber: state.businessNumber, quotationId: state.quotationId, revisionId: state.revisionId, revisionNumber: state.revisionNumber, status: state.status } } } as StoredAutoQuoteDraft
          : item);
        if (!persistDrafts(completed)) {
          setIssueErrorByDraft((current) => ({ ...current, [draft.index]: ISSUE_PERSISTENCE_ERROR }));
          setDrafts((current) => current.map((item) => matches(item)
            ? { ...item, status: 'processing', result: { success: false, error: ISSUE_PERSISTENCE_ERROR } }
            : item));
          return;
        }
        finishOfficialIssue(key);
        if (recoveryDraft.issueOrigin === 'manual' || (!recoveryDraft.issueOrigin && mode === 'manual')) {
          navigateToQuotation(state.quotationId);
        }
        else setActiveDraftIndex(draft.index);
      } else {
        setIssueErrorByDraft((current) => ({ ...current, [draft.index]: state.error }));
        setDrafts((current) => current.map((item) => matches(item) ? { ...item, status: undefined, result: { success: false, error: state.error } } : item));
        finishOfficialIssue(key);
      }
    } catch (error) {
      if (!isCurrent()) return;
      recoveryHandled.current.add(identity);
      const notFound = error instanceof QuotationIssueApiError && error.status === 404;
      const preDispatch = notFound && !recoveryDraft.issueDispatchStarted;
      const needsOperatorRecovery = preDispatch && !recoveryDraft.saved?.snapshot;
      const message = needsOperatorRecovery
        ? PRE_SAVE_RECOVERY_ERROR
        : preDispatch
          ? 'A emissão ainda não foi iniciada. Tente emitir novamente.'
          : 'Não foi possível consultar a emissão. Tente novamente.';
      setIssueErrorByDraft((current) => ({ ...current, [draft.index]: message }));
      setDrafts((current) => current.map((item) => matches(item)
        ? {
            ...item,
            status: needsOperatorRecovery || !preDispatch ? 'processing' : undefined,
            result: { success: false, error: message },
            ...(needsOperatorRecovery ? { issueRecoveryRequired: true } : {}),
          }
        : item));
      if (preDispatch && !needsOperatorRecovery) finishOfficialIssue(key);
    } finally {
      if (recoveryTokens.current.get(draft.index) === token) {
        recoveryTokens.current.delete(draft.index);
        recoveryInFlight.current.delete(draft.index);
      }
    }
  }, [beginOfficialIssue, finishOfficialIssue, mode, navigateToQuotation, persistDrafts, setDrafts]);

  const retryQuotationIssueRecovery = useCallback((draftIndex: number) => {
    const draft = draftsRef.current.find((item) => item.index === draftIndex) as StoredAutoQuoteDraft | undefined;
    if (!draft?.issueIdempotencyKey || draft.issue || draft.status !== 'processing') return;
    const timer = recoveryTimers.current.get(draftIndex);
    if (timer) clearTimeout(timer);
    recoveryTimers.current.delete(draftIndex);
    recoveryTimerKeys.current.delete(draftIndex);
    recoveryAttempts.current.delete(draftIndex);
    recoveryHandled.current.delete(`${draftIndex}:${draft.issueIdempotencyKey}`);
    void recoverQuotationIssue(draft);
  }, [recoverQuotationIssue]);

  useEffect(() => () => {
    for (const timer of recoveryTimers.current.values()) clearTimeout(timer);
    recoveryTimers.current.clear();
    recoveryTimerKeys.current.clear();
  }, []);

  useEffect(() => {
    for (const draft of activeDrafts as StoredAutoQuoteDraft[]) void recoverQuotationIssue(draft);
  }, [activeDrafts, recoverQuotationIssue]);

  useEffect(() => {
    try {
      window.localStorage.removeItem('aspen_drafts');
    } catch {
      // Keep the existing legacy cleanup behavior; it is not a new storage path.
    }
  }, []);

  useEffect(() => {
    setNavigationGuard(liveDraftOperation ? () => false : null);
    return () => setNavigationGuard(null);
  }, [liveDraftOperation, setNavigationGuard]);

  const setManualValue = useCallback(<K extends keyof ManualForm>(key: K, value: ManualForm[K]) => {
    if (liveDraftOperation) return;
    setManual((current) => ({ ...current, [key]: value }));
  }, [liveDraftOperation]);

  const beginManualPricing = useCallback(() => {
    const version = ++manualPricingVersion.current;
    manualPricingPendingRef.current = true;
    setManualPricingPending(true);
    return version;
  }, []);
  const settleManualPricing = useCallback((version: number) => {
    if (manualPricingVersion.current === version) {
      manualPricingPendingRef.current = false;
      if (mountedRef.current) setManualPricingPending(false);
    }
  }, []);
  const invalidateManualPricing = useCallback(() => {
    ++manualPricingVersion.current;
    manualPricingPendingRef.current = false;
    setManualPricingPending(false);
  }, []);

  const repriceManualAutomatic = useCallback(async (requested: ManualForm) => {
    const version = beginManualPricing();
    try {
      const priced = await fetchPricing([draftFromManual(requested, -1)], requested.acrescimo);
      if (manualPricingVersion.current !== version || !priced[0] || !mountedRef.current) return;
      setManual((current) => {
        if (current.acrescimo !== requested.acrescimo || current.items.length !== requested.items.length) return current;
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
    } finally {
      settleManualPricing(version);
    }
  }, [beginManualPricing, fetchPricing, settleManualPricing]);

  const reportConversationPricing = useCallback((draftIndex: number, pending: boolean) => {
    const key = String(draftIndex);
    setConversationPricingPending((current) => {
      if (pending === Boolean(current[key])) return current;
      const next = { ...current };
      if (pending) next[key] = true;
      else delete next[key];
      return next;
    });
  }, []);

  const setManualAcrescimo = useCallback((percent: number) => {
    if (liveDraftOperation) return;
    const next = { ...manual, acrescimo: percent };
    setManual(next);
    void repriceManualAutomatic(next);
  }, [liveDraftOperation, manual, repriceManualAutomatic]);

  const openClientPanel = useCallback((panel: 'existing' | 'new' | 'address') => {
    if (liveDraftOperation) return;
    setDrawerManual(cloneManual(manual));
    setClientSearchTerm('');
    setClientResults([]);
    setClientPanel(panel);
  }, [liveDraftOperation, manual]);

  const closeClientPanel = useCallback(() => {
    if (liveDraftOperation) return;
    setClientPanel(null);
    setDrawerManual(null);
    setClientResults([]);
  }, [liveDraftOperation]);

  const applyClientPanel = useCallback(() => {
    if (liveDraftOperation) return;
    if (drawerManual) setManual(drawerManual);
    closeClientPanel();
  }, [closeClientPanel, drawerManual, liveDraftOperation]);

  const switchMode = useCallback((nextMode: NewQuotationMode) => {
    if (nextMode === mode || liveDraftOperation || manualPricingPending || Object.values(conversationPricingPending).some(Boolean)) return;
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
    if (nextMode === 'conversation') setOrderOpen(false);
    setMode(nextMode);
  }, [activeDraft, conversationPricingPending, drafts, liveDraftOperation, manual, manualPricingPending, mode, navigateToQuotation, setDrafts]);

  useEffect(() => {
    if (previousInitialMode.current === initialMode) return;
    previousInitialMode.current = initialMode;
    switchMode(initialMode);
  }, [initialMode, switchMode]);

  // Descarta a fila local da conversa com o que cada rascunho carregava:
  // recuperações de emissão, erros, fluxo de WhatsApp e demandas carregadas.
  const replaceConversationDrafts = useCallback((next: StoredAutoQuoteDraft[]) => {
    recoveryTokens.current.clear();
    recoveryHandled.current.clear();
    recoveryAttempts.current.clear();
    for (const timer of recoveryTimers.current.values()) clearTimeout(timer);
    recoveryTimers.current.clear();
    recoveryTimerKeys.current.clear();
    setWaFlowByDraft({});
    setIssueErrorByDraft({});
    draftOpportunityRequests.current.clear();
    setDraftOpportunityChoices({});
    setDraftOpportunityLoading({});
    setActiveDraftIndex(next[0]?.index ?? null);
    setOrderOpen(false);
    if (!persistDrafts(next)) {
      draftsRef.current = next;
      setDrafts(next);
      toast('A tela foi atualizada, mas o navegador não permitiu salvar os rascunhos localmente.', 'error');
    }
  }, [persistDrafts, setDrafts, toast]);

  // Um pedido novo substitui o anterior: o card só mostra um orçamento por vez.
  const replaceWithExtraction = useCallback((newDrafts: Draft[]) => {
    if (liveDraftOperation) return;
    const start = Math.max(-1, ...drafts.map((draft) => draft.index)) + 1;
    replaceConversationDrafts(newDrafts.map((draft, offset) => ({ ...draft, index: start + offset })));
  }, [drafts, liveDraftOperation, replaceConversationDrafts]);

  const handleExtract = useCallback(async () => {
    if (liveDraftOperation || (!text.trim() && !imageData)) return;
    const inline = inlineTemplateSelections(text, orderTemplates);
    if (inline.unknown.length) {
      setExtractError(`Modelo não encontrado: ${inline.unknown.join(', ')}.`);
      return;
    }
    const generation = ++extractionGeneration.current;
    const isCurrent = () => mountedRef.current && generation === extractionGeneration.current;
    setExtracting(true);
    setExtractError(null);
    try {
      const response = await apiPost<{ orders?: Record<string, unknown>[] }>('/extract', {
        text: text || null,
        imageBase64: imageData?.base64 || null,
        imageMimeType: imageData?.mime || null,
        ...(inline.selections.length ? { orderTemplateSelections: inline.selections } : {}),
      });
      if (!isCurrent()) return;
      if (!response.orders?.length) {
        setExtractError('Nenhum pedido identificado no texto.');
        return;
      }
      const extracted = buildDraftsFromOrders(response.orders, templateKey).map((draft) => activeQuoteDraft ? {
        ...draft,
        edited: {
          ...draft.edited,
          nome: draft.edited.nome || activeQuoteDraft.name || '',
          email: draft.edited.email || activeQuoteDraft.email || '',
          telefone: draft.edited.telefone || activeQuoteDraft.phone || '',
          origem: 'WhatsApp',
          quote_lead_id: activeQuoteDraft.quoteLeadId,
          crm_deal_id: activeQuoteDraft.crmDealId || undefined,
          client_id: activeQuoteDraft.clientId || undefined,
        },
      } : draft);
      if (extracted.length) {
        setConversationPricingPending((current) => ({ ...current, [CONVERSATION_EXTRACTION_PRICING]: true }));
      }
      try {
        // Resultados extraídos começam sem acréscimo.
        const pricedDrafts = extracted.length ? await fetchPricing(extracted, 0) : [];
        if (!isCurrent()) return;
        const priced = new Map(pricedDrafts.map((draft) => [draft.index, draft]));
        replaceWithExtraction(extracted.map((draft) => priced.get(draft.index) || draft));
      } finally {
        if (isCurrent()) {
          setConversationPricingPending((current) => {
            const next = { ...current };
            delete next[CONVERSATION_EXTRACTION_PRICING];
            return next;
          });
        }
      }
    } catch {
      if (isCurrent()) setExtractError('Não foi possível extrair os pedidos. Tente novamente.');
    } finally {
      if (isCurrent()) setExtracting(false);
    }
  }, [activeQuoteDraft, buildDraftsFromOrders, replaceWithExtraction, fetchPricing, imageData, liveDraftOperation, orderTemplates, templateKey, text]);

  const responseSaved = useCallback((response: OrcamentoResponse) => {
    const quotationId = [response.quotation_uuid, response.quote_id].find((value) => typeof value === 'string' && value)?.toString() || '';
    const businessNumber = typeof response.quotation_id === 'string' ? response.quotation_id : '';
    const revisionId = typeof response.revision_id === 'string' ? response.revision_id : '';
    const concurrencyToken = typeof response.concurrency_token === 'string' ? response.concurrency_token : '';
    const snapshot = savedSnapshotFromResponse(response);
    return quotationId && businessNumber && revisionId && concurrencyToken && snapshot
      ? {
          quotationId,
          businessNumber,
          revisionId,
          concurrencyToken,
          snapshot,
        }
      : null;
  }, []);

  const releaseUnconfirmedIssue = useCallback((draftIndex: number) => {
    const current = draftsRef.current.find((draft) => draft.index === draftIndex) as StoredAutoQuoteDraft | undefined;
    const key = current?.issueIdempotencyKey;
    if (!current?.issueRecoveryRequired || !key) return;
    const identity = `${draftIndex}:${key}`;
    const next = draftsRef.current.map((draft) => {
      if (draft.index !== draftIndex || (draft as StoredAutoQuoteDraft).issueIdempotencyKey !== key) return draft;
      const cleared = { ...draft } as StoredAutoQuoteDraft;
      delete cleared.issueIdempotencyKey;
      delete cleared.issueDispatchStarted;
      delete cleared.issueRecoveryRequired;
      delete cleared.status;
      delete cleared.result;
      return cleared;
    });
    if (!persistDrafts(next)) {
      setIssueErrorByDraft((errors) => ({ ...errors, [draftIndex]: ISSUE_PERSISTENCE_ERROR }));
      return;
    }
    recoveryHandled.current.delete(identity);
    manualIssueKey.current = null;
    setIssueErrorByDraft((errors) => {
      const nextErrors = { ...errors };
      delete nextErrors[draftIndex];
      return nextErrors;
    });
    finishOfficialIssue(key);
  }, [finishOfficialIssue, persistDrafts]);

  const saveDraft = useCallback(async (draft: Draft, isCurrentContent: () => boolean = () => true): Promise<StoredAutoQuoteDraft | null> => {
    // The local index is only a presentation slot. It can change between two
    // click handlers while React commits the first persistence update; the
    // creation key is the identity shared by Save and Issue.
    const requestDraft = ensureCreationRequestId(draft) as StoredAutoQuoteDraft & { creationRequestId: string };
    const identity = requestDraft.creationRequestId;
    const index = requestDraft.index;
    const existing = draftsRef.current.find((candidate) => candidate.index === index) as StoredAutoQuoteDraft | undefined;
    const existingSaved = requestDraft.saved || (
      existing && sameEditableDraft(existing.edited, requestDraft.edited) ? existing.saved : undefined
    );
    if (existingSaved?.quotationId && existingSaved.businessNumber && existingSaved.revisionId && existingSaved.concurrencyToken && existingSaved.snapshot) {
      return { ...draft, saved: existingSaved } as StoredAutoQuoteDraft;
    }
    const pending = saveInFlight.current.get(identity);
    if (pending) return pending;
    let operation!: Promise<StoredAutoQuoteDraft | null>;
    operation = (async () => {
      setSavingDraft((current) => ({ ...current, [index]: true }));
      try {
        // The creation key is stable across retries and persisted before the
        // first dispatch, so a lost response never creates a second quotation.
        const response = await dispatchAfterDraftPersistence(
          requestDraft,
          (persistedDraft) => {
            const staged = draftsRef.current.some((item) => item.index === index)
              ? draftsRef.current.map((item) =>
                  item.index === index ? persistedDraft : item
                )
              : [...draftsRef.current, persistedDraft];
            return persistDrafts(staged);
          },
          (persistedDraft) => apiPost<OrcamentoResponse>('/orcamento', buildQuotePayload(persistedDraft)),
        );
        if (!response) {
          setIssueErrorByDraft((current) => ({ ...current, [index]: ISSUE_PERSISTENCE_ERROR }));
          return null;
        }
        if (!mountedRef.current || unloadingRef.current) return null;
        const saved = responseSaved(response);
        if (!saved) throw new Error('Resposta inválida ao salvar o rascunho.');
        if (!isCurrentContent()) return null;
        const current = draftsRef.current;
        const currentDraft = current.find((item) => item.index === index);
        if (currentDraft && !sameEditableDraft(currentDraft.edited, requestDraft.edited)) return null;
        const next = { ...currentDraft, ...requestDraft, saved, result: undefined, ...(requestDraft.status || currentDraft?.status ? { status: requestDraft.status || currentDraft?.status } : {}) } as StoredAutoQuoteDraft;
        const nextDrafts = current.some((item) => item.index === index)
          ? current.map((item) => item.index === index ? next : item)
          : [...current, next];
        if (!persistDrafts(nextDrafts)) throw new Error('Não foi possível salvar o rascunho.');
        return next;
      } catch (error) {
        if (!mountedRef.current || unloadingRef.current) return null;
        setIssueErrorByDraft((current) => ({ ...current, [index]: saveFailureMessage(error) }));
        return null;
      } finally {
        setSavingDraft((current) => {
          const next = { ...current };
          delete next[index];
          return next;
        });
        if (saveInFlight.current.get(identity) === operation) saveInFlight.current.delete(identity);
      }
    })();
    saveInFlight.current.set(identity, operation);
    return operation;
  }, [persistDrafts, responseSaved]);

  const issueDraft = useCallback(async (input: Draft) => {
    const draftIndex = input.index;
    if ((input as StoredAutoQuoteDraft).issueRecoveryRequired) return;
    if (issueInFlight.current.has(draftIndex)) return;
    issueInFlight.current.add(draftIndex);
    const recoveryTimer = recoveryTimers.current.get(draftIndex);
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimers.current.delete(draftIndex);
    recoveryAttempts.current.delete(draftIndex);
    const existing = draftsRef.current.find((draft) => draft.index === draftIndex) as StoredAutoQuoteDraft | undefined;
    const sameExisting = existing ? sameEditableDraft(existing.edited, input.edited) : false;
    const key = (input as StoredAutoQuoteDraft).issueIdempotencyKey || (sameExisting ? existing?.issueIdempotencyKey : undefined) || globalThis.crypto.randomUUID();
    recoveryHandled.current.delete(`${draftIndex}:${key}`);
    const requestDraft = { ...input, issueIdempotencyKey: key, issueOrigin: mode, issueDispatchStarted: (input as StoredAutoQuoteDraft).issueDispatchStarted === true, status: 'processing', result: undefined } as StoredAutoQuoteDraft;
    setIssueErrorByDraft((current) => { const next = { ...current }; delete next[draftIndex]; return next; });
    const pendingDrafts = draftsRef.current.some((draft) => draft.index === draftIndex)
      ? draftsRef.current.map((draft) => draft.index === draftIndex ? requestDraft : draft)
      : [...draftsRef.current, requestDraft];
    if (!persistDrafts(pendingDrafts)) {
      const failed = pendingDrafts.map((draft) => draft.index === draftIndex
        ? ({ ...draft, status: undefined, result: { success: false, error: ISSUE_PERSISTENCE_ERROR }, issueIdempotencyKey: undefined } as StoredAutoQuoteDraft)
        : draft);
      draftsRef.current = failed;
      setDrafts(failed);
      setIssueErrorByDraft((current) => ({ ...current, [draftIndex]: ISSUE_PERSISTENCE_ERROR }));
      issueInFlight.current.delete(draftIndex);
      if (mode === 'manual') setManualIssuing(false);
      return;
    }
    let issueSent = false;
    try {
      const saved = (requestDraft.saved?.snapshot ? requestDraft.saved : undefined)
        || (sameExisting && existing?.saved?.snapshot ? existing.saved : undefined)
        || (await saveDraft(requestDraft))?.saved;
      if (!mountedRef.current || unloadingRef.current) return;
      // saveDraft owns the actionable Save error. Do not turn a shared Save
      // failure into an Issue attempt with stale or undefined revision data.
      if (!saved?.quotationId || !saved.businessNumber || !saved.revisionId || !saved.concurrencyToken) {
        const failed = draftsRef.current.map((draft) => {
          if (draft.index !== draftIndex || (draft as StoredAutoQuoteDraft).issueIdempotencyKey !== key) return draft;
          const next = { ...draft, status: undefined, result: undefined } as StoredAutoQuoteDraft;
          delete next.issueIdempotencyKey;
          delete next.issueDispatchStarted;
          return next;
        });
        if (!persistDrafts(failed)) {
          draftsRef.current = failed;
          setDrafts(failed);
        }
        return;
      }
      const issue = await issueOfficially(key, async () => {
        const marked = draftsRef.current.map((draft) => draft.index === draftIndex
          && (draft as StoredAutoQuoteDraft).issueIdempotencyKey === key
          ? { ...draft, saved, issueDispatchStarted: true, status: 'processing', result: undefined } as StoredAutoQuoteDraft
          : draft);
        if (!persistDrafts(marked)) throw new Error(ISSUE_PERSISTENCE_ERROR);
        issueSent = true;
        return issuePersistedDraft(saved.revisionId, saved.concurrencyToken, key);
      });
      if (!issue) return;
      if (!mountedRef.current) return;
      const completed = draftsRef.current.map((draft) => draft.index === draftIndex && (draft as StoredAutoQuoteDraft).issueIdempotencyKey === key
        ? { ...draft, issue, result: { success: true, data: { businessNumber: issue.businessNumber, quotationId: issue.quotationId, revisionId: issue.revisionId, revisionNumber: issue.revisionNumber, status: issue.status, ...(saved.snapshot ? { snapshot: saved.snapshot } : {}) } }, status: 'done' } as StoredAutoQuoteDraft
        : draft);
      if (!persistDrafts(completed)) {
        setDrafts(completed);
        draftsRef.current = completed;
      }
      clearManualQuoteDraft();
      clearQuotationOriginPrefill();
      if (requestDraft.issueOrigin === 'manual') navigateToQuotation(issue.quotationId);
      else setActiveDraftIndex(draftIndex);
    } catch (error) {
      if (!mountedRef.current || unloadingRef.current) return;
      const message = error instanceof Error && error.message === ISSUE_PERSISTENCE_ERROR
        ? ISSUE_PERSISTENCE_ERROR
        : error instanceof QuotationIssueApiError && error.status === 409
        ? 'O orçamento mudou ou já está em processamento. Tente novamente.'
        : 'Não foi possível emitir o orçamento. Tente novamente.';
      const ambiguous = issueSent && isAmbiguousIssueError(error);
      setIssueErrorByDraft((current) => ({ ...current, [draftIndex]: message }));
      const failed = draftsRef.current.map((draft) => {
        if (draft.index !== draftIndex || (draft as StoredAutoQuoteDraft).issueIdempotencyKey !== key) return draft;
        const next = { ...draft, status: ambiguous ? 'processing' as const : undefined, result: { success: false, error: message } } as StoredAutoQuoteDraft;
        if (!ambiguous) {
          delete next.issueIdempotencyKey;
          delete next.issueDispatchStarted;
        }
        return next;
      });
      if (!persistDrafts(failed)) {
        draftsRef.current = failed;
        setDrafts(failed);
      }
      if (ambiguous) {
        const currentRecoveryDraft = draftsRef.current.find((draft) => draft.index === draftIndex
          && (draft as StoredAutoQuoteDraft).issueIdempotencyKey === key) as StoredAutoQuoteDraft | undefined;
        await recoverQuotationIssue(currentRecoveryDraft || { ...requestDraft, status: 'processing' }, true);
      }
    } finally {
      issueInFlight.current.delete(draftIndex);
      if (mode === 'manual') setManualIssuing(false);
    }
  }, [issueOfficially, mode, navigateToQuotation, persistDrafts, recoverQuotationIssue, saveDraft, setDrafts]);

  const currentManualDraft = useCallback((): Draft => {
    const base = manualSourceDraft.current === null
      ? undefined
      : drafts.find((draft) => draft.index === manualSourceDraft.current);
    const index = base?.index
      ?? manualSourceDraft.current
      ?? (Math.max(-1, ...drafts.map((draft) => draft.index)) + 1);
    // Reserve the existing presentation slot before the first await. Save and
    // Issue can otherwise observe different slots in adjacent click events.
    if (manualSourceDraft.current === null) manualSourceDraft.current = index;
    return draftFromManual(manual, index, base);
  }, [drafts, manual]);

  const handleManualSave = useCallback(async () => {
    if (liveDraftOperation || opportunityLoading || manualPricingPending || manualPricingPendingRef.current) return;
    const draft = currentManualDraft();
    if (!draft.edited.nome) { toast('Informe o cliente para continuar.', 'error'); return; }
    if (!draft.edited.items.length) { toast('Adicione ao menos um item para continuar.', 'error'); return; }
    if (!isValidLeadSource(draft.edited.origem)) { toast('Selecione a origem para continuar.', 'error'); return; }
    if (draft.edited.cnpj && !isValidCnpj(draft.edited.cnpj)) { toast('CNPJ informado é inválido. Corrija ou deixe em branco.', 'error'); return; }
    if (!isOpportunitySelectionValid(manualRef.current.opportunity, opportunityChoices)) { toast('Escolha a oportunidade ou inicie uma nova demanda.', 'error'); return; }
    const isCurrentContent = () => sameEditableDraft(manualToEdited(manualRef.current), draft.edited);
    const saved = await saveDraft(draft, isCurrentContent);
    if (saved && isCurrentContent()) {
      manualSourceDraft.current = saved.index;
      clearManualQuoteDraft();
      clearQuotationOriginPrefill();
      navigateToQuotation(saved.saved!.quotationId);
    }
  }, [currentManualDraft, liveDraftOperation, manualPricingPending, navigateToQuotation, opportunityChoices, opportunityLoading, saveDraft, toast]);

  const handleManualIssue = useCallback(() => {
    if (opportunityLoading || manualIssuing || officialIssuePending || drafts.some((draft) => draft.status === 'processing') || manualPricingPending || manualPricingPendingRef.current || addingSku) return;
    if (!isOpportunitySelectionValid(manualRef.current.opportunity, opportunityChoices)) { toast('Escolha a oportunidade ou inicie uma nova demanda.', 'error'); return; }
    const draft = currentManualDraft();
    const fingerprint = JSON.stringify(buildQuotePayload(draft));
    const current = manualIssueKey.current;
    const key = current?.fingerprint === fingerprint
      ? current.key
      : (draft as StoredAutoQuoteDraft).issueIdempotencyKey || globalThis.crypto.randomUUID();
    manualIssueKey.current = { fingerprint, key };
    setManualIssuing(true);
    void issueDraft({ ...draft, issueIdempotencyKey: key } as StoredAutoQuoteDraft);
  }, [addingSku, currentManualDraft, drafts, issueDraft, manualIssuing, manualPricingPending, officialIssuePending, opportunityChoices, opportunityLoading, toast]);

  const handleManualReview = useCallback(() => {
    if (liveDraftOperation || opportunityLoading || manualPricingPending || manualPricingPendingRef.current) return;
    const draft = currentManualDraft();
    const isCurrentContent = () => sameEditableDraft(manualToEdited(manualRef.current), draft.edited);
    void saveDraft(draft, isCurrentContent).then((saved) => {
      if (!saved?.saved || !isCurrentContent()) return;
      navigateToQuotation(saved.saved.quotationId);
    });
  }, [currentManualDraft, liveDraftOperation, manualPricingPending, navigateToQuotation, opportunityLoading, saveDraft]);

  const handleAutoIssue = useCallback((draftIndex: number) => {
    if (liveDraftOperation) return;
    const draft = drafts.find((item) => item.index === draftIndex);
    if (!draft) return;
    const block = conversationOpportunityBlockMessage(
      draft,
      draftOpportunityChoices[draftIndex] || [],
      Boolean(draftOpportunityLoading[draftIndex]),
    ) ?? conversationClientBlockMessage(draft, clientResolution.views[draftIndex]);
    if (block) {
      toast(block, 'error');
      return;
    }
    void issueDraft(draft);
  }, [clientResolution.views, draftOpportunityChoices, draftOpportunityLoading, drafts, issueDraft, liveDraftOperation, toast]);

  const handleAutoReview = useCallback((draftIndex: number) => {
    if (liveDraftOperation) return;
    const draft = drafts.find((item) => item.index === draftIndex);
    if (!draft) return;
    const form = document.createElement('form');
    const payload = document.createElement('input');
    form.method = 'POST';
    form.action = '/api/quotation-preview?format=html';
    form.target = '_blank';
    form.style.display = 'none';
    payload.type = 'hidden';
    payload.name = 'payload';
    payload.value = JSON.stringify(buildQuotePayload(draft));
    form.append(payload);
    document.body.append(form);
    form.submit();
    form.remove();
  }, [drafts, liveDraftOperation]);

  const searchClientsLocal = useCallback(async (term: string) => {
    if (liveDraftOperation) return;
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
  }, [liveDraftOperation]);

  const onClientSearch = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    if (liveDraftOperation) return;
    const value = event.target.value;
    setClientSearchTerm(value);
    if (clientTimer.current) clearTimeout(clientTimer.current);
    clientTimer.current = setTimeout(() => void searchClientsLocal(value), 300);
  }, [liveDraftOperation, searchClientsLocal]);

  const chooseClient = useCallback((client: Client) => {
    if (liveDraftOperation) return;
    setDrawerManual((current) => current ? ({
      ...current,
      clientType: CLIENT_TYPE.EXISTING,
      selectedClient: client,
      clientSearch: `${client.nome} (${client.email || client.telefone || client.id})`,
      cnpj: current.cnpj || normalizeCnpj(client.cnpj || ''),
    }) : current);
    setClientResults([]);
  }, [liveDraftOperation]);

  const searchProductsLocal = useCallback(async (term: string) => {
    if (liveDraftOperation) return;
    if (term.trim().length < 2) { setProductResults([]); return; }
    setProductSearching(true);
    try { setProductResults(await searchProducts(term, 8)); } catch { setProductResults([]); } finally { setProductSearching(false); }
  }, [liveDraftOperation]);

  const onProductSearch = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    if (liveDraftOperation) return;
    const value = event.target.value;
    setProductSearch(value);
    if (productTimer.current) clearTimeout(productTimer.current);
    productTimer.current = setTimeout(() => void searchProductsLocal(value), 300);
  }, [liveDraftOperation, searchProductsLocal]);

  const addProduct = useCallback(async (product: Product) => {
    if (!product.sku || addingSku || liveDraftOperation || isUnpricedProduct(product)) return;
    setAddingSku(product.sku);
    const pricingVersion = beginManualPricing();
    try {
      const result = await apiPost<{ items?: Array<{ rate?: number | string }> }>('/pricing-lookup', { items: [{ item_code: product.sku, qty: DEFAULT_QTY }], acrescimo_percent: manual.acrescimo });
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
      settleManualPricing(pricingVersion);
    }
  }, [addingSku, beginManualPricing, liveDraftOperation, manual.acrescimo, settleManualPricing, toast]);

  const updateManualItem = useCallback((key: string, field: 'qty' | 'rate', value: string) => {
    if (liveDraftOperation) return;
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
    invalidateManualPricing();
    const item = manual.items.find((candidate) => candidate._key === key);
    if (field === 'qty' && item && !item._rateManual) void repriceManualAutomatic(next);
  }, [invalidateManualPricing, liveDraftOperation, manual, repriceManualAutomatic]);

  const resetManualRate = useCallback(async (key: string) => {
    if (liveDraftOperation) return;
    const item = manual.items.find((candidate) => candidate._key === key);
    if (!item) return;
    const version = beginManualPricing();
    try {
      const result = await apiPost<{ items?: Array<{ rate?: number | string }> }>('/pricing-lookup', { items: [{ item_code: item.sku, qty: item.qty }], acrescimo_percent: manual.acrescimo });
      const rate = Number(result.items?.[0]?.rate);
      if (!Number.isFinite(rate) || rate <= 0 || !mountedRef.current) return;
      setManual((current) => ({ ...current, items: current.items.map((candidate) => candidate._key === key && version === manualPricingVersion.current && candidate.sku === item.sku && candidate.qty === item.qty ? { ...candidate, rate, _rateManual: false } : candidate) }));
    } catch {
      // Keep the displayed price when repricing is unavailable.
    } finally {
      settleManualPricing(version);
    }
  }, [beginManualPricing, liveDraftOperation, manual.items, manual.acrescimo, settleManualPricing]);

  useEffect(() => {
    if (!clientPanel) return;
    const frame = window.requestAnimationFrame(() => clientPanelInput.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [clientPanel]);

  const selectedClientId = manual.selectedClient?.id || '';
  useEffect(() => {
    if (!selectedClientId) {
      opportunityClientRef.current = null;
      setOpportunityChoices([]);
      setOpportunityLoading(false);
      setManual((current) =>
        current.originPrefill || current.opportunity.mode === 'new'
          ? current
          : { ...current, opportunity: { ...NEW_DEMAND_SELECTION } }
      );
      return;
    }
    let cancelled = false;
    // A selection restored from the browser belongs to the same client and is
    // preserved (even when no longer eligible, so the operator must decide).
    // Only a real client change resets the choice.
    const sameClient = opportunityClientRef.current === selectedClientId;
    opportunityClientRef.current = selectedClientId;
    setOpportunityChoices([]);
    setOpportunityLoading(true);
    listClientOpportunities(selectedClientId)
      .then((choices) => {
        if (cancelled) return;
        setOpportunityChoices(choices);
        setManual((current) =>
          current.originPrefill
            ? current
            : {
                ...current,
                opportunity: reconcileOpportunitySelection(current.opportunity, choices, {
                  sameClient,
                }),
              }
        );
      })
      .catch(() => {
        if (!cancelled) setOpportunityChoices([]);
      })
      .finally(() => {
        if (!cancelled) setOpportunityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedClientId]);

  // Automatic (conversation) drafts must also carry an explicit demand link.
  // Choices load by the proposal's client; with several candidates the result
  // stays blocked until the operator picks one. No inference is ever made.
  // A request is identified by the draft index plus its client and carries a
  // token, so editing the same draft never cancels an in-flight load while a
  // client change (or a cleared/removed draft) makes the old response stale.
  useEffect(() => {
    const clearDraftOpportunityState = (index: number) => {
      setDraftOpportunityChoices((current) => {
        if (!(index in current)) return current;
        const next = { ...current };
        delete next[index];
        return next;
      });
      setDraftOpportunityLoading((current) => {
        if (!(index in current)) return current;
        const next = { ...current };
        delete next[index];
        return next;
      });
    };
    const activeIndices = new Set(activeDrafts.map((draft) => draft.index));
    for (const index of draftOpportunityRequests.current.keys()) {
      if (!activeIndices.has(index)) draftOpportunityRequests.current.delete(index);
    }
    for (const draft of activeDrafts) {
      const index = draft.index;
      const hasDurableState = draftHasDurableQuotationState(draft);
      if (draftHasOrigin(draft)) {
        draftOpportunityRequests.current.delete(index);
        clearDraftOpportunityState(index);
        continue;
      }
      const clientId = draft.edited.client_id;
      if (!clientId) {
        draftOpportunityRequests.current.delete(index);
        clearDraftOpportunityState(index);
        if (!hasDurableState && draft.edited.new_demand !== true) {
          updateDraftSystemField(index, 'new_demand', true);
        }
        continue;
      }
      const key = draftOpportunityRequestKey(index, clientId);
      if (!shouldStartDraftOpportunityRequest({
        request: draftOpportunityRequests.current.get(index),
        key,
        hasOrigin: draftHasOrigin(draft),
        clientId,
      })) continue;
      const token = Symbol('draft-opportunity');
      draftOpportunityRequests.current.set(index, { key, token });
      clearDraftOpportunityState(index);
      setDraftOpportunityLoading((current) => ({ ...current, [index]: true }));
      const decide = (alreadyDecided: boolean) => {
        const latest = draftsRef.current.find((candidate) => candidate.index === index);
        return planDraftOpportunityApplication({
          request: draftOpportunityRequests.current.get(index),
          token,
          draftActive: Boolean(latest && !latest.discarded && !draftHasOrigin(latest)),
          alreadyDecided,
        });
      };
      listClientOpportunities(clientId)
        .then((choices) => {
          const latest = draftsRef.current.find((candidate) => candidate.index === index);
          const decided = Boolean(
            latest && (
              draftHasDurableQuotationState(latest) ||
              latest.edited.opportunity_id ||
              latest.edited.new_demand === true
            )
          );
          const decision = decide(decided);
          if (!decision.choices) return;
          setDraftOpportunityChoices((current) => ({ ...current, [index]: choices }));
          if (!decision.selection) return;
          const selection = initialOpportunitySelection(choices);
          if (selection.mode === 'existing' && selection.opportunityId) {
            updateDraftSystemField(index, 'opportunity_id', selection.opportunityId);
          } else if (selection.mode === 'new') {
            updateDraftSystemField(index, 'new_demand', true);
          }
        })
        .catch(() => {
          if (decide(false).choices) {
            setDraftOpportunityChoices((current) => ({ ...current, [index]: [] }));
          }
        })
        .finally(() => {
          if (decide(false).settleLoading) {
            setDraftOpportunityLoading((current) => ({ ...current, [index]: false }));
          }
        });
    }
  }, [activeDrafts, updateDraftSystemField]);

  const subtotal = manual.items.reduce((sum, item) => sum + item.qty * item.rate, 0);
  const manualValidationBlockMessage = !manualToEdited(manual).nome && !manual.items.length
    ? 'Informe o cliente e adicione ao menos um item para continuar.'
    : !manualToEdited(manual).nome
      ? 'Informe o cliente para continuar.'
      : !manual.items.length
        ? 'Adicione ao menos um item para continuar.'
        : !manual.leadSource || !isValidLeadSource(manual.leadSource)
          ? 'Selecione a origem para continuar.'
          : !isOpportunitySelectionValid(manual.opportunity, opportunityChoices)
            ? 'Escolha a oportunidade ou inicie uma nova demanda.'
            : null;
  const manualBlockMessage = liveDraftOperation
    ? 'Aguarde a conclusão da operação atual.'
    : manualPricingPending
      ? 'Atualizando preços…'
      : opportunityLoading
        ? 'Carregando demandas…'
        : manualValidationBlockMessage;
  const manualCanSubmit = !manualValidationBlockMessage && !manualPricingPending && !opportunityLoading && !manual.items.some((item) => item.rate === 0);
  const manualActionDraftIndex = manualSourceDraft.current ?? (Math.max(-1, ...drafts.map((draft) => draft.index)) + 1);
  const manualRecoveryDraft = activeDrafts.find((draft) => {
    const stored = draft as StoredAutoQuoteDraft;
    return stored.issueIdempotencyKey && !stored.issue;
  }) as StoredAutoQuoteDraft | undefined;
  const manualActionsBlocked = liveDraftOperation || Boolean(addingSku);
  const manualIssueBlocked = manualIssuing || officialIssuePending || manualPricingPending || Boolean(addingSku)
    || drafts.some((draft) => draft.status === 'processing');
  const pricingPending = manualPricingPending || Object.values(conversationPricingPending).some(Boolean);

  const clearResultsBlocked = extracting || liveDraftOperation || pricingPending;

  // Limpar e Novo orçamento: volta ao pedido vazio, sem rascunhos.
  const resetConversation = useCallback(() => {
    if (clearResultsBlocked) return;
    extractionGeneration.current += 1;
    setText('');
    setActiveQuoteDraft(null);
    setIncomingQuoteDraft(null);
    clearImage();
    setExtractError(null);
    replaceConversationDrafts([]);
  }, [clearImage, clearResultsBlocked, replaceConversationDrafts]);

  const activeStoredDraft = activeDraft as StoredAutoQuoteDraft | null;
  const activeResultData = activeDraft?.result?.data;
  const activeIssueStatus = activeResultData?.status ?? activeStoredDraft?.issue?.status;
  const activeRevisionId = typeof activeResultData?.revisionId === 'string'
    ? activeResultData.revisionId
    : activeStoredDraft?.issue?.revisionId || '';
  const activeSelectedWaFlowId = activeDraft
    ? waFlowByDraft[activeDraft.index] || defaultWaFlowId || waFlows[0]?.id || ''
    : '';
  const activeWhatsAppContext = activeDraft
    && isSendableQuotationStatus(activeIssueStatus)
    ? sendContextForDraft(activeDraft, activeSelectedWaFlowId)
    : null;
  const activeRevisionDelivery = activeRevisionId ? deliveriesByRevision[activeRevisionId] : null;
  const activeRevisionDeliveryKey = activeRevisionDelivery
    ? deliveryIdentityKey(activeRevisionDelivery)
    : '';
  const activeDeliveryKey = activeWhatsAppContext ? deliveryIdentityKey(activeWhatsAppContext) : '';
  const activeDelivery = (activeRevisionDeliveryKey ? deliveriesByKey[activeRevisionDeliveryKey] : null)
    || (activeDeliveryKey ? deliveriesByKey[activeDeliveryKey] : null)
    || activeRevisionDelivery
    || null;
  const activeDeliveryPending = Boolean(activeRevisionId && pendingRevisionIds.includes(activeRevisionId))
    || Boolean(activeRevisionDeliveryKey && deliveryPendingKeys.includes(activeRevisionDeliveryKey))
    || Boolean(activeDeliveryKey && deliveryPendingKeys.includes(activeDeliveryKey));
  const activeDeliveryError = (activeRevisionId ? errorsByRevision[activeRevisionId] : undefined)
    || (activeRevisionDeliveryKey ? deliveryErrorsByKey[activeRevisionDeliveryKey] : undefined)
    || (activeDeliveryKey
      ? deliveryErrorsByKey[activeDeliveryKey] || enqueueErrorByKey[activeDeliveryKey]
      : undefined);

  return (
    <PageShell className="min-w-0 flex min-h-0 flex-1 flex-col space-y-6 overflow-x-hidden pb-0">
      {mode === 'manual' && (
        <PageHeader
          title="Novo orçamento"
          className="items-center"
          actions={
            <TabBar
              value={mode}
              onValueChange={switchMode}
              label="Modo de criação"
              idPrefix="quotation-mode"
              variant="segmented"
              className="!mt-0"
              items={[
                { value: 'conversation', label: 'Conversa', icon: MessagesSquare, disabled: pricingPending },
                { value: 'manual', label: 'Manual', icon: PencilLine, disabled: pricingPending },
              ]}
            />
          }
        />
      )}

      {manual.originPrefill && (
        <p className="text-sm text-fg-muted" role="status">
          Origem: {manual.originPrefill.source === 'site_form' ? 'Formulário do site' : manual.originPrefill.source || 'Oportunidade CRM'}
        </p>
      )}

      {mode === 'manual' && manualRecoveryDraft && (
        <InlineAlert
          tone="warning"
          action={
            <Button
              type="button"
              variant="outline"
              disabled={recoveryInFlight.current.has(manualRecoveryDraft.index)
                || (officialIssuePending && !manualRecoveryDraft.result?.error)}
              onClick={() => manualRecoveryDraft.issueRecoveryRequired
                ? releaseUnconfirmedIssue(manualRecoveryDraft.index)
                : manualRecoveryDraft.status === 'processing'
                  ? retryQuotationIssueRecovery(manualRecoveryDraft.index)
                  : handleManualIssue()}
            >
              {manualRecoveryDraft.issueRecoveryRequired
                ? PRE_SAVE_RECOVERY_ACTION
                : manualRecoveryDraft.status === 'processing' ? 'Consultar novamente' : 'Emitir novamente'}
            </Button>
          }
        >
          {manualRecoveryDraft.result?.error || 'Recuperando a emissão pendente…'}
        </InlineAlert>
      )}

      {mode === 'conversation' ? (
        <Card ref={quoteCardRef} variant="outline" padding="none" className="mx-auto w-full max-w-4xl scroll-mt-4">
          <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line px-5 py-4 md:px-6">
            <Heading level="card" as="h1">Novo orçamento</Heading>
            <QuoteSteps
              current={quoteStep}
              reachable={quoteStep === 'order' && activeDraft
                ? (activeIssued ? 'send' : 'review')
                : quoteStep === 'review' && !liveDraftOperation ? 'order' : null}
              onSelect={(step) => setOrderOpen(step === 'order')}
            />
          </header>
          <div ref={quoteStepBodyRef} tabIndex={-1} className="outline-none">
            {quoteStep === 'order' || !activeDraft ? (
              <QuoteOrderStep
                text={text}
                onTextChange={setText}
                imagePreview={imagePreview}
                onImageFile={handleImageFile}
                onClearImage={clearImage}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                extracting={extracting}
                blocked={liveDraftOperation}
                canExtract={!extracting && !liveDraftOperation && Boolean(text.trim() || imageData)}
                onExtract={() => void handleExtract()}
                canReset={!clearResultsBlocked && Boolean(text || imageData || activeDrafts.length || activeQuoteDraft || incomingQuoteDraft)}
                onReset={resetConversation}
                onManual={() => switchMode('manual')}
                manualDisabled={liveDraftOperation || pricingPending}
                onManageTemplates={() => setOrderTemplateOpen(true)}
                notices={
                  <>
                    {incomingQuoteDraft && (
                      <InlineAlert tone="warning" action={
                        <Button type="button" variant="outline" onClick={() => {
                          setText(incomingQuoteDraft.text);
                          setActiveQuoteDraft(incomingQuoteDraft);
                          setIncomingQuoteDraft(null);
                        }}>
                          {text.trim() ? 'Substituir texto' : 'Carregar seleção'}
                        </Button>
                      }>
                        Demanda da conversa pronta para revisão. Os rascunhos existentes foram preservados.
                      </InlineAlert>
                    )}
                    {extractError && <InlineAlert>{extractError}</InlineAlert>}
                    {templateError && (
                      <InlineAlert
                        action={
                          <Button variant="outline" onClick={() => void loadTemplates()}>
                            Tentar novamente
                          </Button>
                        }
                      >
                        {templateError}
                      </InlineAlert>
                    )}
                  </>
                }
              />
            ) : (
              <SplitResultCard
                key={activeDraft.index}
                draft={activeDraft}
                position={{ index: activeDrafts.findIndex((draft) => draft.index === activeDraft.index), total: activeDrafts.length }}
                isProcessing={activeDraft.status === 'processing'}
                issueBlocked={liveDraftOperation}
                editingBlocked={liveDraftOperation}
                onUpdateField={updateDraftField}
                onUpdateItem={updateDraftItem}
                onRemoveItem={removeDraftItem}
                onAddItem={addDraftItem}
                selectProduct={selectProduct}
                onRefetchPricing={refetchDraftPricing}
                defaultProductionDays={defaultProductionDays}
                onCreateQuote={handleAutoIssue}
                onRecoverIssue={retryQuotationIssueRecovery}
                onClearIssueRecovery={releaseUnconfirmedIssue}
                onPricingPendingChange={reportConversationPricing}
                isSavingDraft={Boolean(savingDraft[activeDraft.index])}
                onReviewQuote={handleAutoReview}
                onBackToOrder={() => setOrderOpen(true)}
                onEditManually={() => switchMode('manual')}
                manualDisabled={liveDraftOperation || pricingPending}
                onNewQuote={resetConversation}
                newQuoteDisabled={clearResultsBlocked}
                onNextOrder={nextOrder ? () => setActiveDraftIndex(nextOrder.index) : undefined}
                issue={(activeDraft as StoredAutoQuoteDraft).issue}
                issueError={issueErrorByDraft[activeDraft.index] || activeDraft.result?.error}
                viewUrl={(activeDraft as StoredAutoQuoteDraft).issue?.pdfUrl}
                delivery={activeDelivery}
                deliveryPending={activeDeliveryPending}
                deliveryError={activeDeliveryError}
                waSendEnabled={Boolean(activeWhatsAppContext)}
                waFlows={waFlows}
                waSelectedFlowId={activeSelectedWaFlowId}
                waFlowSelectionDisabled={activeDeliveryPending || Boolean(activeDelivery) || Boolean(activeDeliveryError)}
                onSelectWhatsAppFlow={handleSelectWhatsAppFlow}
                onSendWhatsApp={handleSendWhatsApp}
                onResolveDelivery={async (decision, note) => {
                  if (activeDelivery) await resolveDelivery(activeDelivery.id, decision, note);
                }}
                templates={templates}
                templateLoading={templateLoading}
                templateError={templateError}
                onRetryTemplates={loadTemplates}
                opportunitySelector={
                  draftHasOrigin(activeDraft) ? undefined : (
                    <OpportunitySelector
                      choices={draftOpportunityChoices[activeDraft.index] || []}
                      loading={Boolean(draftOpportunityLoading[activeDraft.index])}
                      value={opportunitySelectionFromDraft(activeDraft)}
                      disabled={liveDraftOperation}
                      onChange={(next) => {
                        updateDraftField(
                          activeDraft.index,
                          'opportunity_id',
                          next.mode === 'existing' ? next.opportunityId || undefined : undefined
                        );
                        updateDraftField(
                          activeDraft.index,
                          'new_demand',
                          next.mode === 'new' ? true : undefined
                        );
                        updateDraftField(
                          activeDraft.index,
                          'demand_summary',
                          next.mode === 'new' ? next.demandSummary || undefined : undefined
                        );
                      }}
                    />
                  )
                }
                opportunityBlockMessage={conversationOpportunityBlockMessage(
                  activeDraft,
                  draftOpportunityChoices[activeDraft.index] || [],
                  Boolean(draftOpportunityLoading[activeDraft.index])
                )}
                clientResolution={activeClientResolution}
                onSelectClient={clientResolution.selectClient}
                onConfirmNewClient={clientResolution.confirmNewClient}
                onRetryClientResolution={clientResolution.retry}
                onClearClientSelection={clientResolution.clearSelection}
                clientBlockMessage={conversationClientBlockMessage(activeDraft, activeClientResolution)}
              />
            )}
          </div>
        </Card>
      ) : (
        <div id="quotation-mode-panel-manual" role="tabpanel" aria-labelledby="quotation-mode-tab-manual" tabIndex={0} className="!mt-3 grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-main-aside">
          <div className="min-w-0 space-y-5">
            <section aria-label="Cliente e demanda" className="rounded-card border border-line bg-surface p-5 md:p-6">
              <Heading level="section">Cliente e demanda</Heading>
              <Heading level="subsection" className="mt-5 flex items-center gap-2"><span className="rounded-control bg-surface-subtle px-2 py-1 text-xs text-fg-muted">01</span> Qual cliente está solicitando?</Heading>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1 text-xs font-medium text-fg-muted">Cliente
                  <Button type="button" variant="outline" className="flex w-full justify-between text-left font-normal" onClick={() => openClientPanel('existing')} disabled={manualActionsBlocked} aria-label="Selecionar cliente">
                    <span className="truncate">{manual.clientType === 'existing' && manual.selectedClient ? manual.selectedClient.nome : manual.newClient.nome || 'Selecionar cliente…'}</span><ChevronDown size={14} className="shrink-0 text-fg-muted" aria-hidden="true" />
                  </Button>
                </div>
                <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">Oportunidade / demanda
                  {manual.originPrefill ? <Input value={manual.originPrefill.leadName || 'Demanda vinculada ao CRM'} readOnly aria-label="Oportunidade vinculada" /> : <Select aria-label="Oportunidade / demanda" containerClassName="w-full" className="w-full" value={manual.opportunity.mode === 'new' ? 'new' : manual.opportunity.opportunityId || ''} disabled={manualActionsBlocked || opportunityLoading} onChange={(event) => setManual((current) => ({ ...current, opportunity: event.target.value === 'new' ? { ...NEW_DEMAND_SELECTION } : { mode: 'existing', opportunityId: event.target.value || null, demandSummary: '' } }))}>
                    {manual.opportunity.mode === 'existing' && !manual.opportunity.opportunityId && <option value="">Selecione uma demanda…</option>}
                    {opportunityChoices.map((choice) => <option key={choice.opportunityId} value={choice.opportunityId}>{choice.demandSummary || 'Demanda sem resumo'}</option>)}
                    <option value="new">Nova demanda</option>
                  </Select>}
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">Contato
                  <Input aria-label="Contato do cliente" value={manual.clientType === 'existing' && manual.selectedClient ? manual.selectedClient.email || fmtPhone(manual.selectedClient.telefone || '') : manual.newClient.email || fmtPhone(manual.newClient.telefone)} readOnly onClick={() => openClientPanel(manual.clientType)} placeholder="Selecionar cliente" className="cursor-pointer" />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">Origem *
                  <Select aria-label="Origem *" value={manual.leadSource} disabled={manualActionsBlocked} onChange={(event) => setManualValue('leadSource', event.target.value)} containerClassName="w-full" className="w-full"><option value="">Selecione a origem…</option>{LEAD_SOURCES.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}</Select>
                </label>
              </div>
              {manual.opportunity.mode === 'new' && !manual.originPrefill && <Input aria-label="Resumo da nova demanda" className="mt-3" placeholder="Resumo da nova demanda (opcional)" value={manual.opportunity.demandSummary} disabled={manualActionsBlocked} onChange={(event) => setManual((current) => ({ ...current, opportunity: { mode: 'new', opportunityId: null, demandSummary: event.target.value } }))} />}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button type="button" variant="ghost" onClick={() => openClientPanel('new')} disabled={manualActionsBlocked}>+ Cadastrar outro cliente</Button>
                {(manual.cnpj || hasAnyAddressField(manual.address)) && <span className="text-xs text-fg-muted">{manual.cnpj ? formatCnpj(manual.cnpj) : formatAddressSummary(manual.address)}</span>}
              </div>
              <details className="mt-2 text-xs text-fg-muted"><summary className="cursor-pointer">Dados fiscais e endereço</summary><div className="mt-3 grid gap-3 md:grid-cols-2"><label className="flex flex-col gap-1">CNPJ (opcional)<Input aria-label="CNPJ (opcional)" value={manual.cnpj ? formatCnpj(manual.cnpj) : ''} disabled={manualActionsBlocked} onChange={(event) => setManualValue('cnpj', normalizeCnpj(event.target.value))} /></label><div className="flex items-end"><Button type="button" variant="outline" onClick={() => openClientPanel('address')} disabled={manualActionsBlocked}><MapPin size={14} /> Editar endereço</Button></div></div></details>
            </section>

            <section aria-label="Itens do orçamento" className="rounded-card border border-line bg-surface p-5 md:p-6">
              <div className="flex items-start justify-between gap-3"><Heading level="section">Produtos e quantidades</Heading><span className="text-sm text-fg-muted">{manual.items.length} {manual.items.length === 1 ? 'item' : 'itens'}</span></div>
              <Heading level="subsection" className="mt-5 flex items-center gap-2"><span className="rounded-control bg-surface-subtle px-2 py-1 text-xs text-fg-muted">02</span> Monte a proposta</Heading>
              <div className="relative mt-4"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" /><Input aria-label="Buscar produto para adicionar ao orçamento" className="pl-9" value={productSearch} disabled={manualActionsBlocked} onChange={onProductSearch} placeholder="Buscar SKU ou nome…" />{productSearching && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-fg-muted" />}</div>
              {productResults.length > 0 && <div className="mt-2 divide-y divide-border overflow-hidden rounded-control border border-line">{productResults.map((product) => <div key={product.sku} className="flex items-center justify-between gap-3 p-3"><span className="min-w-0 truncate text-sm"><span className="font-mono text-primary">{product.sku}</span> · {product.nome}</span><div className="flex shrink-0 items-center gap-2">{isUnpricedProduct(product) && <span className="text-xs text-fg-muted">Preço indisponível</span>}<Button type="button" aria-label={`Adicionar ${product.sku} ao orçamento`} onClick={() => void addProduct(product)} disabled={manualActionsBlocked || Boolean(addingSku) || isUnpricedProduct(product)}>{addingSku === product.sku ? 'Adicionando…' : 'Adicionar'}</Button></div></div>)}</div>}
              {manual.items.length === 0 ? <div className="mt-4 rounded-control border border-dashed border-line px-4 py-10 text-center text-sm text-fg-muted">Nenhum produto na tabela</div> : <div className="mt-4">{compactLayout ? <ul aria-label="Produtos do orçamento" className="divide-y divide-line">{manual.items.map((item) => (
                <li key={item._key} className="flex flex-col gap-2 py-3">
                  <div className="flex items-start gap-2">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <Text variant="title">{item.nome}</Text>
                      <Text variant="meta"><span className="font-mono">{item.sku}</span>{item._rateManual && ' · preço manual'}</Text>
                    </div>
                    <Button type="button" variant="ghost-muted-destructive" size="icon" aria-label={`Remover ${item.sku}`} disabled={manualActionsBlocked} onClick={() => { if (!manualActionsBlocked) setManual((current) => ({ ...current, items: current.items.filter((candidate) => candidate._key !== item._key) })); }}><Trash2 size={14} /></Button>
                  </div>
                  <div className="grid grid-cols-2 items-end gap-2">
                    <Field label="Quantidade"><Input type="number" min="0.001" step="0.001" inputMode="decimal" aria-label={`Quantidade de ${item.sku}`} value={item.qty} disabled={manualActionsBlocked} onChange={(event) => updateManualItem(item._key, 'qty', event.target.value)} /></Field>
                    <Field label="Unitário">
                      <div className="flex items-center gap-1">
                        <Input type="number" min="0" step="0.01" inputMode="decimal" aria-label={`Preço unitário de ${item.sku}`} value={item.rate} disabled={manualActionsBlocked} onChange={(event) => updateManualItem(item._key, 'rate', event.target.value)} />
                        {item._rateManual && <Button type="button" variant="ghost-muted" size="icon" aria-label={`Recalcular preço de ${item.sku}`} onClick={() => void resetManualRate(item._key)} disabled={manualActionsBlocked}><RotateCcw size={14} /></Button>}
                      </div>
                    </Field>
                  </div>
                  <div className="flex justify-between gap-3"><Text variant="meta">Total do item</Text><Text variant="value">{formatBRL(item.qty * item.rate)}</Text></div>
                </li>
              ))}</ul> : <Table className="min-w-[620px] text-sm"><TableHeader><TableRow><TableHead>Produto</TableHead><TableHead className="w-28 text-right">Quantidade</TableHead><TableHead className="w-40 text-right">Unitário</TableHead><TableHead className="w-32 text-right">Total</TableHead><TableHead className="w-10" /></TableRow></TableHeader><TableBody>{manual.items.map((item) => <TableRow key={item._key}><TableCell><span className="font-mono text-xs text-primary">{item.sku}</span><p className="text-sm font-medium text-fg">{item.nome}</p>{item._rateManual && <span className="text-2xs text-warning">preço manual</span>}</TableCell><TableCell className="text-right"><Input type="number" min="0.001" step="0.001" className="ml-auto w-24 text-right" aria-label={`Quantidade de ${item.sku}`} value={item.qty} disabled={manualActionsBlocked} onChange={(event) => updateManualItem(item._key, 'qty', event.target.value)} /></TableCell><TableCell className="text-right"><div className="flex items-center justify-end gap-1"><Input type="number" min="0" step="0.01" className="w-32 text-right" aria-label={`Preço unitário de ${item.sku}`} value={item.rate} disabled={manualActionsBlocked} onChange={(event) => updateManualItem(item._key, 'rate', event.target.value)} />{item._rateManual && <Button type="button" variant="ghost-muted" size="icon" aria-label={`Recalcular preço de ${item.sku}`} onClick={() => void resetManualRate(item._key)} disabled={manualActionsBlocked}><RotateCcw size={14} /></Button>}</div></TableCell><TableCell className="text-right font-medium tabular-nums">{formatBRL(item.qty * item.rate)}</TableCell><TableCell className="text-right"><Button type="button" variant="ghost-muted-destructive" size="icon" aria-label={`Remover ${item.sku}`} disabled={manualActionsBlocked} onClick={() => { if (!manualActionsBlocked) setManual((current) => ({ ...current, items: current.items.filter((candidate) => candidate._key !== item._key) })); }}><Trash2 size={14} /></Button></TableCell></TableRow>)}</TableBody></Table>}</div>}
            </section>

            <section aria-label="Condições do orçamento" className="rounded-card border border-line bg-surface p-5 md:p-6">
              <Heading level="section">Condições e fechamento</Heading>
              {templateError && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-destructive"><p role="alert">{templateError}</p><Button type="button" variant="outline" onClick={() => void loadTemplates()}>Tentar novamente</Button></div>}
              <div className="mt-4 grid gap-3 md:grid-cols-2"><label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">Modelo de orçamento<Select aria-label="Modelo de orçamento" value={manual.templateKey} disabled={manualActionsBlocked || templateLoading || !templates.length} onChange={(event) => { setTemplateKey(event.target.value); setManualValue('templateKey', event.target.value); }} className="w-full">{templates.map((template) => <option key={template.key} value={template.key}>{template.name}</option>)}</Select></label>
                <ProductionTermsFields
                  productionDays={manual.prazoDias ?? defaultProductionDays}
                  surchargePercent={manual.acrescimo}
                  disabled={manualActionsBlocked}
                  onProductionDaysChange={(days) => setManualValue('prazoDias', days)}
                  onSurchargePercentChange={setManualAcrescimo}
                />
              </div>
              <label className="mt-4 flex flex-col gap-1 text-xs font-medium text-fg-muted">Observações<Textarea aria-label="Observações do orçamento" value={manual.observacoes} disabled={manualActionsBlocked} onChange={(event) => setManualValue('observacoes', event.target.value)} /></label>
              {manualBlockMessage && <p id="manual-quotation-action-status" className="mt-3 rounded-control border border-line bg-surface-subtle p-3 text-xs text-fg-muted">{manualBlockMessage}</p>}
            </section>
          </div>
          <aside aria-label="Resumo e ações do orçamento" className="min-w-0 rounded-card border border-line bg-surface p-5 md:p-6 xl:sticky xl:top-4">
            <Heading level="section">Resumo da proposta</Heading>
            <p className="mt-5 text-sm text-fg-muted">{manualToEdited(manual).nome || 'Cliente não selecionado'}</p>
            <dl className="mt-7 space-y-3 text-sm tabular-nums"><div className="flex justify-between gap-3"><dt className="text-fg-muted">Subtotal</dt><dd>{formatBRL(subtotal)}</dd></div><div className="flex justify-between gap-3"><dt className="text-fg-muted">Frete</dt><dd>{formatBRL(Number(manual.frete) || 0)}</dd></div><div className="flex justify-between gap-3 border-t border-line pt-4 text-xl font-semibold"><dt>Total</dt><dd>{formatBRL(subtotal + (Number(manual.frete) || 0))}</dd></div></dl>
            {issueErrorByDraft[manualActionDraftIndex] && <InlineAlert className="mt-4">{issueErrorByDraft[manualActionDraftIndex]}</InlineAlert>}
            <div className="mt-7 space-y-2"><Button type="button" variant="outline" className="w-full" disabled={!manualCanSubmit || manualIssuing || liveDraftOperation || Boolean(savingDraft[manualActionDraftIndex])} onClick={() => void handleManualSave()}>{savingDraft[manualActionDraftIndex] ? 'Salvando…' : 'Salvar rascunho'}</Button><Button type="button" variant="success" className="w-full" disabled={!manualCanSubmit || manualIssuing || liveDraftOperation} onClick={handleManualReview}>Revisar emissão</Button><Button type="button" variant="ghost" aria-label="Emitir orçamento" className="w-full" disabled={!manualCanSubmit || manualIssueBlocked} onClick={handleManualIssue}>{manualIssuing ? 'Emitindo…' : 'Emitir orçamento'}</Button></div>
          </aside>
          <MobileActionBar label="Emissão do orçamento">
            <div className="flex flex-col">
              <Text variant="caption">Total</Text>
              <Text variant="value">{formatBRL(subtotal + (Number(manual.frete) || 0))}</Text>
            </div>
            <Button type="button" variant="success" disabled={!manualCanSubmit || manualIssuing || liveDraftOperation} onClick={handleManualReview}>Revisar emissão</Button>
          </MobileActionBar>
        </div>
      )}

      {clientPanel && (
        <DetailDrawer open title={clientPanel === 'address' ? 'Endereço opcional' : 'Cliente do orçamento'} onClose={closeClientPanel}>
          {clientPanel === 'existing' && drawerManual && (
            <div className="mt-5 space-y-3">
              <label className="block text-xs font-medium text-fg-muted">Nome, e-mail ou telefone<Input ref={clientPanelInput} aria-label="Buscar cliente" value={clientSearchTerm} disabled={manualActionsBlocked} onChange={onClientSearch} /></label>
              {clientSearching && <p className="text-xs text-fg-muted">Buscando…</p>}
              {/* eslint-disable-next-line no-restricted-syntax -- opção de resultado de busca */}
              {clientResults.map((client) => <button key={client.id} type="button" aria-label={`Selecionar ${client.nome}`} disabled={manualActionsBlocked} className="block w-full rounded-control border border-line p-3 text-left hover:bg-surface-hover" onClick={() => chooseClient(client)}><span className="block font-medium text-fg">{client.nome}</span><span className="block text-xs text-fg-muted">{client.email || 'E-mail não informado'} · {fmtPhone(client.telefone || '')}</span></button>)}
              <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => setClientPanel('new')} disabled={manualActionsBlocked}>Novo cliente</Button><Button type="button" onClick={applyClientPanel} disabled={manualActionsBlocked || !drawerManual?.selectedClient}>Aplicar ao rascunho</Button><Button type="button" variant="ghost" onClick={closeClientPanel} disabled={manualActionsBlocked}>Cancelar</Button></div>
            </div>
          )}
          {clientPanel === 'new' && drawerManual && (
            <div className="mt-5 space-y-4">
              <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">Nome *<Input ref={clientPanelInput} aria-label="Nome do cliente" value={drawerManual.newClient.nome} disabled={manualActionsBlocked} onChange={(event) => setDrawerManual((current) => !manualActionsBlocked && current ? ({ ...current, clientType: 'new', selectedClient: null, newClient: { ...current.newClient, nome: event.target.value } }) : current)} /></label>
              <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">E-mail<Input type="email" aria-label="E-mail do cliente" value={drawerManual.newClient.email} disabled={manualActionsBlocked} onChange={(event) => setDrawerManual((current) => !manualActionsBlocked && current ? ({ ...current, newClient: { ...current.newClient, email: event.target.value } }) : current)} /></label>
              <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">Telefone<Input aria-label="Telefone do cliente" inputMode="tel" value={formatPhoneInput(drawerManual.newClient.telefone)} disabled={manualActionsBlocked} onChange={(event) => setDrawerManual((current) => !manualActionsBlocked && current ? ({ ...current, newClient: { ...current.newClient, telefone: normalizePhoneDigits(event.target.value) } }) : current)} /></label>
              <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">CNPJ (opcional)<Input aria-label="CNPJ (opcional)" value={drawerManual.cnpj ? formatCnpj(drawerManual.cnpj) : ''} disabled={manualActionsBlocked} onChange={(event) => setDrawerManual((current) => !manualActionsBlocked && current ? ({ ...current, cnpj: normalizeCnpj(event.target.value) }) : current)} /></label>
              <div className="flex flex-wrap gap-2"><Button type="button" onClick={applyClientPanel} disabled={manualActionsBlocked}>Aplicar ao rascunho</Button><Button type="button" variant="ghost" onClick={closeClientPanel} disabled={manualActionsBlocked}>Cancelar</Button></div>
            </div>
          )}
          {clientPanel === 'address' && drawerManual && (
            <div className="mt-5 space-y-3">
              {(['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf'] as const).map((field) => <label key={field} className="flex flex-col gap-1 text-xs font-medium capitalize text-fg-muted">{field === 'uf' ? 'Estado' : field}<Input ref={field === 'cep' ? clientPanelInput : undefined} aria-label={field === 'uf' ? 'Estado' : field} value={drawerManual.address[field]} disabled={manualActionsBlocked} onChange={(event) => setDrawerManual((current) => !manualActionsBlocked && current ? ({ ...current, showAddress: true, address: normalizeAddress({ ...current.address, [field]: field === 'uf' ? event.target.value.toUpperCase().slice(0, 2) : event.target.value }) }) : current)} /></label>)}
              <div className="flex flex-wrap gap-2"><Button type="button" onClick={applyClientPanel} disabled={manualActionsBlocked}>Aplicar ao rascunho</Button><Button type="button" variant="ghost" onClick={closeClientPanel} disabled={manualActionsBlocked}>Cancelar</Button></div>
            </div>
          )}
        </DetailDrawer>
      )}

      <OrderTemplateManager open={orderTemplateOpen} templates={orderTemplates} onClose={() => setOrderTemplateOpen(false)} onChanged={async () => { try { const result = await listOrderTemplates(); setOrderTemplates((result.data || []).filter((item) => !item.archived)); } catch { /* manager owns its error state */ } }} />
    </PageShell>
  );
}
