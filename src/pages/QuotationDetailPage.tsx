import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ChangeEvent,
  type DragEvent,
  type MouseEvent,
} from 'react';
import {
  Pencil,
  FileText,
  Trash2,
  Save,
  X,
  Plus,
  GripVertical,
  AlertTriangle,
  ShoppingCart,
  Loader2,
  Copy,
  Search,
} from 'lucide-react';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { isCoreUnpricedProduct, searchProducts } from '@/lib/productCache';
import type { Product } from '@/types/domain';
import { formatBRL, formatDate } from '@/lib/formatters';
import { buildQuotationViewUrl } from '@/lib/printFormats';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import SkeletonDetail from '@/components/SkeletonDetail';
import {
  QuotationSectionsEditor,
  type QuotationSectionsSnapshot,
} from '@/components/quotation/QuotationSectionsEditor';
import type { QuotationSectionsSettings } from '@/lib/settingsApi';

const STATUS_LABELS: Record<string, string> = {
  Rascunho: 'Rascunho',
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

interface QuotationItem {
  _key: string;
  item_code: string;
  item_name: string;
  qty: number | string;
  quantidade?: number | string;
  rate: number | string;
  _rateManual?: boolean;
  sku?: string;
  nome?: string;
  descricao?: string;
  unidade?: string;
  suggested_unit_price?: string | number;
  preco_sugerido?: string | number;
  applied_unit_price?: string | number;
  preco_aplicado?: string | number;
  price_difference?: string | number;
  diferenca_preco?: string | number;
  line_total?: string | number;
  total_linha?: string | number;
  manual_rate?: boolean;
}

interface QuotationData {
  id: string;
  status: string;
  cliente?: string;
  data?: string;
  validade?: string;
  validity_date?: string;
  sales_order_id?: string;
  items?: QuotationItem[];
  core_mode?: boolean;
  source?: string;
  status_canonical?: string;
  quotation_id?: string;
  quotation_uuid?: string;
  quote_id?: string;
  revision_id?: string;
  quote_revision_id?: string;
  revision?: number;
  revision_number?: number;
  client_id?: string;
  cliente_id?: string;
  cliente_snapshot?: Record<string, unknown>;
  validade_dias?: number;
  pagamento?: string;
  entrega?: string;
  frete_padrao?: string | number;
  frete?: string | number;
  observacoes?: string;
  prazo_producao?: string;
  template_padrao?: string;
  template_key?: string;
  template_hash?: string;
  template_version_id?: string | null;
  template_version?: number | null;
  secoes?: QuotationSectionsSnapshot | null;
  sections_snapshot?: QuotationSectionsSnapshot | null;
  subtotal?: string | number;
  total?: string | number;
  valor?: string | number;
  updated_at?: string;
  updatedAt?: string;
  concurrency_token?: string;
  version_token?: string;
  revision_history?: QuotationRevisionHistoryEntry[];
  derived_expired?: boolean;
  expiration_derived?: boolean;
  is_expired?: boolean;
  expirada?: boolean;
}

interface QuotationRevisionHistoryEntry {
  id: string;
  revision_id: string;
  revision: number;
  revision_number: number;
  created_at: string;
  createdAt: string;
  validade_dias: number;
  validity_date: string;
  validade: string;
  subtotal: string | number;
  total: string | number;
  valor: string | number;
  status: string;
  status_canonical: string;
  derived_expired: boolean;
  expiration_derived: boolean;
  is_expired: boolean;
  expirada: boolean;
  template_key?: string | null;
  template_version?: number | null;
  template_hash?: string | null;
}

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

const DEFAULT_SECTIONS: QuotationSectionsSettings = {
  schema_version: 1,
  prazo_producao: { enabled: true, title: 'Prazo de produção' },
  pagamento: { enabled: true, title: 'Pagamento', body: '' },
  condicoes_gerais: { enabled: true, title: 'Condições Gerais', body: '' },
};

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
  if (existing) return cloneSections(existing);
  const current: QuotationSectionsSettings = {
    ...cloneSections(DEFAULT_SECTIONS),
    pagamento: { ...DEFAULT_SECTIONS.pagamento, body: data.pagamento || '' },
    condicoes_gerais: {
      ...DEFAULT_SECTIONS.condicoes_gerais,
      body: [data.entrega && `Prazo de entrega:\n${data.entrega}`, data.observacoes && `Observações:\n${data.observacoes}`]
        .filter(Boolean)
        .join('\n\n'),
    },
    prazo_producao: { ...DEFAULT_SECTIONS.prazo_producao, enabled: Boolean(data.prazo_producao) },
  };
  return {
    schema_version: 1,
    prazo_producao: { base: cloneSections(current.prazo_producao), current: cloneSections(current.prazo_producao) },
    pagamento: { base: cloneSections(current.pagamento), current: cloneSections(current.pagamento) },
    condicoes_gerais: { base: cloneSections(current.condicoes_gerais), current: cloneSections(current.condicoes_gerais) },
  };
}

function asCoreItems(items: QuotationItem[] | undefined): CoreQuotationItem[] {
  return (items || []).map((item) => ({
    ...item,
    _key: item._key || makeItemKey(),
    sku: String(item.sku || item.item_code || ''),
    item_code: String(item.item_code || item.sku || ''),
    item_name: String(item.item_name || item.nome || ''),
    nome: String(item.nome || item.item_name || ''),
    qty: String(item.qty ?? item.quantidade ?? '1'),
    suggested_unit_price: String(item.suggested_unit_price ?? item.preco_sugerido ?? '0.00'),
    applied_unit_price: String(
      item.applied_unit_price ?? item.preco_aplicado ?? item.rate ?? '0.00'
    ),
    price_difference: String(item.price_difference ?? item.diferenca_preco ?? '0.00'),
    line_total: String(item.line_total ?? item.total_linha ?? '0.00'),
    manual_rate: item.manual_rate === true || item._rateManual === true,
    rate: String(item.applied_unit_price ?? item.preco_aplicado ?? item.rate ?? '0.00'),
  }));
}

function CoreQuotationDetail({ data: initialData, navigate, onReload }: CoreQuotationDetailProps) {
  const [data, setData] = useState<QuotationData>(initialData);
  const draftEditable = data.status_canonical === 'rascunho';
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [lifecycleAction, setLifecycleAction] = useState<
    'aprovado' | 'perdido' | 'create_revision' | null
  >(null);
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState('');
  const [items, setItems] = useState<CoreQuotationItem[]>(() => asCoreItems(data.items));
  const [clientId, setClientId] = useState(data.client_id || data.cliente_id || '');
  const [clientSearch, setClientSearch] = useState(data.cliente || '');
  const [clientResults, setClientResults] = useState<CoreClientResult[]>([]);
  const [clientSearching, setClientSearching] = useState(false);
  const [validadeDias, setValidadeDias] = useState(String(data.validade_dias ?? ''));
  const [pagamento, setPagamento] = useState(data.pagamento || '');
  const [entrega, setEntrega] = useState(data.entrega || '');
  const [frete, setFrete] = useState(String(data.frete ?? '0.00'));
  const [observacoes, setObservacoes] = useState(data.observacoes || '');
  const [prazoProducao, setPrazoProducao] = useState(data.prazo_producao || '');
  const [sections, setSections] = useState<QuotationSectionsSnapshot>(() => normalizeSections(data));
  const [templates, setTemplates] = useState<QuotationTemplateMetadata[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState(data.template_version_id || '');
  const [selectedTemplate, setSelectedTemplate] = useState(
    data.template_key || data.template_padrao || 'padrao'
  );
  const [templateError, setTemplateError] = useState('');
  const [productTerms, setProductTerms] = useState<Record<string, string>>({});
  const [productResults, setProductResults] = useState<Record<string, Product[]>>({});
  const clientTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const productTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    setData(initialData);
    setItems(asCoreItems(initialData.items));
    setClientId(initialData.client_id || initialData.cliente_id || '');
    setClientSearch(initialData.cliente || '');
    setValidadeDias(String(initialData.validade_dias ?? ''));
    setPagamento(initialData.pagamento || '');
    setEntrega(initialData.entrega || '');
    setFrete(String(initialData.frete ?? '0.00'));
    setObservacoes(initialData.observacoes || '');
    setPrazoProducao(initialData.prazo_producao || '');
    setSections(normalizeSections(initialData));
    setSelectedTemplate(initialData.template_key || initialData.template_padrao || 'padrao');
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
    apiGet<{
      templates?: QuotationTemplateMetadata[];
      data?: QuotationTemplateMetadata[];
      default_key?: string;
    }>('/quotation-templates')
      .then((result) => {
        if (!active) return;
        const available = result.templates || result.data || [];
        const fallback =
          available.find((template) => template.key === result.default_key && !template.archived) ||
          available.find((template) => template.is_default && !template.archived) ||
          available.find((template) => !template.archived) ||
          available[0];
        const persisted = initialData.template_key || initialData.template_padrao || '';
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
  }, [initialData.id, initialData.status_canonical, initialData.template_key, initialData.template_padrao]);

  const searchClients = useCallback(async (term: string) => {
    if (term.trim().length < 2) {
      setClientResults([]);
      return;
    }
    setClientSearching(true);
    try {
      const response = await apiGet<{ data?: CoreClientResult[] }>(
        `/leads-clients?search=${encodeURIComponent(term)}&limit=10`
      );
      setClientResults(response.data || []);
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
      const results = await searchProducts(term, 6);
      setProductResults((previous) => ({ ...previous, [key]: results }));
    } catch {
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
      setClientId(authoritative.client_id || authoritative.cliente_id || '');
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
      setFrete(String(authoritative.frete ?? '0.00'));
      setObservacoes(authoritative.observacoes || '');
      setPrazoProducao(authoritative.prazo_producao || '');
      setSections(normalizeSections(authoritative));
      setSelectedTemplate(authoritative.template_key || authoritative.template_padrao || 'padrao');
      setSelectedVersionId(authoritative.template_version_id || '');
      setMessage('');
      setConflict('');
      setEditing(false);
    },
    [data]
  );

  const save = useCallback(async () => {
    if (!data.concurrency_token && !data.version_token && !data.updated_at) {
      setConflict('Token de concorrência ausente. Recarregue o orçamento antes de editar.');
      return;
    }
    setSaving(true);
    setMessage('Salvando…');
    setConflict('');
    try {
      const refreshed = await apiPut<QuotationData>(
        `/quotations?id=${encodeURIComponent(data.id)}`,
        {
          concurrency_token: data.concurrency_token || data.version_token || data.updated_at,
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
      if (refreshed && refreshed.id) {
        setData(refreshed);
        resetEditor(refreshed);
      }
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
  const displayedTotal =
    data.total ??
    data.valor ??
    displayItems.reduce(
      (sum, item) =>
        sum + Number(item.line_total || Number(item.qty) * Number(item.applied_unit_price)),
      0
    );
  const selectedTemplateMetadata = templates.find((template) => template.key === selectedTemplate);
  const visibleTemplates = templates.filter(
    (template) => !template.archived || template.key === selectedTemplate
  );
  const openPreview = useCallback(() => {
    const params = new URLSearchParams({ id: data.id });
    if (draftEditable && selectedVersionId) params.set('template_version_id', selectedVersionId);
    window.open(
      `/api/quotation-preview?${params.toString()}`,
      '_blank',
      'noopener,noreferrer'
    );
  }, [data.id, draftEditable, selectedVersionId]);
  const emitir = useCallback(async () => {
    if (!confirm(`Emitir orçamento ${data.id}? Após emissão não poderá ser editado.`)) return;
    const token = data.concurrency_token || data.version_token || data.updated_at;
    if (!token) {
      setConflict('Token de concorrência ausente. Recarregue o orçamento antes de emitir.');
      return;
    }
    setIssuing(true);
    setMessage('');
    setConflict('');
    try {
      await apiPost(`/quotations?id=${encodeURIComponent(data.id)}`, {
        action: 'set_status',
        status: 'enviado',
        concurrency_token: token,
      });
      setMessage('Orçamento emitido.');
      await onReload();
    } catch (error) {
      setMessage(`Erro ao emitir: ${(error as Error).message || 'Tente novamente.'}`);
    } finally {
      setIssuing(false);
    }
  }, [data.concurrency_token, data.id, data.updated_at, data.version_token, onReload]);

  const markCommercialStatus = useCallback(
    async (status: 'aprovado' | 'perdido') => {
      const token = data.concurrency_token || data.version_token || data.updated_at;
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
            concurrency_token: token,
          }
        );
        setData(refreshed);
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
    [data.concurrency_token, data.id, data.updated_at, data.version_token]
  );

  const createRevision = useCallback(
    async (sourceRevisionId: string) => {
      const token = data.concurrency_token || data.version_token || data.updated_at;
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
        setData(refreshed);
        resetEditor(refreshed);
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
    [data.concurrency_token, data.id, data.updated_at, data.version_token, resetEditor]
  );
  const openIssuedDocument = useCallback(() => {
    const params = new URLSearchParams({ id: data.id || '', format: 'pdf' });
    window.open(`/api/quotation-preview?${params.toString()}`, '_blank', 'noopener,noreferrer');
  }, [data.id]);

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
        {data.status_canonical === 'enviado' && !editing && (
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
                          <span className="text-[10px] font-medium text-fg-muted">
                            Nome exibido no orçamento
                          </span>
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
            <Button variant="outline" size="sm" onClick={openIssuedDocument}>
              <FileText size={14} /> Visualizar
            </Button>
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
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'edit'>('view'); // 'view' | 'edit'
  const [editedItems, setEditedItems] = useState<QuotationItem[]>([]);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<string>('');
  const [converting, setConverting] = useState<boolean>(false);
  const [convertStatus, setConvertStatus] = useState<string>('');

  // ── Product autocomplete ──
  const [productSearchTerms, setProductSearchTerms] = useState<Record<string, string>>({}); // { _key: searchText }
  const [productResults, setProductResults] = useState<Record<string, Product[]>>({}); // { _key: [...] }
  const [productSearching, setProductSearching] = useState<Record<string, boolean>>({}); // { _key: bool }
  const [activeField, setActiveField] = useState<{ key: string; field: 'sku' | 'name' } | null>(
    null
  ); // { key, field } or null
  const productTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pricingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({}); // { _key: timeoutId }

  // ── Load ──
  const loadDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiGet<QuotationData>(`/quotations?id=${encodeURIComponent(id)}`);
      if (!result || !result.id) throw new Error('Orçamento não encontrado.');
      setData(result);
      setEditedItems((result.items || []).map((item) => ({ ...item, _key: makeItemKey() })));
      setMode('view');
    } catch (err) {
      console.error('[detail]', err);
      setError((err instanceof Error ? err.message : null) || 'Erro ao carregar orçamento.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  // ── Computed ──
  const items = mode === 'edit' ? editedItems : data?.items || [];
  const total = items.reduce((s, item) => s + Number(item.qty || 0) * Number(item.rate || 0), 0);

  // ── Edit mode helpers (key-based) ──
  const updateItem = useCallback((_key: string, field: keyof QuotationItem, value: unknown) => {
    setEditedItems((prev) =>
      prev.map((item) =>
        item._key === _key
          ? {
              ...item,
              [field]: value,
              ...(field === 'rate' ? { _rateManual: true } : {}),
              ...(field === 'item_code' ? { _rateManual: undefined } : {}),
            }
          : item
      )
    );
  }, []);

  const removeItemByKey = useCallback(
    (_key: string) => {
      setEditedItems((prev) => prev.filter((item) => item._key !== _key));
      // Clean up product search state for removed item
      setProductSearchTerms((prev) => {
        const n = { ...prev };
        delete n[_key];
        return n;
      });
      setProductResults((prev) => {
        const n = { ...prev };
        delete n[_key];
        return n;
      });
      setProductSearching((prev) => {
        const n = { ...prev };
        delete n[_key];
        return n;
      });
      if (activeField?.key === _key) setActiveField(null);
      delete pricingTimers.current[_key];
    },
    [activeField]
  );

  const addItem = useCallback(() => {
    const _key = makeItemKey();
    setEditedItems((prev) => [...prev, { _key, item_code: '', item_name: '', qty: 1, rate: 0 }]);
    setProductSearchTerms((prev) => ({ ...prev, [_key]: '' }));
  }, []);

  // ── Product search (debounced, ref-based) ──
  const fetchProductOptions = useCallback(async (_key: string, term: string) => {
    if (!term || term.length < 2) {
      setProductResults((prev) => ({ ...prev, [_key]: [] }));
      return;
    }
    setProductSearching((prev) => ({ ...prev, [_key]: true }));
    try {
      const result = await searchProducts(term, 6);
      setProductResults((prev) => ({ ...prev, [_key]: result }));
    } catch {
      setProductResults((prev) => ({ ...prev, [_key]: [] }));
    } finally {
      setProductSearching((prev) => ({ ...prev, [_key]: false }));
    }
  }, []);

  const onSkuChange = useCallback(
    (_key: string, value: string) => {
      setProductSearchTerms((prev) => ({ ...prev, [_key]: value }));
      updateItem(_key, 'item_code', value);
      if (productTimer.current) clearTimeout(productTimer.current);
      productTimer.current = setTimeout(() => fetchProductOptions(_key, value), 300);
    },
    [updateItem, fetchProductOptions]
  );

  const onNameChange = useCallback(
    (_key: string, value: string) => {
      updateItem(_key, 'item_name', value);
      if (productTimer.current) clearTimeout(productTimer.current);
      productTimer.current = setTimeout(() => fetchProductOptions(_key, value), 300);
    },
    [updateItem, fetchProductOptions]
  );

  // ── Auto-pricing lookup (ref-based debounce, key-based) ──
  interface PricingLookupResponse {
    items?: Array<{
      rate?: number;
      item_name?: string;
    }>;
  }

  const lookupPrice = useCallback(async (_key: string, sku: string, qty: number) => {
    if (!sku || !qty) return;
    try {
      const result = await apiPost<PricingLookupResponse>('/pricing-lookup', {
        items: [{ item_code: sku, qty: Number(qty) }],
      });
      const priced = result?.items?.[0];
      if (priced?.rate !== undefined && priced?.rate !== null) {
        setEditedItems((prev) =>
          prev.map((item) => {
            if (item._key !== _key || item._rateManual) return item;
            return {
              ...item,
              rate: priced.rate ?? item.rate,
              item_name: priced.item_name || item.item_name,
            };
          })
        );
      }
    } catch (err) {
      console.warn('[detail] pricing lookup failed:', err instanceof Error ? err.message : err);
    }
  }, []);

  const schedulePricingLookup = useCallback(
    (_key: string, sku: string, qty: number) => {
      if (pricingTimers.current[_key]) clearTimeout(pricingTimers.current[_key]);
      pricingTimers.current[_key] = setTimeout(() => lookupPrice(_key, sku, qty), 400);
    },
    [lookupPrice]
  );

  const selectProduct = useCallback(
    (_key: string, product: Product) => {
      if (!product?.sku) return;
      if (isCoreUnpricedProduct(product)) {
        setSaveStatus('Preço indisponível para este produto.');
        setProductResults((prev) => ({ ...prev, [_key]: [] }));
        setActiveField(null);
        return;
      }
      updateItem(_key, 'item_code', product.sku);
      updateItem(_key, 'item_name', product.nome || product.item_name || '');
      setProductSearchTerms((prev) => ({ ...prev, [_key]: product.sku }));
      setProductResults((prev) => ({ ...prev, [_key]: [] }));
      setActiveField(null);
      // Auto-price after selecting
      setEditedItems((prev) => {
        const item = prev.find((it) => it._key === _key);
        if (!item) return prev;
        const qty = Number(item.qty || 1);
        schedulePricingLookup(_key, product.sku, qty);
        return prev;
      });
    },
    [updateItem, schedulePricingLookup]
  );

  // ── Save ──
  interface SavePayload {
    items: Array<Omit<QuotationItem, '_key'>>;
  }

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveStatus('Salvando…');
    try {
      // Strip _key before sending to API
      const payload: SavePayload = { items: editedItems.map(({ _key, ...item }) => item) };
      await apiPut(`/quotations?id=${encodeURIComponent(id)}`, payload);
      setSaveStatus('Salvo!');
      setTimeout(() => setSaveStatus(''), 2000);
      // Reload
      await loadDetail();
    } catch (err) {
      setSaveStatus('Erro ao salvar: ' + (err instanceof Error ? err.message : 'Tente novamente.'));
    } finally {
      setSaving(false);
    }
  }, [id, editedItems, loadDetail]);

  const handleCancel = useCallback(() => {
    setEditedItems((data?.items || []).map((item) => ({ ...item, _key: makeItemKey() })));
    // Reset autocomplete state
    setProductSearchTerms({});
    setProductResults({});
    setProductSearching({});
    setActiveField(null);
    pricingTimers.current = {};
    setMode('view');
  }, [data]);

  // ── Delete ──
  const handleDelete = useCallback(async () => {
    if (
      !confirm(
        `Tem certeza que deseja excluir o orçamento ${id}?\n\nEsta ação não pode ser desfeita.`
      )
    )
      return;
    try {
      await apiDelete(`/quotations?id=${encodeURIComponent(id)}`);
      navigate('/quotations');
    } catch (err) {
      alert('Erro ao excluir: ' + (err instanceof Error ? err.message : 'Tente novamente.'));
    }
  }, [id, navigate]);

  // ── Create Sales Order ──
  interface SalesOrderResponse {
    already_exists?: boolean;
    sales_order_id?: string;
  }

  const handleCreateSalesOrder = useCallback(async () => {
    if (!window.confirm(`Gerar e confirmar pedido de venda para o orçamento ${id}?`)) return;
    setConverting(true);
    setConvertStatus('Gerando pedido de venda…');
    try {
      const result = await apiPost<SalesOrderResponse>('/sales-order-from-quotation', {
        quotation_id: id,
      });
      setConvertStatus(
        result.already_exists ? 'Pedido já existia.' : 'Pedido de venda criado e confirmado.'
      );
      await loadDetail(); // refresh to show linked SO
      if (result.sales_order_id) navigate(`/sales-orders/${result.sales_order_id}`);
    } catch (err) {
      setConvertStatus(err instanceof Error ? err.message : 'Erro ao gerar pedido de venda.');
    } finally {
      setConverting(false);
    }
  }, [id, loadDetail, navigate]);

  // ── Duplicate ──
  const [duplicating, setDuplicating] = useState<boolean>(false);

  interface DuplicateResponse {
    success?: boolean;
    new_id?: string;
  }

  const handleDuplicate = useCallback(async () => {
    if (!confirm(`Duplicar o orçamento ${id}? Será criada uma cópia com nova numeração.`)) return;
    setDuplicating(true);
    try {
      const result = await apiPost<DuplicateResponse>('/duplicate-quotation', { quotation_id: id });
      if (result.success && result.new_id) {
        navigate(`/quotations/${result.new_id}`);
      }
    } catch (err) {
      alert('Erro ao duplicar: ' + (err instanceof Error ? err.message : 'Tente novamente.'));
    } finally {
      setDuplicating(false);
    }
  }, [id, navigate]);

  // ── Drag-and-drop reorder ──
  const handleDragStart = useCallback((e: DragEvent<HTMLTableCellElement>, _key: string) => {
    e.dataTransfer.setData('text/plain', _key);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: DragEvent<HTMLTableRowElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLTableRowElement>, targetKey: string) => {
    e.preventDefault();
    const sourceKey = e.dataTransfer.getData('text/plain');
    if (sourceKey === targetKey) return;
    setEditedItems((prev) => {
      const sourceIdx = prev.findIndex((it) => it._key === sourceKey);
      const targetIdx = prev.findIndex((it) => it._key === targetKey);
      if (sourceIdx === -1 || targetIdx === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(sourceIdx, 1);
      next.splice(targetIdx, 0, moved);
      return next;
    });
  }, []);

  // ── Loading / Error ──
  if (loading) {
    return <SkeletonDetail />;
  }

  if (error) {
    return (
      <div className="space-y-4 animate-fade-in">
        <button
          onClick={() => navigate('/quotations')}
          className="text-sm text-primary hover:underline"
        >
          ← Voltar para Orçamentos
        </button>
        <div className="flex flex-col items-center py-16 text-fg-muted gap-3">
          <AlertTriangle size={32} className="text-destructive/60" />
          <p>Erro ao carregar orçamento</p>
          <p className="text-sm">{error}</p>
          <Button variant="outline" onClick={loadDetail}>
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  if (data.core_mode === true || data.source === 'postgres') {
    return <CoreQuotationDetail data={data} navigate={navigate} onReload={loadDetail} />;
  }

  const quotationViewUrl = buildQuotationViewUrl(data.id);

  return (
    <div className="space-y-4 max-w-[1060px] mx-auto">
      {/* Detail card */}
      <div className="bg-surface rounded-lg border border-line shadow-sm">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-mono text-lg font-semibold">{data.id}</span>
            <StatusBadge status={data.status} label={STATUS_LABELS[data.status] || data.status} />
          </div>
          <div className="flex items-center gap-3">
            {data.sales_order_id ? (
              <>
                <span className="text-xs text-fg-muted">
                  Pedido criado: SAL-ORD-{data.sales_order_id}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/sales-orders/${data.sales_order_id}`)}
                >
                  Abrir Pedido
                </Button>
              </>
            ) : mode === 'view' ? (
              <>
                <Button onClick={handleCreateSalesOrder} disabled={converting} size="sm">
                  <ShoppingCart size={14} />
                  {converting ? 'Gerando pedido de venda…' : 'Gerar Pedido de Venda'}
                </Button>
                {convertStatus && (
                  <span
                    className={`text-xs ${convertStatus.startsWith('Erro') ? 'text-destructive/60' : 'text-fg-muted'}`}
                  >
                    {convertStatus}
                  </span>
                )}
              </>
            ) : null}
          </div>
        </div>

        {/* Meta */}
        <div className="px-6 py-4 border-b grid grid-cols-3 gap-6">
          <div>
            <span className="text-xs text-fg-muted">Cliente</span>
            <p className="font-medium">{data.cliente || '—'}</p>
          </div>
          <div>
            <span className="text-xs text-fg-muted">Data</span>
            <p>{formatDate(data.data)}</p>
          </div>
          <div>
            <span className="text-xs text-fg-muted">Validade</span>
            <p>{formatDate(data.validade)}</p>
          </div>
        </div>

        {/* Items table */}
        <div className="px-6 py-4">
          <div className="w-full overflow-visible">
            <table className="w-full caption-bottom text-sm">
              <TableHeader>
                <TableRow>
                  {mode === 'edit' && <TableHead className="w-8"></TableHead>}
                  <TableHead>SKU</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-center w-20">Qtd</TableHead>
                  <TableHead className="text-center">
                    {mode === 'edit' ? 'Preço Unit.' : 'Preço Unit.'}
                  </TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  {mode === 'edit' && <TableHead className="w-8"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const amount = Number(item.qty || 0) * Number(item.rate || 0);
                  const key = item._key;

                  if (mode === 'edit') {
                    const searchTerm = productSearchTerms[key] || '';
                    const results = productResults[key] || [];
                    const searching = productSearching[key] || false;
                    const showDropdown = activeField?.key === key && results.length > 0;
                    const searchSpinner = searching && (
                      <div className="absolute right-2 top-2">
                        <Loader2 size={12} className="animate-spin text-fg-muted" />
                      </div>
                    );
                    const productDropdown = showDropdown && (
                      <div className="absolute z-50 left-0 right-0 mt-1 bg-surface border border-line rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {results.map((p) => (
                          <button
                            key={p.sku || p.item_code}
                            type="button"
                            disabled={isCoreUnpricedProduct(p)}
                            title={
                              isCoreUnpricedProduct(p)
                                ? 'Preço indisponível para este produto.'
                                : undefined
                            }
                            className="w-full text-left px-3 py-2 text-sm hover:bg-primary/10 transition-colors flex items-center gap-2"
                            onMouseDown={(e: MouseEvent<HTMLButtonElement>) => {
                              e.preventDefault();
                              selectProduct(key, p);
                            }}
                          >
                            <span className="font-mono text-xs text-fg-muted">
                              {p.sku || p.item_code}
                            </span>
                            <span className="truncate">{p.nome || p.item_name}</span>
                            {isCoreUnpricedProduct(p) && (
                              <span className="ml-auto shrink-0 text-[10px] text-destructive">
                                Preço indisponível
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    );

                    return (
                      <TableRow
                        key={key}
                        onDragOver={handleDragOver}
                        onDrop={(e: DragEvent<HTMLTableRowElement>) => handleDrop(e, key)}
                      >
                        {/* Drag handle — only the grip icon is draggable, not the whole row */}
                        <TableCell
                          className="cursor-grab text-fg-muted p-2"
                          draggable
                          onDragStart={(e: DragEvent<HTMLTableCellElement>) =>
                            handleDragStart(e, key)
                          }
                        >
                          <GripVertical size={14} />
                        </TableCell>
                        {/* SKU with autocomplete */}
                        <TableCell className="relative">
                          <Input
                            className="h-8 text-sm font-mono"
                            placeholder="Buscar SKU ou nome…"
                            value={searchTerm || item.item_code || ''}
                            onFocus={() => setActiveField({ key, field: 'sku' })}
                            onBlur={() => setTimeout(() => setActiveField(null), 200)}
                            onChange={(e: ChangeEvent<HTMLInputElement>) =>
                              onSkuChange(key, e.target.value)
                            }
                          />
                          {searchSpinner}
                          {activeField?.field === 'sku' && productDropdown}
                        </TableCell>
                        {/* Name with autocomplete */}
                        <TableCell className="relative">
                          <Input
                            className="h-8 text-sm"
                            placeholder="Buscar produto…"
                            value={item.item_name || ''}
                            onFocus={() => setActiveField({ key, field: 'name' })}
                            onBlur={() => setTimeout(() => setActiveField(null), 200)}
                            onChange={(e: ChangeEvent<HTMLInputElement>) =>
                              onNameChange(key, e.target.value)
                            }
                          />
                          {activeField?.field === 'name' && productDropdown}
                        </TableCell>
                        {/* Qty */}
                        <TableCell className="text-center">
                          <Input
                            type="number"
                            min="1"
                            className="h-8 w-20 text-sm mx-auto"
                            value={item.qty || ''}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => {
                              const val = Number(e.target.value);
                              if (!isNaN(val)) {
                                updateItem(key, 'qty', val);
                                schedulePricingLookup(key, item.item_code, val);
                              }
                            }}
                          />
                        </TableCell>
                        {/* Rate */}
                        <TableCell className="text-center">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            className="h-8 w-28 text-sm mx-auto"
                            value={item.rate || ''}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val)) updateItem(key, 'rate', val);
                            }}
                          />
                        </TableCell>
                        {/* Amount (calculated) */}
                        <TableCell className="text-right font-mono">{formatBRL(amount)}</TableCell>
                        {/* Remove */}
                        <TableCell className="p-2">
                          <button
                            onClick={() => removeItemByKey(key)}
                            className="text-fg-muted hover:text-destructive transition-colors"
                            title="Remover"
                          >
                            <X size={16} />
                          </button>
                        </TableCell>
                      </TableRow>
                    );
                  }

                  // View mode
                  return (
                    <TableRow key={key}>
                      <TableCell className="font-mono text-sm">{item.item_code}</TableCell>
                      <TableCell>{item.item_name || item.item_code}</TableCell>
                      <TableCell className="text-center">{item.qty}</TableCell>
                      <TableCell className="text-center">{formatBRL(item.rate)}</TableCell>
                      <TableCell className="text-right font-mono">{formatBRL(amount)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </table>
          </div>
        </div>

        {/* Totals */}
        <div className="px-6 py-3 border-t text-right font-semibold">Total: {formatBRL(total)}</div>

        {/* Actions */}
        <div className="px-6 py-4 border-t flex items-center gap-3">
          {mode === 'view' && (
            <>
              <Button onClick={() => setMode('edit')} variant="outline" size="sm">
                <Pencil size={14} /> Editar
              </Button>
              <Button onClick={handleDuplicate} variant="outline" size="sm" disabled={duplicating}>
                <Copy size={14} /> {duplicating ? 'Duplicando…' : 'Duplicar'}
              </Button>
              <a
                href={quotationViewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-line bg-transparent px-3 text-xs font-medium transition-all duration-200 hover:bg-primary/5 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-page [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
              >
                <FileText size={14} /> Visualizar
              </a>
              <span className="text-xs text-fg-muted">Link público indisponível para esta cotação legada.</span>
              <div className="flex-1" />
              <Button
                onClick={handleDelete}
                variant="outline"
                size="sm"
                className="text-red-700 border-red-200 hover:bg-destructive/10 dark:text-destructive/60 dark:border-red-800/40 dark:hover:bg-destructive/100/10"
              >
                <Trash2 size={14} /> Excluir
              </Button>
            </>
          )}

          {mode === 'edit' && (
            <>
              <Button onClick={handleSave} disabled={saving} variant="success" size="sm">
                <Save size={14} /> Salvar
              </Button>
              <Button onClick={handleCancel} variant="outline" size="sm" disabled={saving}>
                <X size={14} /> Cancelar
              </Button>
              <Button onClick={addItem} variant="outline" size="sm">
                <Plus size={14} /> Item
              </Button>
              {saveStatus && (
                <span
                  className={`text-xs ${saveStatus.startsWith('Erro') ? 'text-destructive/60' : 'text-fg-muted'}`}
                >
                  {saveStatus}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
