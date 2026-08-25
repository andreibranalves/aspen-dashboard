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
  X,
  Plus,
  Phone,
  AlertTriangle,
  Loader2,
  Mail,
  Search,
} from 'lucide-react';
import { apiGet, apiPost, apiPut, apiDelete, type ApiError } from '@/lib/api/api';
import { issueQuotation } from '@/lib/api/quotationIssueApi';
import { fetchFlows, type CommunicationFlow } from '@/lib/api/communicationApi';
import QuotationDeliveryStatus from '@/features/quotations/components/QuotationDeliveryStatus';
import { useQuotationDeliveries, deliveryIdentityKey } from '@/hooks/useQuotationDeliveries';
import type { DeliveryResolution } from '@/lib/api/quotationDeliveryApi';
import { searchProducts } from '@/lib/api/productCache';
import type { Product } from '@/types/domain';
import { formatBRL, formatDate } from '@/lib/formatting/formatters';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/badge';
import { useToast } from '@/components/shared/toast';
import { useRouteGuardContext } from '@/hooks/useHashRoute';
import { quotationStatusLabel, quotationStatusBadgeKey } from '@/lib/statusLabels';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import SkeletonDetail from '@/components/shared/SkeletonDetail';
import {
  QuotationSectionsEditor,
  type QuotationSectionsSnapshot,
} from '@/features/quotations/components/QuotationSectionsEditor';
import { QuotationEmailDialog } from '@/features/quotations/components/QuotationEmailDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { projectClientRow, projectProduct, projectQuotationDetail, projectQuotationTemplate, type ProjectedQuotationData, type ProjectedQuotationItem } from '@/lib/localProjections';

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
const SAFE_CONFLICT_MESSAGES = new Set([
  'O orçamento foi alterado por outro usuário. Recarregue antes de salvar.',
  'O orçamento mudou ou não pode mais ser editado. Recarregue para conferir.',
  'O orçamento mudou. Recarregue para conferir o estado atual.',
  'A revisão mudou ou já existe um rascunho. Recarregue para conferir.',
]);
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
  const existing = parseSections(data.secoes) || parseSections(data.sections_snapshot);
  if (!existing) throw new Error('Resposta inválida: seções do orçamento ausentes.');
  return cloneSections(existing);
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

function CoreQuotationDetail({ data: initialData, navigate, onReload, concurrencyTokenRef }: CoreQuotationDetailProps) {
  const [data, setData] = useState<QuotationData>(initialData);
  const draftEditable = data.status_canonical === 'rascunho';
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
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'info' | 'error'>('info');
  const [confirmIssueOpen, setConfirmIssueOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [lossReasonOpen, setLossReasonOpen] = useState(false);
  const [lossReasonChoice, setLossReasonChoice] = useState('');
  const [lossReasonDetail, setLossReasonDetail] = useState('');
  const lossReasonDialogRef = useRef<HTMLDivElement>(null);
  const lossReasonSelectRef = useRef<HTMLSelectElement>(null);
  const lossReasonRestoreFocusRef = useRef<HTMLElement | null>(null);
  const [conflict, setConflict] = useState('');
  const { toast } = useToast();
  const { setNavigationGuard } = useRouteGuardContext();
  const showMessage = useCallback((text: string, tone: 'info' | 'error' = 'info') => {
    setMessage(text);
    setMessageTone(tone);
  }, []);
  const [items, setItems] = useState<CoreQuotationItem[]>(() => asCoreItems(data.items));
  const [clientId, setClientId] = useState(data.client_id || '');
  const [clientSearch, setClientSearch] = useState(data.cliente || '');
  const [clientResults, setClientResults] = useState<CoreClientResult[]>([]);
  const [clientSearching, setClientSearching] = useState(false);
  const [validadeDias, setValidadeDias] = useState(String(data.validade_dias ?? ''));
  const [pagamento, setPagamento] = useState(data.pagamento || '');
  const [entrega, setEntrega] = useState(data.entrega || '');
  const [frete, setFrete] = useState(String(data.frete));
  const [observacoes, setObservacoes] = useState(data.observacoes || '');
  const [prazoProducao, setPrazoProducao] = useState(data.prazo_producao || '');
  const [sections, setSections] = useState<QuotationSectionsSnapshot>(() => normalizeSections(data));
  const [templates, setTemplates] = useState<QuotationTemplateMetadata[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState(data.template_version_id || '');
  const [selectedTemplate, setSelectedTemplate] = useState(
    data.template_key || 'padrao'
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
  const deliveryIdentity = data.status_canonical !== 'rascunho' && data.revision_id && deliveryFlowId
    ? { revisionId: data.revision_id, flowId: deliveryFlowId }
    : null;
  const {
    deliveriesByKey,
    pendingKeys,
    errorByKey,
    enqueue,
    resolve,
  } = useQuotationDeliveries(deliveryIdentity ? [deliveryIdentity] : []);
  const deliveryKey = deliveryIdentity ? deliveryIdentityKey(deliveryIdentity) : '';
  const delivery = deliveryKey ? deliveriesByKey[deliveryKey] || null : null;
  const deliveryPending = deliveryKey ? pendingKeys.includes(deliveryKey) : false;
  const deliveryError = deliveryKey ? errorByKey[deliveryKey] : undefined;

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
    setClientId(initialData.client_id || '');
    setClientSearch(initialData.cliente || '');
    setValidadeDias(String(initialData.validade_dias ?? ''));
    setPagamento(initialData.pagamento || '');
    setEntrega(initialData.entrega || '');
    setFrete(String(initialData.frete));
    setObservacoes(initialData.observacoes || '');
    setPrazoProducao(initialData.prazo_producao || '');
    setSections(normalizeSections(initialData));
    setSelectedTemplate(initialData.template_key || 'padrao');
    setSelectedVersionId(initialData.template_version_id || '');
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
  }, [initialData]);

  useEffect(() => {
    setConfirmedEmailAcceptedKey((current) =>
      current === `${data.id}:${data.revision_id}` ? current : ''
    );
    setEmailDialogOpen(false);
    setEmailError('');
    setEmailSuccess('');
    setEmailAttemptId('');
    setEmailAttemptRecipient('');
  }, [data.id, data.revision_id]);

  useEffect(() => {
    let active = true;
    fetchFlows().then((result) => {
      if (!active) return;
      const flows = Array.isArray(result.flows) ? result.flows : [];
      setDeliveryFlows(flows);
      const preferred = flows.find((flow) => flow.context === 'already_talking');
      const fallbackFlowId = preferred?.id || result.selectedFlowId || flows[0]?.id || '';
      setDeliveryFlowId((current) =>
        current && flows.some((flow) => flow.id === current) ? current : fallbackFlowId
      );
    }).catch(() => {
      if (!active) return;
      setDeliveryFlows([]);
      setDeliveryFlowId('');
    });
    return () => { active = false; };
  }, [initialData.id]);

  useEffect(() => {
    let active = true;
    apiGet<unknown>('/quotation-templates')
      .then((result) => {
        if (!active) return;
        const payload = result && typeof result === 'object' && !Array.isArray(result)
          ? result as Record<string, unknown>
          : null;
        const rawTemplates = payload && Array.isArray(payload.templates)
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
        const persisted = initialData.template_key || '';
        const persistedTemplate = available.find((template) => template.key === persisted);
        setTemplates(available);
        if (persistedTemplate?.archived) {
          setSelectedTemplate(persisted);
          setSelectedVersionId(
            initialData.template_version_id || persistedTemplate.current_version_id || ''
          );
        } else if (initialData.status_canonical === 'rascunho' && fallback) {
          setSelectedTemplate(fallback.key);
          setSelectedVersionId(fallback.current_version_id || '');
        } else if (persistedTemplate) {
          setSelectedTemplate(persisted);
          setSelectedVersionId(
            initialData.template_version_id || persistedTemplate.current_version_id || ''
          );
        } else if (fallback) {
          setSelectedTemplate(fallback.key);
          setSelectedVersionId(fallback.current_version_id || '');
        }
        setTemplateError('');
      })
      .catch(() => {
        if (active) setTemplateError('Não foi possível carregar os templates. Tente novamente.');
      });
    return () => {
      active = false;
    };
  }, [initialData.id, initialData.status_canonical, initialData.template_key]);

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
      const payload = response && typeof response === 'object' && !Array.isArray(response)
        ? response as Record<string, unknown>
        : {};
      const results = Array.isArray(payload.data)
        ? payload.data.map(projectClientRow).filter((client): client is CoreClientResult => client !== null)
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
      if (clientTimer.current) clearTimeout(clientTimer.current);
      clientTimer.current = setTimeout(() => searchClients(value), 250);
    },
    [searchClients]
  );

  const updateItem = useCallback((key: string, patch: Partial<CoreQuotationItem>) => {
    nextPricingVersion(key);
    setItems((previous) =>
      previous.map((item) => (item._key === key ? { ...item, ...patch } : item))
    );
  }, [nextPricingVersion]);

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
    const response = await apiPost<{ items?: Array<{ rate?: string | number }> }>('/pricing-lookup', {
      items: [{ item_code: sku, qty }],
      urgent: false,
    });
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
              : current,
          ),
        );
      } catch {
        setMessage('Não foi possível consultar o preço. Tente novamente.');
      }
    },
    [items, lookupProductPrice, nextPricingVersion],
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
              : current,
          ),
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

  const removeItem = useCallback((key: string) => {
    nextPricingVersion(key);
    setItems((previous) => previous.filter((item) => item._key !== key));
  }, [nextPricingVersion]);

  const resetEditor = useCallback(
    (authoritative: QuotationData = data) => {
      setItems(asCoreItems(authoritative.items));
      setClientId(authoritative.client_id || '');
      setClientSearch(authoritative.cliente || '');
      setClientResults([]);
      setClientSearching(false);
      if (clientTimer.current) clearTimeout(clientTimer.current);
      clientTimer.current = null;
      setProductTerms({});
      setProductResults({});
      Object.values(productTimers.current).forEach((timer) => clearTimeout(timer));
      productTimers.current = {};
      setValidadeDias(String(authoritative.validade_dias ?? ''));
      setPagamento(authoritative.pagamento || '');
      setEntrega(authoritative.entrega || '');
      setFrete(String(authoritative.frete));
      setObservacoes(authoritative.observacoes || '');
      setPrazoProducao(authoritative.prazo_producao || '');
      setSections(normalizeSections(authoritative));
      setSelectedTemplate(authoritative.template_key || 'padrao');
      setSelectedVersionId(authoritative.template_version_id || '');
      showMessage('');
      setConflict('');
      setEditing(false);
    },
    [data]
  );

  // ── Dirty detection for the edit form ──
  const isDirty = useMemo(() => {
    if (!editing) return false;
    if (JSON.stringify(comparableItems(items)) !== JSON.stringify(comparableItems(asCoreItems(data.items)))) return true;
    if (clientId !== (data.client_id || '')) return true;
    if (validadeDias !== String(data.validade_dias ?? '')) return true;
    if (pagamento !== (data.pagamento || '')) return true;
    if (entrega !== (data.entrega || '')) return true;
    if (frete !== String(data.frete)) return true;
    if (observacoes !== (data.observacoes || '')) return true;
    if (prazoProducao !== (data.prazo_producao || '')) return true;
    if (JSON.stringify(sections) !== JSON.stringify(normalizeSections(data))) return true;
    if (selectedTemplate !== (data.template_key || 'padrao')) return true;
    if (selectedVersionId !== (data.template_version_id || '')) return true;
    return false;
  }, [editing, items, data, clientId, validadeDias, pagamento, entrega, frete, observacoes, prazoProducao, sections, selectedTemplate, selectedVersionId]);

  useEffect(() => {
    if (!isDirty) {
      setNavigationGuard(null);
      setPendingRoute(null);
      return () => setNavigationGuard(null);
    }
    setNavigationGuard(saving
      ? () => true
      : (nextRoute) => {
          setPendingRoute(nextRoute);
          return false;
        });
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
      const refreshed = await apiPut<unknown>(
        `/quotations?id=${encodeURIComponent(data.id)}`,
        {
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
          pagamento,
          entrega,
          frete,
          observacoes,
          prazo_producao: prazoProducao,
          template_key: selectedTemplate,
          template_version_id: selectedVersionId || undefined,
          secoes: sections,
        }
      );
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
        const safeMessage = error instanceof Error && SAFE_CONFLICT_MESSAGES.has(error.message)
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
    observacoes,
    pagamento,
    prazoProducao,
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
    if (data.status_canonical !== 'rascunho') {
      toast('Somente rascunhos podem ser excluídos.', 'info');
      return;
    }
    try {
      await apiDelete(`/quotations?id=${encodeURIComponent(data.id)}`);
      toast(`Orçamento ${data.id} excluído.`, 'success');
      navigate('/quotations');
    } catch {
      showMessage('Não foi possível excluir o orçamento. Tente novamente.', 'error');
    }
  }, [data.id, data.status_canonical, navigate, showMessage, toast]);

  const displayItems = items;
  const editingSubtotal = items.reduce(
    (sum, item) => sum + Number(item.qty) * Number(item.applied_unit_price),
    0,
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
    const params = new URLSearchParams({ id: data.revision_id || data.id });
    if (draftEditable && selectedVersionId) params.set('template_version_id', selectedVersionId);
    window.open(
      `/api/quotation-preview?${params.toString()}`,
      '_blank',
      'noopener,noreferrer'
    );
  }, [data.id, data.revision_id, draftEditable, selectedVersionId]);
  const runIssue = useCallback(async () => {
    setConfirmIssueOpen(false);
    setIssuing(true);
    showMessage('');
    setConflict('');
    try {
      const key = globalThis.crypto.randomUUID();
      const issue = await issueQuotation({ extracted: {
        nome: data.cliente || '', email: data.email || null, telefone: data.telefone || null,
        items: items.map((item) => ({ item_code: item.sku, item_name: item.item_name, qty: Number(item.qty), rate: Number(item.applied_unit_price), manual_rate: item.manual_rate })),
        prazo_producao: prazoProducao || undefined, frete: frete || undefined,
        pagamento,
        entrega,
        validade_dias: Number(validadeDias),
        observacoes,
        template_key: selectedTemplate,
        template_version_id: selectedVersionId || undefined,
        secoes: sections,
      } }, key, { sourceQuotationId: data.quotation_uuid || undefined, sourceRevisionId: data.revision_id || undefined });
      toast(`Orçamento ${issue.businessNumber} emitido.`, 'success');
      await onReload();
    } catch {
      showMessage('Não foi possível emitir o orçamento. Tente novamente.', 'error');
    } finally {
      setIssuing(false);
    }
  }, [data.cliente, data.email, data.id, data.quotation_uuid, data.revision_id, entrega, frete, items, observacoes, onReload, pagamento, prazoProducao, sections, selectedTemplate, selectedVersionId, showMessage, toast, validadeDias]);

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
      showMessage(status === 'aprovado' ? 'Marcando como aprovado…' : 'Marcando como perdido…');
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
        toast(
          status === 'aprovado' ? 'Orçamento aprovado.' : 'Orçamento marcado como perdido.',
          'success'
        );
        showMessage('');
      } catch (error) {
        const responseStatus = (error as { status?: number }).status;
        if (responseStatus === 409) {
          const safeMessage = error instanceof Error && SAFE_CONFLICT_MESSAGES.has(error.message)
            ? error.message
            : 'O orçamento mudou. Recarregue para conferir o estado atual.';
          setConflict(safeMessage);
          showMessage('');
        } else {
          showMessage('Não foi possível atualizar o estado do orçamento. Tente novamente.', 'error');
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
      showMessage('Criando nova revisão…');
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
        toast('Nova revisão criada em rascunho.', 'success');
      } catch (error) {
        const responseStatus = (error as { status?: number }).status;
        if (responseStatus === 409) {
          const safeMessage = error instanceof Error && SAFE_CONFLICT_MESSAGES.has(error.message)
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
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR)
      );
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

  const openIssuedDocument = useCallback(() => {
    const params = new URLSearchParams({ id: data.revision_id || data.id || '', format: 'pdf' });
    window.open(`/api/quotation-preview?${params.toString()}`, '_blank', 'noopener,noreferrer');
  }, [data.id, data.revision_id]);
  const sendIssuedQuotation = useCallback(async () => {
    if (
      !data.revision_id ||
      !deliveryFlowId ||
      deliveryPending ||
      Boolean(delivery) ||
      Boolean(data.expirada || data.is_expired || data.derived_expired)
    ) return;
    try {
      await enqueue({
        quotationId: data.quotation_id || data.id,
        revisionId: data.revision_id,
        flowId: deliveryFlowId,
      });
    } catch {
      console.error('[QuotationDetailPage] failed to enqueue WhatsApp delivery');
    }
  }, [data.derived_expired, data.expirada, data.id, data.is_expired, data.quotation_id, data.revision_id, delivery, deliveryFlowId, deliveryPending, enqueue]);
  const sendQuotationEmail = useCallback(async (recipient: string) => {
    if (!data.revision_id) return;
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
        revision_id: data.revision_id,
        recipient: recipientValue,
        attempt_id: attemptId,
      });
      setConfirmedEmailAcceptedKey(`${data.id}:${data.revision_id}`);
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
  }, [data.id, data.revision_id, emailAttemptId, emailAttemptRecipient, onReload]);
  const cancelEmailDialog = useCallback(() => {
    setEmailError('');
    setEmailDialogOpen(false);
  }, []);

  const emailSent = data.email_sent || confirmedEmailAcceptedKey === `${data.id}:${data.revision_id}`;

  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-4">
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 title={data.id} className="truncate font-mono text-xl font-semibold tracking-[-0.2px]">{data.id}</h1>
              <StatusBadge {...statusBadgeProps(data.status)} />
              {data.revision_number && (
                <span className="text-xs text-fg-muted">Revisão {data.revision_number}</span>
              )}
            </div>
            <p className="mt-1 break-words text-sm text-fg-muted">
              {data.cliente || 'Cliente não informado'}
            </p>
          </div>
          <button
            onClick={() => navigate('/quotations')}
            className="shrink-0 text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page"
          >
            ← Voltar
          </button>
        </header>

        {!draftEditable && (
          <div className="border-b border-line bg-surface-subtle px-4 py-3 text-sm text-fg-muted sm:px-6">
            Este orçamento está somente para leitura porque já foi emitido.
          </div>
        )}
        {conflict && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-destructive/10 px-4 py-3 text-sm text-destructive sm:px-6">
            <span className="min-w-0 break-words">{conflict}</span>
            <Button variant="outline" size="sm" onClick={reloadAfterConflict}>
              Recarregar
            </Button>
          </div>
        )}

        <fieldset disabled={saving} className="contents">
        <section aria-label="Dados principais" className="grid grid-cols-1 gap-x-6 gap-y-4 border-b border-line px-4 py-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
          <div className="relative min-w-0">
            <span className="text-xs font-medium text-fg-muted">Cliente</span>
            {editing ? (
              <>
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
                        className="w-full text-left px-3 py-2 text-sm hover:bg-primary/10"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          setClientId(client.id);
                          setClientSearch(client.nome);
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
              </>
            ) : (
              <p className="mt-1 break-words font-medium">{data.cliente || 'Cliente não informado'}</p>
            )}
          </div>
          <div className="min-w-0">
            <span className="text-xs font-medium text-fg-muted">Data</span>
            <p className="mt-1 whitespace-nowrap tabular-nums">{formatDate(data.data) || '—'}</p>
          </div>
          <div className="min-w-0">
            <span className="text-xs font-medium text-fg-muted">Validade</span>
            <p className="mt-1 break-words">
              {formatDate(data.validade) || '—'} ({data.validade_dias ?? '—'} dias)
            </p>
            {(data.derived_expired ||
              data.expiration_derived ||
              data.is_expired ||
              data.expirada) && (
              <span className="mt-1 block text-xs text-warning">Validade expirada (indicador derivado)</span>
            )}
          </div>
        </section>

        <section aria-label="Condições comerciais" className="grid grid-cols-1 gap-x-6 gap-y-4 border-b border-line px-4 py-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          <label className="min-w-0 text-sm">
            <span className="text-xs font-medium text-fg-muted">Pagamento</span>
            {editing ? (
              <Input
                aria-label="Pagamento do orçamento"
                value={pagamento}
                onChange={(event) => setPagamento(event.target.value)}
              />
            ) : (
              <p className="mt-1 break-words whitespace-pre-wrap">{pagamento || '—'}</p>
            )}
          </label>
          <label className="min-w-0 text-sm">
            <span className="text-xs font-medium text-fg-muted">Entrega</span>
            {editing ? (
              <Input
                aria-label="Entrega do orçamento"
                value={entrega}
                onChange={(event) => setEntrega(event.target.value)}
              />
            ) : (
              <p className="mt-1 break-words whitespace-pre-wrap">{entrega || '—'}</p>
            )}
          </label>
          <label className="min-w-0 text-sm">
            <span className="text-xs font-medium text-fg-muted">Validade (dias)</span>
            {editing ? (
              <Input
                aria-label="Validade do orçamento"
                type="number"
                min="1"
                max="365"
                value={validadeDias}
                onChange={(event) => setValidadeDias(event.target.value)}
              />
            ) : (
              <p className="mt-1 tabular-nums">{data.validade_dias ?? '—'}</p>
            )}
          </label>
          <label className="min-w-0 text-sm">
            <span className="text-xs font-medium text-fg-muted">Frete</span>
            {editing ? (
              <Input
                aria-label="Frete do orçamento"
                type="number"
                min="0"
                step="0.01"
                value={frete}
                onChange={(event) => setFrete(event.target.value)}
              />
            ) : (
              <p className="mt-1 whitespace-nowrap tabular-nums">{formatBRL(data.frete)}</p>
            )}
          </label>
          <label className="min-w-0 text-sm sm:col-span-2 lg:col-span-4">
            <span className="text-xs font-medium text-fg-muted">Prazo de produção</span>
            {editing ? (
              <Input
                aria-label="Prazo de produção do orçamento"
                value={prazoProducao}
                onChange={(event) => setPrazoProducao(event.target.value)}
              />
            ) : (
              <p className="mt-1 break-words whitespace-pre-wrap">{prazoProducao || '—'}</p>
            )}
          </label>
          <label className="min-w-0 text-sm sm:col-span-2 lg:col-span-4">
            <span className="text-xs font-medium text-fg-muted">Observações</span>
            {editing ? (
              <textarea
                aria-label="Observações do orçamento"
                className="mt-1 min-h-24 w-full rounded-sm border border-line bg-surface px-3 py-2 text-sm"
                value={observacoes}
                onChange={(event) => setObservacoes(event.target.value)}
              />
            ) : (
              <p className="mt-1 break-words whitespace-pre-wrap">{observacoes || '—'}</p>
            )}
          </label>
        </section>

        <section aria-labelledby="quotation-sections-title" className="space-y-3 border-b border-line px-4 py-4 sm:px-6">
          <div>
            <h2 id="quotation-sections-title" className="text-base font-semibold">Seções do orçamento</h2>
            <p className="text-xs text-fg-muted">Conteúdo capturado nesta revisão.</p>
          </div>
          <QuotationSectionsEditor
            mode="revision"
            sections={sections}
            editable={editing && draftEditable}
            onChange={setSections}
            onRestore={(key) => {
              if (!key) return;
              setSections((current) => ({
                ...current,
                [key]: { ...current[key], current: cloneSections(current[key].base) },
              }));
            }}
          />
        </section>

        {(templates.length > 0 || templateError) && (
          <section className="flex flex-wrap items-end gap-3 border-b border-line bg-surface-subtle px-4 py-4 sm:px-6">
            <h2 id="quotation-template-title" className="sr-only">Modelo do orçamento</h2>
            {templates.length > 0 && (
              <>
                <label className="min-w-0 flex-1 text-sm sm:min-w-64">
                  <span className="text-xs font-medium text-fg-muted">Modelo do orçamento</span>
                  {draftEditable ? (
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
                          {template.name}{template.archived ? ' (arquivado)' : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p aria-label="Modelo do orçamento" className="mt-2 break-words font-medium">
                      {selectedTemplateMetadata?.name || selectedTemplate || 'Modelo não informado'}
                    </p>
                  )}
                </label>
                {selectedTemplateMetadata && (
                  <span
                    className="text-xs text-fg-muted pb-2"
                    title={selectedTemplateMetadata.hash || selectedTemplateMetadata.current_hash || ''}
                  >
                    {selectedTemplateMetadata.archived ? 'Arquivado · ' : ''}Versão {selectedTemplateMetadata.current_version || data.template_version || '—'} · Hash: {(selectedTemplateMetadata.hash || selectedTemplateMetadata.current_hash || '').slice(0, 12)}…
                  </span>
                )}
                <Button type="button" variant="outline" size="sm" onClick={openPreview}>
                  Visualizar modelo
                </Button>
              </>
            )}
            {templateError && (
              <span className="text-xs text-destructive">
                Não foi possível carregar os modelos. Tente novamente mais tarde.
              </span>
            )}
          </section>
        )}
        {(data.status_canonical === 'emitido' || data.status_canonical === 'enviado') && !editing && (
          <div
            className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 sm:px-6"
            role="group"
            aria-label="Estado comercial"
          >
            <span className="text-xs text-fg-muted mr-1">Estado comercial:</span>
            <Button
              variant="success"
              size="sm"
              disabled={lifecycleAction !== null}
              onClick={() => markCommercialStatus('aprovado')}
            >
              {lifecycleAction === 'aprovado' && <Loader2 size={14} className="animate-spin" />}
              Marcar como aprovado
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={lifecycleAction !== null}
              onClick={openLossReasonDialog}
            >
              {lifecycleAction === 'perdido' && <Loader2 size={14} className="animate-spin" />}
              Marcar como perdido
            </Button>
          </div>
        )}

        <section aria-labelledby="quotation-items-title" className="space-y-3 px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="quotation-items-title" className="text-base font-semibold">Itens</h2>
            <span className="text-xs text-fg-muted">
              {displayItems.length} item{displayItems.length === 1 ? '' : 'ns'}
            </span>
          </div>
          {displayItems.length > 0 ? (
            <Table className="min-w-[760px] text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="h-9 whitespace-nowrap">SKU</TableHead>
                <TableHead className="h-9 min-w-[220px]">Produto</TableHead>
                <TableHead className="h-9 whitespace-nowrap text-center">Qtd</TableHead>
                <TableHead className="h-9 whitespace-nowrap text-right">Sugerido</TableHead>
                <TableHead className="h-9 whitespace-nowrap text-right">Aplicado</TableHead>
                <TableHead className="h-9 whitespace-nowrap text-right">Diferença</TableHead>
                <TableHead className="h-9 whitespace-nowrap text-right">Total</TableHead>
                {editing && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayItems.map((item) => {
                const results = productResults[item._key] || [];
                return (
                  <TableRow key={item._key}>
                    <TableCell className="relative whitespace-nowrap py-2 font-mono">
                      {editing ? (
                        <>
                          <Input
                            value={productTerms[item._key] ?? item.sku}
                            onChange={(event) => onProductTerm(item._key, event.target.value)}
                            className="h-8 w-32"
                          />
                          {results.length > 0 && (
                            <div className="absolute left-0 top-9 z-40 w-64 rounded-md border border-line bg-surface shadow-lg">
                              {results.map((product) => (
                                <button
                                  type="button"
                                  key={product.sku}
                                  className="block w-full text-left px-2 py-1.5 hover:bg-primary/10"
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
                        </>
                      ) : (
                        item.sku || '—'
                      )}
                    </TableCell>
                    <TableCell className="max-w-[320px] break-words py-2">
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
                        item.nome || item.item_name || item.sku || 'Produto não informado'
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-2 text-center">
                      {editing ? (
                        <Input
                          aria-label={`Quantidade de ${item.sku}`}
                          className="h-8 w-20 mx-auto"
                          type="number"
                          min="1"
                          step="1"
                          value={Number(item.qty)}
                          onChange={(event) =>
                            updateItem(item._key, { qty: event.target.value, line_total: '' })
                          }
                          onBlur={() => {
                            void repriceItem(item._key);
                          }}
                        />
                      ) : (
                        Number(item.qty)
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-2 text-right">
                      {formatBRL(item.suggested_unit_price)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-2 text-right">
                      {editing ? (
                        <Input
                          aria-label={`Preço aplicado ${item.sku}`}
                          className="h-8 w-28 ml-auto"
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
                    <TableCell
                      className={`whitespace-nowrap py-2 text-right ${Number(item.price_difference) > 0 ? 'text-destructive' : ''}`}
                    >
                      {formatBRL(item.price_difference)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-2 text-right font-mono">
                      {formatBRL(
                        editing
                          ? Number(item.qty) * Number(item.applied_unit_price)
                          : item.line_total || Number(item.qty) * Number(item.applied_unit_price)
                      )}
                    </TableCell>
                    {editing && (
                      <TableCell>
                        <button
                          type="button"
                          className="text-fg-muted hover:text-destructive"
                          onClick={() => removeItem(item._key)}
                          aria-label="Remover item"
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
            <EmptyState
              icon={FileText}
              title="Nenhum item neste orçamento"
              description={editing ? 'Adicione um item para compor a proposta.' : 'Não há itens registrados nesta revisão.'}
            />
          )}
          {editing && (
            <Button variant="outline" size="sm" onClick={addItem}>
              <Plus size={14} /> Item
            </Button>
          )}
        </section>

        <section aria-label="Resumo financeiro" className="flex justify-end border-t border-line bg-surface-subtle px-4 py-4 sm:px-6">
          <dl className="grid w-full max-w-xs gap-2 text-right text-sm">
            <div className="flex items-center justify-between gap-6">
              <dt className="text-fg-muted">Subtotal</dt>
              <dd className="font-mono tabular-nums">{formatBRL(displayedSubtotal)}</dd>
            </div>
            <div className="flex items-center justify-between gap-6">
              <dt className="text-fg-muted">Frete</dt>
              <dd className="font-mono tabular-nums">{formatBRL(editing ? frete : data.frete)}</dd>
            </div>
            <div className="flex items-center justify-between gap-6 border-t border-line pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd className="font-mono tabular-nums">{formatBRL(displayedTotal)}</dd>
            </div>
          </dl>
        </section>
        <section aria-label="Ações do orçamento" className="space-y-3 border-t border-line px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
          {draftEditable && !editing && (
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
          )}
          {draftEditable && !editing && (
            <Button
              variant="success"
              size="sm"
              disabled={issuing || lifecycleAction !== null}
              onClick={() => setConfirmIssueOpen(true)}
            >
              {issuing ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}{' '}
              {issuing ? 'Emitindo…' : 'Emitir orçamento'}
            </Button>
          )}
          {editing && (
            <>
              <Button variant="success" size="sm" disabled={saving} onClick={save}>
                <Save size={14} /> {saving ? 'Salvando…' : 'Salvar'}
              </Button>
              <Button variant="outline" size="sm" disabled={saving} onClick={() => (isDirty ? setConfirmDiscardEdits(true) : resetEditor())}>
                Cancelar
              </Button>
            </>
          )}
          {data.status_canonical !== 'rascunho' && (
            <>
              <Button variant="outline" size="sm" onClick={openIssuedDocument}>
                <FileText size={14} /> Visualizar
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEmailError('');
                  setEmailDialogOpen(true);
                }}
              >
                <Mail size={14} /> {emailSent ? 'Reenviar por e-mail' : 'Enviar por e-mail'}
              </Button>
              <div className="flex min-w-0 basis-full flex-wrap items-end gap-2 border-t border-line pt-3 sm:basis-auto sm:border-0 sm:pt-0">
                <label className="min-w-0 text-xs font-medium text-fg-muted">
                  <span className="mb-1 block">Fluxo de WhatsApp</span>
                  <select
                    aria-label="Fluxo de WhatsApp"
                    className="h-9 max-w-full rounded-sm border border-line bg-surface px-2 text-sm font-normal text-fg"
                    value={deliveryFlowId}
                    onChange={(event) => setDeliveryFlowId(event.target.value)}
                    disabled={deliveryPending}
                  >
                    {deliveryFlows.length === 0 && <option value="">Nenhum fluxo disponível</option>}
                    {deliveryFlows.map((flow) => <option key={flow.id} value={flow.id}>{flow.name}</option>)}
                  </select>
                </label>
                {deliveryFlows.length === 0 && (
                  <span role="status" className="text-xs text-fg-muted">
                    Não foi possível carregar os fluxos. Tente novamente mais tarde.
                  </span>
                )}
                <QuotationDeliveryStatus
                  delivery={delivery}
                  pending={deliveryPending}
                  onResolve={handleResolveDelivery}
                  className="basis-full"
                />
                {deliveryError && (
                  <span role="status" className="basis-full break-words text-xs text-warning">
                    {deliveryError}
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  title={
                    deliveryPending
                      ? 'Envio em andamento'
                      : delivery
                        ? 'Este orçamento já foi enviado pelo WhatsApp. Acompanhe o status ao lado.'
                        : deliveryError
                          ? 'Não foi possível verificar o envio. Tente novamente mais tarde.'
                          : !deliveryFlowId
                            ? 'Selecione um fluxo de WhatsApp para enviar.'
                            : (data.expirada || data.is_expired || data.derived_expired)
                            ? 'Orçamento vencido. Crie uma nova revisão para reenviar.'
                            : undefined
                  }
                  disabled={deliveryPending || Boolean(deliveryError) || !deliveryFlowId || Boolean(delivery) || Boolean(data.expirada || data.is_expired || data.derived_expired)}
                  onClick={sendIssuedQuotation}
                >
                  <Phone size={14} /> Enviar WhatsApp
                </Button>
                {delivery && !deliveryPending && (
                  <span className="text-xs text-fg-muted">Já enviado — acompanhe o status acima.</span>
                )}
                {(data.expirada || data.is_expired || data.derived_expired) && (
                  <span className="text-xs text-warning">Orçamento vencido. Crie uma nova revisão.</span>
                )}
              </div>
            </>
          )}
          {draftEditable && !editing && (
            <Button
              onClick={() => setConfirmDeleteOpen(true)}
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/10"
            >
              <Trash2 size={14} /> Excluir
            </Button>
          )}
          {emailSuccess && (
            <span role="status" aria-live="polite" className="text-xs text-fg-muted">
              {emailSuccess}
            </span>
          )}
          {message && (
            <span
              role="status"
              aria-live="polite"
              className={`basis-full break-words text-xs ${messageTone === 'error' ? 'text-destructive' : 'text-fg-muted'}`}
            >
              {message}
            </span>
          )}
          </div>
        </section>

        {(data.revision_history || []).length > 0 && (
          <section className="space-y-3 border-t border-line px-4 py-4 sm:px-6" aria-label="Histórico de revisões">
            <h2 className="text-base font-semibold">Histórico de revisões</h2>
            <Table className="min-w-[860px] text-sm">
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-9">Versão</TableHead>
                    <TableHead className="h-9">Criada em</TableHead>
                    <TableHead className="h-9">Validade</TableHead>
                    <TableHead className="h-9">Estado</TableHead>
                    <TableHead className="h-9">Modelo</TableHead>
                    <TableHead className="h-9">Versão do modelo</TableHead>
                    <TableHead className="h-9 text-right">Total</TableHead>
                    <TableHead className="h-9">PDF</TableHead>
                    <TableHead className="h-9" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.revision_history || []).map((entry) => {
                    const expired =
                      entry.derived_expired ||
                      entry.expiration_derived ||
                      entry.is_expired ||
                      entry.expirada;
                    const eligible = entry.status_canonical !== 'rascunho' && !draftEditable;
                    return (
                      <TableRow key={entry.revision_id || entry.id}>
                        <TableCell className="whitespace-nowrap py-2 font-medium">R{entry.revision_number}</TableCell>
                        <TableCell className="whitespace-nowrap py-2">{formatDate(entry.created_at || entry.createdAt) || '—'}</TableCell>
                        <TableCell className="whitespace-nowrap py-2">
                          {formatDate(entry.validity_date || entry.validade) || '—'}
                          {expired && <span className="block text-xs text-warning">Expirada</span>}
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            {...statusBadgeProps(entry.status)}
                          />
                        </TableCell>
                        <TableCell className="max-w-[180px] break-words py-2">{entry.template_key || '—'}</TableCell>
                        <TableCell className="whitespace-nowrap py-2">{entry.template_version ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap py-2 text-right font-mono">
                          {formatBRL(entry.total || entry.valor)}
                        </TableCell>
                        <TableCell>
                          {entry.status_canonical !== 'rascunho' ? (
                            <button
                              type="button"
                              className="text-primary hover:underline text-xs"
                              onClick={() => {
                                window.open(
                                  `/api/quotation-preview?id=${encodeURIComponent(entry.revision_id)}&format=pdf`,
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
                              onClick={() => createRevision(entry.revision_id)}
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
          </section>
        )}
        </fieldset>
      </div>
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
        title={`Emitir orçamento ${data.id}?`}
        message="Após a emissão este orçamento não poderá mais ser editado."
        confirmLabel="Emitir"
        cancelLabel="Cancelar"
        variant="default"
        onConfirm={runIssue}
        onCancel={() => setConfirmIssueOpen(false)}
      />
      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Excluir orçamento?"
        message={`Tem certeza que deseja excluir o orçamento ${data.id}? Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
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
              Informe por que o orçamento {data.id} foi perdido. O motivo fica registrado no
              histórico.
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
                  !lossReasonChoice ||
                  (lossReasonChoice === 'Outro' && !lossReasonDetail.trim())
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

  useEffect(() => {
    dataRef.current = null;
  }, [id]);

  const loadDetail = useCallback(async () => {
    const hasExistingDetail = dataRef.current?.id === id;
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

  useEffect(() => { void loadDetail(); }, [loadDetail]);

  if (loading && !data) return <SkeletonDetail />;
  if (error) {
    return (
      <div className="space-y-4 animate-fade-in">
        <button
          onClick={() => navigate('/quotations')}
          className="text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page"
        >
          ← Voltar para Orçamentos
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
          <Button variant="outline" onClick={() => void loadDetail()}>Tentar novamente</Button>
        </div>
      </div>
    );
  }
  if (!data) return null;
  return (
    <div className="space-y-3">
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
    </div>
  );
}
