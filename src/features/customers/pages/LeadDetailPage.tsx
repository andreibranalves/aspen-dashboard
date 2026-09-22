import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Columns3,
  Edit3,
  FileText,
  Mail,
  MapPin,
  Phone,
  Save,
  ShoppingCart,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/lib/api/api';
import { createQuoteForClient } from '@/features/customers/quote-prefill';
import type { LeadCreateResponse } from '@/types/domain';
import { fmtPhone, formatBRL, formatDate, whatsappContactUrl } from '@/lib/formatting/formatters';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import SkeletonDetail from '@/components/shared/SkeletonDetail';
import { useToast } from '@/components/shared/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/ui/badge';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { QualityBadges, type QualityBadge } from '@/features/customers/components/QualityBadges';
import { readNewClientPrefill } from '@/features/customers/new-client-prefill';
import { ContextActions, type ContextAction } from '@/features/customers/components/ContextActions';
import { CustomerActionMenu } from '@/features/customers/components/CustomerActionMenu';
import { projectClientDetail, type ProjectedClientDetail } from '@/lib/localProjections';
import { useRouteGuardContext } from '@/hooks/useHashRoute';
import { useBreadcrumbLabel } from '@/components/layout/BreadcrumbLabelContext';

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
  empresa: string;
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

const EMPTY_FIELDS: EditFields = {
  nome: '',
  empresa: '',
  email: '',
  telefone: '',
  documento: '',
  observacoes: '',
  endereco: {},
};

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
  if (digits.length === 14)
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return value || '—';
}

function addressText(address?: Address | null): string {
  if (!address) return 'Endereço não cadastrado';
  const first = [address.endereco, address.numero].filter(Boolean).join(', ');
  const second = [address.bairro, address.complemento].filter(Boolean).join(' · ');
  const city = [address.municipio, address.uf].filter(Boolean).join('/');
  return (
    [first, second, city, address.cep].filter(Boolean).join(' · ') || 'Endereço não cadastrado'
  );
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
    empresa: detail.empresa || '',
    email: detail.email || '',
    telefone: detail.telefone || '',
    documento: detail.tax_id || detail.documento || '',
    observacoes: detail.notes ?? detail.observacoes ?? '',
    endereco: { ...(detail.address || {}) },
  };
}

function qualityBadges(detail: ClientDetail): QualityBadge[] {
  const labels: Record<string, QualityBadge> = {
    sem_telefone: { label: 'Sem telefone', type: 'warning' },
    sem_email: { label: 'Sem e-mail', type: 'warning' },
    sem_cnpj: { label: 'Sem documento', type: 'info' },
    endereco_incompleto: { label: 'Endereço incompleto', type: 'warning' },
  };
  return detail.quality_flags?.length
    ? detail.quality_flags.map((flag) => labels[flag] || { label: flag, type: 'warning' })
    : [];
}

interface SectionCardProps {
  title: string;
  description?: string;
  icon?: (props: { size?: number }) => ReactNode;
  children: ReactNode;
  className?: string;
}

function SectionCard({ title, description, icon: Icon, children, className }: SectionCardProps) {
  return (
    <section
      className={`space-y-4 rounded-card border border-line bg-surface p-5 md:p-6 ${className || ''}`}
      aria-labelledby={`section-${title}`}
    >
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="mt-0.5 rounded-control bg-surface-subtle p-2 text-fg-muted">
            <Icon size={16} aria-hidden="true" />
          </div>
        )}
        <div>
          <h2 id={`section-${title}`} className="text-sm font-semibold text-fg">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function InfoField({
  label,
  value,
  children,
  className,
}: {
  label: string;
  value?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className || ''}`}>
      <span className="text-[11px] uppercase tracking-wide text-fg-muted">{label}</span>
      {children || <p className="mt-1 break-words text-sm font-medium text-fg">{value || '—'}</p>}
    </div>
  );
}

function addressField(
  label: string,
  value: string,
  onChange: (value: string) => void,
  className?: string
) {
  return (
    <label className={`block text-xs text-fg-muted ${className || ''}`}>
      {label}
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export default function LeadDetailPage({ tipo: _tipo, id, navigate }: LeadDetailPageProps) {
  const decodedId = decodeURIComponent(id || '');
  const isNewClient = decodedId === 'new';
  const initialFields = useMemo<EditFields>(
    () =>
      isNewClient
        ? { ...EMPTY_FIELDS, ...readNewClientPrefill(window.location.hash) }
        : EMPTY_FIELDS,
    [isNewClient]
  );
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | 'not_found' | null>(null);
  const [editing, setEditing] = useState(isNewClient);
  const [fields, setFields] = useState<EditFields>(initialFields);
  const [saving, setSaving] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDiscardEdits, setConfirmDiscardEdits] = useState(false);
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);
  const { toast } = useToast();
  const { setNavigationGuard } = useRouteGuardContext();

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
      setFields(fieldsFromDetail(projected));
      setEditing(false);
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(
        status === 404 ? 'not_found' : 'Não foi possível carregar o cliente. Tente novamente.'
      );
    } finally {
      setLoading(false);
    }
  }, [decodedId, isNewClient]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const hasUnsavedChanges = useMemo(() => {
    if (!editing) return false;
    const baseline = detail ? fieldsFromDetail(detail) : initialFields;
    return JSON.stringify(fields) !== JSON.stringify(baseline);
  }, [detail, editing, fields, initialFields, saving]);

  useEffect(() => {
    if (!hasUnsavedChanges) {
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
  }, [hasUnsavedChanges, saving, setNavigationGuard]);

  const save = useCallback(async () => {
    if (!fields.nome.trim()) {
      toast('Nome é obrigatório.', 'error');
      return;
    }
    if (!isValidEmail(fields.email)) {
      toast('E-mail inválido.', 'error');
      return;
    }
    if (!isValidPhone(fields.telefone)) {
      toast('Telefone inválido.', 'error');
      return;
    }
    setSaving(true);
    const payload = {
      nome: fields.nome.trim(),
      empresa: fields.empresa.trim() || null,
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
        const currentRoute = window.location.hash.replace(/^#/, '').split('?')[0];
        if (currentRoute === '/leads/cliente/new') {
          setNavigationGuard(null);
          navigate(`/leads/cliente/${encodeURIComponent(createdId)}`);
        }
        return;
      }
      const updated = await apiPut<unknown>(
        `/client-detail?name=${encodeURIComponent(decodedId)}`,
        payload
      );
      const projected = projectClientDetail(updated);
      if (!projected) throw new Error('Resposta inválida ao salvar cliente.');
      setDetail(projected);
      setFields(fieldsFromDetail(projected));
      setEditing(false);
      toast('Cliente atualizado com sucesso.', 'success');
    } catch {
      toast('Não foi possível salvar o cliente. Tente novamente.', 'error');
    } finally {
      setSaving(false);
    }
  }, [decodedId, fields, isNewClient, navigate, setNavigationGuard, toast]);

  const archive = useCallback(async () => {
    if (!detail || isNewClient) return;
    const archived = detail.status === 'archived' || detail.arquivado === true;
    try {
      const response = archived
        ? await apiPatch<unknown>(`/client-detail?name=${encodeURIComponent(decodedId)}`, {
            arquivado: false,
          })
        : await apiDelete<unknown>(`/leads-clients?id=${encodeURIComponent(decodedId)}`);
      const projected = projectClientDetail(response);
      setDetail((current) => {
        const base = projected || current || detail;
        return {
          ...base,
          status: archived ? 'active' : 'archived',
          arquivado: !archived,
        };
      });
      setArchiveDialogOpen(false);
      toast(archived ? 'Cliente restaurado.' : 'Cliente arquivado.', 'success');
    } catch {
      setArchiveDialogOpen(false);
      toast('Não foi possível alterar o status. Tente novamente.', 'error');
    }
  }, [decodedId, detail, isNewClient, toast]);

  const deleteClient = useCallback(async () => {
    if (deleting || isNewClient) return;
    setDeleting(true);
    try {
      await apiDelete(`/client-detail?name=${encodeURIComponent(decodedId)}`);
      setNavigationGuard(null);
      toast('Cliente excluído.', 'success');
      navigate('/leads');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Não foi possível excluir o cliente.', 'error');
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  }, [decodedId, deleting, isNewClient, navigate, setNavigationGuard, toast]);

  const discardEditing = useCallback(() => {
    setConfirmDiscardEdits(false);
    if (isNewClient) {
      setNavigationGuard(null);
      navigate('/leads');
      return;
    }
    if (detail) setFields(fieldsFromDetail(detail));
    setEditing(false);
  }, [detail, isNewClient, navigate, setNavigationGuard]);

  const cancelEditing = useCallback(() => {
    if (hasUnsavedChanges) {
      setConfirmDiscardEdits(true);
      return;
    }
    discardEditing();
  }, [discardEditing, hasUnsavedChanges]);

  const breadcrumbLabel = !isNewClient ? detail?.display_name || detail?.nome || null : null;
  useBreadcrumbLabel(breadcrumbLabel);

  if (loading) return <SkeletonDetail />;
  if (error === 'not_found')
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-fg-muted">
        <UserRound size={40} className="text-fg-muted/40" aria-hidden="true" />
        <p className="text-lg font-medium">Registro não encontrado</p>
        <Button variant="outline" onClick={() => void loadDetail()}>
          Tentar novamente
        </Button>
      </div>
    );
  if (error)
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-fg-muted" role="alert">
        <AlertTriangle size={40} className="text-destructive" aria-hidden="true" />
        <p className="text-lg font-medium">Erro ao carregar cliente</p>
        <p className="text-sm">{error}</p>
        <Button variant="outline" onClick={() => void loadDetail()}>
          Tentar novamente
        </Button>
      </div>
    );

  const current: Partial<ClientDetail> = detail || {};
  const title = current.display_name || current.nome || 'Novo cliente';
  const archived = current.status === 'archived' || current.arquivado === true;
  const contextActions: ContextAction[] = [];
  if (current.telefone)
    contextActions.push({
      label: 'WhatsApp',
      icon: Phone,
      href: whatsappContactUrl(current.telefone),
      title: 'Abrir WhatsApp',
    });
  if (current.email)
    contextActions.push({
      label: 'E-mail',
      icon: Mail,
      href: `mailto:${current.email}`,
      title: 'Enviar e-mail',
    });

  const headerActions = editing ? (
    <>
      <Button size="sm" onClick={() => void save()} disabled={saving}>
        <Save size={14} />
        {saving ? 'Salvando…' : isNewClient ? 'Criar cliente' : 'Salvar'}
      </Button>
      <Button variant="outline" size="sm" onClick={cancelEditing} disabled={saving}>
        <X size={14} /> Cancelar
      </Button>
    </>
  ) : (
    <>
      <Button
        variant="outline"
        size="sm"
        className="px-2 sm:px-3"
        onClick={() => {
          if (detail) {
            setFields(fieldsFromDetail(detail));
            setEditing(true);
          }
        }}
      >
        <Edit3 size={14} /> Editar cadastro
      </Button>
      <Button
        size="sm"
        className="px-2 sm:px-3"
        onClick={() => createQuoteForClient(current, navigate)}
      >
        <Sparkles size={14} /> Novo orçamento
      </Button>
      <CustomerActionMenu
        archived={archived}
        customerName={title}
        onArchiveToggle={() => setArchiveDialogOpen(true)}
        onDelete={() => setDeleteDialogOpen(true)}
      />
    </>
  );

  return (
    <PageShell className="space-y-5">
      <fieldset disabled={saving} className="space-y-5">
        <PageHeader
          title={editing && !isNewClient ? 'Editar cliente' : title}
          description={
            editing && !isNewClient
              ? title
              : isNewClient
                ? undefined
                : current.modified
                  ? `Atualizado ${formatDate(current.modified)}`
                  : undefined
          }
          actions={confirmDiscardEdits || pendingRoute !== null ? undefined : headerActions}
        />

        {!isNewClient && !editing && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-subtle p-3">
            <StatusBadge status={archived ? 'Archived' : 'Active'} label={archived ? 'Arquivado' : 'Ativo'} />
            <span className="text-xs text-fg-muted">Cliente</span>
            {qualityBadges(current as ClientDetail).length > 0 && (
              <QualityBadges badges={qualityBadges(current as ClientDetail)} />
            )}
            {contextActions.length > 0 && <ContextActions actions={contextActions} />}
          </div>
        )}

        {editing ? (
          <div className="grid items-start gap-5 lg:grid-cols-2">
            <SectionCard title="Dados do cliente" icon={UserRound}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="text-xs text-fg-muted">
                  Nome
                  <Input
                    value={fields.nome}
                    onChange={(event) =>
                      setFields((value) => ({ ...value, nome: event.target.value }))
                    }
                    placeholder="Nome do cliente"
                  />
                </label>
                <label className="text-xs text-fg-muted">
                  Empresa
                  <Input
                    value={fields.empresa}
                    onChange={(event) =>
                      setFields((value) => ({ ...value, empresa: event.target.value }))
                    }
                    placeholder="Empresa"
                  />
                </label>
                <label className="text-xs text-fg-muted">
                  E-mail
                  <Input
                    type="email"
                    value={fields.email}
                    onChange={(event) =>
                      setFields((value) => ({ ...value, email: event.target.value }))
                    }
                    placeholder="email@exemplo.com"
                  />
                </label>
                <label className="text-xs text-fg-muted">
                  Telefone
                  <Input
                    value={fields.telefone}
                    onChange={(event) =>
                      setFields((value) => ({ ...value, telefone: event.target.value }))
                    }
                    placeholder="(99) 99999-9999"
                  />
                </label>
                <label className="text-xs text-fg-muted">
                  Documento
                  <Input
                    value={fields.documento}
                    onChange={(event) =>
                      setFields((value) => ({ ...value, documento: event.target.value }))
                    }
                    placeholder="CPF ou CNPJ"
                  />
                </label>
                <label className="text-xs text-fg-muted md:col-span-2">
                  Observações
                  <Textarea
                    aria-label="Observações"
                    value={fields.observacoes}
                    onChange={(event) =>
                      setFields((value) => ({ ...value, observacoes: event.target.value }))
                    }
                  />
                </label>
              </div>
            </SectionCard>
            <SectionCard title="Endereço" icon={MapPin}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {addressField(
                  'Endereço',
                  fields.endereco.endereco || '',
                  (value) =>
                    setFields((currentValue) => ({
                      ...currentValue,
                      endereco: { ...currentValue.endereco, endereco: value },
                    })),
                  'md:col-span-2'
                )}
                {addressField('Número', fields.endereco.numero || '', (value) =>
                  setFields((currentValue) => ({
                    ...currentValue,
                    endereco: { ...currentValue.endereco, numero: value },
                  }))
                )}
                {addressField('Bairro', fields.endereco.bairro || '', (value) =>
                  setFields((currentValue) => ({
                    ...currentValue,
                    endereco: { ...currentValue.endereco, bairro: value },
                  }))
                )}
                {addressField('Complemento', fields.endereco.complemento || '', (value) =>
                  setFields((currentValue) => ({
                    ...currentValue,
                    endereco: { ...currentValue.endereco, complemento: value },
                  }))
                )}
                {addressField('Município', fields.endereco.municipio || '', (value) =>
                  setFields((currentValue) => ({
                    ...currentValue,
                    endereco: { ...currentValue.endereco, municipio: value },
                  }))
                )}
                {addressField('UF', fields.endereco.uf || '', (value) =>
                  setFields((currentValue) => ({
                    ...currentValue,
                    endereco: { ...currentValue.endereco, uf: value },
                  }))
                )}
                {addressField('CEP', fields.endereco.cep || '', (value) =>
                  setFields((currentValue) => ({
                    ...currentValue,
                    endereco: { ...currentValue.endereco, cep: value },
                  }))
                )}
              </div>
            </SectionCard>
          </div>
        ) : (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <div className="space-y-5 lg:order-2">
              {current.latest_quotation && (
                <SectionCard title="Atividade recente" icon={FileText}>
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                      Orçamento recente
                    </p>
                    <p className="break-words font-medium">{current.latest_quotation.name}</p>
                    <p className="text-xs text-fg-muted">
                      {current.latest_quotation.status || '—'}
                      {current.latest_quotation.date
                        ? ` · ${formatDate(current.latest_quotation.date)}`
                        : ''}
                    </p>
                    {current.latest_quotation.grand_total != null && (
                      <p className="text-sm">{formatBRL(current.latest_quotation.grand_total)}</p>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        navigate(
                          `/quotations/${encodeURIComponent(current.latest_quotation!.name)}`
                        )
                      }
                    >
                      Abrir orçamento
                    </Button>
                  </div>
                </SectionCard>
              )}
              {current.deal && (
                <SectionCard title="Negócio ativo" icon={Columns3}>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <p className="break-words font-medium">{current.deal.name}</p>
                      {current.deal.status && (
                        <p className="text-xs text-fg-muted">{current.deal.status}</p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        navigate(`/crm?search=${encodeURIComponent(current.deal!.name)}`)
                      }
                    >
                      Abrir no CRM
                    </Button>
                  </div>
                </SectionCard>
              )}
              {current.orders && current.orders.length > 0 && (
                <SectionCard title="Pedidos recentes" icon={ShoppingCart}>
                  <div className="space-y-2">
                    {current.orders.map((order) => (
                      <div
                        key={order.name}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-subtle p-4"
                      >
                        <div className="min-w-0">
                          <p className="break-words font-medium">{order.name}</p>
                          <p className="text-xs text-fg-muted">
                            {order.status || '—'}
                            {order.date ? ` · ${formatDate(order.date)}` : ''}
                          </p>
                          {order.grand_total != null && (
                            <p className="mt-1 text-sm">{formatBRL(order.grand_total)}</p>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            navigate(`/sales-orders/${encodeURIComponent(order.name)}`)
                          }
                        >
                          Abrir pedido
                        </Button>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )}
            </div>
            <SectionCard title="Cadastro" icon={UserRound} className="lg:order-1">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <InfoField label="Empresa" value={current.empresa || 'Empresa não informada'} />
                <InfoField
                  label="Telefone"
                  value={fmtPhone(current.telefone) || 'Telefone não informado'}
                />
                <InfoField
                  label="E-mail"
                  value={current.email || 'E-mail não informado'}
                />
                <InfoField
                  label="Documento"
                  value={formatDocument(current.tax_id || current.documento)}
                />
                {current.address && (
                  <InfoField
                    label="Endereço"
                    value={addressText(current.address)}
                    className="md:col-span-2"
                  />
                )}
                {(current.notes || current.observacoes) && (
                  <InfoField
                    label="Observações"
                    value={current.notes ?? current.observacoes ?? ''}
                    className="md:col-span-2"
                  />
                )}
                {current.creation && (
                  <InfoField label="Criado em" value={formatDate(current.creation)} />
                )}
                {current.modified && (
                  <InfoField label="Modificado em" value={formatDate(current.modified)} />
                )}
              </div>
            </SectionCard>
          </div>
        )}
      </fieldset>
      <ConfirmDialog
        open={deleteDialogOpen}
        title="Excluir cliente?"
        message={`Excluir ${title} e seus negócios sem orçamento permanentemente? Orçamentos e pedidos vinculados precisam ser removidos ou transferidos primeiro.`}
        confirmLabel={deleting ? 'Excluindo…' : 'Excluir cliente'}
        onConfirm={() => { void deleteClient(); }}
        onCancel={() => { if (!deleting) setDeleteDialogOpen(false); }}
      />
      <ConfirmDialog
        open={archiveDialogOpen}
        title={archived ? 'Restaurar cliente' : 'Arquivar cliente'}
        message={`${archived ? 'Restaurar' : 'Arquivar'} o cliente ${title}?`}
        confirmLabel={archived ? 'Restaurar' : 'Arquivar'}
        cancelLabel="Cancelar"
        variant={archived ? 'default' : 'destructive'}
        onConfirm={() => {
          setArchiveDialogOpen(false);
          void archive();
        }}
        onCancel={() => setArchiveDialogOpen(false)}
      />
      <ConfirmDialog
        open={confirmDiscardEdits}
        title="Descartar alterações?"
        message="As alterações do cadastro do cliente que ainda não foram salvas serão perdidas."
        confirmLabel="Descartar"
        cancelLabel="Continuar editando"
        variant="destructive"
        onConfirm={discardEditing}
        onCancel={() => setConfirmDiscardEdits(false)}
      />
      <ConfirmDialog
        open={pendingRoute !== null}
        title="Sair sem salvar?"
        message="As alterações do cadastro do cliente que ainda não foram salvas serão perdidas."
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
