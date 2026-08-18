import {
  useState,
  useEffect,
  useCallback,
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
  Search,
} from 'lucide-react';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api/api';
import { issueQuotation } from '@/lib/api/quotationIssueApi';
import {
  fetchDeliveryStatus,
  fetchFlows,
  executeFlow,
  projectDeliveryFailure,
  projectDeliveryState,
  type CommunicationFlow,
  type DeliveryProjection,
} from '@/lib/api/communicationApi';
import { searchProducts } from '@/lib/api/productCache';
import type { Product } from '@/types/domain';
import { formatBRL, formatDate } from '@/lib/formatting/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import SkeletonDetail from '@/components/shared/SkeletonDetail';
import {
  QuotationSectionsEditor,
  type QuotationSectionsSnapshot,
} from '@/features/quotations/components/QuotationSectionsEditor';
import { projectClientRow, projectProduct, projectQuotationDetail, projectQuotationTemplate, type ProjectedQuotationData, type ProjectedQuotationItem } from '@/lib/localProjections';

const STATUS_LABELS: Record<string, string> = {
  Rascunho: 'Rascunho',
  Emitido: 'Emitido',
  Enviado: 'Enviado',
  Aprovado: 'Aprovado',
  Perdido: 'Perdido',
  Draft: 'Rascunho',
  Issued: 'Emitido',
  Open: 'Aberto',
  Replied: 'Respondido',
  Ordered: 'Convertido',
  Lost: 'Perdido',
  Expired: 'Expirado',
  Cancelled: 'Cancelado',
};

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
  const [saving, setSaving] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [deliverySending, setDeliverySending] = useState(false);
  const [deliveryState, setDeliveryState] = useState<DeliveryProjection | null>(null);
  const [deliveryFlows, setDeliveryFlows] = useState<CommunicationFlow[]>([]);
  const [deliveryFlowId, setDeliveryFlowId] = useState('');
  const [lifecycleAction, setLifecycleAction] = useState<
    'aprovado' | 'perdido' | 'create_revision' | null
  >(null);
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState('');
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
    setMessage('');
    setEditing(false);
    setConflict('');
  }, [initialData]);

  useEffect(() => {
    let active = true;
    fetchFlows().then(async (result) => {
      if (!active) return;
      const flows = result.flows || [];
      setDeliveryFlows(flows);
      const preferred = flows.find((flow) => flow.context === 'already_talking');
      const flowId = preferred?.id || result.selectedFlowId || flows[0]?.id || '';
      setDeliveryFlowId(flowId);
      if (!flowId || !initialData.quotation_uuid || !initialData.revision_id || initialData.status_canonical === 'rascunho') return;
      const status = await fetchDeliveryStatus({
        quotationId: initialData.quotation_uuid,
        revisionId: initialData.revision_id,
        flowId,
      });
      if (active) setDeliveryState(status ? projectDeliveryState(status) : null);
    }).catch(() => {
      if (active) {
        setDeliveryFlows([]);
        if (initialData.revision_id && initialData.status_canonical !== 'rascunho') {
          setDeliveryState(projectDeliveryFailure(new Error('status unavailable')));
        }
      }
    });
    return () => { active = false; };
  }, [initialData.id, initialData.quotation_id, initialData.quotation_uuid, initialData.revision_id, initialData.status_canonical]);

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
      .catch((error) => {
        if (active)
          setTemplateError(
            error instanceof Error ? error.message : 'Não foi possível carregar os templates.'
          );
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
    setItems((previous) =>
      previous.map((item) => (item._key === key ? { ...item, ...patch } : item))
    );
  }, []);

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
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível buscar produtos.');
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

  const selectProduct = useCallback(
    (key: string, product: Product) => {
      const sku = String(product.sku || product.item_code || '');
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
      setProductTerms((previous) => ({ ...previous, [key]: sku }));
      setProductResults((previous) => ({ ...previous, [key]: [] }));
    },
    [updateItem]
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
    setItems((previous) => previous.filter((item) => item._key !== key));
  }, []);

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
      setMessage('');
      setConflict('');
      setEditing(false);
    },
    [data]
  );

  const save = useCallback(async () => {
    const token = concurrencyTokenRef.current;
    if (!token) {
      setConflict('Token de concorrência ausente. Recarregue o orçamento antes de editar.');
      return;
    }
    setSaving(true);
    setMessage('Salvando…');
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
      setMessage('Salvo.');
      setEditing(false);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 409) {
        setConflict(
          (error as Error).message ||
            'O orçamento mudou ou não pode mais ser editado. Recarregue para conferir.'
        );
        setMessage('');
      } else {
        setMessage(`Erro ao salvar: ${(error as Error).message || 'Tente novamente.'}`);
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
    if (data.status_canonical !== 'rascunho') {
      setMessage('Somente rascunhos podem ser excluídos.');
      return;
    }
    if (
      !confirm(
        `Tem certeza que deseja excluir o orçamento ${data.id}?\n\nEsta ação não pode ser desfeita.`
      )
    )
      return;
    try {
      await apiDelete(`/quotations?id=${encodeURIComponent(data.id)}`);
      navigate('/quotations');
    } catch (err) {
      setMessage(`Erro ao excluir: ${err instanceof Error ? err.message : 'Tente novamente.'}`);
    }
  }, [data.id, navigate]);

  const displayItems = items;
  const displayedTotal = data.total;
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
  const emitir = useCallback(async () => {
    if (!confirm(`Emitir orçamento ${data.id}? Após emissão não poderá ser editado.`)) return;
    setIssuing(true);
    setMessage('');
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
      setMessage(`Orçamento ${issue.businessNumber} emitido.`);
      await onReload();
    } catch (error) {
      setMessage(`Erro ao emitir: ${(error as Error).message || 'Tente novamente.'}`);
    } finally {
      setIssuing(false);
    }
  }, [data.cliente, data.email, data.id, data.quotation_uuid, data.revision_id, entrega, frete, items, observacoes, onReload, pagamento, prazoProducao, sections, selectedTemplate, selectedVersionId, validadeDias]);

  const markCommercialStatus = useCallback(
    async (status: 'aprovado' | 'perdido') => {
      const lossReason = status === 'perdido'
        ? window.prompt('Informe o motivo da perda:')?.trim() || ''
        : undefined;
      if (status === 'perdido' && !lossReason) {
        setMessage('Informe um motivo para marcar o orçamento como perdido.');
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
      setMessage(status === 'aprovado' ? 'Marcando como aprovado…' : 'Marcando como perdido…');
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
        setMessage(
          status === 'aprovado' ? 'Orçamento aprovado.' : 'Orçamento marcado como perdido.'
        );
      } catch (error) {
        const responseStatus = (error as { status?: number }).status;
        if (responseStatus === 409) {
          setConflict(
            (error as Error).message ||
              'O orçamento mudou. Recarregue para conferir o estado atual.'
          );
          setMessage('');
        } else {
          setMessage(
            `Erro ao atualizar o estado: ${(error as Error).message || 'Tente novamente.'}`
          );
        }
      } finally {
        setLifecycleAction(null);
      }
    },
    [concurrencyTokenRef, data.id]
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
      setMessage('Criando nova revisão…');
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
        setMessage('Nova revisão criada em rascunho.');
      } catch (error) {
        const responseStatus = (error as { status?: number }).status;
        if (responseStatus === 409) {
          setConflict(
            (error as Error).message ||
              'A revisão mudou ou já existe um rascunho. Recarregue para conferir.'
          );
          setMessage('');
        } else {
          setMessage(`Erro ao criar revisão: ${(error as Error).message || 'Tente novamente.'}`);
        }
      } finally {
        setLifecycleAction(null);
      }
    },
    [concurrencyTokenRef, data.id, resetEditor]
  );
  const openIssuedDocument = useCallback(() => {
    const params = new URLSearchParams({ id: data.revision_id || data.id || '', format: 'pdf' });
    window.open(`/api/quotation-preview?${params.toString()}`, '_blank', 'noopener,noreferrer');
  }, [data.id, data.revision_id]);
  const sendIssuedQuotation = useCallback(async () => {
    if (!data.revision_id || !deliveryFlowId || deliveryState && !deliveryState.retryable) return;
    setDeliverySending(true);
    setDeliveryState(null);
    try {
      await executeFlow({
        quotation_id: data.quotation_id || data.id,
        quotation_uuid: data.quotation_uuid || null,
        revision_id: data.revision_id,
        flow_id: deliveryFlowId,
      });
      setDeliveryState({ kind: 'completed', label: 'Enviado', retryable: false });
    } catch (error) {
      setDeliveryState(projectDeliveryFailure(error));
    } finally {
      setDeliverySending(false);
    }
  }, [data.id, data.quotation_id, data.quotation_uuid, data.revision_id, deliveryFlowId, deliveryState]);

  return (
    <div className="space-y-4 max-w-[1060px] mx-auto">
      <div className="bg-surface rounded-lg border border-line shadow-sm">
        <div className="px-6 py-4 border-b flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="font-mono text-lg font-semibold">{data.id}</span>
            <StatusBadge status={data.status} label={STATUS_LABELS[data.status] || data.status} />
            {data.revision_number && (
              <span className="text-xs text-fg-muted">Revisão {data.revision_number}</span>
            )}
          </div>
          <button
            onClick={() => navigate('/quotations')}
            className="text-sm text-primary hover:underline"
          >
            ← Voltar
          </button>
        </div>

        {!draftEditable && (
          <div className="px-6 py-3 border-b bg-page text-sm text-fg-muted">
            Este orçamento não está em rascunho e não pode ser editado.
          </div>
        )}
        {conflict && (
          <div className="px-6 py-3 border-b bg-destructive/10 text-sm text-destructive flex items-center justify-between gap-3">
            <span>{conflict}</span>
            <Button variant="outline" size="sm" onClick={reloadAfterConflict}>
              Recarregar
            </Button>
          </div>
        )}

        <div className="px-6 py-4 border-b grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="relative">
            <span className="text-xs text-fg-muted">Cliente</span>
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
                  <div className="absolute z-40 left-0 right-0 mt-1 bg-surface border border-line rounded shadow-lg max-h-40 overflow-y-auto">
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
              <p className="font-medium mt-1">{data.cliente || '—'}</p>
            )}
          </div>
          <div>
            <span className="text-xs text-fg-muted">Data</span>
            <p>{formatDate(data.data)}</p>
          </div>
          <div>
            <span className="text-xs text-fg-muted">Validade</span>
            <p>
              {formatDate(data.validade)} ({data.validade_dias ?? '—'} dias)
            </p>
            {(data.derived_expired ||
              data.expiration_derived ||
              data.is_expired ||
              data.expirada) && (
              <span className="text-xs text-warning">Validade expirada (indicador derivado)</span>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-b grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="text-sm">
            <span className="text-xs text-fg-muted">Pagamento</span>
            {editing ? (
              <Input
                aria-label="Pagamento do orçamento"
                value={pagamento}
                onChange={(event) => setPagamento(event.target.value)}
              />
            ) : (
              <p>{pagamento || '—'}</p>
            )}
          </label>
          <label className="text-sm">
            <span className="text-xs text-fg-muted">Entrega</span>
            {editing ? (
              <Input
                aria-label="Entrega do orçamento"
                value={entrega}
                onChange={(event) => setEntrega(event.target.value)}
              />
            ) : (
              <p>{entrega || '—'}</p>
            )}
          </label>
          <label className="text-sm">
            <span className="text-xs text-fg-muted">Validade (dias)</span>
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
              <p>{data.validade_dias ?? '—'}</p>
            )}
          </label>
          <label className="text-sm">
            <span className="text-xs text-fg-muted">Frete</span>
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
              <p>{formatBRL(data.frete)}</p>
            )}
          </label>
          <label className="text-sm md:col-span-2">
            <span className="text-xs text-fg-muted">Prazo de produção</span>
            {editing ? (
              <Input
                aria-label="Prazo de produção do orçamento"
                value={prazoProducao}
                onChange={(event) => setPrazoProducao(event.target.value)}
              />
            ) : (
              <p>{prazoProducao || '—'}</p>
            )}
          </label>
          <label className="text-sm md:col-span-2">
            <span className="text-xs text-fg-muted">Observações</span>
            {editing ? (
              <textarea
                aria-label="Observações do orçamento"
                className="mt-1 w-full min-h-20 rounded border border-line bg-surface px-3 py-2 text-sm"
                value={observacoes}
                onChange={(event) => setObservacoes(event.target.value)}
              />
            ) : (
              <p className="whitespace-pre-wrap">{observacoes || '—'}</p>
            )}
          </label>
        </div>

        <div className="px-6 py-4 border-b space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Seções do orçamento</h2>
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
        </div>

        {(templates.length > 0 || templateError) && (
          <div className="px-6 py-4 border-b flex flex-wrap items-end gap-3">
            {templates.length > 0 && (
              <>
                <label className="text-sm min-w-64">
                  <span className="text-xs text-fg-muted">Modelo do orçamento</span>
                  <select
                    aria-label="Modelo do orçamento"
                    className="mt-1 h-9 w-full rounded border border-line bg-surface px-2 text-sm"
                    value={selectedTemplate}
                    disabled={!draftEditable}
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
            {templateError && <span className="text-xs text-destructive">{templateError}</span>}
          </div>
        )}
        {(data.status_canonical === 'emitido' || data.status_canonical === 'enviado') && !editing && (
          <div
            className="px-6 py-3 border-b flex flex-wrap items-center gap-2"
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
              onClick={() => markCommercialStatus('perdido')}
            >
              {lifecycleAction === 'perdido' && <Loader2 size={14} className="animate-spin" />}
              Marcar como perdido
            </Button>
          </div>
        )}

        <div className="px-6 py-4 overflow-x-auto">
          <table className="w-full text-sm">
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead className="text-center">Qtd</TableHead>
                <TableHead className="text-right">Sugerido</TableHead>
                <TableHead className="text-right">Aplicado</TableHead>
                <TableHead className="text-right">Diferença</TableHead>
                <TableHead className="text-right">Total</TableHead>
                {editing && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayItems.map((item) => {
                const results = productResults[item._key] || [];
                return (
                  <TableRow key={item._key}>
                    <TableCell className="relative font-mono">
                      {editing ? (
                        <>
                          <Input
                            value={productTerms[item._key] ?? item.sku}
                            onChange={(event) => onProductTerm(item._key, event.target.value)}
                            className="h-8 w-32"
                          />
                          {results.length > 0 && (
                            <div className="absolute z-40 left-0 top-9 w-64 bg-surface border border-line rounded shadow-lg">
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
                        item.sku
                      )}
                    </TableCell>
                    <TableCell>
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
                        item.nome || item.item_name || item.sku
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {editing ? (
                        <Input
                          className="h-8 w-20 mx-auto"
                          type="number"
                          min="1"
                          step="1"
                          value={Number(item.qty)}
                          onChange={(event) => updateItem(item._key, { qty: event.target.value })}
                        />
                      ) : (
                        Number(item.qty)
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatBRL(item.suggested_unit_price)}
                    </TableCell>
                    <TableCell className="text-right">
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
                      className={`text-right ${Number(item.price_difference) > 0 ? 'text-destructive' : ''}`}
                    >
                      {formatBRL(item.price_difference)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatBRL(
                        item.line_total || Number(item.qty) * Number(item.applied_unit_price)
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
          </table>
          {editing && (
            <Button variant="outline" size="sm" className="mt-3" onClick={addItem}>
              <Plus size={14} /> Item
            </Button>
          )}
        </div>

        <div className="px-6 py-3 border-t text-right font-semibold">
          Subtotal: {formatBRL(data.subtotal)} · Frete: {formatBRL(data.frete)} · Total:{' '}
          {formatBRL(displayedTotal)}
        </div>
        <div className="px-6 py-4 border-t flex items-center gap-3">
          {draftEditable && !editing && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setMessage('');
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
              onClick={emitir}
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
              <Button variant="outline" size="sm" disabled={saving} onClick={() => resetEditor()}>
                Cancelar
              </Button>
            </>
          )}
          {data.status_canonical !== 'rascunho' && (
            <>
              <Button variant="outline" size="sm" onClick={openIssuedDocument}>
                <FileText size={14} /> Visualizar
              </Button>
              <select
                aria-label="Fluxo de WhatsApp"
                className="h-8 rounded border border-line bg-surface px-2 text-xs"
                value={deliveryFlowId}
                onChange={(event) => setDeliveryFlowId(event.target.value)}
                disabled={deliverySending || Boolean(deliveryState && !deliveryState.retryable)}
              >
                {deliveryFlows.map((flow) => <option key={flow.id} value={flow.id}>{flow.name}</option>)}
              </select>
              <Button
                variant="outline"
                size="sm"
                disabled={deliverySending || Boolean(deliveryState && !deliveryState.retryable) || Boolean(data.expirada || data.is_expired || data.derived_expired)}
                onClick={sendIssuedQuotation}
              >
                <Phone size={14} /> {deliveryState?.kind === 'accepted' ? 'Envio aceito' : deliveryState?.kind === 'reconciling' ? 'Reconciliação necessária' : deliveryState?.kind === 'completed' ? 'Enviado pelo WhatsApp' : deliveryState?.kind === 'readonly' ? 'Somente leitura' : deliverySending ? 'Enviando…' : 'Enviar WhatsApp'}
              </Button>
              {(data.expirada || data.is_expired || data.derived_expired) && (
                <span className="text-xs text-warning">Orçamento vencido. Crie uma nova revisão.</span>
              )}
              {deliveryState && <span role="status" className="text-xs text-fg-muted">{deliveryState.label}</span>}
            </>
          )}
          {draftEditable && !editing && (
            <Button
              onClick={handleDelete}
              variant="outline"
              size="sm"
              className="text-destructive border-destructive/20 hover:bg-destructive/10"
            >
              <Trash2 size={14} /> Excluir
            </Button>
          )}
          {message && (
            <span
              role="status"
              aria-live="polite"
              className={`text-xs ${message.startsWith('Erro') ? 'text-destructive' : 'text-fg-muted'}`}
            >
              {message}
            </span>
          )}
        </div>

        {(data.revision_history || []).length > 0 && (
          <div className="px-6 py-4 border-t" aria-label="Histórico de revisões">
            <h2 className="text-sm font-semibold mb-3">Histórico de revisões</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <TableHeader>
                  <TableRow>
                    <TableHead>Versão</TableHead>
                    <TableHead>Criada em</TableHead>
                    <TableHead>Validade</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Modelo</TableHead>
                    <TableHead>Versão do modelo</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>PDF</TableHead>
                    <TableHead />
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
                        <TableCell className="font-medium">R{entry.revision_number}</TableCell>
                        <TableCell>{formatDate(entry.created_at || entry.createdAt)}</TableCell>
                        <TableCell>
                          {formatDate(entry.validity_date || entry.validade)}
                          {expired && <span className="block text-xs text-warning">Expirada</span>}
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            status={entry.status}
                            label={STATUS_LABELS[entry.status] || entry.status}
                          />
                        </TableCell>
                        <TableCell>{entry.template_key || '—'}</TableCell>
                        <TableCell>{entry.template_version ?? '—'}</TableCell>
                        <TableCell className="text-right font-mono">
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
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function QuotationDetailPage({ id, navigate }: QuotationDetailPageProps) {
  const [data, setData] = useState<QuotationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const concurrencyTokenRef = useRef('');

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    concurrencyTokenRef.current = '';
    try {
      const result = await apiGet<unknown>(`/quotations?id=${encodeURIComponent(id)}`);
      const projection = projectQuotationDetail(result);
      if (!projection) throw new Error('Resposta inválida ao carregar orçamento.');
      concurrencyTokenRef.current = projection.concurrencyToken;
      setData(projection.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar orçamento.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void loadDetail(); }, [loadDetail]);

  if (loading) return <SkeletonDetail />;
  if (error) {
    return (
      <div className="space-y-4 animate-fade-in">
        <button onClick={() => navigate('/quotations')} className="text-sm text-primary hover:underline">
          ← Voltar para Orçamentos
        </button>
        <div className="flex flex-col items-center py-16 text-fg-muted gap-3">
          <AlertTriangle size={32} className="text-destructive/60" />
          <p>Erro ao carregar orçamento</p>
          <p className="text-sm">{error}</p>
          <Button variant="outline" onClick={() => void loadDetail()}>Tentar novamente</Button>
        </div>
      </div>
    );
  }
  if (!data) return null;
  return <CoreQuotationDetail data={data} navigate={navigate} onReload={loadDetail} concurrencyTokenRef={concurrencyTokenRef} />;
}
