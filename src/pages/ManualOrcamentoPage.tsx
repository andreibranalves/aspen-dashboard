import {
  useState,
  useCallback,
  useRef,
  type ChangeEvent,
} from 'react';
import {
  AlertTriangle,
  Building2,
  Calculator,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Loader2,
  MapPin,
  MessageCircle,
  PackagePlus,
  Plus,
  RotateCcw,
  Search,
  ShoppingCart,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { searchProducts as cachedSearchProducts } from '@/lib/productCache';
import type { Product } from '@/types/domain';
import type { OrcamentoResponse } from '@/types/erpnext';
import { formatBRL, fmtPhone, capitalize, formatPhoneInput, normalizePhoneDigits } from '@/lib/formatters';
import { buildQuotationViewUrl } from '@/lib/printFormats';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

export default function ManualOrcamentoPage() {
  // ── Client state ──
  const [clientType, setClientType] = useState<string>(CLIENT_TYPE.NEW);
  const [clientSearch, setClientSearch] = useState<string>('');
  const [clientResults, setClientResults] = useState<Client[]>([]);
  const [clientSearching, setClientSearching] = useState<boolean>(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [newClient, setNewClient] = useState<NewClient>({ nome: '', email: '', telefone: '' });
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

  // ── Submit state ──
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [result, setResult] = useState<OrcamentoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Pricing helpers ──
  const lookupRate = useCallback(async (sku: string, qty: number, urgentValue = urgente): Promise<number> => {
    const res = await apiPost<PricingLookupResponse>('/pricing-lookup', {
      items: [{ item_code: sku, qty }],
      urgent: urgentValue,
    });
    const priced = res.items?.[0];
    return priced?.rate != null ? Number(priced.rate) : 0;
  }, [urgente]);

  const repriceAutoItems = useCallback(async (urgentValue: boolean) => {
    const autoItems = items.filter(item => !item._rateManual);
    if (autoItems.length === 0) return;

    setPricingRows(new Set(autoItems.map(item => item._key)));
    try {
      const pricedItems = await Promise.all(autoItems.map(async (item) => ({
        _key: item._key,
        rate: await lookupRate(item.sku, item.qty, urgentValue),
      })));
      const priceMap = new Map(pricedItems.map(item => [item._key, item.rate]));
      setItems(prev => prev.map(item => (
        priceMap.has(item._key) ? { ...item, rate: priceMap.get(item._key) ?? item.rate } : item
      )));
    } catch {
      // mantém os preços atuais se o ERP não responder
    } finally {
      setPricingRows(new Set());
    }
  }, [items, lookupRate]);

  // ── Client search ──
  const searchClients = useCallback(async (term: string) => {
    if (!term || term.length < 2) { setClientResults([]); return; }
    setClientSearching(true);
    try {
      const res = await apiGet<LeadsClientsResponse>(`/leads-clients?search=${encodeURIComponent(term)}&limit=10&tipo=todos`);
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
      setItems(prev => [
        ...prev,
        {
          _key: makeItemKey(product.sku),
          sku: product.sku,
          nome: product.nome || product.sku,
          qty: DEFAULT_QTY,
          rate: 0,
          _rateManual: false,
        },
      ]);
      setProductSearch('');
      setProductResults([]);
    } finally {
      setAddingSku(null);
    }
  }, [addingSku, lookupRate, urgente]);

  const updateItemQty = useCallback(async (_key: string, value: string | number) => {
    const qty = Math.max(1, toNumber(value, 1));
    const current = items.find(item => item._key === _key);
    if (!current) return;

    setItems(prev => prev.map(item => (item._key === _key ? { ...item, qty } : item)));
    if (current._rateManual) return;

    setPricingRows(prev => new Set(prev).add(_key));
    try {
      const rate = await lookupRate(current.sku, qty, urgente);
      setItems(prev => prev.map(item => (item._key === _key ? { ...item, rate } : item)));
    } catch {
      // mantém preço atual
    } finally {
      setPricingRows(prev => {
        const next = new Set(prev);
        next.delete(_key);
        return next;
      });
    }
  }, [items, lookupRate, urgente]);

  const updateItemRate = useCallback((_key: string, value: string | number) => {
    const rate = Math.max(0, toNumber(value, 0));
    setItems(prev => prev.map(item => (
      item._key === _key ? { ...item, rate, _rateManual: true } : item
    )));
  }, []);

  const resetItemRate = useCallback(async (_key: string) => {
    const current = items.find(item => item._key === _key);
    if (!current) return;
    setPricingRows(prev => new Set(prev).add(_key));
    try {
      const rate = await lookupRate(current.sku, current.qty, urgente);
      setItems(prev => prev.map(item => (
        item._key === _key ? { ...item, rate, _rateManual: false } : item
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
  }, [items, lookupRate, urgente]);

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

  const canSubmit = Boolean(getClientInfo().nome) && Boolean(leadSource) && isValidLeadSource(leadSource) && items.length > 0 && !submitting;

  // ── Submit ──
  const handleSubmit = useCallback(async () => {
    const { nome, email, telefone } = getClientInfo();
    if (!nome) { alert('Informe o nome do cliente.'); return; }
    if (!leadSource) { alert('Selecione a origem do lead antes de criar o orçamento.'); return; }
    if (!isValidLeadSource(leadSource)) { alert('Origem selecionada não é válida.'); return; }
    if (cnpj && !isValidCnpj(cnpj)) { alert('CNPJ informado é inválido. Corrija ou deixe em branco.'); return; }
    if (items.length === 0) { alert('Adicione ao menos um produto.'); return; }

    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const payload = {
        extracted: {
          nome,
          email: email || undefined,
          telefone: telefone || undefined,
          urgente,
          origem: leadSource || undefined,
          cnpj: cnpj || undefined,
          endereco: hasAnyAddressField(address) ? address : undefined,
          items: items.map(item => ({
            item_code: item.sku,
            qty: item.qty,
            rate: item.rate,
            manual_rate: true,
          })),
          prazo_producao: prazo || undefined,
          ...(observacoes.trim() ? { observacoes: observacoes.trim() } : {}),
        },
      };

      const res = await apiPost<OrcamentoResponse>('/orcamento', payload);
      setResult(res);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao criar orçamento.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [getClientInfo, items, urgente, prazo, observacoes, leadSource, cnpj, address]);

  // ── WhatsApp link builder ──
  const buildWaLink = useCallback((telefone: string, nome: string | undefined, quotationId: string | undefined, quotationLink: string): string | null => {
    if (!telefone) return null;
    const digits = telefone.replace(/\D/g, '').replace(/^55(\d{10,11})$/, '$1');
    if (digits.length < 10) return null;
    const linkLine = quotationLink ? `\n${quotationLink}` : '';
    const text = `Olá, ${nome || ''}! Segue seu orçamento ${quotationId}.${linkLine}\nQualquer dúvida estamos à disposição. Aspen Estamparia`;
    return `https://wa.me/55${digits}?text=${encodeURIComponent(text)}`;
  }, []);

  // ── Reset all ──
  const resetForm = useCallback(() => {
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
  }, []);

  // ── Render ──
  return (
    <div className="space-y-6 animate-fade-in max-w-[1060px] mx-auto">
      {/* ══ Success Result ══ */}
      {result && (
        <div className="bg-success/10 border border-success/30 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-success flex items-center justify-center">
              <Check size={18} className="text-white" />
            </div>
            <div>
              <p className="font-semibold text-success">Orçamento criado com sucesso</p>
              <p className="text-sm text-success/70">
                {capitalize(result.cliente)} · {result.quotation_id}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {result.quotation_id && (
              <a
                href={buildQuotationViewUrl(result.quotation_id)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-line rounded-full text-sm text-success hover:bg-surface-muted transition-colors"
              >
                <ExternalLink size={14} /> Visualizar PDF
              </a>
            )}
            {(() => {
              const info = getClientInfo();
              const quotationLink = result.quotation_id ? new URL(buildQuotationViewUrl(result.quotation_id), window.location.origin).toString() : '';
              const waLink = buildWaLink(info.telefone, result.cliente, result.quotation_id, quotationLink);
              return waLink ? (
                <a
                  href={waLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-success text-white rounded-full text-sm hover:bg-success/90 transition-colors"
                >
                  <MessageCircle size={14} /> WhatsApp
                </a>
              ) : null;
            })()}
          </div>

          <Button variant="outline" size="sm" onClick={resetForm}>
            Novo orçamento
          </Button>
        </div>
      )}

      {/* ══ Error ══ */}
      {error && !result && (
        <div className="bg-red-50 border border-red-200 dark:bg-red-500/10 dark:border-red-800/40 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle size={20} className="text-destructive shrink-0" />
          <div>
            <p className="font-medium text-destructive">Erro ao criar orçamento</p>
            <p className="text-sm text-destructive">{error}</p>
          </div>
        </div>
      )}

      {!result && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">
            <div className="space-y-5 min-w-0">
              {/* ══ 1. Cliente ══ */}
              <section aria-label="Seleção de cliente" className="bg-surface rounded-xl border border-line shadow-sm p-5 space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-card-foreground flex items-center gap-2">
                      <UserPlus size={18} /> 1. Cliente
                    </h2>
                    <p className="text-sm text-fg-muted mt-1">Use um cadastro existente ou crie o contato nesta venda.</p>
                  </div>

                  <div className="flex gap-1 bg-surface-muted rounded-lg p-0.5 w-fit">
                    <button
                      onClick={() => { setClientType(CLIENT_TYPE.NEW); setSelectedClient(null); setClientSearch(''); }}
                      className={cn(
                        'px-3 py-1.5 text-sm rounded-md transition-colors',
                        clientType === CLIENT_TYPE.NEW ? 'bg-surface-muted font-medium text-fg' : 'text-fg-muted hover:text-fg',
                      )}
                      aria-label="Cadastrar novo cliente"
                    >
                      Novo cliente
                    </button>
                    <button
                      onClick={() => { setClientType(CLIENT_TYPE.EXISTING); setNewClient({ nome: '', email: '', telefone: '' }); }}
                      className={cn(
                        'px-3 py-1.5 text-sm rounded-md transition-colors',
                        clientType === CLIENT_TYPE.EXISTING ? 'bg-surface-muted font-medium text-fg' : 'text-fg-muted hover:text-fg',
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
                      <div className="border border-line rounded-xl divide-y divide-border max-h-60 overflow-y-auto bg-surface">
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
                                {[client.email, client.telefone ? fmtPhone(client.telefone) : '', client.tipo === 'lead' ? 'Lead' : 'Cliente']
                                  .filter(Boolean).join(' · ')}
                              </p>
                            </div>
                            <span className={cn(
                              'text-[10px] px-2 py-1 rounded-full shrink-0',
                              client.tipo === 'lead' ? 'bg-primary/10 text-primary' : 'bg-success/10 text-success',
                            )}>
                              {client.tipo === 'lead' ? 'Lead' : 'Cliente'}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
                      <label className="text-xs text-fg-muted mb-1 block">Email</label>
                      <Input
                        type="email"
                        placeholder="email@exemplo.com"
                        value={newClient.email}
                        onChange={e => setNewClient(prev => ({ ...prev, email: e.target.value }))}
                        aria-label="Email do cliente"
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
                  <div className="flex flex-wrap items-center gap-2 text-sm bg-primary/5 border border-primary/20 text-fg rounded-xl px-3 py-2">
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
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-800/40 dark:bg-amber-500/10 dark:text-amber-300 flex items-start gap-2">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    CNPJ informado ({formatCnpj(cnpj)}) difere do CNPJ cadastrado ({formatCnpj(selectedClient.cnpj)}). O CNPJ do cadastro será mantido.
                  </div>
                )}

                {/* ── Origem (obrigatória, sempre visível) ── */}
                <div className="space-y-1 pt-3 border-t border-line">
                  <label className="text-xs font-medium text-fg-muted">Origem do lead *</label>
                  <select
                    className="w-full rounded-[12px] border border-line bg-surface px-3 py-2 text-sm text-fg"
                    value={leadSource}
                    onChange={e => setLeadSource(e.target.value)}
                  >
                    <option value="">Selecione a origem…</option>
                    {LEAD_SOURCES.map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>

                {/* ── CNPJ (opcional) ── */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted">CNPJ (opcional)</label>
                  <div className="relative">
                    <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
                    <Input
                      className="h-10 pl-9 text-sm font-mono"
                      value={cnpj ? formatCnpj(cnpj) : ''}
                      onChange={e => setCnpj(normalizeCnpj(e.target.value))}
                      placeholder="00.000.000/0000-00"
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
              <section aria-label="Itens do orçamento" className="bg-surface rounded-xl border border-line shadow-sm p-5 space-y-4">
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
                  <div className="border border-line rounded-xl overflow-hidden bg-surface divide-y divide-border max-h-72 overflow-y-auto">
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
                          disabled={Boolean(addingSku)}
                          className="w-full sm:w-auto"
                          aria-label={`Adicionar ${product.sku} ao orçamento`}
                        >
                          {addingSku === product.sku ? (
                            <Loader2 size={14} className="animate-spin mr-1.5" />
                          ) : (
                            <Plus size={14} className="mr-1.5" />
                          )}
                          Adicionar
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
                                    min="1"
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
                                    className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-md text-fg-muted hover:bg-destructive/100/10 hover:text-destructive transition-colors"
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
                          <div key={item._key} className="border border-line rounded-xl p-3 space-y-3 bg-surface">
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
                                className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-md text-fg-muted hover:bg-destructive/100/10 hover:text-destructive transition-colors"
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
                                  min="1"
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
                  <div className="rounded-xl border border-dashed border-line bg-surface-muted/20 overflow-hidden">
                    <div className="grid grid-cols-[1fr_88px_120px_120px] gap-3 border-b border-line bg-surface-muted/30 px-4 py-3 text-xs font-medium uppercase tracking-wide text-fg-muted max-md:hidden">
                      <span>Produto</span>
                      <span className="text-right">Qtd</span>
                      <span className="text-right">Unitário</span>
                      <span className="text-right">Total</span>
                    </div>
                    <div className="px-4 py-10 text-center text-fg-muted">
                      <ShoppingCart size={36} className="mx-auto text-fg-muted/40" />
                      <p className="mt-3 font-medium text-fg">Nenhum produto na tabela</p>
                      <p className="mt-1 text-sm">Pesquise acima e clique em Adicionar. Depois edite quantidade e preço direto nas colunas da linha.</p>
                    </div>
                  </div>
                )}
              </section>

              {/* ══ 3. Condições ══ */}
              <section aria-label="Condições do orçamento" className="bg-surface rounded-xl border border-line shadow-sm p-5 space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-card-foreground flex items-center gap-2">
                    <FileText size={18} /> 3. Condições e fechamento
                  </h2>
                  <p className="text-sm text-fg-muted mt-1">Defina prazo, urgência e observações antes de criar.</p>
                </div>

                {hasZeroPrice && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-500/10 dark:text-red-200 flex items-start gap-2">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    Existe item com preço R$ 0,00. Revise o preço unitário antes de criar o orçamento.
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
                  <div className="rounded-xl border border-line bg-surface px-3 py-2 flex items-center justify-between gap-3">
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
                    className="w-full min-h-[88px] rounded-[10px] border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 resize-y"
                    placeholder="Detalhes de arte, entrega, acabamentos ou condições comerciais…"
                    value={observacoes}
                    onChange={e => setObservacoes(e.target.value)}
                    aria-label="Observações do orçamento"
                  />
                </div>

                <div className="rounded-xl border border-line bg-surface-muted/20 px-3 py-2 text-sm text-fg-muted">
                  {canSubmit ? 'Revise o resumo ao lado e crie o orçamento.' : 'Informe cliente e ao menos um item para liberar a criação.'}
                </div>
              </section>
            </div>

            {/* ══ Side Summary ══ */}
            <aside className="xl:sticky xl:top-0 bg-surface rounded-xl border border-line shadow-sm p-5 space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-card-foreground">
                <Calculator size={17} /> Resumo
              </div>

              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-fg-muted">Cliente</span>
                  <span className="font-medium text-right truncate max-w-[180px]">
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
                  <span className="text-2xl font-bold tracking-tight">{formatBRL(subtotal)}</span>
                </div>
                <p className="text-xs text-fg-muted mt-2">
                  O valor enviado usa exatamente os preços visíveis na tabela.
                </p>
              </div>

              <div className="border-t border-line pt-4 space-y-2">
                <Button
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="min-h-[44px] w-full"
                  aria-label="Criar orçamento"
                >
                  {submitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin mr-2" />
                      Criando…
                    </>
                  ) : (
                    'Criar orçamento'
                  )}
                </Button>
                <Button variant="outline" onClick={resetForm} disabled={submitting} className="w-full">
                  Limpar tudo
                </Button>
                <p className="text-xs text-fg-muted text-center">
                  {canSubmit ? 'Pronto para criar no ERPNext.' : 'Cliente e itens são obrigatórios.'}
                </p>
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
