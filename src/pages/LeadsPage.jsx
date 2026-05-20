import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Phone, Mail, AlertTriangle, Users, Pencil, Check, X } from 'lucide-react';
import { apiGet, apiPut } from '@/lib/api.js';
import { fmtPhone, capitalize } from '@/lib/formatters.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import PageHeader from '@/components/PageHeader.jsx';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table.jsx';
import SkeletonTable from '@/components/SkeletonTable.jsx';
import { DetailDrawer } from '@/components/DetailDrawer.jsx';
import { QualityBadges } from '@/components/QualityBadges.jsx';
import { ContextActions } from '@/components/ContextActions.jsx';
import { buildQuotationErpUrl, buildCrmDealErpUrl, buildLeadErpUrl, buildCustomerErpUrl } from '@/lib/erpLinks.js';

const TIPOS = ['', 'lead', 'cliente'];
const TIPO_DISPLAY = ['Todos', 'Leads', 'Clientes'];
const PAGE_SIZES = [10, 25, 50];

const CONTRIBUINTE_OPTS = [
  { value: '0', label: '0 - Não informado' },
  { value: '1', label: '1 - Contribuinte ICMS' },
  { value: '2', label: '2 - Contribuinte isento' },
  { value: '9', label: '9 - Não Contribuinte' },
];

const LEAD_SOURCES = ['Google Ads', 'Bríndice', 'Cliente recorrente'];

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

// ── CPF/CNPJ helpers ──

function formatCpf(value) {
  const d = value.replace(/\D/g, '').slice(0, 11);
  return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

function formatCnpj(value) {
  const d = value.replace(/\D/g, '').slice(0, 14);
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function isValidCpf(value) {
  const d = value.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (slice, factor) => {
    let sum = 0;
    for (let i = 0; i < slice.length; i++) sum += Number(slice[i]) * (factor - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(d.slice(0, 9), 10) === Number(d[9]) && calc(d.slice(0, 10), 11) === Number(d[10]);
}

function isValidCnpj(value) {
  const d = value.replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (slice, weights) => {
    let sum = 0;
    for (let i = 0; i < slice.length; i++) sum += Number(slice[i]) * weights[i];
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const w1 = [5,4,3,2,9,8,7,6,5,4,3,2];
  const w2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
  return calc(d.slice(0, 12), w1) === Number(d[12]) && calc(d.slice(0, 13), w2) === Number(d[13]);
}

function formatTaxId(value, personType) {
  const d = value.replace(/\D/g, '');
  if (personType === 'pf') return formatCpf(d);
  if (personType === 'pj') return formatCnpj(d);
  return value;
}

async function lookupCep(cep, setEditFields) {
  const digits = cep.replace(/\D/g, '');
  if (digits.length !== 8) return;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
    const data = await res.json();
    if (data.erro) return;
    setEditFields(prev => ({
      ...prev,
      endereco: {
        ...prev.endereco,
        endereco: data.logradouro || prev.endereco?.endereco || '',
        bairro: data.bairro || prev.endereco?.bairro || '',
        municipio: data.localidade || prev.endereco?.municipio || '',
        uf: data.uf || prev.endereco?.uf || '',
        // complemento NÃO é preenchido automaticamente — ViaCEP retorna dados pouco úteis ("até 183/184")
      },
    }));
  } catch { /* silencioso */ }
}

export default function LeadsPage() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [tipo, setTipo] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [totalPages, setTotalPages] = useState(0);
  const [totalRecords, setTotalRecords] = useState(0);
  const searchTimer = useRef(null);

  // ── Drawer state ──
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null); // { doctype, name, tipo }
  const [clientDetail, setClientDetail] = useState(null);
  const [clientLoading, setClientLoading] = useState(false);
  const [clientError, setClientError] = useState(null);
  const [clientSaving, setClientSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editFields, setEditFields] = useState({});

  const fetchData = useCallback(async (searchVal, tipoVal, pageNum, limitVal) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(pageNum));
      params.set('limit', String(limitVal));
      if (searchVal) params.set('search', searchVal);
      if (tipoVal) params.set('tipo', tipoVal);

      const result = await apiGet(`/leads-clients?${params.toString()}`);
      setData(result.data || []);
      setTotalPages(result.pagination?.total_pages || 0);
      setTotalRecords(result.pagination?.total || 0);
    } catch (err) {
      setError(err.message || 'Erro ao carregar leads e clientes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(search, tipo, page, limit); }, [fetchData, search, tipo, page, limit]);

  const onSearchChange = useCallback((e) => {
    const val = e.target.value;
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setPage(1);
      fetchData(val, tipo, 1, limit);
    }, 350);
  }, [tipo, limit, fetchData]);

  const onTipoClick = useCallback((t) => {
    setTipo(t);
    setPage(1);
    fetchData(search, t, 1, limit);
  }, [search, limit, fetchData]);

  const onLimitChange = useCallback((e) => {
    const newLimit = parseInt(e.target.value, 10);
    setLimit(newLimit);
    setPage(1);
    fetchData(search, tipo, 1, newLimit);
  }, [search, tipo, fetchData]);

  const getPageNumbers = () => {
    if (totalPages <= 1) return [];
    const start = Math.max(1, page - 3);
    const end = Math.min(totalPages, start + 6);
    const nums = [];
    for (let i = start; i <= end; i++) nums.push(i);
    return nums;
  };

  // ── Drawer handlers ──

  const openDrawer = useCallback(async (row) => {
    const doctype = row.tipo === 'lead' ? 'Lead' : 'Customer';
    setSelectedClient({ doctype, name: row.id, tipo: row.tipo });
    setClientDetail(null);
    setClientError(null);
    setClientLoading(true);
    setEditMode(false);
    setEditFields({});
    setDrawerOpen(true);

    try {
      const detail = await apiGet(`/client-detail?doctype=${encodeURIComponent(doctype)}&name=${encodeURIComponent(row.id)}`);
      setClientDetail(detail);
    } catch (err) {
      setClientError(err.message || 'Erro ao carregar detalhes.');
    } finally {
      setClientLoading(false);
    }
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setSelectedClient(null);
    setClientDetail(null);
    setClientError(null);
    setEditMode(false);
  }, []);

  const startEdit = useCallback(() => {
    if (!clientDetail) return;
    setEditFields({
      nome: clientDetail.display_name || '',
      email: clientDetail.email || '',
      telefone: clientDetail.telefone || '',
      origem: clientDetail.origem || '',
      personType: clientDetail.person_type || '',
      taxId: clientDetail.tax_id || '',
      empresa: clientDetail.empresa || '',
      contribuinte: clientDetail.contribuinte || '0',
      inscricaoEstadual: clientDetail.inscricao_estadual || '',
      endereco: {
        endereco: clientDetail.address?.endereco || '',
        numero: clientDetail.address?.numero || '',
        bairro: clientDetail.address?.bairro || '',
        complemento: clientDetail.address?.complemento || '',
        municipio: clientDetail.address?.municipio || '',
        uf: clientDetail.address?.uf || '',
        cep: clientDetail.address?.cep || '',
      },
    });
    setEditMode(true);
  }, [clientDetail]);

  const cancelEdit = useCallback(() => {
    setEditMode(false);
    setEditFields({});
  }, []);

  const saveEdit = useCallback(async () => {
    if (!selectedClient || !clientDetail) return;
    setClientSaving(true);
    setClientError(null);
    try {
      const payload = {
        nome: editFields.nome?.trim() || null,
        email: editFields.email?.trim() || null,
        telefone: editFields.telefone?.trim() || null,
      };
      // Origem apenas para Lead
      if (selectedClient.doctype === 'Lead') {
        payload.origem = editFields.origem?.trim() || null;
      }
      // Tipo de pessoa + CPF/CNPJ
      if (editFields.personType) {
        payload.person_type = editFields.personType;
        payload.tax_id = editFields.taxId?.replace(/\D/g, '') || null;
      }
      // Campos adicionais
      payload.empresa = editFields.empresa?.trim() || null;
      payload.contribuinte = editFields.contribuinte || '0';
      payload.inscricao_estadual = editFields.inscricaoEstadual?.trim() || null;
      // Origem (sempre envia, Lead ou Customer)
      payload.origem = editFields.origem?.trim() || null;
      // Endereço (sempre envia se tiver campos preenchidos)
      if (editFields.endereco) {
        payload.endereco = {
          endereco: editFields.endereco.endereco?.trim() || '',
          numero: editFields.endereco.numero?.trim() || '',
          bairro: editFields.endereco.bairro?.trim() || '',
          complemento: editFields.endereco.complemento?.trim() || '',
          municipio: editFields.endereco.municipio?.trim() || '',
          uf: editFields.endereco.uf?.trim() || '',
          cep: editFields.endereco.cep?.trim() || '',
        };
      }

      const updated = await apiPut(
        `/client-detail?doctype=${encodeURIComponent(selectedClient.doctype)}&name=${encodeURIComponent(selectedClient.name)}`,
        payload,
      );
      setClientDetail(updated);
      setEditMode(false);
      setEditFields({});

      // Atualiza a linha na lista local
      if (updated.display_name) {
        setData(prev => prev.map(row =>
          row.id === selectedClient.name ? { ...row, nome: updated.display_name, email: updated.email, telefone: updated.telefone } : row,
        ));
      }
    } catch (err) {
      setClientError(err.message || 'Erro ao salvar.');
    } finally {
      setClientSaving(false);
    }
  }, [selectedClient, clientDetail, editFields]);

  // ── Build context actions ──

  const buildContextActions = useCallback(() => {
    if (!clientDetail) return [];
    const actions = [];

    if (clientDetail.telefone) {
      actions.push({
        label: 'WhatsApp',
        icon: Phone,
        href: `https://wa.me/${clientDetail.telefone.replace(/\D/g, '')}`,
        title: 'Abrir WhatsApp',
      });
    }

    if (clientDetail.email) {
      actions.push({
        label: 'Email',
        icon: Mail,
        href: `mailto:${clientDetail.email}`,
        title: 'Enviar email',
      });
    }

    if (clientDetail.latest_quotation) {
      actions.push({
        label: 'Orçamento recente',
        icon: null,
        href: buildQuotationErpUrl(null, clientDetail.latest_quotation.name),
        title: `Abrir ${clientDetail.latest_quotation.name}`,
      });
    }

    if (clientDetail.deal) {
      actions.push({
        label: 'Deal vinculado',
        icon: null,
        href: buildCrmDealErpUrl(null, clientDetail.deal.name),
        title: `Abrir ${clientDetail.deal.name}`,
      });
    }

    return actions;
  }, [clientDetail]);

  // ── Build quality badges ──

  const buildQualityBadges = useCallback(() => {
    if (!clientDetail?.quality_flags) return [];

    const labelMap = {
      sem_telefone: { label: 'Sem telefone', type: 'warning' },
      sem_email: { label: 'Sem email', type: 'warning' },
      sem_origem: { label: 'Sem origem', type: 'danger' },
      sem_cnpj: { label: 'Sem CNPJ', type: 'info' },
      endereco_incompleto: { label: 'Sem endereço', type: 'warning' },
    };

    return clientDetail.quality_flags.map(flag => labelMap[flag] || { label: flag, type: 'warning' });
  }, [clientDetail]);

  // ── Components ──

  const TipoBadge = ({ tipo: t }) => (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium
      ${t === 'lead' ? 'bg-framer-accent-blue/10 text-framer-accent-blue' : 'bg-framer-success/10 text-framer-success'}
    `}>
      {t === 'lead' ? 'Lead' : t === 'cliente' ? 'Cliente' : t || '—'}
    </span>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Leads / Clientes"
        description={`${totalRecords} registro${totalRecords !== 1 ? 's' : ''}`}
      />

      {/* Tipo chips */}
      <div className="flex gap-2">
        {TIPOS.map((t, i) => (
          <button
            key={t}
            onClick={() => onTipoClick(t)}
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors
              ${tipo === t ? 'bg-framer-surface-2 text-framer-ink' : 'bg-framer-canvas text-framer-ink-muted hover:text-framer-ink hover:bg-framer-surface-1'}
            `}
          >
            {TIPO_DISPLAY[i]}
          </button>
        ))}
      </div>

      {/* Search + Page size */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-md flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome…"
            value={search}
            onChange={onSearchChange}
            className="pl-9"
            aria-label="Buscar leads e clientes"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Itens por página</span>
          <select
            value={limit}
            onChange={onLimitChange}
            className="border border-framer-hairline rounded-[10px] px-3 py-2 text-sm bg-framer-surface-1 text-framer-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
          >
            {PAGE_SIZES.map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Loading */}
      {loading && <SkeletonTable cols={5} rows={8} title="Carregando leads e clientes…" />}

      {/* Error */}
      {!loading && error && (
        <div className="flex flex-col items-center py-16 text-muted-foreground gap-3">
          <AlertTriangle size={32} className="text-red-400" />
          <p>Erro ao carregar leads e clientes</p>
          <p className="text-sm">{error}</p>
          <Button variant="outline" onClick={() => fetchData(search, tipo, page, limit)}>Tentar novamente</Button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && data.length === 0 && (
        <div className="flex flex-col items-center py-16 text-muted-foreground gap-3">
          <Users size={36} className="text-muted-foreground/40" />
          <p>Nenhum lead ou cliente encontrado</p>
          <p className="text-sm">Tente ajustar a busca ou os filtros.</p>
        </div>
      )}

      {/* ── Desktop Table ── */}
      {!loading && !error && data.length > 0 && (
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="w-[120px] text-center">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map(row => (
                <TableRow
                  key={row.id || row.email}
                  className="cursor-pointer hover:bg-framer-surface-2/50 transition-colors"
                  onClick={() => openDrawer(row)}
                >
                  <TableCell className="font-medium">{row.nome || '—'}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{row.email || '—'}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{fmtPhone(row.telefone)}</TableCell>
                  <TableCell><TipoBadge tipo={row.tipo} /></TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
                      {row.telefone && (
                        <a
                          href={`https://wa.me/${row.telefone.replace(/\D/g, '')}`}
                          target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded hover:bg-green-500/10 hover:text-green-600 transition-colors"
                          aria-label={`WhatsApp ${row.nome || row.email}`}
                          title={`WhatsApp ${row.nome || row.email}`}
                        >
                          <Phone size={18} />
                        </a>
                      )}
                      {row.email && (
                        <a
                          href={`mailto:${row.email}`}
                          className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded hover:bg-muted transition-colors"
                          aria-label={`Email ${row.nome || row.email}`}
                          title={`Email ${row.nome || row.email}`}
                        >
                          <Mail size={18} />
                        </a>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── Mobile Cards ── */}
      {!loading && !error && data.length > 0 && (
        <div className="md:hidden space-y-3">
          {data.map(row => (
            <div
              key={row.id || row.email}
              className="bg-card rounded-lg border border-border shadow-sm p-4 space-y-2 cursor-pointer hover:bg-framer-surface-2/50 transition-colors"
              onClick={() => openDrawer(row)}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{row.nome || '—'}</span>
                <TipoBadge tipo={row.tipo} />
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                {row.email && <div className="flex items-center gap-1"><Mail size={12} /> {row.email}</div>}
                {row.telefone && <div className="flex items-center gap-1"><Phone size={12} /> {fmtPhone(row.telefone)}</div>}
              </div>
              <div className="flex items-center gap-1 pt-1" onClick={e => e.stopPropagation()}>
                {row.telefone && (
                  <a
                    href={`https://wa.me/${row.telefone.replace(/\D/g, '')}`}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded hover:bg-green-500/10 hover:text-green-600 transition-colors"
                    aria-label={`WhatsApp ${row.nome || row.email}`}
                  >
                    <Phone size={18} />
                  </a>
                )}
                {row.email && (
                  <a
                    href={`mailto:${row.email}`}
                    className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded hover:bg-muted transition-colors"
                    aria-label={`Email ${row.nome || row.email}`}
                  >
                    <Mail size={18} />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Página {page} de {totalPages} · {totalRecords} registro{totalRecords !== 1 ? 's' : ''}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              ‹ Anterior
            </Button>
            {getPageNumbers().map(p => (
              <Button key={p} variant={p === page ? 'default' : 'outline'} size="sm" onClick={() => setPage(p)}>
                {p}
              </Button>
            ))}
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              Próximo ›
            </Button>
          </div>
        </div>
      )}

      {/* ── Detail Drawer ── */}
      <DetailDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        title={clientDetail?.display_name || 'Carregando…'}
        description={
          selectedClient
            ? `${selectedClient.doctype} · ${selectedClient.name}`
            : undefined
        }
        actions={
          clientDetail && (
            <div className="space-y-3">
              {/* Quality badges */}
              <QualityBadges badges={buildQualityBadges()} />

              {/* Context actions */}
              <ContextActions actions={buildContextActions()} />

              {/* Edit / Save buttons */}
              <div className="flex items-center gap-2 pt-1">
                {!editMode ? (
                  <Button variant="outline" size="sm" onClick={startEdit} disabled={clientLoading || clientSaving}>
                    <Pencil className="size-3.5" />
                    Editar
                  </Button>
                ) : (
                  <>
                    <Button variant="default" size="sm" onClick={saveEdit} disabled={clientSaving}>
                      <Check className="size-3.5" />
                      {clientSaving ? 'Salvando…' : 'Salvar'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={cancelEdit} disabled={clientSaving}>
                      <X className="size-3.5" />
                      Cancelar
                    </Button>
                  </>
                )}
                {/* Abrir no ERPNext */}
                {clientDetail.erp_url && (
                  <a
                    href={clientDetail.erp_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium bg-framer-surface-2 text-framer-ink hover:bg-framer-accent-blue hover:text-white active:scale-[0.97] transition-all duration-200 no-underline"
                  >
                    Abrir no ERPNext
                  </a>
                )}
              </div>
            </div>
          )
        }
      >
        {clientLoading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            Carregando detalhes…
          </div>
        )}

        {clientError && !clientLoading && (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-3">
            <AlertTriangle size={24} className="text-red-400" />
            <p className="text-sm">{clientError}</p>
            <Button variant="outline" size="sm" onClick={() => selectedClient && openDrawer({ id: selectedClient.name, tipo: selectedClient.tipo })}>
              Tentar novamente
            </Button>
          </div>
        )}

        {clientDetail && !clientLoading && (
          <div className="space-y-4">
            {/* Fields */}
            <div className="space-y-3 text-sm">
              {/* Linha 1: Nome (33%) + E-mail (33%) + Telefone (33%) */}
              <div className="flex gap-2">
                <div style={{ width: '33%' }}>
                  <span className="text-framer-ink-muted text-xs">Nome</span>
                  {editMode ? (
                    <Input
                      value={editFields.nome}
                      onChange={e => setEditFields(prev => ({ ...prev, nome: e.target.value }))}
                      className="mt-1 h-8 text-xs"
                      placeholder="Nome do cliente"
                    />
                  ) : (
                    <p className="mt-0.5 font-medium truncate">{clientDetail.display_name || '—'}</p>
                  )}
                </div>
                <div style={{ width: '33%' }}>
                  <span className="text-framer-ink-muted text-xs">E-mail</span>
                  {editMode ? (
                    <Input
                      value={editFields.email}
                      onChange={e => setEditFields(prev => ({ ...prev, email: e.target.value }))}
                      className="mt-1 h-8 text-xs"
                      placeholder="email@exemplo.com"
                    />
                  ) : (
                    <p className="mt-0.5 font-medium truncate">{clientDetail.email || '—'}</p>
                  )}
                </div>
                <div style={{ width: '33%' }}>
                  <span className="text-framer-ink-muted text-xs">Telefone</span>
                  {editMode ? (
                    <Input
                      value={editFields.telefone}
                      onChange={e => setEditFields(prev => ({ ...prev, telefone: e.target.value }))}
                      className="mt-1 h-8 text-xs"
                      placeholder="(99) 99999-9999"
                    />
                  ) : (
                    <p className="mt-0.5 font-medium">{fmtPhone(clientDetail.telefone) || '—'}</p>
                  )}
                </div>
              </div>

              {/* Linha 2: Tipo de Pessoa (33%) + CNPJ/CPF (33%) + Contribuinte (33%) */}
              <div className="flex gap-2">
                <div style={{ width: '33%' }}>
                  <span className="text-framer-ink-muted text-xs">Tipo de Pessoa</span>
                  {editMode ? (
                    <select
                      value={editFields.personType || ''}
                      onChange={e => setEditFields(prev => ({
                        ...prev,
                        personType: e.target.value,
                        taxId: '',
                      }))}
                      className="mt-1 h-8 w-full text-xs border border-framer-hairline rounded-[10px] px-2 bg-framer-surface-1 text-framer-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
                    >
                      <option value="">Selecione</option>
                      <option value="pf">Pessoa Física</option>
                      <option value="pj">Pessoa Jurídica</option>
                    </select>
                  ) : (
                    <p className="mt-0.5 font-medium">
                      {clientDetail.person_type === 'pf' ? 'Pessoa Física' : clientDetail.person_type === 'pj' ? 'Pessoa Jurídica' : '—'}
                    </p>
                  )}
                </div>
                <div style={{ width: '33%' }}>
                  <span className="text-framer-ink-muted text-xs">
                    {editFields.personType === 'pf' ? 'CPF' : editFields.personType === 'pj' ? 'CNPJ' : 'CPF/CNPJ'}
                  </span>
                  {editMode ? (
                    <Input
                      value={formatTaxId(editFields.taxId || '', editFields.personType)}
                      onChange={e => {
                        const raw = e.target.value.replace(/\D/g, '');
                        const maxLen = editFields.personType === 'pf' ? 11 : editFields.personType === 'pj' ? 14 : 14;
                        setEditFields(prev => ({ ...prev, taxId: raw.slice(0, maxLen) }));
                      }}
                      className={`mt-1 h-8 text-xs ${editFields.taxId && editFields.personType && (
                        (editFields.personType === 'pf' && editFields.taxId.length === 11 && !isValidCpf(editFields.taxId)) ||
                        (editFields.personType === 'pj' && editFields.taxId.length === 14 && !isValidCnpj(editFields.taxId))
                      ) ? 'border-red-400' : ''}`}
                      placeholder={editFields.personType === 'pf' ? '000.000.000-00' : editFields.personType === 'pj' ? '00.000.000/0000-00' : 'Selecione o tipo'}
                      disabled={!editFields.personType}
                    />
                  ) : (
                    <p className="mt-0.5 font-medium">
                      {(() => {
                        const tid = clientDetail.tax_id;
                        if (!tid) return '—';
                        if (tid.length === 11) return formatCpf(tid);
                        if (tid.length === 14) return formatCnpj(tid);
                        return tid;
                      })()}
                    </p>
                  )}
                </div>
                <div style={{ width: '33%' }}>
                  <span className="text-framer-ink-muted text-xs">Contribuinte</span>
                  {editMode ? (
                    <select
                      value={editFields.contribuinte || '0'}
                      onChange={e => setEditFields(prev => ({ ...prev, contribuinte: e.target.value }))}
                      className="mt-1 h-8 w-full text-xs border border-framer-hairline rounded-[10px] px-2 bg-framer-surface-1 text-framer-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
                    >
                      {CONTRIBUINTE_OPTS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : (
                    <p className="mt-0.5 font-medium text-xs">
                      {CONTRIBUINTE_OPTS.find(o => o.value === clientDetail.contribuinte)?.label || '—'}
                    </p>
                  )}
                </div>
              </div>

              {/* Linha 3: Empresa (33%) + Inscrição Estadual (33%) + Origem (33%) */}
              <div className="flex gap-2">
                <div style={{ width: '33%' }}>
                  <span className="text-framer-ink-muted text-xs">Empresa</span>
                  {editMode ? (
                    <Input
                      value={editFields.empresa || ''}
                      onChange={e => setEditFields(prev => ({ ...prev, empresa: e.target.value }))}
                      className="mt-1 h-8 text-xs"
                      placeholder="Nome da empresa"
                    />
                  ) : (
                    <p className="mt-0.5 font-medium truncate">{clientDetail.empresa || '—'}</p>
                  )}
                </div>
                <div style={{ width: '33%' }}>
                  <span className="text-framer-ink-muted text-xs">Inscrição Estadual</span>
                  {editMode ? (
                    <Input
                      value={editFields.inscricaoEstadual || ''}
                      onChange={e => setEditFields(prev => ({ ...prev, inscricaoEstadual: e.target.value }))}
                      className="mt-1 h-8 text-xs"
                      placeholder="IE"
                    />
                  ) : (
                    <p className="mt-0.5 font-medium">{clientDetail.inscricao_estadual || '—'}</p>
                  )}
                </div>
                <div style={{ width: '33%' }}>
                  <span className="text-framer-ink-muted text-xs">Origem</span>
                  {editMode ? (
                    <select
                      value={editFields.origem || ''}
                      onChange={e => setEditFields(prev => ({ ...prev, origem: e.target.value }))}
                      className="mt-1 h-8 w-full text-xs border border-framer-hairline rounded-[10px] px-2 bg-framer-surface-1 text-framer-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
                    >
                      <option value="">Selecione</option>
                      {LEAD_SOURCES.map(src => (
                        <option key={src} value={src}>{src}</option>
                      ))}
                    </select>
                  ) : (
                    <p className="mt-0.5 font-medium">{clientDetail.origem || '—'}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Orçamento recente */}
            {clientDetail.latest_quotation && (
              <div className="border-t border-framer-hairline pt-3">
                <span className="text-framer-ink-muted text-xs">Último orçamento</span>
                <div className="mt-1 flex items-center gap-2">
                  <a
                    href={buildQuotationErpUrl(null, clientDetail.latest_quotation.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-framer-accent-blue hover:underline"
                  >
                    {clientDetail.latest_quotation.name}
                  </a>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium
                    ${clientDetail.latest_quotation.status === 'Open' ? 'bg-framer-accent-blue/10 text-framer-accent-blue' : 'bg-framer-surface-2 text-framer-ink-muted'}
                  `}>
                    {clientDetail.latest_quotation.status}
                  </span>
                </div>
                {clientDetail.latest_quotation.grand_total != null && (
                  <p className="text-xs text-framer-ink-muted mt-0.5">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(clientDetail.latest_quotation.grand_total)}
                  </p>
                )}
              </div>
            )}

            {/* Deal vinculado */}
            {clientDetail.deal && (
              <div className="border-t border-framer-hairline pt-3">
                <span className="text-framer-ink-muted text-xs">Deal CRM</span>
                <div className="mt-1 flex items-center gap-2">
                  <a
                    href={buildCrmDealErpUrl(null, clientDetail.deal.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-framer-accent-blue hover:underline"
                  >
                    {clientDetail.deal.name}
                  </a>
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-framer-surface-2 text-framer-ink-muted">
                    {clientDetail.deal.status}
                  </span>
                </div>
                {clientDetail.deal.next_step && (
                  <p className="text-xs text-framer-ink-muted mt-0.5">{clientDetail.deal.next_step}</p>
                )}
              </div>
            )}

            {/* Endereço */}
            <div className="border-t border-framer-hairline pt-3">
              <span className="text-framer-ink-muted text-xs">
                Endereço {clientDetail.address?.complete ? '' : '(incompleto)'}
              </span>
              {editMode ? (
                <div className="mt-1 space-y-2 text-sm">
                  {/* Linha 1: CEP (30%) + Município (50%) + UF (20%) */}
                  <div className="flex gap-2">
                    <div className="relative" style={{ width: '30%' }}>
                      <Input
                        value={editFields.endereco?.cep || ''}
                        onChange={e => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 8);
                          setEditFields(prev => ({
                            ...prev,
                            endereco: { ...prev.endereco, cep: val },
                          }));
                          if (val.length === 8) lookupCep(val, setEditFields);
                        }}
                        className="h-8 text-xs pr-8"
                        placeholder="CEP"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const cep = editFields.endereco?.cep || '';
                          if (cep.replace(/\D/g, '').length === 8) lookupCep(cep, setEditFields);
                        }}
                        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-full text-framer-ink-muted hover:text-framer-accent-blue hover:bg-framer-surface-2 transition-colors"
                        title="Buscar CEP"
                      >
                        <Search size={14} />
                      </button>
                    </div>
                    <div style={{ width: '50%' }}>
                      <Input
                        value={editFields.endereco?.municipio || ''}
                        onChange={e => setEditFields(prev => ({
                          ...prev,
                          endereco: { ...prev.endereco, municipio: e.target.value },
                        }))}
                        className="h-8 text-xs"
                        placeholder="Município"
                      />
                    </div>
                    <div style={{ width: '20%' }}>
                      <select
                        value={editFields.endereco?.uf || ''}
                        onChange={e => setEditFields(prev => ({
                          ...prev,
                          endereco: { ...prev.endereco, uf: e.target.value },
                        }))}
                        className="h-8 w-full text-xs border border-framer-hairline rounded-[10px] px-2 bg-framer-surface-1 text-framer-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
                      >
                        <option value="">UF</option>
                        {UFS.map(uf => (
                          <option key={uf} value={uf}>{uf}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Linha 2: Endereço (80%) + Número (20%) */}
                  <div className="flex gap-2">
                    <div style={{ width: '80%' }}>
                      <Input
                        value={editFields.endereco?.endereco || ''}
                        onChange={e => setEditFields(prev => ({
                          ...prev,
                          endereco: { ...prev.endereco, endereco: e.target.value },
                        }))}
                        className="h-8 text-xs"
                        placeholder="Endereço"
                      />
                    </div>
                    <div style={{ width: '20%' }}>
                      <Input
                        value={editFields.endereco?.numero || ''}
                        onChange={e => setEditFields(prev => ({
                          ...prev,
                          endereco: { ...prev.endereco, numero: e.target.value },
                        }))}
                        className="h-8 text-xs"
                        placeholder="Número"
                      />
                    </div>
                  </div>

                  {/* Linha 3: Bairro (50%) + Complemento (50%) */}
                  <div className="flex gap-2">
                    <div style={{ width: '50%' }}>
                      <Input
                        value={editFields.endereco?.bairro || ''}
                        onChange={e => setEditFields(prev => ({
                          ...prev,
                          endereco: { ...prev.endereco, bairro: e.target.value },
                        }))}
                        className="h-8 text-xs"
                        placeholder="Bairro"
                      />
                    </div>
                    <div style={{ width: '50%' }}>
                      <Input
                        value={editFields.endereco?.complemento || ''}
                        onChange={e => setEditFields(prev => ({
                          ...prev,
                          endereco: { ...prev.endereco, complemento: e.target.value },
                        }))}
                        className="h-8 text-xs"
                        placeholder="Complemento"
                      />
                    </div>
                  </div>
                </div>
              ) : clientDetail.address ? (
                <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {clientDetail.address.cep && (
                    <div>
                      <span className="text-framer-ink-muted text-[10px]">CEP</span>
                      <p className="font-medium">{clientDetail.address.cep.replace(/^(\d{5})(\d{3})$/, '$1-$2')}</p>
                    </div>
                  )}
                  {clientDetail.address.municipio && (
                    <div>
                      <span className="text-framer-ink-muted text-[10px]">Município</span>
                      <p className="font-medium">{clientDetail.address.municipio}{clientDetail.address.uf ? `/${clientDetail.address.uf}` : ''}</p>
                    </div>
                  )}
                  {clientDetail.address.endereco && (
                    <div className="col-span-2">
                      <span className="text-framer-ink-muted text-[10px]">Endereço</span>
                      <p className="font-medium">{clientDetail.address.endereco}{clientDetail.address.numero ? `, ${clientDetail.address.numero}` : ''}</p>
                    </div>
                  )}
                  {clientDetail.address.bairro && (
                    <div>
                      <span className="text-framer-ink-muted text-[10px]">Bairro</span>
                      <p className="font-medium">{clientDetail.address.bairro}</p>
                    </div>
                  )}
                  {clientDetail.address.complemento && (
                    <div>
                      <span className="text-framer-ink-muted text-[10px]">Complemento</span>
                      <p className="font-medium">{clientDetail.address.complemento}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="mt-0.5 text-sm text-framer-ink-muted">Clique em Editar para cadastrar</p>
              )}
            </div>

            {/* Datas */}
            <div className="border-t border-framer-hairline pt-3 text-xs text-framer-ink-muted space-y-0.5">
              <p>Criado: {clientDetail.creation ? new Date(clientDetail.creation).toLocaleString('pt-BR') : '—'}</p>
              <p>Modificado: {clientDetail.modified ? new Date(clientDetail.modified).toLocaleString('pt-BR') : '—'}</p>
            </div>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}
