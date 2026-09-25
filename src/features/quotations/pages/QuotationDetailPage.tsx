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
  Loader2,
  Mail,
  Search,
  CheckCircle2,
  ShoppingCart,
  ArrowUpRight,
  ChevronDown,
  Send,
} from 'lucide-react';
import { apiGet, apiPost, apiPut, apiDelete, type ApiError } from '@/lib/api/api';
import { issuePersistedDraft } from '@/lib/api/quotationIssueApi';
import { fetchFlows, type CommunicationFlow } from '@/lib/api/communicationApi';
import QuotationDeliveryStatus from '@/features/quotations/components/QuotationDeliveryStatus';
import { useQuotationDeliveries, deliveryIdentityKey } from '@/hooks/useQuotationDeliveries';
import { projectDelivery, type DeliveryResolution } from '@/lib/api/quotationDeliveryApi';
import { searchProducts } from '@/lib/api/productCache';
import type { Product } from '@/types/domain';
import { fmtPhone, formatBRL, formatDate } from '@/lib/formatting/formatters';
import { Button } from '@/components/ui/button';
import InlineAlert from '@/components/shared/InlineAlert';
import ErrorState from '@/components/shared/ErrorState';
import { Dialog } from '@/components/ui/dialog';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
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
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import { useBreadcrumbLabel } from '@/components/layout/BreadcrumbLabelContext';
import { type QuotationSectionsSnapshot } from '@/features/quotations/components/QuotationSectionsEditor';
import ProductionTermsFields from '@/features/quotations/components/ProductionTermsFields';
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
import { MenuItem } from '@/components/ui/menu-item';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import MobileActionBar from '@/components/shared/MobileActionBar';

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
  const lossReasonSelectRef = useRef<HTMLSelectElement>(null);
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
  const [productionDays, setProductionDays] = useState(data.prazoProducaoDias);
  const [surchargePercent, setSurchargePercent] = useState(data.acrescimoPercent);
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
    setProductionDays(initialData.prazoProducaoDias);
    setSurchargePercent(initialData.acrescimoPercent);
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

  const lookupProductPrice = useCallback(async (sku: string, qty: string, percent = surchargePercent) => {
    const response = await apiPost<{ items?: Array<{ rate?: string | number }> }>(
      '/pricing-lookup',
      {
        items: [{ item_code: sku, qty }],
        acrescimo_percent: percent,
      }
    );
    const rawRate = response.items?.[0]?.rate;
    const rate = Number(rawRate);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error('Preço indisponível para este produto.');
    }
    return String(rawRate);
  }, [surchargePercent]);

  const repriceItem = useCallback(
    async (key: string, percent?: number) => {
      const item = items.find((candidate) => candidate._key === key);
      if (!item || !item.sku || item.manual_rate) return;
      const quantity = item.qty;
      const sku = item.sku;
      const requestVersion = nextPricingVersion(key);
      if (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0) return;
      try {
        const rate = await lookupProductPrice(sku, quantity, percent);
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

  const changeSurchargePercent = useCallback(
    (percent: number) => {
      setSurchargePercent(percent);
      items.forEach((item) => void repriceItem(item._key, percent));
    },
    [items, repriceItem]
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
      setProductionDays(authoritative.prazoProducaoDias);
      setSurchargePercent(authoritative.acrescimoPercent);
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
    if (productionDays !== data.prazoProducaoDias) return true;
    if (surchargePercent !== data.acrescimoPercent) return true;
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
    productionDays,
    surchargePercent,
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
        prazo_producao_dias: productionDays,
        acrescimo_percent: surchargePercent,
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
    productionDays,
    resetEditor,
    selectedTemplate,
    selectedVersionId,
    sections,
    surchargePercent,
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
          acrescimo_percent: surchargePercent,
          items: items.map((item) => ({
            item_code: item.sku || item.item_code,
            item_name: item.item_name,
            qty: Number(item.qty),
            rate: Number(item.applied_unit_price),
            manual_rate: item.manual_rate,
          })),
          prazo_producao_dias: productionDays,
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
    productionDays,
    sections,
    selectedTemplate,
    selectedVersionId,
    surchargePercent,
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

  const closeTechDetailsDialog = useCallback(() => {
    setTechDetailsOpen(false);
  }, []);

  const openIssuedDocument = useCallback(() => {
    const params = new URLSearchParams({ id: data.revisionId || data.id || '', format: 'pdf' });
    window.open(`/api/quotation-preview?${params.toString()}`, '_blank', 'noopener,noreferrer');
  }, [data.id, data.revisionId]);
  const scrollToCommunication = useCallback(() => {
    document.getElementById('issued-communication')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
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
  const displayTitle = quotationDisplayTitle(data.businessNumber);
  const issuedView = !draftEditable && !editing;
  const totalUnits = displayItems.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  const productionDeadline = sections.prazo_producao.current.value || '';
  const hideDuplicateProductionDeadline = quotationContentsMatch(entrega, productionDeadline);
  const whatsappDisabledReason = deliveryPending
    ? 'Envio em andamento.'
    : delivery
      ? projectDelivery(delivery).sendBlockedReason
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
    <div className="grid min-w-0 gap-5 xl:grid-cols-main-aside">
      <div id="quotation-panel" className="min-w-0 space-y-5">
        <section
          aria-labelledby="issued-client-title"
          className="rounded-card bg-surface px-5 py-5 md:px-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <Heading level="section" id="issued-client-title">Cliente e oportunidade</Heading>
              <div className="mt-5 flex items-center gap-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-avatar-one text-3xs font-bold text-avatar-ink" aria-hidden="true">{(data.cliente || 'CL').slice(0, 2).toLocaleUpperCase('pt-BR')}</span>
                <div className="min-w-0"><p className="truncate text-sm font-medium text-fg">{data.cliente || 'Cliente não informado'}</p>{(data.email || data.telefone) && <p className="truncate text-xs text-fg-muted">{[data.email, fmtPhone(data.telefone) || data.telefone].filter(Boolean).join(' · ')}</p>}</div>
              </div>
            </div>
            {data.clienteId && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => navigate(`/leads/cliente/${encodeURIComponent(data.clienteId)}`)}
              >
                <ArrowUpRight aria-hidden="true" /> Abrir cliente
              </Button>
            )}
          </div>
          {data.quotationOrigin && data.quotationOrigin.status !== 'missing' && <div className="mt-5 flex items-center justify-between border-t border-line pt-4 text-xs"><span className="text-fg-muted">Origem</span><span>{data.quotationOrigin.sourceLabel}</span></div>}
        </section>

        <section
          aria-labelledby="issued-items-title"
          className="overflow-hidden rounded-card bg-surface"
        >
          <div className="px-5 pb-3 pt-5 md:px-6">
            <Heading level="section" id="issued-items-title">
              Itens do orçamento
            </Heading>
          </div>
          {displayItems.length > 0 ? (
            <div className="px-5 md:px-6">
              <ul aria-label="Itens do orçamento" className="divide-y divide-line pb-2 md:hidden">
                {displayItems.map((item) => (
                  <li key={item._key} className="flex flex-col gap-1 py-3">
                    <Text variant="title">
                      {item.nome || item.item_name || item.sku || 'Produto não informado'}
                    </Text>
                    <div className="flex items-baseline justify-between gap-3">
                      <Text variant="meta">
                        {Number(item.qty)} × {formatBRL(item.applied_unit_price)}
                        {item.sku && <span className="font-mono"> · {item.sku}</span>}
                      </Text>
                      <Text variant="value" className="shrink-0">
                        {formatBRL(item.line_total || Number(item.qty) * Number(item.applied_unit_price))}
                      </Text>
                    </div>
                  </li>
                ))}
              </ul>
              <Table
                density="compact"
                edges="flush"
                className="table-fixed text-sm"
                containerClassName="overflow-hidden max-md:hidden"
              >
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-9 w-[48%]">Produto</TableHead>
                    <TableHead className="h-9 whitespace-nowrap text-center">Qtd.</TableHead>
                    <TableHead className="h-9 whitespace-nowrap text-center">Unitário</TableHead>
                    <TableHead className="h-9 whitespace-nowrap text-right">
                      Subtotal
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayItems.map((item) => (
                    <TableRow key={item._key}>
                      <TableCell>
                        <span className="block break-words font-medium text-fg">
                          {item.nome || item.item_name || item.sku || 'Produto não informado'}
                        </span>
                        <span className="mt-1 block font-mono text-3xs text-fg-muted">{item.sku || '—'}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-center tabular-nums">
                        {Number(item.qty)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-center tabular-nums">
                        {formatBRL(item.applied_unit_price)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
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
        </section>

        <section
          aria-labelledby="issued-conditions-title"
          className="rounded-card bg-surface px-5 py-5 md:px-6 [&>section:first-of-type]:border-t-0"
        >
          <Heading level="section" id="issued-conditions-title">
            Condições comerciais
          </Heading>
          <QuotationSectionsDocument sections={sections} editable={false} onChange={setSections} />
          {entrega && (
            <section className="border-t border-line py-5" aria-labelledby="issued-delivery-title">
              <Heading level="subsection" id="issued-delivery-title">
                Previsão de entrega
              </Heading>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-fg-muted">{entrega}</p>
            </section>
          )}
          <div className="divide-y divide-line border-t border-line">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-medium text-fg [&::-webkit-details-marker]:hidden">
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
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-medium text-fg [&::-webkit-details-marker]:hidden">
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
                  <Table density="compact" edges="flush" className="min-w-[680px] text-sm">
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
                        const eligible = entry.status !== 'rascunho' && !draftEditable;
                        return (
                          <TableRow key={entry.revisionId}>
                            <TableCell className="whitespace-nowrap font-medium">
                              R{entry.revision}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {formatDate(entry.createdAt) || '—'}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {formatDate(entry.validade) || '—'}
                              {entry.expired && (
                                <span className="block text-xs text-warning">Expirada</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <StatusBadge {...statusBadgeProps(entry.status)} />
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">
                              {formatBRL(entry.total)}
                            </TableCell>
                            <TableCell>
                              {entry.status !== 'rascunho' ? (
                                <Button
                                  type="button"
                                  variant="link"
                                  size="inline"
                                  onClick={() => {
                                    window.open(
                                      `/api/quotation-preview?id=${encodeURIComponent(entry.revisionId)}&format=pdf`,
                                      '_blank',
                                      'noopener,noreferrer'
                                    );
                                  }}
                                >
                                  Visualizar
                                </Button>
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
                ) : (
                  <p className="text-sm text-fg-muted">Nenhuma revisão anterior.</p>
                )}
              </div>
            </details>
          </div>
        </section>
      </div>

      <div className="min-w-0 space-y-5 self-start">
      <aside className="rounded-card bg-surface p-5" aria-label="Resumo do orçamento">
        <Heading level="section">Resumo</Heading>
        <dl className="mt-4 space-y-3 text-xs tabular-nums">
          <div className="flex justify-between gap-3"><dt className="text-fg-muted">Subtotal</dt><dd>{formatBRL(Number(data.total) - Number(data.frete))}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-fg-muted">Frete</dt><dd>{formatBRL(data.frete)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-fg-muted">Itens</dt><dd>{displayItems.length}</dd></div>
          <div className="flex items-center justify-between gap-3 border-t border-line pt-4 text-sm"><dt>Total</dt><dd className="text-xl font-bold">{formatBRL(data.total)}</dd></div>
        </dl>
        <p className="mt-5 rounded-control border border-line p-3 text-2xs leading-4 text-fg-muted">Emitir o documento não confirma a entrega por WhatsApp ou e-mail.</p>
      </aside>
      <aside id="issued-communication"
        className="rounded-card bg-surface px-5 py-5"
        aria-labelledby="commercial-followup-title"
      >
        <Heading level="section" id="commercial-followup-title">
          Comunicação
        </Heading>
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
          <Heading level="subsection">Resultado da negociação</Heading>
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
                variant="ghost-muted"
                className="w-full"
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
    </div>
  ) : null;

  return (
    <div ref={detailTopRef} className="space-y-5">
      <fieldset disabled={saving} className="flex min-w-0 flex-col gap-5">
        <PageHeader
          eyebrow={draftEditable && !editing ? 'Revisar antes de emitir' : undefined}
          title={data.businessNumber || displayTitle}
          meta={
            <>
              <StatusBadge {...statusBadgeProps(data.status)} />
              {data.cliente && <span className="font-medium text-fg">{data.cliente}</span>}
              <span>Revisão {data.revision}</span>
              <span>Data {formatDate(data.data) || '—'}</span>
              <span>Válido até {formatDate(data.validade) || '—'}</span>
              {data.expired && <span className="font-medium text-warning">Expirado</span>}
              {issuedView && (
                <span role="status" className="text-xs font-medium text-fg-muted">
                  Somente leitura. Alterações criam uma nova revisão.
                </span>
              )}
              {data.quotationOrigin && data.quotationOrigin.status !== 'missing' && (
                <div
                  className="flex flex-wrap items-center gap-2"
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
                    isDirty ? 'font-medium text-warning' : undefined
                  }
                >
                  {saving
                    ? 'Salvando…'
                    : isDirty
                      ? 'Alterações não salvas'
                      : 'Nenhuma alteração pendente'}
                </p>
              )}
            </>
          }
          actions={
            <>
              {editing ? (
                <>
                  <Button
                    variant="outline"
                    className="max-md:hidden"
                    disabled={saving}
                    onClick={() => (isDirty ? setConfirmDiscardEdits(true) : resetEditor())}
                  >
                    Cancelar
                  </Button>
                  <Button variant="outline" disabled={saving} onClick={openPreview}>
                    Pré-visualizar
                  </Button>
                  <Button className="max-md:hidden" disabled={saving} onClick={save}>
                    <Save size={14} /> {saving ? 'Salvando…' : 'Salvar alterações'}
                  </Button>
                </>
              ) : (
                <>
                  {draftEditable ? (
                    <>
                      <Button
                        variant="outline"
                        className="max-md:hidden"
                        onClick={() => {
                          showMessage('');
                          setEditing(true);
                        }}
                      >
                        <Pencil size={14} /> Editar
                      </Button>
                    </>
                  ) : (
                    <Button variant="outline" className="max-md:hidden" onClick={openIssuedDocument}>
                      <FileText size={14} /> Prévia do documento
                    </Button>
                  )}

                  {issuedView && data.revisionId && <Button variant="outline" className="max-md:hidden" disabled={lifecycleAction !== null} onClick={() => createRevision(data.revisionId!)}><Pencil size={14} />{lifecycleAction === 'create_revision' ? 'Criando revisão…' : 'Nova revisão'}</Button>}
                  {/* A partir de xl o painel Comunicação fica ao lado; abaixo de md a ação vai para a barra inferior. */}
                  {issuedView && <Button className="max-md:hidden xl:hidden" onClick={scrollToCommunication}><Send size={14} />Preparar envio</Button>}

                  <div className="relative">
                    <Button
                      ref={moreActionsButtonRef}
                      type="button"
                      variant="outline"
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      onClick={() => setMenuOpen((current) => !current)}
                    >
                      <MoreHorizontal aria-hidden="true" />
                      Mais ações
                    </Button>
                    {menuOpen && (
                      <div
                        aria-hidden="true"
                        className="fixed inset-0 z-floating"
                        onClick={() => setMenuOpen(false)}
                      />
                    )}
                    {menuOpen && (
                      <div
                        role="menu"
                        aria-label="Ações do orçamento"
                        className="absolute right-0 top-12 z-floating w-52 rounded-control border border-line bg-surface p-1 shadow-lg"
                      >
                        {issuedView && data.revisionId && (
                          <MenuItem
                            role="menuitem"
                            className="md:hidden"
                            disabled={lifecycleAction !== null}
                            onClick={() => {
                              setMenuOpen(false);
                              createRevision(data.revisionId!);
                            }}
                          >
                            <Pencil aria-hidden="true" /> Nova revisão
                          </MenuItem>
                        )}
                        <MenuItem
                          role="menuitem"
                          onClick={() => {
                            setMenuOpen(false);
                            setTechDetailsOpen(true);
                          }}
                        >
                          Detalhes técnicos
                        </MenuItem>
                        <MenuItem
                          role="menuitem"
                          tone="destructive"
                          onClick={() => {
                            setMenuOpen(false);
                            setConfirmDeleteOpen(true);
                          }}
                        >
                          <Trash2 aria-hidden="true" /> Excluir orçamento
                        </MenuItem>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          }
        />

        {(message || emailSuccess) && (
          <p
            role="status"
            aria-live="polite"
            className={`mb-4 text-sm ${messageTone === 'error' ? 'text-destructive' : 'text-fg-muted'}`}
          >
            {message || emailSuccess}
          </p>
        )}
        {conflict && (
          <InlineAlert className="mt-4"
            action={
              <Button variant="outline" size="sm" onClick={reloadAfterConflict}>
                Recarregar
              </Button>
            }
          >
            <span className="break-words">{conflict}</span>
          </InlineAlert>
        )}

        {issuedDetail}

        {!issuedView && (
          <div
            className={
              editing
                ? 'min-w-0 space-y-5'
                : 'grid min-w-0 gap-5 xl:grid-cols-main-aside'
            }
          >
            <div className="min-w-0 rounded-card border border-line bg-surface p-5 md:p-6">
              {draftEditable && !editing && (
                <Heading level="section" className="mb-3">Conferência</Heading>
              )}
              <>
                {/* Cliente */}
                <section aria-labelledby="cliente-title" className="border-t border-line py-5">
                  <Heading as="h2" level="subsection" id="cliente-title">
                    Cliente
                  </Heading>
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
                          <div className="absolute left-0 right-0 z-floating mt-1 max-h-40 overflow-y-auto rounded-control border border-line bg-surface shadow-lg">
                            {clientResults.map((client) => (
                              // eslint-disable-next-line no-restricted-syntax -- opção de autocomplete
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
                            <Button
                              type="button"
                              variant="link"
                              size="inline"
                              onClick={() =>
                                navigate(`/leads/cliente/${encodeURIComponent(data.clienteId)}`)
                              }
                            >
                              Ver cliente
                            </Button>
                            <Button
                              type="button"
                              variant="link"
                              size="inline"
                              onClick={() => navigate('/crm')}
                            >
                              Abrir no CRM
                            </Button>
                            <Button
                              type="button"
                              variant="link"
                              size="inline"
                              onClick={() => navigate('/quotations')}
                            >
                              Ver orçamentos anteriores
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </section>

                {/* Dados do orçamento */}
                <section aria-labelledby="dados-title" className="border-t border-line py-5">
                  <Heading as="h2" level="subsection" id="dados-title">
                    Dados do orçamento
                  </Heading>
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
                          <p className="mt-1 text-xs text-fg-muted">
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
                            <span className="block text-xs text-fg-muted">
                              Válida até {formatDate(data.validade)}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-fg-muted">Modelo</span>
                      {editing && draftEditable && templates.length > 0 ? (
                        <Select
                          aria-label="Modelo do orçamento"
                          containerClassName="w-full mt-1" className="w-full"
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
                        </Select>
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
                    <div className="min-w-0 sm:col-span-2">
                      {editing && draftEditable ? (
                        <ProductionTermsFields
                          productionDays={productionDays}
                          surchargePercent={surchargePercent}
                          onProductionDaysChange={setProductionDays}
                          onSurchargePercentChange={changeSurchargePercent}
                        />
                      ) : (
                        <>
                          <span className="text-xs font-medium text-fg-muted">
                            Prazo de produção
                          </span>
                          <p className="mt-1 break-words">
                            {data.prazoProducaoDias} dias úteis
                            {data.acrescimoPercent > 0 && ` · acréscimo de ${data.acrescimoPercent}%`}
                          </p>
                        </>
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
                    <Heading as="h2" level="subsection" id="quotation-items-title">
                      Itens
                    </Heading>
                    <span className="text-xs text-fg-muted">
                      {quotationItemCountLabel(displayItems.length)}
                    </span>
                  </div>
                  {displayItems.length > 0 ? (
                    <Table density="compact" className="min-w-[620px] text-sm [&_th]:h-8">
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
                                      className="h-8"
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
                                      <span className="block font-mono text-xs text-fg-muted">
                                        {item.sku}
                                      </span>
                                    )}
                                  </>
                                )}
                              </TableCell>
                              {editing && (
                                <TableCell className="relative whitespace-nowrap font-mono">
                                  <Input
                                    value={productTerms[item._key] ?? item.sku}
                                    onChange={(event) =>
                                      onProductTerm(item._key, event.target.value)
                                    }
                                    className="h-8 w-32"
                                    aria-label={`SKU do item ${item.item_name}`}
                                  />
                                  {results.length > 0 && (
                                    <div className="absolute left-0 top-9 z-floating w-64 rounded-control border border-line bg-surface shadow-lg">
                                      {results.map((product) => (
                                        // eslint-disable-next-line no-restricted-syntax -- opção de autocomplete
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
                              <TableCell className="whitespace-nowrap text-center">
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
                                <TableCell className="whitespace-nowrap text-right">
                                  {formatBRL(item.suggested_unit_price)}
                                </TableCell>
                              )}
                              <TableCell className="whitespace-nowrap text-right">
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
                                  className={`whitespace-nowrap text-right ${
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
                                  <Button
                                    type="button"
                                    variant="ghost-muted-destructive"
                                    size="icon-sm"
                                    onClick={() => removeItem(item._key)}
                                    aria-label={`Remover item ${item.item_name || item.sku}`}
                                  >
                                    <X size={16} />
                                  </Button>
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
                  <Heading as="h2" level="subsection">Revisões</Heading>
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
                    <Table density="compact" className="min-w-[720px] text-sm">
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
                              <TableCell className="whitespace-nowrap font-medium">
                                R{entry.revision}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                {formatDate(entry.createdAt) || '—'}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">
                                {formatDate(entry.validade) || '—'}
                                {expired && (
                                  <span className="block text-xs text-warning">Expirada</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <StatusBadge {...statusBadgeProps(entry.status)} />
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">
                                {formatBRL(entry.total)}
                              </TableCell>
                              <TableCell>
                                {entry.status !== 'rascunho' ? (
                                  <Button
                                    type="button"
                                    variant="link"
                                    size="inline"
                                    onClick={() => {
                                      window.open(
                                        `/api/quotation-preview?id=${encodeURIComponent(entry.revisionId)}&format=pdf`,
                                        '_blank',
                                        'noopener,noreferrer'
                                      );
                                    }}
                                  >
                                    Visualizar
                                  </Button>
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
                className="min-w-0 rounded-card border border-line bg-surface p-5 md:p-6"
                aria-labelledby="quotation-summary-title"
              >
                <Heading level="section" id="quotation-summary-title">
                  Resumo
                </Heading>
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

        <MobileActionBar label="Ações do orçamento">
          {editing ? (
            <>
              <Button variant="outline" disabled={saving} onClick={() => (isDirty ? setConfirmDiscardEdits(true) : resetEditor())}>
                Cancelar
              </Button>
              <Button disabled={saving} onClick={save}>
                <Save size={14} /> {saving ? 'Salvando…' : 'Salvar'}
              </Button>
            </>
          ) : draftEditable ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  showMessage('');
                  setEditing(true);
                }}
              >
                <Pencil size={14} /> Editar
              </Button>
              <Button disabled={issuing || lifecycleAction !== null} onClick={() => setConfirmIssueOpen(true)}>
                <FileText size={14} /> {issuing ? 'Emitindo…' : 'Emitir'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={openIssuedDocument}>
                <FileText size={14} /> Prévia
              </Button>
              <Button onClick={scrollToCommunication}>
                <Send size={14} /> Preparar envio
              </Button>
            </>
          )}
        </MobileActionBar>
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
      <Dialog
        open={techDetailsOpen}
        onClose={closeTechDetailsDialog}
        returnFocusRef={moreActionsButtonRef}
        title="Detalhes técnicos"
      >
        <dl className="space-y-3 text-sm">
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
      </Dialog>
      <Dialog
        open={lossReasonOpen}
        onClose={closeLossReasonDialog}
        initialFocusRef={lossReasonSelectRef}
        title="Motivo da perda"
        description={`Informe por que o orçamento ${data.businessNumber || ''} foi perdido. O motivo fica registrado no histórico.`}
        footer={
          <>
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
          </>
        }
      >
        <label className="block text-sm">
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
          <Textarea
            value={lossReasonDetail}
            onChange={(event) => setLossReasonDetail(event.target.value)}
            rows={3}
            placeholder="Contexto adicional sobre a perda…"
            className="mt-1"
            required={lossReasonChoice === 'Outro'}
            aria-required={lossReasonChoice === 'Outro' ? 'true' : undefined}
          />
        </label>
      </Dialog>
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
    const fromDeliveries = previousRoute && routePath(previousRoute) === '/whatsapp-deliveries';
    const returnRoute = fromCommercial ? '/crm' : fromDeliveries ? previousRoute : '/quotations';
    const returnLabel = fromCommercial ? 'Comercial' : fromDeliveries ? 'Envios' : 'Orçamentos';
    return (
      <PageShell>
        <ErrorState
          title="Não foi possível carregar o orçamento"
          description="Nenhuma alteração foi realizada."
          onRetry={() => void loadDetail()}
          actions={
            <Button variant="ghost" onClick={() => navigate(returnRoute)}>
              Voltar para {returnLabel}
            </Button>
          }
        />
      </PageShell>
    );
  }
  if (!data) return null;
  return (
    <PageShell className="space-y-3">
      {reloadWarning && (
        <InlineAlert
          tone="warning"
          action={
            <Button variant="outline" size="sm" onClick={() => void loadDetail()}>
              Tentar novamente
            </Button>
          }
        >
          Não foi possível atualizar o orçamento. Exibindo os dados anteriores.
        </InlineAlert>
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
