import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Edit3,
  FileText,
  Mail,
  MapPin,
  Phone,
  Save,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/lib/api/api';
import { createQuoteForClient } from '@/features/customers/quote-prefill';
import type { LeadCreateResponse } from '@/types/domain';
import { fmtPhone, formatBRL, formatDate } from '@/lib/formatting/formatters';
import PageHeader from '@/components/shared/PageHeader';
import PageShell from '@/components/shared/PageShell';
import SkeletonDetail from '@/components/shared/SkeletonDetail';
import { useToast } from '@/components/shared/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { QualityBadges, type QualityBadge } from '@/features/customers/components/QualityBadges';
import { readNewClientPrefill } from '@/features/customers/new-client-prefill';
import { ContextActions, type ContextAction } from '@/features/customers/components/ContextActions';
import { CustomerActionMenu } from '@/features/customers/components/CustomerActionMenu';
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

const EMPTY_FIELDS: EditFields = {
  nome: '',
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
}

function SectionCard({ title, description, icon: Icon, children }: SectionCardProps) {
  return (
    <section
      className="space-y-4 rounded-md border border-line bg-surface p-4 md:p-5"
      aria-labelledby={`section-${title}`}
    >
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="mt-0.5 rounded-sm bg-surface-muted p-2 text-fg-muted">
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
}: {
  label: string;
  value?: string;
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0">
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
  const initialFields: EditFields = isNewClient
    ? { ...EMPTY_FIELDS, ...readNewClientPrefill(window.location.hash) }
    : EMPTY_FIELDS;
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | 'not_found' | null>(null);
  const [editing, setEditing] = useState(isNewClient);
  const [fields, setFields] = useState<EditFields>(initialFields);
  const [saving, setSaving] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const { toast } = useToast();

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
  }, [decodedId, fields, isNewClient, navigate, toast]);

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

  const cancelEditing = useCallback(() => {
    if (isNewClient) {
      navigate('/leads');
      return;
    }
    if (detail) setFields(fieldsFromDetail(detail));
    setEditing(false);
  }, [detail, isNewClient, navigate]);

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
      href: `https://wa.me/${current.telefone.replace(/\D/g, '')}`,
      title: 'Abrir WhatsApp',
    });
  if (current.email)
    contextActions.push({
      label: 'E-mail',
      icon: Mail,
      href: `mailto:${current.email}`,
      title: 'Enviar e-mail',
    });
  if (detail && !isNewClient)
    contextActions.push({
      label: 'Criar orçamento',
      icon: Sparkles,
      onClick: () => createQuoteForClient(current, navigate),
      title: 'Criar orçamento com os dados deste cliente',
    });
  if (current.latest_quotation)
    contextActions.push({
      label: 'Orçamento recente',
      icon: FileText,
      onClick: () => navigate(`/quotations/${encodeURIComponent(current.latest_quotation!.name)}`),
      title: `Abrir ${current.latest_quotation.name}`,
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
        size="sm"
        onClick={() => {
          if (detail) {
            setFields(fieldsFromDetail(detail));
            setEditing(true);
          }
        }}
      >
        <Edit3 size={14} /> Editar cadastro
      </Button>
      <CustomerActionMenu
        archived={archived}
        customerName={title}
        onArchiveToggle={() => setArchiveDialogOpen(true)}
      />
    </>
  );

  return (
    <PageShell className="space-y-5">
      <PageHeader
        title={title}
        description={isNewClient ? undefined : 'Cadastro e contexto comercial do cliente.'}
        actions={headerActions}
      />

      {!isNewClient && (
        <section
          className="rounded-md border border-line bg-surface p-4 md:p-5"
          aria-labelledby="customer-identity"
        >
          <div className="flex items-start gap-4">
            <div
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-primary/10 text-lg font-semibold text-primary"
              aria-hidden="true"
            >
              {title
                .trim()
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => part[0]?.toUpperCase())
                .join('') || 'CL'}
            </div>
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="customer-identity" className="break-words text-lg font-semibold text-fg">
                  {title}
                </h2>
                <StatusBadge
                  status={archived ? 'Archived' : 'Active'}
                  label={archived ? 'Arquivado' : 'Ativo'}
                />
                <span className="text-xs text-fg-muted">Cliente</span>
              </div>
              {qualityBadges(current as ClientDetail).length > 0 && (
                <QualityBadges badges={qualityBadges(current as ClientDetail)} />
              )}
              {contextActions.length > 0 && <ContextActions actions={contextActions} />}
            </div>
          </div>
        </section>
      )}

      {editing ? (
        <>
          <SectionCard
            title="Dados do cliente"
            description="Contato e identificação comercial."
            icon={UserRound}
          >
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
                <textarea
                  aria-label="Observações"
                  value={fields.observacoes}
                  onChange={(event) =>
                    setFields((value) => ({ ...value, observacoes: event.target.value }))
                  }
                  className="mt-1 min-h-24 w-full rounded-sm border border-line bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </label>
            </div>
          </SectionCard>
          <SectionCard
            title="Endereço"
            description="Dados de entrega e localização, quando disponíveis."
            icon={MapPin}
          >
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
        </>
      ) : (
        <>
          <SectionCard
            title="Dados gerais"
            description="Contato e identificação comercial."
            icon={UserRound}
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <InfoField label="Nome" value={title} />
              <InfoField label="E-mail" value={current.email || 'E-mail não informado'} />
              <InfoField
                label="Telefone"
                value={fmtPhone(current.telefone) || 'Telefone não informado'}
              />
              <InfoField
                label="Documento"
                value={formatDocument(current.tax_id || current.documento)}
              />
              {(current.notes || current.observacoes) && (
                <InfoField label="Observações" value={current.notes ?? current.observacoes ?? ''} />
              )}
              {current.creation && (
                <InfoField label="Criado em" value={formatDate(current.creation)} />
              )}
              {current.modified && (
                <InfoField label="Modificado em" value={formatDate(current.modified)} />
              )}
            </div>
          </SectionCard>
          {current.address && (
            <SectionCard title="Endereço" description={addressText(current.address)} icon={MapPin}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <InfoField
                  label="Endereço"
                  value={[current.address.endereco, current.address.numero]
                    .filter(Boolean)
                    .join(', ')}
                />
                <InfoField
                  label="Município/UF"
                  value={[current.address.municipio, current.address.uf].filter(Boolean).join('/')}
                />
                <InfoField label="Bairro" value={current.address.bairro || ''} />
                <InfoField label="Complemento" value={current.address.complemento || ''} />
                <InfoField label="CEP" value={current.address.cep || ''} />
              </div>
            </SectionCard>
          )}
          {current.latest_quotation && (
            <SectionCard
              title="Orçamento recente"
              description="Último orçamento retornado para este cliente."
              icon={FileText}
            >
              <div className="space-y-2">
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
                    navigate(`/quotations/${encodeURIComponent(current.latest_quotation!.name)}`)
                  }
                >
                  Abrir orçamento
                </Button>
              </div>
            </SectionCard>
          )}
        </>
      )}

      <ConfirmDialog
        open={archiveDialogOpen}
        title={archived ? 'Restaurar cliente' : 'Arquivar cliente'}
        message={`${archived ? 'Restaurar' : 'Arquivar'} o cliente ${title}?`}
        confirmLabel={archived ? 'Restaurar' : 'Arquivar'}
        cancelLabel="Cancelar"
        variant={archived ? 'default' : 'destructive'}
        onConfirm={() => void archive()}
        onCancel={() => setArchiveDialogOpen(false)}
      />
    </PageShell>
  );
}
