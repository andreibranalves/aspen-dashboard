import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { AlertTriangle, Archive, ArchiveRestore, Edit3, FileText, Mail, MapPin, Phone, Save, Sparkles, UserRound, X } from 'lucide-react';
import { apiGet, apiPut, apiPost, apiPatch, apiDelete } from '@/lib/api/api';
import type { LeadCreateResponse } from '@/types/domain';
import { fmtPhone, formatBRL, formatDate } from '@/lib/formatting/formatters';
import PageHeader from '@/components/shared/PageHeader';
import SkeletonDetail from '@/components/shared/SkeletonDetail';
import { useToast } from '@/components/shared/toast';
import { useSetTopBarActions } from '@/components/layout/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QualityBadges } from '@/features/customers/components/QualityBadges';
import { readNewClientPrefill } from '@/features/customers/new-client-prefill';
import { ContextActions, type ContextAction } from '@/features/customers/components/ContextActions';
import { projectClientDetail, type ProjectedClientDetail } from '@/lib/localProjections';

interface Address {
  endereco?: string;
  numero?: string;
  bairro?: string;
  complemento?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
}

type ClientDetail = ProjectedClientDetail;

interface EditFields {
  nome: string;
  email: string;
  telefone: string;
  documento: string;
  observacoes: string;
  endereco: Address;
}

interface LeadDetailPageProps {
  tipo: string;
  id: string;
  navigate: (hash: string) => void;
}

const EMPTY_FIELDS: EditFields = { nome: '', email: '', telefone: '', documento: '', observacoes: '', endereco: {} };

function isValidEmail(value: string): boolean {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isValidPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return !digits || (digits.length >= 10 && digits.length <= 15);
}

function formatDocument(value?: string | null): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (digits.length === 14) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return value || '—';
}

function addressText(address?: Address | null): string {
  if (!address) return 'Endereço não cadastrado';
  const first = [address.endereco, address.numero].filter(Boolean).join(', ');
  const second = [address.bairro, address.complemento].filter(Boolean).join(' · ');
  const city = [address.municipio, address.uf].filter(Boolean).join('/');
  return [first, second, city, address.cep].filter(Boolean).join(' · ') || 'Endereço não cadastrado';
}

function addressPayload(address: Address): Address {
  return {
    endereco: address.endereco?.trim() || '',
    numero: address.numero?.trim() || '',
    bairro: address.bairro?.trim() || '',
    complemento: address.complemento?.trim() || '',
    municipio: address.municipio?.trim() || '',
    uf: address.uf?.trim() || '',
    cep: address.cep?.trim() || '',
  };
}

function fieldsFromDetail(detail: ClientDetail): EditFields {
  return {
    nome: detail.display_name || detail.nome || '',
    email: detail.email || '',
    telefone: detail.telefone || '',
    documento: detail.tax_id || detail.documento || '',
    observacoes: detail.notes ?? detail.observacoes ?? '',
    endereco: { ...(detail.address || {}) },
  };
}

// Contexto para pré-preencher um orçamento no painel Auto (#/auto).
const QUOTE_PREFILL_KEY = 'aspen_quote_prefill';

function createQuoteForClient(
  client: { display_name?: string | null; nome?: string | null; email?: string | null; telefone?: string | null },
  navigate: (path: string) => void,
): void {
  const prefill: Record<string, string> = {};
  const nome = client.display_name || client.nome;
  if (nome) prefill.nome = nome;
  if (client.email) prefill.email = client.email;
  if (client.telefone) prefill.telefone = client.telefone;
  try {
    window.sessionStorage.setItem(QUOTE_PREFILL_KEY, JSON.stringify(prefill));
  } catch {
    /* sessionStorage indisponível */
  }
  navigate('/auto');
}

interface SectionCardProps {
  title: string;
  description?: string;
  icon?: (props: { size?: number }) => ReactNode;
  children: ReactNode;
}

function SectionCard({ title, description, icon: Icon, children }: SectionCardProps) {
  return <section className="bg-surface rounded-xl border border-line shadow-sm p-5 space-y-4"><div className="flex items-start gap-3">{Icon && <div className="mt-0.5 rounded-full bg-surface-muted p-2 text-fg-muted"><Icon size={16} /></div>}<div><h2 className="text-sm font-semibold text-fg">{title}</h2>{description && <p className="text-xs text-fg-muted mt-0.5">{description}</p>}</div></div>{children}</section>;
}

function InfoField({ label, value, children }: { label: string; value?: string; children?: ReactNode }) {
  return <div><span className="text-fg-muted text-[11px] uppercase tracking-wide">{label}</span>{children || <p className="mt-1 text-sm font-medium text-fg break-words">{value || '—'}</p>}</div>;
}

export default function LeadDetailPage({ tipo: _tipo, id, navigate }: LeadDetailPageProps) {
  const decodedId = decodeURIComponent(id || '');
  const isNewClient = decodedId === 'new';
  const initialFields: EditFields = isNewClient
    ? { ...EMPTY_FIELDS, ...readNewClientPrefill(window.location.hash) }
    : EMPTY_FIELDS;
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | 'not_found' | null>(null);
  const [editing, setEditing] = useState(isNewClient);
  const [fields, setFields] = useState<EditFields>(initialFields);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const setTopBarActions = useSetTopBarActions();

  const loadDetail = useCallback(async () => {
    if (!decodedId) return;
    setLoading(true);
    setError(null);
    try {
      if (isNewClient) {
        setDetail(null);
        setFields({ ...EMPTY_FIELDS, ...readNewClientPrefill(window.location.hash) });
        setEditing(true);
        return;
      }
      const result = await apiGet<unknown>(`/client-detail?name=${encodeURIComponent(decodedId)}`);
      const projected = projectClientDetail(result);
      if (!projected) throw new Error('Resposta inválida ao carregar cliente.');
      setDetail(projected);
      setFields(EMPTY_FIELDS);
      setEditing(false);
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(status === 404 ? 'not_found' : ((err as Error).message || 'Erro ao carregar cliente.'));
    } finally {
      setLoading(false);
    }
  }, [decodedId, isNewClient]);

  useEffect(() => { void loadDetail(); }, [loadDetail]);

  const save = useCallback(async () => {
    if (!fields.nome.trim()) { toast('Nome é obrigatório.', 'error'); return; }
    if (!isValidEmail(fields.email)) { toast('E-mail inválido.', 'error'); return; }
    if (!isValidPhone(fields.telefone)) { toast('Telefone inválido.', 'error'); return; }
    setSaving(true);
    const payload = {
      nome: fields.nome.trim(),
      email: fields.email.trim() || null,
      telefone: fields.telefone.trim() || null,
      documento: fields.documento.replace(/\D/g, '') || null,
      notes: fields.observacoes.trim() || null,
      endereco: addressPayload(fields.endereco),
    };
    try {
      if (isNewClient) {
        const created = await apiPost<LeadCreateResponse>('/leads-clients', payload);
        const createdId = String(created.created || created.id || created.name || '');
        if (!createdId) throw new Error('Cliente criado, mas não foi possível abrir o cadastro.');
        toast('Cliente criado com sucesso.', 'success');
        navigate(`/leads/cliente/${encodeURIComponent(createdId)}`);
        return;
      }
      const updated = await apiPut<unknown>(`/client-detail?name=${encodeURIComponent(decodedId)}`, payload);
      const projected = projectClientDetail(updated);
      if (!projected) throw new Error('Resposta inválida ao salvar cliente.');
      setDetail(projected);
      setEditing(false);
      setFields(EMPTY_FIELDS);
      toast('Cliente atualizado com sucesso.', 'success');
    } catch (err) {
      toast((err as Error).message || 'Erro ao salvar cliente.', 'error');
    } finally {
      setSaving(false);
    }
  }, [decodedId, fields, isNewClient, navigate, toast]);

  const archive = useCallback(async () => {
    if (!detail || isNewClient) return;
    const archived = detail.status === 'archived' || detail.arquivado === true;
    try {
      const updated = archived
        ? await apiPatch<unknown>(`/client-detail?name=${encodeURIComponent(decodedId)}`, { arquivado: false })
        : await apiDelete<unknown>(`/leads-clients?id=${encodeURIComponent(decodedId)}`);
      const projected = projectClientDetail(updated);
      if (!projected) throw new Error('Resposta inválida ao alterar status do cliente.');
      setDetail((current) => current ? {
        ...current,
        ...projected,
        status: archived ? 'active' : 'archived',
        arquivado: !archived,
      } : projected);
      toast(archived ? 'Cliente restaurado.' : 'Cliente arquivado.', 'success');
    } catch (err) {
      toast((err as Error).message || 'Não foi possível alterar o status.', 'error');
    }
  }, [decodedId, detail, isNewClient, toast]);

  useEffect(() => {
    if (!setTopBarActions) return undefined;
    if (loading || error || (isNewClient ? false : !detail)) {
      setTopBarActions(null);
      return () => setTopBarActions(null);
    }
    setTopBarActions(<div className="flex items-center gap-2">{editing ? <><Button size="sm" onClick={() => void save()} disabled={saving}><Save size={14} />{saving ? 'Salvando…' : isNewClient ? 'Criar cliente' : 'Salvar'}</Button><Button variant="outline" size="sm" onClick={() => { if (isNewClient) navigate('/leads'); else { setEditing(false); setFields(EMPTY_FIELDS); } }} disabled={saving}><X size={14} /> Cancelar</Button></> : <><Button size="sm" onClick={() => { if (detail) { setFields(fieldsFromDetail(detail)); setEditing(true); } }}><Edit3 size={14} /> Editar cadastro</Button><Button variant="outline" size="sm" onClick={() => void archive()}><ArchiveIcon archived={detail?.status === 'archived' || detail?.arquivado === true} /></Button></>}</div>);
    return () => setTopBarActions(null);
  }, [archive, detail, editing, error, fields, isNewClient, loading, navigate, save, saving, setTopBarActions]);

  if (loading) return <SkeletonDetail />;
  if (error === 'not_found') return <div className="flex flex-col items-center py-16 text-fg-muted gap-3"><UserRound size={40} className="text-fg-muted/40" /><p className="text-lg font-medium">Registro não encontrado</p><Button variant="outline" onClick={loadDetail}>Tentar novamente</Button></div>;
  if (error) return <div className="flex flex-col items-center py-16 text-fg-muted gap-3"><AlertTriangle size={40} className="text-destructive" /><p className="text-lg font-medium">Erro ao carregar cliente</p><p className="text-sm">{error}</p><Button variant="outline" onClick={loadDetail}>Tentar novamente</Button></div>;

  const current: Partial<ClientDetail> = detail || {};
  const title = current.display_name || current.nome || 'Novo cliente';
  const contextActions: ContextAction[] = [];
  if (current.telefone) contextActions.push({ label: 'WhatsApp', icon: Phone, href: `https://wa.me/${current.telefone.replace(/\D/g, '')}`, title: 'Abrir WhatsApp' });
  if (current.email) contextActions.push({ label: 'E-mail', icon: Mail, href: `mailto:${current.email}`, title: 'Enviar e-mail' });
  if (detail && !isNewClient) contextActions.push({ label: 'Criar orçamento', icon: Sparkles, onClick: () => createQuoteForClient(current, navigate), title: 'Criar orçamento com os dados deste cliente' });
  if (current.latest_quotation) contextActions.push({ label: 'Orçamento recente', icon: FileText, onClick: () => navigate(`/quotations/${encodeURIComponent(current.latest_quotation!.name)}`), title: `Abrir ${current.latest_quotation.name}` });

  return <div className="space-y-5 animate-fade-in max-w-[1060px] mx-auto">
    {isNewClient && <PageHeader title="Novo cliente" />}
    {!isNewClient && <section className="bg-surface rounded-xl border border-line shadow-sm p-5"><div className="flex items-start gap-4"><div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-xl font-semibold text-primary">{title.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'CL'}</div><div className="min-w-0 space-y-2"><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold text-fg truncate">{title}</h2><span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">{current.status === 'archived' || current.arquivado ? 'Arquivado' : 'Cliente'}</span></div><QualityBadges badges={current.quality_flags?.map((flag) => ({ label: flag, type: 'warning' as const })) || [{ label: 'Cadastro local', type: 'success' as const }]} />{contextActions.length > 0 && <ContextActions actions={contextActions} />}</div></div></section>}
    {editing ? <SectionCard title="Dados do cliente" description="Contato e identificação comercial." icon={UserRound}><div className="grid grid-cols-1 md:grid-cols-2 gap-4"><label className="text-xs text-fg-muted">Nome<Input value={fields.nome} onChange={(event) => setFields((value) => ({ ...value, nome: event.target.value }))} placeholder="Nome do cliente" /></label><label className="text-xs text-fg-muted">E-mail<Input type="email" value={fields.email} onChange={(event) => setFields((value) => ({ ...value, email: event.target.value }))} placeholder="email@exemplo.com" /></label><label className="text-xs text-fg-muted">Telefone<Input value={fields.telefone} onChange={(event) => setFields((value) => ({ ...value, telefone: event.target.value }))} placeholder="(99) 99999-9999" /></label><label className="text-xs text-fg-muted">Documento<Input value={fields.documento} onChange={(event) => setFields((value) => ({ ...value, documento: event.target.value }))} placeholder="CPF ou CNPJ" /></label><label className="text-xs text-fg-muted md:col-span-2">Observações<textarea aria-label="Observações" value={fields.observacoes} onChange={(event) => setFields((value) => ({ ...value, observacoes: event.target.value }))} className="mt-1 min-h-24 w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-sm" /></label></div></SectionCard> : <><SectionCard title="Dados gerais" description="Contato e identificação comercial." icon={UserRound}><div className="grid grid-cols-1 md:grid-cols-2 gap-4"><InfoField label="Nome" value={title} /><InfoField label="E-mail" value={current.email || ''} /><InfoField label="Telefone" value={fmtPhone(current.telefone) || ''} /><InfoField label="Documento" value={formatDocument(current.tax_id || current.documento)} /><InfoField label="Observações" value={current.notes ?? current.observacoes ?? ''} /><InfoField label="Criado / modificado" value={current.creation ? formatDate(current.creation) : ''} /></div></SectionCard><SectionCard title="Endereço" description={addressText(current.address)} icon={MapPin}><div className="grid grid-cols-1 md:grid-cols-2 gap-4"><InfoField label="Endereço" value={[current.address?.endereco, current.address?.numero].filter(Boolean).join(', ')} /><InfoField label="Município/UF" value={[current.address?.municipio, current.address?.uf].filter(Boolean).join('/')} /><InfoField label="Bairro" value={current.address?.bairro || ''} /><InfoField label="Complemento" value={current.address?.complemento || ''} /></div></SectionCard><SectionCard title="Atividade recente" description="Contexto comercial local." icon={FileText}>{current.latest_quotation ? <div className="space-y-2"><p className="font-medium">{current.latest_quotation.name}</p><p className="text-xs text-fg-muted">{current.latest_quotation.status || '—'}{current.latest_quotation.date ? ` · ${formatDate(current.latest_quotation.date)}` : ''}</p>{current.latest_quotation.grand_total != null && <p className="text-sm">{formatBRL(current.latest_quotation.grand_total)}</p>}<Button variant="outline" size="sm" onClick={() => navigate(`/quotations/${encodeURIComponent(current.latest_quotation!.name)}`)}>Abrir orçamento</Button></div> : <p className="text-sm text-fg-muted">Nenhum orçamento recente vinculado.</p>}</SectionCard></>}
  </div>;
}

function ArchiveIcon({ archived }: { archived: boolean }) {
  return <>{archived ? <><ArchiveRestore size={14} /> Restaurar cliente</> : <><Archive size={14} /> Arquivar cliente</>}</>;
}
