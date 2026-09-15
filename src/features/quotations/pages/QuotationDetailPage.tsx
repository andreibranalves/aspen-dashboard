import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ChangeEvent,
  type MutableRefObject,
} from 'react';
import {
  Pencil,
  FileText,
  Trash2,
  Save,
  MoreHorizontal,
  X,
  Plus,
  Phone,
  AlertTriangle,
  Loader2,
  Mail,
  Search,
  CheckCircle2,
  ShoppingCart,
  ArrowUpRight,
  ChevronDown,
  LockKeyhole,
} from 'lucide-react';
import { apiGet, apiPost, apiPut, apiDelete, type ApiError } from '@/lib/api/api';
import { issuePersistedDraft } from '@/lib/api/quotationIssueApi';
import { fetchFlows, type CommunicationFlow } from '@/lib/api/communicationApi';
import QuotationDeliveryStatus from '@/features/quotations/components/QuotationDeliveryStatus';
import { useQuotationDeliveries, deliveryIdentityKey } from '@/hooks/useQuotationDeliveries';
import type { DeliveryResolution } from '@/lib/api/quotationDeliveryApi';
import { searchProducts } from '@/lib/api/productCache';
import type { Product } from '@/types/domain';
import { fmtPhone, formatBRL, formatDate } from '@/lib/formatting/formatters';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/badge';
import { useToast } from '@/components/shared/toast';
import { getHashHistoryPreviousRoute, useRouteGuardContext } from '@/hooks/useHashRoute';
import { routePath } from '@/app/match-route';
import { quotationStatusLabel, quotationStatusBadgeKey } from '@/lib/statusLabels';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import SkeletonDetail from '@/components/shared/SkeletonDetail';
import PageShell from '@/components/shared/PageShell';
import { useBreadcrumbLabel } from '@/components/layout/BreadcrumbLabelContext';
import { type QuotationSectionsSnapshot } from '@/features/quotations/components/QuotationSectionsEditor';
import { QuotationSectionsDocument } from '@/features/quotations/components/QuotationSectionsDocument';
import { QuotationEmailDialog } from '@/features/quotations/components/QuotationEmailDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import {
  quotationContentsMatch,
  quotationDisplayTitle,
  quotationItemCountLabel,
} from '@/lib/quotationDisplay';
import {
  projectClientRow,
  projectProduct,
  projectQuotationDetail,
  projectQuotationTemplate,
  type ProjectedQuotationData,
  type ProjectedQuotationItem,
} from '@/lib/localProjections';

// Estados legados de conversação (fora do vocabulário canônico de orçamentos).
const LEGACY_CONVERSATION_STATUS: Record<string, { label: string; badge: string }> = {
  Open: { label: 'Aberto', badge: 'Open' },
  Replied: { label: 'Respondido', badge: 'Replied' },
};

function statusBadgeProps(status: unknown): { status: string; label: string } {
  const raw = String(status ?? '');
  const legacy = LEGACY_CONVERSATION_STATUS[raw];
  if (legacy) return { status: legacy.badge, label: legacy.label };
  return {
    status: quotationStatusBadgeKey(raw),
    label: quotationStatusLabel(raw),
  };
}

const LOSS_REASONS = ['Preço', 'Prazo', 'Sem retorno do cliente', 'Outro'] as const;
const SALES_ORDER_ID_PATTERN = /^PED-\d{4}-\d{4}$/;
const SAFE_CONFLICT_MESSAGES = new Set([
  'O orçamento foi alterado por outro usuário. Recarregue antes de salvar.',
  'O orçamento mudou ou não pode mais ser editado. Recarregue para conferir.',
  'O orçamento mudou. Recarregue para conferir o estado atual.',
  'A revisão mudou ou já existe um rascunho. Recarregue para conferir.',
  'Já existe um pedido ativo para este orçamento. Atualize a página e tente novamente.',
  'Este orçamento não pode ser convertido em pedido de venda.',
  'A revisão aprovada do orçamento não está disponível.',
]);

function readCreatedSalesOrderId(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const candidate = (value as { sales_order_id?: unknown }).sales_order_id;
  if (typeof candidate !== 'string') return '';
  const id = candidate.trim();
  return SALES_ORDER_ID_PATTERN.test(id) ? id : '';
}
const DIALOG_FOCUSABLE_SELECTOR =
  'button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type QuotationItem = ProjectedQuotationItem & {
  _key?: string;
  _rateManual?: boolean;
};

type QuotationData = Omit<ProjectedQuotationData, 'items'> & {
  items?: QuotationItem[];
};

interface QuotationDetailPageProps {
  id: string;
  navigate: (path: string) => void;
}

function makeItemKey(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

interface CoreClientResult {
  id: string;
  nome: string;
  email?: string | null;
  telefone?: string | null;
}

interface CoreQuotationItem extends QuotationItem {
  _key: string;
  sku: string;
  nome: string;
  qty: string;
  suggested_unit_price: string;
  applied_unit_price: string;
  price_difference: string;
  line_total: string;
  manual_rate: boolean;
}

interface CoreQuotationDetailProps {
  data: QuotationData;
  navigate: (path: string) => void;
  onReload: () => Promise<void>;
  concurrencyTokenRef: MutableRefObject<string>;
}

interface QuotationTemplateMetadata {
  key: string;
  name: string;
  is_default?: boolean;
  archived?: boolean;
  hash?: string;
  current_hash?: string | null;
  current_version_id?: string | null;
  current_version?: number | null;
}

function cloneSections<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseSections(value: unknown): QuotationSectionsSnapshot | null {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as QuotationSectionsSnapshot)
    : null;
}

function normalizeSections(data: QuotationData): QuotationSectionsSnapshot {
  const existing = parseSections(data.secoes);
  if (!existing) throw new Error('Resposta inválida: seções do orçamento ausentes.');
  const normalized = cloneSections(existing);
  const legacyDeadline = data.prazoProducao || '';
  const currentValue = normalized.prazo_producao.current.value;
  const baseValue =
    typeof normalized.prazo_producao.base.value === 'string'
      ? normalized.prazo_producao.base.value
      : typeof currentValue === 'string'
        ? currentValue
        : legacyDeadline;
  normalized.prazo_producao.base.value = baseValue;
  if (typeof normalized.prazo_producao.current.value !== 'string') {
    normalized.prazo_producao.current.value = baseValue;
  }
  return normalized;
}

// Comparação determinística de itens: ignora _key (ID de UI gerado aleatoriamente).
function comparableItems(items: CoreQuotationItem[]): Omit<CoreQuotationItem, '_key'>[] {
  return items.map(({ _key: _ignored, ...rest }) => rest);
}

const EMAIL_AMBIGUOUS_ERROR = 'O resultado do envio não pôde ser confirmado. Tente novamente.';
const EMAIL_SEND_ERROR = 'Não foi possível enviar o e-mail. Tente novamente.';

function normalizeEmailRecipient(value: string): string {
  return value.trim().toLowerCase();
}

function asCoreItems(items: QuotationItem[] | undefined): CoreQuotationItem[] {
  return (items || []).map((item) => ({
    _key: item._key || makeItemKey(),
    sku: String(item.sku ?? item.item_code),
    item_code: String(item.item_code),
    item_name: String(item.item_name),
    nome: String(item.nome ?? item.item_name),
    qty: String(item.qty),
    suggested_unit_price: String(item.suggested_unit_price ?? item.preco_sugerido),
    applied_unit_price: String(item.applied_unit_price ?? item.preco_aplicado ?? item.rate),
    price_difference: String(item.price_difference ?? item.diferenca_preco),
    line_total: String(item.line_total ?? item.total_linha),
    manual_rate: item.manual_rate,
    rate: String(item.rate),
  }));
}

function CoreQuotationDetail({
  data: initialData,
  navigate,
  onReload,
  concurrencyTokenRef,
}: CoreQuotationDetailProps) {
  const detailTopRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<QuotationData>(initialData);
  const draftEditable = data.status === 'rascunho';
  const [editing, setEditing] = useState(false);
  const [confirmDiscardEdits, setConfirmDiscardEdits] = useState(false);
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [emailSuccess, setEmailSuccess] = useState('');
  const [emailAttemptId, setEmailAttemptId] = useState('');
  const [emailAttemptRecipient, setEmailAttemptRecipient] = useState('');
  const [confirmedEmailAcceptedKey, setConfirmedEmailAcceptedKey] = useState('');
  const [deliveryFlows, setDeliveryFlows] = useState<CommunicationFlow[]>([]);
  const [deliveryFlowId, setDeliveryFlowId] = useState('');
  const [lifecycleAction, setLifecycleAction] = useState<
    'aprovado' | 'perdido' | 'create_revision' | null
  >(null);
  const [createdSalesOrderId, setCreatedSalesOrderId] = useState('');
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'info' | 'error'>('info');
  const [confirmIssueOpen, setConfirmIssueOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [lossReasonOpen, setLossReasonOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [techDetailsOpen, setTechDetailsOpen] = useState(false);
  const [lossReasonChoice, setLossReasonChoice] = useState('');
  const [lossReasonDetail, setLossReasonDetail] = useState('');
  const moreActionsButtonRef = useRef<HTMLButtonElement>(null);
  const techDetailsDialogRef = useRef<HTMLDivElement>(null);
  const techDetailsCloseRef = useRef<HTMLButtonElement>(null);
  const lossReasonDialogRef = useRef<HTMLDivElement>(null);
  const lossReasonSelectRef = useRef<HTMLSelectElement>(null);
  const lossReasonRestoreFocusRef = useRef<HTMLElement | null>(null);
  const [conflict, setConflict] = useState('');
  const { toast } = useToast();
  const { setNavigationGuard } = useRouteGuardContext();

  useEffect(() => {
    if (!editing) return undefined;
    const frame = window.requestAnimationFrame(() => {
      detailTopRef.current?.closest('main')?.scrollTo({ top: 0, left: 0 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editing]);
  const showMessage = useCallback((text: string, tone: 'info' | 'error' = 'info') => {
    setMessage(text);
    setMessageTone(tone);
  }, []);
  const [items, setItems] = useState<CoreQuotationItem[]>(() => asCoreItems(data.items));
  const [clientId, setClientId] = useState(data.clienteId || '');
  const [clientSearch, setClientSearch] = useState(data.cliente || '');
  const [clientEmail, setClientEmail] = useState(data.email || '');
  const [clientTelefone, setClientTelefone] = useState(data.telefone || '');
  const [clientResults, setClientResults] = useState<CoreClientResult[]>([]);
  const [clientSearching, setClientSearching] = useState(false);
  const [validadeDias, setValidadeDias] = useState(String(data.validadeDias ?? ''));
  const [entrega, setEntrega] = useState(data.entrega || '');
  const [frete, setFrete] = useState(String(data.frete));
  const [sections, setSections] = useState<QuotationSectionsSnapshot>(() =>
    normalizeSections(data)
  );
  const [templates, setTemplates] = useState<QuotationTemplateMetadata[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState(data.templateVersionId || '');
  const [selectedTemplate, setSelectedTemplate] = useState(data.templateKey || 'padrao');
  const templateBaselineRef = useRef({
    key: data.templateKey || 'padrao',
    versionId: data.templateVersionId || '',
  });
  const clientSnapshot = useMemo(
    () => ({
      id: clientId || undefined,
      nome: clientSearch.trim(),
      email: clientEmail.trim() || null,
      telefone: clientTelefone.trim() || null,
    }),
    [clientEmail, clientId, clientSearch, clientTelefone]
  );
  const [templateError, setTemplateError] = useState('');
  const [productTerms, setProductTerms] = useState<Record<string, string>>({});
  const [productResults, setProductResults] = useState<Record<string, Product[]>>({});
  const clientTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const productTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pricingVersionsRef = useRef<Record<string, number>>({});
  const nextPricingVersion = useCallback((key: string): number => {
    const version = (pricingVersionsRef.current[key] || 0) + 1;
    pricingVersionsRef.current[key] = version;
    return version;
  }, []);
  const deliveryIdentity =
    data.status !== 'rascunho' && data.revisionId && deliveryFlowId
      ? { revisionId: data.revisionId, flowId: deliveryFlowId }
      : null;
  const { deliveriesByKey, pendingKeys, errorByKey, enqueueErrorByKey, enqueue, resolve } =
    useQuotationDeliveries(deliveryIdentity ? [deliveryIdentity] : []);
  const deliveryKey = deliveryIdentity ? deliveryIdentityKey(deliveryIdentity) : '';
  const delivery = deliveryKey ? deliveriesByKey[deliveryKey] || null : null;
  const deliveryPending = deliveryKey ? pendingKeys.includes(deliveryKey) : false;
  const deliveryError = deliveryKey ? errorByKey[deliveryKey] : undefined;
  const enqueueError = deliveryKey ? enqueueErrorByKey[deliveryKey] : undefined;

  const handleResolveDelivery = useCallback(
    async (decision: DeliveryResolution, note: string) => {
      if (!delivery) return;
      await resolve(delivery.id, decision, note);
    },
    [delivery, resolve]
  );

  useEffect(() => {
    setData(initialData);
    setItems(asCoreItems(initialData.items));
    setClientId(initialData.clienteId || '');
    setClientSearch(initialData.cliente || '');
    setClientEmail(initialData.email || '');
    setClientTelefone(initialData.telefone || '');
    setValidadeDias(String(initialData.validadeDias ?? ''));
    setEntrega(initialData.entrega || '');
    setFrete(String(initialData.frete));
    setSections(normalizeSections(initialData));
    setSelectedTemplate(initialData.templateKey || 'padrao');
    setSelectedVersionId(initialData.templateVersionId || '');
    templateBaselineRef.current = {
      key: initialData.templateKey || 'padrao',
      versionId: initialData.templateVersionId || '',
    };
    setClientResults([]);
    setClientSearching(false);
    if (clientTimer.current) clearTimeout(clientTimer.current);
    clientTimer.current = null;
    setProductTerms({});
    setProductResults({});
    Object.values(productTimers.current).forEach((timer) => clearTimeout(timer));
    productTimers.current = {};
    showMessage('');
    setEditing(false);
    setConflict('');
    setMenuOpen(false);
    setTechDetailsOpen(false);
  }, [initialData]);

  useEffect(() => {
    setConfirmedEmailAcceptedKey((current) =>
      current === `${data.id}:${data.revisionId}` ? current : ''
    );
    setEmailDialogOpen(false);
    setEmailError('');
    setEmailSuccess('');
    setEmailAttemptId('');
    setEmailAttemptRecipient('');
  }, [data.id, data.revisionId]);

  useEffect(() => {
    let active = true;
    fetchFlows()
      .then((result) => {
        if (!active) return;
        const flows = Array.isArray(result.flows) ? result.flows : [];
        setDeliveryFlows(flows);
        const preferred = flows.find((flow) => flow.context === 'already_talking');
        const fallbackFlowId = preferred?.id || result.selectedFlowId || flows[0]?.id || '';
        setDeliveryFlowId((current) =>
          current && flows.some((flow) => flow.id === current) ? current : fallbackFlowId
        );
      })
      .catch(() => {
        if (!active) return;
        setDeliveryFlows([]);
        setDeliveryFlowId('');
      });
    return () => {
      active = false;
    };
  }, [initialData.id]);

  useEffect(() => {
    let active = true;
    apiGet<unknown>('/quotation-templates')
      .then((result) => {
        if (!active) return;
        const payload =
          result && typeof result === 'object' && !Array.isArray(result)
            ? (result as Record<string, unknown>)
            : null;
        const rawTemplates =
          payload && Array.isArray(payload.templates)
            ? payload.templates
            : payload && Array.isArray(payload.data)
              ? payload.data
              : [];
        const projected = rawTemplates.map(projectQuotationTemplate);
        if (projected.some((template): template is null => template === null)) {
          throw new Error('Resposta inválida ao carregar templates.');
        }
        const available = projected as QuotationTemplateMetadata[];
        const defaultKey = typeof payload?.default_key === 'string' ? payload.default_key : '';
        const fallback =
          available.find((template) => template.key === defaultKey && !template.archived) ||
          available.find((template) => template.is_default && !template.archived) ||
          available.find((template) => !template.archived) ||
          available[0];
        const persisted = initialData.templateKey || '';
        const persistedTemplate = available.find((template) => template.key === persisted);
        setTemplates(available);
        const selection = persistedTemplate?.archived
          ? {
              key: persisted,
              versionId:
                initialData.templateVersionId || persistedTemplate.current_version_id || '',
            }
          : initialData.status === 'rascunho' && fallback
            ? { key: fallback.key, versionId: fallback.current_version_id || '' }
            : persistedTemplate
              ? {
                  key: persisted,
                  versionId:
                    initialData.templateVersionId || persistedTemplate.current_version_id || '',
                }
              : fallback
                ? { key: fallback.key, versionId: fallback.current_version_id || '' }
                : null;
        if (selection) {
          setSelectedTemplate(selection.key);
          setSelectedVersionId(selection.versionId);
          templateBaselineRef.current = selection;
        }
        setTemplateError('');
      })
      .catch(() => {
        if (active) setTemplateError('Não foi possível carregar os modelos. Tente novamente.');
      });
    return () => {
      active = false;
    };
  }, [initialData.id, initialData.status, initialData.templateKey]);

  const searchClients = useCallback(async (term: string) => {
    if (term.trim().length < 2) {
      setClientResults([]);
      return;
    }
    setClientSearching(true);
    try {
      const response = await apiGet<unknown>(
        `/leads-clients?search=${encodeURIComponent(term)}&limit=10`
      );
      const payload =
        response && typeof response === 'object' && !Array.isArray(response)
          ? (response as Record<string, unknown>)
          : {};
      const results = Array.isArray(payload.data)
        ? payload.data
            .map(projectClientRow)
            .filter((client): client is CoreClientResult => client !== null)
        : [];
      setClientResults(results);
    } catch {
      setClientResults([]);
    } finally {
      setClientSearching(false);
    }
  }, []);

  const onClientSearch = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setClientSearch(value);
      setClientId('');
      setClientEmail('');
      setClientTelefone('');
      if (clientTimer.current) clearTimeout(clientTimer.current);
      clientTimer.current = setTimeout(() => searchClients(value), 250);
    },
    [searchClients]
  );

  const updateItem = useCallback(
    (key: string, patch: Partial<CoreQuotationItem>) => {
      nextPricingVersion(key);
      setItems((previous) =>
        previous.map((item) => (item._key === key ? { ...item, ...patch } : item))
      );
    },
    [nextPricingVersion]
  );

  const searchItemProducts = useCallback(async (key: string, term: string) => {
    if (term.trim().length < 2) {
      setProductResults((previous) => ({ ...previous, [key]: [] }));
      return;
    }
    try {
      const rawResults = await searchProducts(term, 6);
      const results = rawResults.map(projectProduct);
      if (results.some((product): product is null => product === null)) {
        throw new Error('Resposta inválida ao buscar produtos.');
      }
      setProductResults((previous) => ({ ...previous, [key]: results as Product[] }));
    } catch {
      toast('Não foi possível buscar produtos. Tente novamente.', 'error');
      setProductResults((previous) => ({ ...previous, [key]: [] }));
    }
  }, []);

  const onProductTerm = useCallback(
    (key: string, value: string) => {
      setProductTerms((previous) => ({ ...previous, [key]: value }));
      updateItem(key, {
        sku: value,
        item_code: value,
        manual_rate: false,
        applied_unit_price: '',
        suggested_unit_price: '',
        price_difference: '',
        line_total: '',
      });
      if (productTimers.current[key]) clearTimeout(productTimers.current[key]);
      productTimers.current[key] = setTimeout(() => searchItemProducts(key, value), 250);
    },
    [searchItemProducts, updateItem]
  );

  const lookupProductPrice = useCallback(async (sku: string, qty: string) => {
    const response = await apiPost<{ items?: Array<{ rate?: string | number }> }>(
      '/pricing-lookup',
      {
        items: [{ item_code: sku, qty }],
        urgent: false,
      }
    );
    const rawRate = response.items?.[0]?.rate;
    const rate = Number(rawRate);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error('Preço indisponível para este produto.');
    }
    return String(rawRate);
  }, []);

  const repriceItem = useCallback(
    async (key: string) => {
      const item = items.find((candidate) => candidate._key === key);
      if (!item || !item.sku || item.manual_rate) return;
      const quantity = item.qty;
      const sku = item.sku;
      const requestVersion = nextPricingVersion(key);
      if (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0) return;
      try {
        const rate = await lookupProductPrice(sku, quantity);
        setItems((previous) =>
          previous.map((current) =>
            current._key === key &&
            pricingVersionsRef.current[key] === requestVersion &&
            current.sku === sku &&
            current.qty === quantity &&
            !current.manual_rate
              ? {
                  ...current,
                  suggested_unit_price: rate,
                  applied_unit_price: rate,
                  price_difference: '0.00',
                  line_total: String(Number(quantity) * Number(rate)),
                }
              : current
          )
        );
      } catch {
        setMessage('Não foi possível consultar o preço. Tente novamente.');
      }
    },
    [items, lookupProductPrice, nextPricingVersion]
  );

  const selectProduct = useCallback(
    async (key: string, product: Product) => {
      const sku = String(product.sku || product.item_code || '');
      const qty = items.find((item) => item._key === key)?.qty || '1.000';
      updateItem(key, {
        sku,
        item_code: sku,
        item_name: product.nome || product.item_name || '',
        nome: product.nome || product.item_name || '',
        manual_rate: false,
        applied_unit_price: '',
        suggested_unit_price: '',
        price_difference: '',
        line_total: '',
      });
      const requestVersion = nextPricingVersion(key);
      setProductTerms((previous) => ({ ...previous, [key]: sku }));
      setProductResults((previous) => ({ ...previous, [key]: [] }));
      try {
        const rate = await lookupProductPrice(sku, qty);
        setItems((previous) =>
          previous.map((current) =>
            current._key === key &&
            pricingVersionsRef.current[key] === requestVersion &&
            current.sku === sku &&
            String(current.qty) === String(qty) &&
            !current.manual_rate
              ? {
                  ...current,
                  suggested_unit_price: rate,
                  applied_unit_price: rate,
                  price_difference: '0.00',
                  line_total: String(Number(qty) * Number(rate)),
                }
              : current
          )
        );
      } catch {
        toast('Não foi possível consultar o preço. Tente novamente.', 'error');
      }
    },
    [items, lookupProductPrice, nextPricingVersion, updateItem]
  );

  const addItem = useCallback(() => {
    const key = makeItemKey();
    setItems((previous) => [
      ...previous,
      {
        _key: key,
        sku: '',
        item_code: '',
        item_name: '',
        nome: '',
        qty: '1.000',
        suggested_unit_price: '',
        applied_unit_price: '',
        price_difference: '',
        line_total: '',
        manual_rate: false,
        rate: '',
      },
    ]);
  }, []);

  const removeItem = useCallback(
    (key: string) => {
      nextPricingVersion(key);
      setItems((previous) => previous.filter((item) => item._key !== key));
    },
    [nextPricingVersion]
  );

  const resetEditor = useCallback(
    (authoritative: QuotationData = data) => {
      setItems(asCoreItems(authoritative.items));
      setClientId(authoritative.clienteId || '');
      setClientSearch(authoritative.cliente || '');
      setClientEmail(authoritative.email || '');
      setClientTelefone(authoritative.telefone || '');
      setClientResults([]);
      setClientSearching(false);
      if (clientTimer.current) clearTimeout(clientTimer.current);
      clientTimer.current = null;
      setProductTerms({});
      setProductResults({});
      Object.values(productTimers.current).forEach((timer) => clearTimeout(timer));
      productTimers.current = {};
      setValidadeDias(String(authoritative.validadeDias ?? ''));
      setEntrega(authoritative.entrega || '');
      setFrete(String(authoritative.frete));
      setSections(normalizeSections(authoritative));
      setSelectedTemplate(authoritative.templateKey || 'padrao');
      setSelectedVersionId(authoritative.templateVersionId || '');
      templateBaselineRef.current = {
        key: authoritative.templateKey || 'padrao',
        versionId: authoritative.templateVersionId || '',
      };
      showMessage('');
      setConflict('');
      setEditing(false);
    },
    [data]
  );

  // ── Dirty detection for the edit form ──
  const isDirty = useMemo(() => {
    if (!editing) return false;
    if (
      JSON.stringify(comparableItems(items)) !==
      JSON.stringify(comparableItems(asCoreItems(data.items)))
    )
      return true;
    if (clientId !== (data.clienteId || '')) return true;
    if (validadeDias !== String(data.validadeDias ?? '')) return true;
    if (entrega !== (data.entrega || '')) return true;
    if (frete !== String(data.frete)) return true;
    if (JSON.stringify(sections) !== JSON.stringify(normalizeSections(data))) return true;
    if (selectedTemplate !== templateBaselineRef.current.key) return true;
    if (selectedVersionId !== templateBaselineRef.current.versionId) return true;
    return false;
  }, [
    editing,
    items,
    data,
    clientId,
    validadeDias,
    entrega,
    frete,
    sections,
    selectedTemplate,
    selectedVersionId,
  ]);

  useEffect(() => {
    if (!isDirty) {
      setNavigationGuard(null);
      setPendingRoute(null);
      return () => setNavigationGuard(null);
    }
    setNavigationGuard(
      saving
        ? () => true
        : (nextRoute) => {
            setPendingRoute(nextRoute);
            return false;
          }
    );
    return () => setNavigationGuard(null);
  }, [isDirty, saving, setNavigationGuard]);

  const save = useCallback(async () => {
    const token = concurrencyTokenRef.current;
    if (!token) {
      setConflict('Token de concorrência ausente. Recarregue o orçamento antes de editar.');
      return;
    }
    setSaving(true);
    showMessage('Salvando…');
    setConflict('');
    try {
      const refreshed = await apiPut<unknown>(`/quotations?id=${encodeURIComponent(data.id)}`, {
        concurrency_token: token,
        client_id: clientId,
        items: items.map((item) => ({
          item_code: item.sku || item.item_code,
          item_name: item.item_name,
          qty: item.qty,
          rate: item.applied_unit_price,
          manual_rate: item.manual_rate,
        })),
        validade_dias: Number(validadeDias),
        entrega,
        frete,
        prazo_producao: sections.prazo_producao.current.enabled
          ? sections.prazo_producao.current.value
          : '',
        template_key: selectedTemplate,
        template_version_id: selectedVersionId || undefined,
        secoes: sections,
      });
      const projection = projectQuotationDetail(refreshed);
      if (!projection) throw new Error('Resposta inválida ao salvar orçamento.');
      concurrencyTokenRef.current = projection.concurrencyToken;
      setData(projection.data);
      resetEditor(projection.data);
      toast('Orçamento salvo.', 'success');
      setEditing(false);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 409) {
        const safeMessage =
          error instanceof Error && SAFE_CONFLICT_MESSAGES.has(error.message)
            ? error.message
            : 'O orçamento mudou ou não pode mais ser editado. Recarregue para conferir.';
        setConflict(safeMessage);
        showMessage('');
      } else {
        showMessage('Não foi possível salvar o orçamento. Tente novamente.', 'error');
      }
    } finally {
      setSaving(false);
    }
  }, [
    clientId,
    data,
    entrega,
    frete,
    items,
    resetEditor,
    selectedTemplate,
    selectedVersionId,
    sections,
    validadeDias,
  ]);

  const reloadAfterConflict = useCallback(async () => {
    setConflict('');
    await onReload();
  }, [onReload]);

  const handleDelete = useCallback(async () => {
    setConfirmDeleteOpen(false);
    try {
      await apiDelete(`/quotations?id=${encodeURIComponent(data.id)}`);
      toast(`Orçamento ${data.id} excluído.`, 'success');
      navigate('/quotations');
    } catch (error) {
      showMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível excluir o orçamento. Tente novamente.',
        'error'
      );
    }
  }, [data.id, navigate, showMessage, toast]);

  const displayItems = items;
  const editingSubtotal = items.reduce(
    (sum, item) => sum + Number(item.qty) * Number(item.applied_unit_price),
    0
  );
  const displayedSubtotal = editing ? editingSubtotal : data.subtotal;
  const displayedTotal = editing
    ? editingSubtotal + (Number.isFinite(Number(frete)) ? Number(frete) : 0)
    : data.total;
  const selectedTemplateMetadata = templates.find((template) => template.key === selectedTemplate);
  const visibleTemplates = templates.filter(
    (template) => !template.archived || template.key === selectedTemplate
  );
  const openPreview = useCallback(() => {
    if (draftEditable && isDirty) {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = '/api/quotation-preview?format=html';
      form.target = '_blank';
      form.style.display = 'none';
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'payload';
      input.value = JSON.stringify({
        extracted: {
          nome: clientSnapshot.nome,
          email: clientSnapshot.email,
          telefone: clientSnapshot.telefone,
          cliente_snapshot: clientSnapshot,
          urgente: false,
          items: items.map((item) => ({
            item_code: item.sku || item.item_code,
            item_name: item.item_name,
            qty: Number(item.qty),
            rate: Number(item.applied_unit_price),
            manual_rate: item.manual_rate,
          })),
          prazo_producao: sections.prazo_producao.current.value || undefined,
          entrega: entrega || undefined,
          frete: frete || undefined,
          validade_dias: validadeDias ? Number(validadeDias) : undefined,
          template_key: selectedTemplate,
          template_version_id: selectedVersionId || undefined,
          secoes: sections,
        },
      });
      form.append(input);
      document.body.append(form);
      form.submit();
      form.remove();
      return;
    }
    const params = new URLSearchParams({ id: data.revisionId || data.id });
    if (draftEditable && selectedVersionId) params.set('template_version_id', selectedVersionId);
    window.open(`/api/quotation-preview?${params.toString()}`, '_blank', 'noopener,noreferrer');
  }, [
    clientSnapshot,
    data.id,
    data.revisionId,
    draftEditable,
    entrega,
    frete,
    isDirty,
    items,
    sections,
    selectedTemplate,
    selectedVersionId,
    validadeDias,
  ]);
  const runIssue = useCallback(async () => {
    setConfirmIssueOpen(false);
    setIssuing(true);
    showMessage('');
    setConflict('');
    try {
      const token = concurrencyTokenRef.current;
      if (!token) {
        setConflict('Token de concorrência ausente. Recarregue o orçamento antes de emitir.');
        return;
      }
      const revisionId = data.revisionId || '';
      if (!revisionId) throw new Error('Recarregue o orçamento antes de emitir.');
      // Emission is by reference: the server loads commercial content, items,
      // client and template from the persisted revision. Unsaved editor state
      // is deliberately NOT sent — save first to include it.
      const key = globalThis.crypto.randomUUID();
      const issue = await issuePersistedDraft(revisionId, token, key);
      toast(`Orçamento ${issue.businessNumber} emitido.`, 'success');
      await onReload();
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 409) {
        const safeMessage =
          error instanceof Error && SAFE_CONFLICT_MESSAGES.has(error.message)
            ? error.message
            : 'O orçamento mudou ou não pode mais ser emitido. Recarregue para conferir.';
        setConflict(safeMessage);
        showMessage('');
      } else {
        showMessage('Não foi possível emitir o orçamento. Tente novamente.', 'error');
      }
    } finally {
      setIssuing(false);
    }
  }, [concurrencyTokenRef, data.revisionId, onReload, showMessage, toast]);

  const markCommercialStatus = useCallback(
    async (status: 'aprovado' | 'perdido', lossReason?: string) => {
      if (status === 'perdido' && !lossReason) {
        toast('Informe um motivo para marcar o orçamento como perdido.', 'info');
        return;
      }
      const token = concurrencyTokenRef.current;
      if (!token) {
        setConflict(
          'Token de concorrência ausente. Recarregue o orçamento antes de atualizar o estado.'
        );
        return;
      }
      setLifecycleAction(status);
      showMessage(status === 'aprovado' ? 'Aprovando e criando pedido…' : 'Marcando como perdido…');
      setConflict('');
      try {
        const refreshed = await apiPost<QuotationData>(
          `/quotations?id=${encodeURIComponent(data.id)}`,
          {
            action: 'set_status',
            status,
            ...(lossReason ? { loss_reason: lossReason } : {}),
            concurrency_token: token,
          }
        );
        const projection = projectQuotationDetail(refreshed);
        if (!projection) throw new Error('Resposta inválida ao atualizar o estado do orçamento.');
        concurrencyTokenRef.current = projection.concurrencyToken;
        setData(projection.data);
        const salesOrderId = status === 'aprovado' ? readCreatedSalesOrderId(refreshed) : '';
        setCreatedSalesOrderId(salesOrderId);
        toast(
          status === 'aprovado'
            ? salesOrderId
              ? `Pedido ${salesOrderId} criado.`
              : 'Orçamento aprovado.'
            : 'Orçamento marcado como perdido.',
          'success'
        );
        showMessage('');
      } catch (error) {
        const responseStatus = (error as { status?: number }).status;
        if (responseStatus === 409) {
          const safeMessage =
            error instanceof Error && SAFE_CONFLICT_MESSAGES.has(error.message)
              ? error.message
              : 'O orçamento mudou. Recarregue para conferir o estado atual.';
          setConflict(safeMessage);
          showMessage('');
        } else {
          showMessage(
            'Não foi possível atualizar o estado do orçamento. Tente novamente.',
            'error'
          );
        }
      } finally {
        setLifecycleAction(null);
      }
    },
    [concurrencyTokenRef, data.id, showMessage, toast]
  );

  const createRevision = useCallback(
    async (sourceRevisionId: string) => {
      const token = concurrencyTokenRef.current;
      if (!token) {
        setConflict(
          'Token de concorrência ausente. Recarregue o orçamento antes de criar uma revisão.'
        );
        return;
      }
      setLifecycleAction('create_revision');
      showMessage('');
      setConflict('');
      try {
        const refreshed = await apiPost<QuotationData>(
          `/quotations?id=${encodeURIComponent(data.id)}`,
          {
            action: 'create_revision',
            source_revision_id: sourceRevisionId,
            concurrency_token: token,
          }
        );
        const projection = projectQuotationDetail(refreshed);
        if (!projection) throw new Error('Resposta inválida ao criar revisão.');
        concurrencyTokenRef.current = projection.concurrencyToken;
        setData(projection.data);
        resetEditor(projection.data);
        setEditing(true);
        toast('Nova revisão criada em rascunho.', 'success');
      } catch (error) {
        const responseStatus = (error as { status?: number }).status;
        if (responseStatus === 409) {
          const safeMessage =
            error instanceof Error && SAFE_CONFLICT_MESSAGES.has(error.message)
              ? error.message
              : 'A revisão mudou ou já existe um rascunho. Recarregue para conferir.';
          setConflict(safeMessage);
          showMessage('');
        } else {
          showMessage('Não foi possível criar a revisão. Tente novamente.', 'error');
        }
      } finally {
        setLifecycleAction(null);
      }
    },
    [concurrencyTokenRef, data.id, resetEditor, showMessage, toast]
  );
  const openLossReasonDialog = useCallback(() => {
    setLossReasonChoice('');
    setLossReasonDetail('');
    setLossReasonOpen(true);
  }, []);

  const closeLossReasonDialog = useCallback(() => {
    setLossReasonOpen(false);
  }, []);

  const submitLossReason = useCallback(() => {
    const detail = lossReasonDetail.trim();
    const reason =
      lossReasonChoice === 'Outro'
        ? detail
        : detail
          ? `${lossReasonChoice}: ${detail}`
          : lossReasonChoice;
    if (!reason) return;
    setLossReasonOpen(false);
    void markCommercialStatus('perdido', reason);
  }, [lossReasonChoice, lossReasonDetail, markCommercialStatus]);

  useEffect(() => {
    if (!lossReasonOpen) return undefined;

    lossReasonRestoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lossReasonSelectRef.current?.focus();
    const dialog = lossReasonDialogRef.current;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeLossReasonDialog();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (dialog && !dialog.contains(event.target as Node)) lossReasonSelectRef.current?.focus();
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('focusin', handleFocusIn);
      lossReasonRestoreFocusRef.current?.focus();
      lossReasonRestoreFocusRef.current = null;
    };
  }, [closeLossReasonDialog, lossReasonOpen]);

  const closeTechDetailsDialog = useCallback(() => {
    setTechDetailsOpen(false);
  }, []);

  useEffect(() => {
    if (!techDetailsOpen) return undefined;

    techDetailsCloseRef.current?.focus();
    const dialog = techDetailsDialogRef.current;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeTechDetailsDialog();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (dialog && !dialog.contains(event.target as Node)) techDetailsCloseRef.current?.focus();
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('focusin', handleFocusIn);
      if (moreActionsButtonRef.current && document.contains(moreActionsButtonRef.current)) {
        moreActionsButtonRef.current.focus();
      }
    };
  }, [closeTechDetailsDialog, techDetailsOpen]);

  const openIssuedDocument = useCallback(() => {
    const params = new URLSearchParams({ id: data.revisionId || data.id || '', format: 'pdf' });
    window.open(`/api/quotation-preview?${params.toString()}`, '_blank', 'noopener,noreferrer');
  }, [data.id, data.revisionId]);
  const sendIssuedQuotation = useCallback(async () => {
    if (
      !data.revisionId ||
      !deliveryFlowId ||
      deliveryPending ||
      Boolean(delivery) ||
      Boolean(enqueueError) ||
      Boolean(deliveryError) ||
      Boolean(data.expired)
    )
      return;
    try {
      await enqueue({
        quotationId: data.businessNumber,
        revisionId: data.revisionId,
        flowId: deliveryFlowId,
      });
    } catch {
      console.error('[QuotationDetailPage] failed to enqueue WhatsApp delivery');
    }
  }, [
    data.businessNumber,
    data.expired,
    data.revisionId,
    delivery,
    deliveryError,
    deliveryFlowId,
    deliveryPending,
    enqueue,
    enqueueError,
  ]);
  const sendQuotationEmail = useCallback(
    async (recipient: string) => {
      if (!data.revisionId) return;
      const recipientValue = recipient.trim();
      const sameRecipient =
        emailAttemptId &&
        emailAttemptRecipient &&
        normalizeEmailRecipient(emailAttemptRecipient) === normalizeEmailRecipient(recipientValue);
      const attemptId = sameRecipient ? emailAttemptId : globalThis.crypto.randomUUID();
      setEmailAttemptId(attemptId);
      setEmailAttemptRecipient(recipientValue);
      setEmailSending(true);
      setEmailError('');
      setEmailSuccess('');
      try {
        await apiPost('/send-quotation-email', {
          revision_id: data.revisionId,
          recipient: recipientValue,
          attempt_id: attemptId,
        });
        setConfirmedEmailAcceptedKey(`${data.id}:${data.revisionId}`);
        setEmailSuccess('E-mail aceito para envio.');
        setEmailDialogOpen(false);
        setEmailAttemptId('');
        setEmailAttemptRecipient('');
        await onReload();
      } catch (error) {
        const apiError = error as ApiError;
        const response = apiError.data as { retry_same_attempt?: unknown } | undefined;
        const retrySameAttempt = response?.retry_same_attempt === true;
        if (!retrySameAttempt) {
          setEmailAttemptId('');
          setEmailAttemptRecipient('');
        }
        setEmailError(retrySameAttempt ? EMAIL_AMBIGUOUS_ERROR : EMAIL_SEND_ERROR);
      } finally {
        setEmailSending(false);
      }
    },
    [data.id, data.revisionId, emailAttemptId, emailAttemptRecipient, onReload]
  );
  const cancelEmailDialog = useCallback(() => {
    setEmailError('');
    setEmailDialogOpen(false);
  }, []);

  const emailSent = data.emailSent || confirmedEmailAcceptedKey === `${data.id}:${data.revisionId}`;
  const currentRevision = (data.revisionHistory || []).find(
    (entry) => entry.revision === data.revision
  );
  const displayTitle = quotationDisplayTitle(data.businessNumber);
  const issuedView = !draftEditable && !editing;
  const totalUnits = displayItems.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  const productionDeadline = sections.prazo_producao.current.value || '';
  const hideDuplicateProductionDeadline = quotationContentsMatch(entrega, productionDeadline);
  const whatsappDisabledReason = deliveryPending
    ? 'Envio em andamento.'
    : delivery
      ? delivery.state === 'failed'
        ? 'A entrega falhou e esta revisão não pode ser reenviada.'
        : 'Este orçamento já foi enviado pelo WhatsApp.'
      : enqueueError
        ? 'O envio anterior ficou sem resposta. Aguarde a confirmação antes de reenviar.'
        : deliveryError
          ? deliveryError
          : data.expired
            ? 'Validade expirada — crie uma nova revisão para reenviar.'
            : !deliveryFlowId
              ? 'Selecione um fluxo para enviar pelo WhatsApp.'
              : '';

  const issuedDetail = issuedView ? (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_336px]">
      <div id="quotation-panel" className="min-w-0 space-y-5">
        <section
          aria-labelledby="issued-client-title"
          className="rounded-lg border border-line bg-surface px-5 py-5 md:px-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="issued-client-title" className="text-base font-semibold text-fg">
                Cliente
              </h2>
              <p className="mt-2 text-lg font-semibold text-fg">
                {data.cliente || 'Cliente não informado'}
              </p>
              {(data.email || data.telefone) && (
                <p className="mt-1 break-words text-sm text-fg-muted">
                  {[data.email, fmtPhone(data.telefone) || data.telefone]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
            </div>
            {data.clienteId && (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onClick={() => navigate(`/leads/cliente/${encodeURIComponent(data.clienteId)}`)}
              >
                Ver cliente <ArrowUpRight size={14} aria-hidden="true" />
              </button>
            )}
          </div>
          {data.clienteId && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
              <button
                type="button"
                className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onClick={() => navigate('/crm')}
              >
                Abrir no CRM
              </button>
              <button
                type="button"
                className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onClick={() => navigate('/quotations')}
              >
                Ver orçamentos anteriores
              </button>
            </div>
          )}
        </section>

        <section
          aria-labelledby="issued-items-title"
          className="overflow-hidden rounded-lg border border-line bg-surface"
        >
          <div className="px-5 pb-3 pt-5 md:px-6">
            <h2 id="issued-items-title" className="text-base font-semibold text-fg">
              Itens do orçamento
            </h2>
          </div>
          {displayItems.length > 0 ? (
            <div className="px-5 md:px-6">
              <Table
                className="table-fixed text-sm"
                containerClassName="overflow-hidden border-0 rounded-none"
              >
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-9 w-[12%] px-0">SKU</TableHead>
                    <TableHead className="h-9 w-[36%] px-2">Produto</TableHead>
                    <TableHead className="h-9 whitespace-nowrap text-center">Quantidade</TableHead>
                    <TableHead className="h-9 whitespace-nowrap text-center">
                      Valor unitário
                    </TableHead>
                    <TableHead className="h-9 whitespace-nowrap pr-0 text-right">
                      Subtotal
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayItems.map((item) => (
                    <TableRow key={item._key}>
                      <TableCell className="px-0 py-3 font-mono text-xs text-fg-muted">
                        {item.sku || '—'}
                      </TableCell>
                      <TableCell className="px-2 py-3">
                        <span className="block break-words font-medium text-fg">
                          {item.nome || item.item_name || item.sku || 'Produto não informado'}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-3 text-center tabular-nums">
                        {Number(item.qty)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-3 text-center tabular-nums">
                        {formatBRL(item.applied_unit_price)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-3 pr-0 text-right font-medium tabular-nums">
                        {formatBRL(
                          item.line_total || Number(item.qty) * Number(item.applied_unit_price)
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="px-5 pb-5 md:px-6">
              <EmptyState
                icon={FileText}
                title="Nenhum item neste orçamento"
                description="Não há itens registrados nesta revisão."
              />
            </div>
          )}
          <div className="mx-5 flex flex-wrap items-end justify-between gap-5 border-t border-line py-5 md:mx-6">
            <dl className="text-sm tabular-nums">
              <dt className="text-xs text-fg-muted">Frete</dt>
              <dd className="mt-0.5">{formatBRL(data.frete)}</dd>
            </dl>
            <dl className="text-right tabular-nums">
              <dt className="text-sm text-fg-muted">Total do orçamento</dt>
              <dd className="mt-1 text-xl font-semibold tracking-tight text-fg">
                {formatBRL(data.total)}
              </dd>
            </dl>
          </div>
        </section>

        <section
          aria-labelledby="issued-conditions-title"
          className="rounded-lg border border-line bg-surface px-5 py-5 md:px-6 [&>section:first-of-type]:border-t-0"
        >
          <h2 id="issued-conditions-title" className="text-base font-semibold text-fg">
            Condições comerciais
          </h2>
          <QuotationSectionsDocument sections={sections} editable={false} onChange={setSections} />
          {entrega && (
            <section className="border-t border-line py-5" aria-labelledby="issued-delivery-title">
              <h3 id="issued-delivery-title" className="text-sm font-semibold text-fg">
                Previsão de entrega
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-fg-muted">{entrega}</p>
            </section>
          )}
          <div className="divide-y divide-line border-t border-line">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-medium text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
                <span>Detalhes do documento</span>
                <span className="flex items-center gap-3 text-xs font-normal text-fg-muted">
                  Datas e modelo
                  <ChevronDown
                    size={16}
                    className="transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  />
                </span>
              </summary>
              <dl className="grid gap-4 pb-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-xs text-fg-muted">Data do orçamento</dt>
                  <dd className="mt-1 tabular-nums">{formatDate(data.data) || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-muted">Validade</dt>
                  <dd className="mt-1">
                    {data.validadeDias ?? '—'} dias
                    {formatDate(data.validade) && (
                      <span className="block text-xs text-fg-muted">
                        Até {formatDate(data.validade)}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-muted">Modelo</dt>
                  <dd className="mt-1 break-words">
                    {selectedTemplateMetadata?.name || selectedTemplate || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-muted">Frete</dt>
                  <dd className="mt-1 tabular-nums">{formatBRL(data.frete)}</dd>
                </div>
              </dl>
            </details>

            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-medium text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
                <span>Histórico e revisões</span>
                <span className="flex items-center gap-3 text-xs font-normal text-fg-muted">
                  R{data.revision}
                  <ChevronDown
                    size={16}
                    className="transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  />
                </span>
              </summary>
              <div className="overflow-x-auto pb-4">
                {(data.revisionHistory || []).length > 0 ? (
                  <Table className="min-w-[680px] text-sm">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="h-9 pl-0">Revisão</TableHead>
                        <TableHead className="h-9">Criada em</TableHead>
                        <TableHead className="h-9">Validade</TableHead>
                        <TableHead className="h-9">Estado</TableHead>
                        <TableHead className="h-9 text-right">Total</TableHead>
                        <TableHead className="h-9">PDF</TableHead>
                        <TableHead className="h-9 pr-0" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(data.revisionHistory || []).map((entry) => {
                        const eligible = entry.status !== 'rascunho' && !draftEditable;
                        return (
                          <TableRow key={entry.revisionId}>
                            <TableCell className="whitespace-nowrap py-2 pl-0 font-medium">
                              R{entry.revision}
                            </TableCell>
                            <TableCell className="whitespace-nowrap py-2">
                              {formatDate(entry.createdAt) || '—'}
                            </TableCell>
                            <TableCell className="whitespace-nowrap py-2">
                              {formatDate(entry.validade) || '—'}
                              {entry.expired && (
                                <span className="block text-xs text-warning">Expirada</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <StatusBadge {...statusBadgeProps(entry.status)} />
                            </TableCell>
                            <TableCell className="whitespace-nowrap py-2 text-right tabular-nums">
                              {formatBRL(entry.total)}
                            </TableCell>
                            <TableCell>
                              {entry.status !== 'rascunho' ? (
                                <button
                                  type="button"
                                  className="text-xs font-medium text-primary hover:underline"
                                  onClick={() => {
                                    window.open(
                                      `/api/quotation-preview?id=${encodeURIComponent(entry.revisionId)}&format=pdf`,
                                      '_blank',
                                      'noopener,noreferrer'
                                    );
                                  }}
                                >
                                  Visualizar
                                </button>
                              ) : (
                                <span className="text-xs text-fg-muted">—</span>
                              )}
                            </TableCell>
                            <TableCell className="py-2 pr-0 text-right">
                              {eligible && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={lifecycleAction !== null}
                                  onClick={() => createRevision(entry.revisionId)}
                                >
                                  Nova revisão
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-fg-muted">Nenhuma revisão anterior.</p>
                )}
              </div>
            </details>
          </div>
        </section>
      </div>

      <aside
        className="min-w-0 self-start rounded-lg border border-line bg-surface px-5 py-5 xl:sticky xl:top-4"
        aria-labelledby="commercial-followup-title"
      >
        <h2 id="commercial-followup-title" className="text-base font-semibold text-fg">
          Acompanhamento comercial
        </h2>
        <div className="mt-5 space-y-3">
          <label className="block text-xs font-medium text-fg-muted">
            <span className="mb-1.5 block">Fluxo WhatsApp</span>
            <Select
              className="w-full"
              containerClassName="w-full"
              value={deliveryFlowId}
              onChange={(event) => setDeliveryFlowId(event.target.value)}
              disabled={deliveryPending || Boolean(enqueueError)}
            >
              {deliveryFlows.length === 0 && <option value="">Nenhum fluxo disponível</option>}
              {deliveryFlows.map((flow) => (
                <option key={flow.id} value={flow.id}>
                  {flow.name}
                </option>
              ))}
            </Select>
          </label>
          <p className="text-sm leading-5 text-fg-muted">
            Envie o orçamento para iniciar a conversa com a cliente.
          </p>
          <Button
            className="w-full"
            aria-label="Enviar WhatsApp"
            title={whatsappDisabledReason || undefined}
            disabled={Boolean(whatsappDisabledReason)}
            onClick={sendIssuedQuotation}
          >
            <Phone size={14} /> Enviar pelo WhatsApp
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setEmailError('');
              setEmailDialogOpen(true);
            }}
          >
            <Mail size={14} /> {emailSent ? 'Reenviar por e-mail' : 'Enviar por e-mail'}
          </Button>
        </div>
        {whatsappDisabledReason && (
          <p role="status" className="mt-2 text-xs text-fg-muted">
            {whatsappDisabledReason}
          </p>
        )}
        {(delivery && deliveryError) || enqueueError ? (
          <p role="status" className="mt-2 text-xs text-warning">
            {deliveryError || enqueueError}
          </p>
        ) : null}
        {deliveryFlows.length === 0 && !deliveryError && (
          <p role="status" className="mt-2 text-xs text-fg-muted">
            Não foi possível carregar os fluxos. Tente novamente mais tarde.
          </p>
        )}
        <QuotationDeliveryStatus
          delivery={delivery}
          pending={deliveryPending}
          onResolve={handleResolveDelivery}
          className="mt-5 border-t border-line pt-4"
        />
        <div className="mt-5 border-t border-line pt-5">
          <h3 className="text-sm font-semibold text-fg">Resultado da negociação</h3>
          {data.status === 'emitido' ? (
            <div className="mt-3 space-y-2">
              <Button
                variant="outline"
                className="w-full"
                disabled={lifecycleAction !== null}
                onClick={() => void markCommercialStatus('aprovado')}
              >
                {lifecycleAction === 'aprovado' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={14} />
                )}
                Aprovar e criar pedido
              </Button>
              <Button
                variant="ghost"
                className="w-full text-fg-muted"
                disabled={lifecycleAction !== null}
                onClick={openLossReasonDialog}
              >
                Marcar como perdido
              </Button>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusBadge {...statusBadgeProps(data.status)} />
              {createdSalesOrderId ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    navigate(`/sales-orders/${encodeURIComponent(createdSalesOrderId)}`)
                  }
                >
                  <ShoppingCart size={14} /> Ver pedido {createdSalesOrderId}
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </aside>
    </div>
  ) : null;

  return (
    <div ref={detailTopRef} className="space-y-0">
      <fieldset disabled={saving} className="contents">
        <header className="flex flex-col gap-4 pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {draftEditable && !editing && (
              <p className="mb-1 text-sm font-medium text-fg-muted">Revisar antes de emitir</p>
            )}
            <h1 className="text-2xl font-semibold leading-8 tracking-[-0.2px] text-fg">
              {data.businessNumber || displayTitle}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
              <span className="font-medium text-fg">{data.cliente || 'Cliente não informado'}</span>
              <span aria-hidden="true">·</span>
              <span>Revisão {data.revision}</span>
              {issuedView ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Válido até {formatDate(data.validade) || '—'}</span>
                </>
              ) : currentRevision?.createdAt ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{formatDate(currentRevision.createdAt) || '—'}</span>
                </>
              ) : null}
            </div>
            {!issuedView && (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                <StatusBadge {...statusBadgeProps(data.status)} />
                <span>Validade: {formatDate(data.validade) || '—'}</span>
                {data.expired && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-warning">Expirado</span>
                  </>
                )}
              </div>
            )}
            {data.quotationOrigin && data.quotationOrigin.status !== 'missing' && (
              <div
                className="mt-2 flex flex-wrap items-center gap-2 text-sm"
                aria-label="Origem do orçamento"
              >
                <span
                  className={
                    data.quotationOrigin.status === 'conflict'
                      ? 'text-destructive'
                      : 'text-fg-muted'
                  }
                >
                  Origem: {data.quotationOrigin.sourceLabel}
                </span>
                {data.quotationOrigin.salesOrderNumber && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      navigate(
                        `/sales-orders/${encodeURIComponent(data.quotationOrigin!.salesOrderNumber!)}`
                      )
                    }
                  >
                    <ShoppingCart size={14} /> Abrir pedido
                  </Button>
                )}
              </div>
            )}
            {editing && (
              <p
                role="status"
                aria-live="polite"
                className={
                  isDirty ? 'mt-2 text-xs font-medium text-warning' : 'mt-2 text-xs text-fg-muted'
                }
              >
                {saving
                  ? 'Salvando…'
                  : isDirty
                    ? 'Alterações não salvas'
                    : 'Nenhuma alteração pendente'}
              </p>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            {editing ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onClick={() => (isDirty ? setConfirmDiscardEdits(true) : resetEditor())}
                >
                  Cancelar
                </Button>
                <Button variant="outline" size="sm" disabled={saving} onClick={openPreview}>
                  Pré-visualizar
                </Button>
                <Button size="sm" disabled={saving} onClick={save}>
                  <Save size={14} /> {saving ? 'Salvando…' : 'Salvar alterações'}
                </Button>
              </>
            ) : (
              <>
                {draftEditable ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        showMessage('');
                        setEditing(true);
                      }}
                    >
                      <Pencil size={14} /> Editar
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" size="lg" onClick={openIssuedDocument}>
                    <FileText size={14} /> Visualizar PDF
                  </Button>
                )}

                <div className="relative">
                  <button
                    ref={moreActionsButtonRef}
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    aria-label="Mais ações"
                    className={`flex items-center justify-center rounded-sm border border-line text-fg-muted hover:bg-surface-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${issuedView ? 'h-10 gap-2 px-4 text-sm font-medium' : 'h-8 w-8'}`}
                    onClick={() => setMenuOpen((current) => !current)}
                  >
                    <MoreHorizontal size={18} />
                    {issuedView && <span>Mais ações</span>}
                  </button>
                  {menuOpen && (
                    <div
                      role="menu"
                      aria-label="Ações do orçamento"
                      className="absolute right-0 top-9 z-40 w-52 rounded-md border border-line bg-surface py-1 shadow-lg"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-subtle"
                        onClick={() => {
                          setMenuOpen(false);
                          setTechDetailsOpen(true);
                        }}
                      >
                        Detalhes técnicos
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="block w-full px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
                        onClick={() => {
                          setMenuOpen(false);
                          setConfirmDeleteOpen(true);
                        }}
                      >
                        <Trash2 size={14} className="mr-2 inline" /> Excluir orçamento
                      </button>
                    </div>
                  )}
                  {menuOpen && (
                    <div
                      aria-hidden="true"
                      className="fixed inset-0 z-30"
                      onClick={() => setMenuOpen(false)}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        </header>

        {(message || emailSuccess) && (
          <p
            role="status"
            aria-live="polite"
            className={`mb-4 text-sm ${messageTone === 'error' ? 'text-destructive' : 'text-fg-muted'}`}
          >
            {message || emailSuccess}
          </p>
        )}
        {issuedView && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-5">
            <div className="flex min-w-0 items-center gap-2 text-sm text-fg-muted">
              <LockKeyhole size={16} aria-hidden="true" />
              <span className="font-semibold text-fg">Emitido</span>
              <span>Somente leitura. Alterações criam uma nova revisão.</span>
            </div>
            {data.revisionId && (
              <button
                type="button"
                className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                disabled={lifecycleAction !== null}
                onClick={() => createRevision(data.revisionId!)}
              >
                {lifecycleAction === 'create_revision' ? 'Criando revisão…' : 'Criar revisão'}
              </button>
            )}
          </div>
        )}

        {conflict && (
          <div
            role="alert"
            className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <span className="min-w-0 break-words">{conflict}</span>
            <Button variant="outline" size="sm" onClick={reloadAfterConflict}>
              Recarregar
            </Button>
          </div>
        )}

        {issuedDetail}

        {!issuedView && (
          <div
            className={
              editing
                ? 'min-w-0 space-y-5'
                : 'grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]'
            }
          >
            <div className="min-w-0 rounded-lg border border-line bg-surface p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:p-5">
              {draftEditable && !editing && (
                <h2 className="mb-3 text-base font-semibold text-fg">Conferência</h2>
              )}
              <>
                {/* Cliente */}
                <section aria-labelledby="cliente-title" className="border-t border-line py-5">
                  <h2 id="cliente-title" className="text-sm font-semibold text-fg">
                    Cliente
                  </h2>
                  <div className="mt-2">
                    {editing ? (
                      <div className="relative max-w-md">
                        <span className="text-xs font-medium text-fg-muted">Cliente</span>
                        <div className="relative mt-1">
                          <Search size={14} className="absolute left-2 top-2 text-fg-muted" />
                          <Input
                            aria-label="Cliente do orçamento"
                            value={clientSearch}
                            onChange={onClientSearch}
                            className="pl-7"
                            placeholder="Buscar cliente…"
                          />
                          {clientSearching && (
                            <Loader2
                              size={14}
                              className="absolute right-2 top-2 animate-spin text-fg-muted"
                            />
                          )}
                        </div>
                        {clientResults.length > 0 && (
                          <div className="absolute left-0 right-0 z-40 mt-1 max-h-40 overflow-y-auto rounded-md border border-line bg-surface shadow-lg">
                            {clientResults.map((client) => (
                              <button
                                key={client.id}
                                type="button"
                                className="w-full px-3 py-2 text-left text-sm hover:bg-primary/10"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  setClientId(client.id);
                                  setClientSearch(client.nome);
                                  setClientEmail(client.email || '');
                                  setClientTelefone(client.telefone || '');
                                  setClientResults([]);
                                }}
                              >
                                <span className="font-medium">{client.nome}</span>
                                <span className="block text-xs text-fg-muted">
                                  {client.email || client.telefone || client.id}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <p className="text-base font-semibold">
                          {data.cliente || 'Cliente não informado'}
                        </p>
                        {(data.email || data.telefone) && (
                          <p className="mt-1 break-words text-sm text-fg-muted">
                            {[data.email, fmtPhone(data.telefone) || data.telefone]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        )}
                        {data.clienteId && (
                          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                            <button
                              type="button"
                              className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              onClick={() =>
                                navigate(`/leads/cliente/${encodeURIComponent(data.clienteId)}`)
                              }
                            >
                              Ver cliente
                            </button>
                            <button
                              type="button"
                              className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              onClick={() => navigate('/crm')}
                            >
                              Abrir no CRM
                            </button>
                            <button
                              type="button"
                              className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              onClick={() => navigate('/quotations')}
                            >
                              Ver orçamentos anteriores
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </section>

                {/* Dados do orçamento */}
                <section aria-labelledby="dados-title" className="border-t border-line py-5">
                  <h2 id="dados-title" className="text-sm font-semibold text-fg">
                    Dados do orçamento
                  </h2>
                  <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-fg-muted">Data do orçamento</span>
                      <p className="mt-1 whitespace-nowrap tabular-nums">
                        {formatDate(data.data) || '—'}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-fg-muted">Validade da revisão</span>
                      {editing ? (
                        <>
                          <Input
                            aria-label="Validade do orçamento em dias"
                            type="number"
                            min="1"
                            max="365"
                            value={validadeDias}
                            onChange={(event) => setValidadeDias(event.target.value)}
                            className="mt-1 w-28"
                          />
                          <p className="mt-1 text-xs text-fg-tertiary">
                            {Number(validadeDias) !== Number(data.validadeDias)
                              ? 'A data final será recalculada ao salvar.'
                              : formatDate(data.validade)
                                ? `Válida até ${formatDate(data.validade)}`
                                : undefined}
                          </p>
                        </>
                      ) : (
                        <p className="mt-1 break-words">
                          {data.validadeDias ?? '—'} dias configurados
                          {formatDate(data.validade) && (
                            <span className="block text-xs text-fg-tertiary">
                              Válida até {formatDate(data.validade)}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-fg-muted">Modelo</span>
                      {editing && draftEditable && templates.length > 0 ? (
                        <select
                          aria-label="Modelo do orçamento"
                          className="mt-1 h-9 w-full rounded-sm border border-line bg-surface px-2 text-sm"
                          value={selectedTemplate}
                          onChange={(event) => {
                            const key = event.target.value;
                            const template = templates.find((item) => item.key === key);
                            setSelectedTemplate(key);
                            setSelectedVersionId(template?.current_version_id || '');
                          }}
                        >
                          {visibleTemplates.map((template) => (
                            <option key={template.key} value={template.key}>
                              {template.name}
                              {template.archived ? ' (arquivado)' : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className="mt-1 break-words">
                          {selectedTemplateMetadata?.name || selectedTemplate || '—'}
                        </p>
                      )}
                      {templateError && (
                        <p className="mt-1 text-xs text-destructive">{templateError}</p>
                      )}
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-fg-muted">Frete</span>
                      {editing ? (
                        <Input
                          aria-label="Frete do orçamento"
                          type="number"
                          min="0"
                          step="0.01"
                          value={frete}
                          onChange={(event) => setFrete(event.target.value)}
                          className="mt-1 w-32"
                        />
                      ) : (
                        <p className="mt-1 whitespace-nowrap tabular-nums">
                          {formatBRL(data.frete)}
                        </p>
                      )}
                    </div>
                    {(editing || entrega) && (
                      <div className="min-w-0 sm:col-span-2 lg:col-span-4">
                        <span className="text-xs font-medium text-fg-muted">
                          Previsão de entrega
                        </span>
                        {editing ? (
                          <Input
                            aria-label="Entrega do orçamento"
                            value={entrega}
                            onChange={(event) => setEntrega(event.target.value)}
                            className="mt-1"
                          />
                        ) : (
                          <p className="mt-1 max-w-[68ch] break-words whitespace-pre-wrap">
                            {entrega}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  {data.expired && (
                    <p className="mt-3 text-xs text-warning">
                      Validade expirada — crie uma nova revisão para reenviar.
                    </p>
                  )}
                </section>
              </>

              {/* Itens */}
              <>
                <section
                  aria-labelledby="quotation-items-title"
                  className="border-t border-line py-5"
                >
                  <div className="mb-3 flex flex-wrap items-baseline gap-2">
                    <h2 id="quotation-items-title" className="text-sm font-semibold text-fg">
                      Itens
                    </h2>
                    <span className="text-xs text-fg-muted">
                      {quotationItemCountLabel(displayItems.length)}
                    </span>
                  </div>
                  {displayItems.length > 0 ? (
                    <Table
                      className="min-w-[620px] text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:h-8 [&_th]:px-3"
                      containerClassName="border-0 rounded-none"
                    >
                      <TableHeader>
                        <TableRow>
                          <TableHead className="h-8 w-full min-w-[280px]">Produto</TableHead>
                          {editing && <TableHead className="h-9 whitespace-nowrap">SKU</TableHead>}
                          <TableHead className="h-9 whitespace-nowrap text-center">Qtd</TableHead>
                          {editing && (
                            <TableHead className="h-9 whitespace-nowrap text-right">
                              Sugerido
                            </TableHead>
                          )}
                          <TableHead className="h-9 whitespace-nowrap text-right">
                            Preço un.
                          </TableHead>
                          {editing && (
                            <TableHead className="h-9 whitespace-nowrap text-right">
                              Diferença
                            </TableHead>
                          )}
                          <TableHead className="h-9 whitespace-nowrap text-right">Total</TableHead>
                          {editing && <TableHead />}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {displayItems.map((item) => {
                          const results = productResults[item._key] || [];
                          return (
                            <TableRow key={item._key}>
                              <TableCell className="max-w-[480px] break-words leading-5">
                                {editing ? (
                                  <label className="block space-y-1">
                                    <Input
                                      aria-label={`Nome exibido no orçamento ${item.sku}`}
                                      className="h-8 text-sm"
                                      value={item.item_name}
                                      onChange={(event) =>
                                        updateItem(item._key, {
                                          item_name: event.target.value,
                                          nome: event.target.value,
                                        })
                                      }
                                    />
                                  </label>
                                ) : (
                                  <>
                                    {item.nome ||
                                      item.item_name ||
                                      item.sku ||
                                      'Produto não informado'}
                                    {item.sku && (
                                      <span className="block font-mono text-xs text-fg-tertiary">
                                        {item.sku}
                                      </span>
                                    )}
                                  </>
                                )}
                              </TableCell>
                              {editing && (
                                <TableCell className="relative whitespace-nowrap py-2 font-mono">
                                  <Input
                                    value={productTerms[item._key] ?? item.sku}
                                    onChange={(event) =>
                                      onProductTerm(item._key, event.target.value)
                                    }
                                    className="h-8 w-32"
                                    aria-label={`SKU do item ${item.item_name}`}
                                  />
                                  {results.length > 0 && (
                                    <div className="absolute left-0 top-9 z-40 w-64 rounded-md border border-line bg-surface shadow-lg">
                                      {results.map((product) => (
                                        <button
                                          type="button"
                                          key={product.sku}
                                          className="block w-full px-2 py-1.5 text-left hover:bg-primary/10"
                                          onMouseDown={(event) => {
                                            event.preventDefault();
                                            selectProduct(item._key, product);
                                          }}
                                        >
                                          <span className="font-mono text-xs">{product.sku}</span>{' '}
                                          {product.nome}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </TableCell>
                              )}
                              <TableCell className="whitespace-nowrap py-2 text-center">
                                {editing ? (
                                  <Input
                                    aria-label={`Quantidade de ${item.sku}`}
                                    className="mx-auto h-8 w-20"
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={Number(item.qty)}
                                    onChange={(event) =>
                                      updateItem(item._key, {
                                        qty: event.target.value,
                                        line_total: '',
                                      })
                                    }
                                    onBlur={() => {
                                      void repriceItem(item._key);
                                    }}
                                  />
                                ) : (
                                  Number(item.qty)
                                )}
                              </TableCell>
                              {editing && (
                                <TableCell className="whitespace-nowrap py-2 text-right">
                                  {formatBRL(item.suggested_unit_price)}
                                </TableCell>
                              )}
                              <TableCell className="whitespace-nowrap py-2 text-right">
                                {editing ? (
                                  <Input
                                    aria-label={`Preço aplicado ${item.sku}`}
                                    className="ml-auto h-8 w-28"
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    value={item.applied_unit_price}
                                    onChange={(event) =>
                                      updateItem(item._key, {
                                        applied_unit_price: event.target.value,
                                        manual_rate: true,
                                      })
                                    }
                                  />
                                ) : (
                                  formatBRL(item.applied_unit_price)
                                )}
                              </TableCell>
                              {editing && (
                                <TableCell
                                  className={`whitespace-nowrap py-2 text-right ${
                                    Number(item.price_difference) > 0 ? 'text-destructive' : ''
                                  }`}
                                >
                                  {formatBRL(item.price_difference)}
                                </TableCell>
                              )}
                              <TableCell className="whitespace-nowrap text-right tabular-nums">
                                {formatBRL(
                                  editing
                                    ? Number(item.qty) * Number(item.applied_unit_price)
                                    : item.line_total ||
                                        Number(item.qty) * Number(item.applied_unit_price)
                                )}
                              </TableCell>
                              {editing && (
                                <TableCell>
                                  <button
                                    type="button"
                                    className="text-fg-muted hover:text-destructive"
                                    onClick={() => removeItem(item._key)}
                                    aria-label={`Remover item ${item.item_name || item.sku}`}
                                  >
                                    <X size={15} />
                                  </button>
                                </TableCell>
                              )}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  ) : (
                    <div>
                      <EmptyState
                        icon={FileText}
                        title="Nenhum item neste orçamento"
                        description={
                          editing
                            ? 'Adicione um item para compor a proposta.'
                            : 'Não há itens registrados nesta revisão.'
                        }
                      />
                    </div>
                  )}
                  {editing && (
                    <Button variant="outline" size="sm" className="mt-3" onClick={addItem}>
                      <Plus size={14} /> Item
                    </Button>
                  )}
                  {!draftEditable && (
                    <div className="mt-4 flex justify-end">
                      <dl className="w-full max-w-[300px] text-sm tabular-nums">
                        <div className="flex items-center justify-between gap-6 py-0.5">
                          <dt className="text-fg-muted">Subtotal</dt>
                          <dd>{formatBRL(displayedSubtotal)}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-6 py-0.5">
                          <dt className="text-fg-muted">Frete</dt>
                          <dd>{formatBRL(editing ? frete : data.frete)}</dd>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-6 border-t border-line pt-2.5 text-base font-semibold">
                          <dt>Total</dt>
                          <dd>{formatBRL(displayedTotal)}</dd>
                        </div>
                      </dl>
                    </div>
                  )}
                </section>
              </>

              {/* Seções textuais em documento */}
              <QuotationSectionsDocument
                sections={sections}
                editable={editing && draftEditable}
                hideProductionDeadline={!editing && hideDuplicateProductionDeadline}
                onChange={setSections}
              />

              {/* Revisões */}
              {(data.revisionHistory || []).length > 0 && (
                <section className="border-t border-line py-5" aria-label="Revisões">
                  <h2 className="text-sm font-semibold text-fg">Revisões</h2>
                  <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                    <span>
                      Revisão atual: <b className="font-semibold">R{data.revision}</b>
                    </span>
                    {(data.revisionHistory || []).find((entry) => entry.revision === data.revision)
                      ?.createdAt && (
                      <span className="text-fg-muted">
                        Criada em{' '}
                        {formatDate(
                          (data.revisionHistory || []).find(
                            (entry) => entry.revision === data.revision
                          )?.createdAt
                        ) || '—'}
                      </span>
                    )}
                  </div>
                  <details className="mt-3">
                    <summary className="mb-3 cursor-pointer text-sm font-medium text-primary hover:underline">
                      Ver histórico completo
                    </summary>
                    <Table className="min-w-[720px] text-sm">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="h-9">Revisão</TableHead>
                          <TableHead className="h-9">Criada em</TableHead>
                          <TableHead className="h-9">Validade</TableHead>
                          <TableHead className="h-9">Estado</TableHead>
                          <TableHead className="h-9 text-right">Total</TableHead>
                          <TableHead className="h-9">PDF</TableHead>
                          <TableHead className="h-9" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(data.revisionHistory || []).map((entry) => {
                          const expired = entry.expired;
                          const eligible = entry.status !== 'rascunho' && !draftEditable;
                          return (
                            <TableRow key={entry.revisionId}>
                              <TableCell className="whitespace-nowrap py-2 font-medium">
                                R{entry.revision}
                              </TableCell>
                              <TableCell className="whitespace-nowrap py-2">
                                {formatDate(entry.createdAt) || '—'}
                              </TableCell>
                              <TableCell className="whitespace-nowrap py-2">
                                {formatDate(entry.validade) || '—'}
                                {expired && (
                                  <span className="block text-xs text-warning">Expirada</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <StatusBadge {...statusBadgeProps(entry.status)} />
                              </TableCell>
                              <TableCell className="whitespace-nowrap py-2 text-right tabular-nums">
                                {formatBRL(entry.total)}
                              </TableCell>
                              <TableCell>
                                {entry.status !== 'rascunho' ? (
                                  <button
                                    type="button"
                                    className="text-xs text-primary hover:underline"
                                    onClick={() => {
                                      window.open(
                                        `/api/quotation-preview?id=${encodeURIComponent(entry.revisionId)}&format=pdf`,
                                        '_blank',
                                        'noopener,noreferrer'
                                      );
                                    }}
                                  >
                                    Visualizar
                                  </button>
                                ) : (
                                  <span className="text-xs text-fg-muted">—</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                {eligible && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={lifecycleAction !== null}
                                    onClick={() => createRevision(entry.revisionId)}
                                  >
                                    Nova revisão
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </details>
                </section>
              )}
            </div>

            {draftEditable && (
              <aside
                className="min-w-0 rounded-lg border border-line bg-surface p-4 md:p-5"
                aria-labelledby="quotation-summary-title"
              >
                <h2 id="quotation-summary-title" className="text-base font-semibold text-fg">
                  Resumo
                </h2>
                <dl className="mt-4 space-y-3 text-sm tabular-nums">
                  <div className="flex justify-between gap-4">
                    <dt className="text-fg-muted">Subtotal</dt>
                    <dd>{formatBRL(displayedSubtotal)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-fg-muted">Frete</dt>
                    <dd>{formatBRL(editing ? frete : data.frete)}</dd>
                  </div>
                  <div className="flex justify-between gap-4 border-t border-line pt-3 text-lg font-semibold">
                    <dt>Total</dt>
                    <dd>{formatBRL(displayedTotal)}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs text-fg-muted">
                  {quotationItemCountLabel(displayItems.length)} · {totalUnits} unidades
                </p>
                {!editing && (
                  <div className="mt-5 space-y-2">
                    <Button
                      className="w-full"
                      disabled={issuing || lifecycleAction !== null}
                      onClick={() => setConfirmIssueOpen(true)}
                    >
                      {issuing ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <FileText size={14} />
                      )}
                      {issuing ? 'Emitindo…' : 'Emitir orçamento'}
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        showMessage('');
                        setEditing(true);
                      }}
                    >
                      Continuar editando
                    </Button>
                  </div>
                )}
              </aside>
            )}
          </div>
        )}
      </fieldset>

      <QuotationEmailDialog
        open={emailDialogOpen}
        initialEmail={emailAttemptRecipient || data.email || ''}
        sending={emailSending}
        error={emailError}
        onCancel={cancelEmailDialog}
        onSubmit={sendQuotationEmail}
      />
      <ConfirmDialog
        open={pendingRoute !== null}
        title="Sair sem salvar?"
        message="As edições deste orçamento que ainda não foram salvas serão perdidas."
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
      <ConfirmDialog
        open={confirmDiscardEdits}
        title="Descartar alterações?"
        message="As edições deste orçamento (itens, condições e seções) que ainda não foram salvas serão perdidas."
        confirmLabel="Descartar"
        cancelLabel="Continuar editando"
        variant="destructive"
        onConfirm={() => {
          setConfirmDiscardEdits(false);
          resetEditor();
        }}
        onCancel={() => setConfirmDiscardEdits(false)}
      />
      <ConfirmDialog
        open={confirmIssueOpen}
        title={`Emitir ${data.businessNumber || 'orçamento'}?`}
        message={`A revisão R${data.revision} será registrada e o PDF será gerado. Alterações futuras criarão uma nova revisão.`}
        confirmLabel="Emitir"
        cancelLabel="Cancelar"
        variant="default"
        onConfirm={runIssue}
        onCancel={() => setConfirmIssueOpen(false)}
      />
      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Excluir orçamento?"
        message={`Excluir ${data.businessNumber || 'este orçamento'} e todas as suas revisões permanentemente? Mensagens e arquivos já recebidos pelo cliente não serão apagados.`}
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
      {techDetailsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={closeTechDetailsDialog}
            aria-hidden="true"
          />
          <div
            ref={techDetailsDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="tech-details-title"
            tabIndex={-1}
            className="relative w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-2xl"
          >
            <h3 id="tech-details-title" className="text-lg font-semibold text-fg">
              Detalhes técnicos
            </h3>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-xs text-fg-muted">Modelo</dt>
                <dd className="mt-0.5 break-words">
                  {selectedTemplateMetadata?.name || selectedTemplate || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">Versão do modelo</dt>
                <dd className="mt-0.5 break-words">
                  {selectedTemplateMetadata?.current_version ?? data.templateVersion ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">Snapshot</dt>
                <dd className="mt-0.5 break-all font-mono text-xs">
                  {data.templateHash ||
                    selectedTemplateMetadata?.hash ||
                    selectedTemplateMetadata?.current_hash ||
                    '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">Revisão</dt>
                <dd className="mt-0.5 break-all font-mono text-xs">{data.revisionId || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">ID interno</dt>
                <dd className="mt-0.5 break-all font-mono text-xs">{data.id}</dd>
              </div>
            </dl>
            <div className="mt-5 flex justify-end">
              <Button ref={techDetailsCloseRef} variant="outline" onClick={closeTechDetailsDialog}>
                Fechar
              </Button>
            </div>
          </div>
        </div>
      )}
      {lossReasonOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={closeLossReasonDialog}
            aria-hidden="true"
          />
          <div
            ref={lossReasonDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="loss-reason-title"
            aria-describedby="loss-reason-description"
            tabIndex={-1}
            className="relative w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-2xl"
          >
            <h3 id="loss-reason-title" className="text-lg font-semibold text-fg">
              Motivo da perda
            </h3>
            <p id="loss-reason-description" className="mt-2 text-sm text-fg-muted">
              Informe por que o orçamento {data.businessNumber || ''} foi perdido. O motivo fica
              registrado no histórico.
            </p>
            <label className="mt-4 block text-sm">
              <span className="text-xs text-fg-muted">Motivo</span>
              <Select
                ref={lossReasonSelectRef}
                value={lossReasonChoice}
                onChange={(event) => setLossReasonChoice(event.target.value)}
                className="mt-1 w-full"
                aria-label="Motivo da perda"
                required
              >
                <option value="">Selecione…</option>
                {LOSS_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </Select>
            </label>
            <label className="mt-3 block text-sm">
              <span className="text-xs text-fg-muted">
                Detalhes {lossReasonChoice === 'Outro' ? '(obrigatório)' : '(opcional)'}
              </span>
              <textarea
                value={lossReasonDetail}
                onChange={(event) => setLossReasonDetail(event.target.value)}
                rows={3}
                placeholder="Contexto adicional sobre a perda…"
                className="mt-1 w-full rounded-sm border border-line bg-surface px-3 py-2 text-sm"
                required={lossReasonChoice === 'Outro'}
                aria-required={lossReasonChoice === 'Outro' ? 'true' : undefined}
              />
            </label>
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="outline" onClick={closeLossReasonDialog}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                disabled={
                  !lossReasonChoice || (lossReasonChoice === 'Outro' && !lossReasonDetail.trim())
                }
                onClick={submitLossReason}
              >
                Marcar como perdido
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default function QuotationDetailPage({ id, navigate }: QuotationDetailPageProps) {
  const [data, setData] = useState<QuotationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadWarning, setReloadWarning] = useState(false);
  const concurrencyTokenRef = useRef('');
  const dataRef = useRef<QuotationData | null>(null);
  const loadedRouteIdRef = useRef<string | null>(null);
  useBreadcrumbLabel(data?.businessNumber || null);

  useEffect(() => {
    dataRef.current = null;
    loadedRouteIdRef.current = null;
  }, [id]);

  const loadDetail = useCallback(async () => {
    const hasExistingDetail = dataRef.current !== null && loadedRouteIdRef.current === id;
    setLoading(true);
    setError(null);
    setReloadWarning(false);
    if (!hasExistingDetail) concurrencyTokenRef.current = '';
    try {
      const result = await apiGet<unknown>(`/quotations?id=${encodeURIComponent(id)}`);
      const projection = projectQuotationDetail(result);
      if (!projection) throw new Error('Resposta inválida ao carregar orçamento.');
      concurrencyTokenRef.current = projection.concurrencyToken;
      dataRef.current = projection.data;
      loadedRouteIdRef.current = id;
      setData(projection.data);
    } catch {
      if (!hasExistingDetail) {
        setError('Não foi possível carregar o orçamento.');
      } else {
        setReloadWarning(true);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  if (loading && !data) return <SkeletonDetail />;
  if (error) {
    const previousRoute = getHashHistoryPreviousRoute();
    const fromCommercial = previousRoute && routePath(previousRoute) === '/crm';
    const fromSendHistory =
      previousRoute &&
      routePath(previousRoute) === '/comunicacao' &&
      new URLSearchParams(previousRoute.split('?')[1] || '').get('tab') === 'history';
    const fromDeliveries = previousRoute && routePath(previousRoute) === '/whatsapp-deliveries';
    const returnRoute =
      fromCommercial
        ? '/crm'
        : fromSendHistory || fromDeliveries
          ? previousRoute
          : '/quotations';
    const returnLabel =
      fromFollowUps || fromCommercial
        ? 'Comercial'
        : fromSendHistory
          ? 'Histórico de envios'
          : fromDeliveries
            ? 'Envios'
            : 'Orçamentos';
    return (
      <PageShell className="space-y-4">
        <button
          onClick={() => navigate(returnRoute)}
          className="text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page"
        >
          ← Voltar para {returnLabel}
        </button>
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-12 text-center text-fg"
        >
          <AlertTriangle size={32} className="text-destructive" aria-hidden="true" />
          <p className="font-medium">Erro ao carregar orçamento</p>
          <p className="max-w-md text-sm text-fg-muted">
            Verifique sua conexão e tente novamente. Nenhuma alteração foi realizada.
          </p>
          <Button variant="outline" onClick={() => void loadDetail()}>
            Tentar novamente
          </Button>
        </div>
      </PageShell>
    );
  }
  if (!data) return null;
  return (
    <PageShell className="space-y-3">
      {reloadWarning && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-fg-muted"
        >
          <span>Não foi possível atualizar o orçamento. Exibindo os dados anteriores.</span>
          <Button variant="outline" size="sm" onClick={() => void loadDetail()}>
            Tentar novamente
          </Button>
        </div>
      )}
      <CoreQuotationDetail
        data={data}
        navigate={navigate}
        onReload={loadDetail}
        concurrencyTokenRef={concurrencyTokenRef}
      />
    </PageShell>
  );
}
