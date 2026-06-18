import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  Check,
  Edit3,
  ExternalLink,
  FileText,
  Mail,
  MapPin,
  Phone,
  Save,
  UserRound,
  X,
} from 'lucide-react';
import { apiGet, apiPut, apiPost } from '@/lib/api.js';
import { fmtPhone, formatBRL, formatDate } from '@/lib/formatters.js';
import { buildCrmDealErpUrl, buildQuotationErpUrl } from '@/lib/erpLinks.js';
import PageHeader from '@/components/PageHeader.jsx';
import SkeletonDetail from '@/components/SkeletonDetail.jsx';
import { useSetTopBarActions } from '@/components/layout/Layout.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { QualityBadges } from '@/components/QualityBadges.jsx';
import { ContextActions } from '@/components/ContextActions.jsx';

const CONTRIBUINTE_OPTS = [
  { value: '0', label: '0 - Não informado' },
  { value: '1', label: '1 - Contribuinte ICMS' },
  { value: '2', label: '2 - Contribuinte isento' },
  { value: '9', label: '9 - Não Contribuinte' },
];

const LEAD_SOURCES = ['Google Ads', 'Bríndice', 'Cliente recorrente'];
const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

// ── Format/validation helpers ──

function formatCpf(value) {
  const d = String(value || '').replace(/\D/g, '').slice(0, 11);
  return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

function formatCnpj(value) {
  const d = String(value || '').replace(/\D/g, '').slice(0, 14);
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function formatTaxId(value, personType) {
  const d = String(value || '').replace(/\D/g, '');
  if (personType === 'pf') return formatCpf(d);
  if (personType === 'pj') return formatCnpj(d);
  if (d.length === 11) return formatCpf(d);
  if (d.length === 14) return formatCnpj(d);
  return value || '';
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function isValidPhone(value) {
  const d = String(value || '').replace(/\D/g, '');
  return d.length >= 10 && d.length <= 11;
}

function getDoctype(tipo) {
  return tipo === 'cliente' || tipo === 'customer' ? 'Customer' : 'Lead';
}

function getTipoFromDoctype(doctype) {
  return doctype === 'Customer' ? 'cliente' : 'lead';
}

function tipoLabel(doctype) {
  return doctype === 'Customer' ? 'Cliente' : 'Lead';
}

function getInitials(name) {
  return String(name || 'Lead')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'LD';
}

function qualityBadges(detail) {
  const labelMap = {
    sem_telefone: { label: 'Sem telefone', type: 'warning' },
    sem_email: { label: 'Sem email', type: 'warning' },
    sem_origem: { label: 'Sem origem', type: 'danger' },
    sem_cnpj: { label: 'Sem CNPJ', type: 'info' },
    endereco_incompleto: { label: 'Endereço incompleto', type: 'warning' },
  };
  if (!detail?.quality_flags?.length) return [{ label: 'Cadastro completo', type: 'success' }];
  return detail.quality_flags.map(flag => labelMap[flag] || { label: flag, type: 'warning' });
}

function buildEditFields(detail) {
  return {
    nome: detail.display_name || '',
    email: detail.email || '',
    telefone: detail.telefone || '',
    origem: detail.origem || '',
    personType: detail.person_type || '',
    taxId: detail.tax_id || '',
    empresa: detail.empresa || '',
    contribuinte: detail.contribuinte || '0',
    inscricaoEstadual: detail.inscricao_estadual || '',
    endereco: {
      endereco: detail.address?.endereco || '',
      numero: detail.address?.numero || '',
      bairro: detail.address?.bairro || '',
      complemento: detail.address?.complemento || '',
      municipio: detail.address?.municipio || '',
      uf: detail.address?.uf || '',
      cep: detail.address?.cep || '',
    },
  };
}

function buildEmptyLeadDetail(doctype = 'Lead') {
  return {
    doctype,
    name: '',
    display_name: '',
    empresa: '',
    email: '',
    telefone: '',
    origem: '',
    person_type: '',
    tax_id: '',
    contribuinte: '0',
    inscricao_estadual: '',
    address: {},
    quality_flags: [],
    latest_quotation: null,
    deal: null,
    erp_url: null,
  };
}

async function lookupCep(cep, setEditFields) {
  const digits = String(cep || '').replace(/\D/g, '');
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
      },
    }));
  } catch { /* best-effort */ }
}

// ── Small UI components ──

function TipoBadge({ doctype }) {
  const isLead = doctype !== 'Customer';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
      isLead ? 'bg-primary/10 text-primary' : 'bg-success/10 text-success'
    }`}>
      {tipoLabel(doctype)}
    </span>
  );
}

function SectionCard({ title, description, icon: Icon, children }) {
  return (
    <section className="bg-surface rounded-xl border border-line shadow-sm p-5 space-y-4">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="mt-0.5 rounded-full bg-surface-muted p-2 text-fg-muted">
            <Icon size={16} />
          </div>
        )}
        <div>
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {description && <p className="text-xs text-fg-muted mt-0.5">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function InfoField({ label, value, children, className = '' }) {
  return (
    <div className={className}>
      <span className="text-fg-muted text-[11px] uppercase tracking-wide">{label}</span>
      {children || <p className="mt-1 text-sm font-medium text-fg break-words">{value || '—'}</p>}
    </div>
  );
}

function SelectBox({ value, onChange, children, disabled = false, className = '' }) {
  return (
    <select
      value={value || ''}
      onChange={onChange}
      disabled={disabled}
      className={`mt-1 h-10 w-full text-sm border border-line rounded-[10px] px-3 bg-surface text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:opacity-50 ${className}`}
    >
      {children}
    </select>
  );
}

function inputClass(invalid) {
  return `mt-1 text-sm ${invalid ? 'border-red-400 focus-visible:ring-red-400/25' : ''}`;
}

function addressLine(address) {
  if (!address) return 'Endereço não cadastrado';
  const first = [address.endereco, address.numero].filter(Boolean).join(', ');
  const second = [address.bairro, address.complemento].filter(Boolean).join(' · ');
  const city = [address.municipio, address.uf].filter(Boolean).join('/');
  return [first, second, city, address.cep ? address.cep.replace(/^(\d{5})(\d{3})$/, '$1-$2') : null].filter(Boolean).join(' · ') || 'Endereço não cadastrado';
}

export default function LeadDetailPage({ tipo, id, navigate }) {
  const decodedId = decodeURIComponent(id || '');
  const doctype = getDoctype(tipo);
  const isNewLead = decodedId === 'new';
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editFields, setEditFields] = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const setTopBarActions = useSetTopBarActions();

  const loadDetail = useCallback(async () => {
    if (!decodedId) return;
    setLoading(true);
    setError(null);
    try {
      if (isNewLead) {
        const empty = buildEmptyLeadDetail(doctype);
        setDetail(empty);
        setEditFields(buildEditFields(empty));
        setEditMode(true);
        setLoading(false);
        return;
      }

      const result = await apiGet(`/client-detail?doctype=${encodeURIComponent(doctype)}&name=${encodeURIComponent(decodedId)}`);
      setDetail(result);
      setEditMode(false);
      setEditFields({});
    } catch (err) {
      if (err.status === 404) setError('not_found');
      else setError(err.message || 'Erro ao carregar lead.');
    } finally {
      setLoading(false);
    }
  }, [decodedId, doctype, isNewLead]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  const startEdit = useCallback(() => {
    if (!detail) return;
    setEditFields(buildEditFields(detail));
    setEditMode(true);
  }, [detail]);

  const cancelEdit = useCallback(() => {
    if (isNewLead) {
      navigate('/leads');
      return;
    }
    setEditMode(false);
    setEditFields({});
  }, [isNewLead, navigate]);

  const saveEdit = useCallback(async () => {
    if (!detail) return;
    setSaving(true);
    setError(null);
    setToast(null);
    try {
      const payload = {
        nome: editFields.nome?.trim() || null,
        email: editFields.email?.trim() || null,
        telefone: editFields.telefone?.trim() || null,
        empresa: editFields.empresa?.trim() || null,
        contribuinte: editFields.contribuinte || '0',
        inscricao_estadual: editFields.inscricaoEstadual?.trim() || null,
        origem: editFields.origem?.trim() || null,
      };

      if (editFields.personType) {
        payload.person_type = editFields.personType;
        payload.tax_id = editFields.taxId?.replace(/\D/g, '') || null;
      }

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

      if (!payload.nome) {
        setToast({ type: 'error', message: 'Nome é obrigatório.' });
        return;
      }
      if (payload.email && !isValidEmail(payload.email)) {
        setToast({ type: 'error', message: 'E-mail inválido.' });
        return;
      }
      if (payload.telefone && !isValidPhone(payload.telefone)) {
        setToast({ type: 'error', message: 'Telefone inválido.' });
        return;
      }

      if (isNewLead) {
        const created = await apiPost('/leads-clients', {
          tipo: getTipoFromDoctype(doctype),
          nome: payload.nome,
          email: payload.email || undefined,
          telefone: payload.telefone || undefined,
          origem: payload.origem || undefined,
        });
        const createdId = created.created || created.name || created.id;
        if (!createdId) {
          setToast({ type: 'error', message: 'Lead criado, mas não foi possível abrir o cadastro.' });
          navigate('/leads');
          return;
        }

        const extraPayload = { ...payload };
        delete extraPayload.nome;
        delete extraPayload.email;
        delete extraPayload.telefone;
        delete extraPayload.origem;
        const hasEndereco = Object.values(extraPayload.endereco || {}).some(value => String(value || '').trim());
        if (!hasEndereco) delete extraPayload.endereco;
        if (Object.keys(extraPayload).length > 0) {
          await apiPut(
            `/client-detail?doctype=${encodeURIComponent(doctype)}&name=${encodeURIComponent(createdId)}`,
            extraPayload,
          );
        }

        setToast({ type: 'success', message: 'Lead criado com sucesso.' });
        navigate(`/leads/${getTipoFromDoctype(doctype)}/${encodeURIComponent(createdId)}`);
        return;
      }

      const updated = await apiPut(
        `/client-detail?doctype=${encodeURIComponent(doctype)}&name=${encodeURIComponent(decodedId)}`,
        payload,
      );
      setDetail(updated);
      setEditMode(false);
      setEditFields({});
      setToast({ type: 'success', message: 'Cadastro atualizado com sucesso.' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Erro ao salvar cadastro.' });
    } finally {
      setSaving(false);
    }
  }, [decodedId, detail, doctype, editFields, isNewLead, navigate]);

  useEffect(() => {
    if (!setTopBarActions) return undefined;

    if (loading || error || !detail) {
      setTopBarActions(null);
      return () => setTopBarActions(null);
    }

    setTopBarActions(
      <div className="flex items-center gap-2">
        {editMode ? (
          <>
            <Button variant="default" size="sm" onClick={saveEdit} disabled={saving}>
              <Save size={16} />
              {saving ? (isNewLead ? 'Criando…' : 'Salvando…') : (isNewLead ? 'Criar Lead' : 'Salvar')}
            </Button>
            <Button variant="outline" size="sm" onClick={cancelEdit} disabled={saving}>
              <X size={16} />
              Cancelar
            </Button>
          </>
        ) : (
          <Button variant="default" size="sm" onClick={startEdit} disabled={saving}>
            <Edit3 size={16} />
            Editar cadastro
          </Button>
        )}
      </div>
    );

    return () => setTopBarActions(null);
  }, [cancelEdit, detail, editMode, error, isNewLead, loading, saveEdit, saving, setTopBarActions, startEdit]);

  if (loading) return <SkeletonDetail title="Carregando lead…" />;

  if (error === 'not_found') {
    return (
      <div className="flex flex-col items-center py-16 text-fg-muted gap-3">
        <UserRound size={40} className="text-fg-muted/40" />
        <p className="text-lg font-medium">Registro não encontrado</p>
        <p className="text-sm">Não encontramos {tipoLabel(doctype).toLowerCase()} &quot;{decodedId}&quot;.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center py-16 text-fg-muted gap-3">
        <AlertTriangle size={40} className="text-destructive" />
        <p className="text-lg font-medium">Erro ao carregar cadastro</p>
        <p className="text-sm">{error}</p>
        <Button variant="outline" className="min-h-10" onClick={loadDetail}>Tentar novamente</Button>
      </div>
    );
  }

  if (!detail) return null;

  const actions = [
    detail.telefone ? {
      label: 'WhatsApp',
      icon: Phone,
      href: `https://wa.me/${detail.telefone.replace(/\D/g, '')}`,
      title: 'Abrir WhatsApp',
    } : null,
    detail.email ? {
      label: 'Email',
      icon: Mail,
      href: `mailto:${detail.email}`,
      title: 'Enviar email',
    } : null,
    detail.latest_quotation ? {
      label: 'Orçamento recente',
      icon: FileText,
      href: buildQuotationErpUrl(null, detail.latest_quotation.name),
      title: `Abrir ${detail.latest_quotation.name}`,
    } : null,
    detail.deal ? {
      label: 'Deal vinculado',
      icon: UserRound,
      href: buildCrmDealErpUrl(null, detail.deal.name),
      title: `Abrir ${detail.deal.name}`,
    } : null,
    detail.erp_url ? {
      label: 'ERPNext',
      icon: ExternalLink,
      href: detail.erp_url,
      title: 'Abrir no ERPNext',
    } : null,
  ].filter(Boolean);

  return (
    <div className="space-y-5 animate-fade-in max-w-[1060px] mx-auto">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-in slide-in-from-top-2 ${
          toast.type === 'success'
            ? 'bg-success/10 text-success border border-success/30'
            : 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-800/40'
        }`}>
          {toast.type === 'success' ? <Check size={16} className="inline mr-1" /> : <AlertTriangle size={16} className="inline mr-1" />}
          {toast.message}
        </div>
      )}

      <PageHeader
        title={isNewLead ? 'Novo Lead' : (detail.display_name || decodedId)}
      />

      <section className="bg-surface rounded-xl border border-line shadow-sm p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4 min-w-0">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-xl font-semibold text-primary">
              {getInitials(detail.display_name)}
            </div>
            <div className="min-w-0 space-y-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold text-fg truncate">{detail.display_name || 'Sem nome'}</h2>
                  <TipoBadge doctype={detail.doctype || doctype} />
                </div>
                <p className="text-sm text-fg-muted">{detail.empresa || 'Empresa não informada'}</p>
              </div>
              <QualityBadges badges={isNewLead ? [] : qualityBadges(detail)} />
              {!isNewLead && <ContextActions actions={actions} />}
            </div>
          </div>

        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-8 space-y-5">
          <SectionCard title="Dados gerais" description="Contato, origem e identificação comercial." icon={UserRound}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InfoField label="Nome">
                {editMode ? (
                  <Input value={editFields.nome || ''} onChange={e => setEditFields(prev => ({ ...prev, nome: e.target.value }))} className="mt-1 text-sm" placeholder="Nome do lead" />
                ) : <p className="mt-1 text-sm font-medium text-fg">{detail.display_name || '—'}</p>}
              </InfoField>
              <InfoField label="Empresa">
                {editMode ? (
                  <Input value={editFields.empresa || ''} onChange={e => setEditFields(prev => ({ ...prev, empresa: e.target.value }))} className="mt-1 text-sm" placeholder="Nome da empresa" />
                ) : <p className="mt-1 text-sm font-medium text-fg">{detail.empresa || '—'}</p>}
              </InfoField>
              <InfoField label="E-mail">
                {editMode ? (
                  <Input value={editFields.email || ''} onChange={e => setEditFields(prev => ({ ...prev, email: e.target.value }))} className={inputClass(editFields.email && !isValidEmail(editFields.email))} placeholder="email@exemplo.com" />
                ) : <p className="mt-1 text-sm font-medium text-fg">{detail.email || '—'}</p>}
              </InfoField>
              <InfoField label="Telefone">
                {editMode ? (
                  <Input value={editFields.telefone || ''} onChange={e => setEditFields(prev => ({ ...prev, telefone: e.target.value }))} className={inputClass(editFields.telefone && !isValidPhone(editFields.telefone))} placeholder="(99) 99999-9999" />
                ) : <p className="mt-1 text-sm font-medium text-fg">{fmtPhone(detail.telefone) || '—'}</p>}
              </InfoField>
              <InfoField label="Origem">
                {editMode && (detail.doctype || doctype) === 'Lead' ? (
                  <SelectBox value={editFields.origem || ''} onChange={e => setEditFields(prev => ({ ...prev, origem: e.target.value }))}>
                    <option value="">Selecione</option>
                    {LEAD_SOURCES.map(src => <option key={src} value={src}>{src}</option>)}
                  </SelectBox>
                ) : <p className="mt-1 text-sm font-medium text-fg">{detail.origem || '—'}</p>}
              </InfoField>
              {!isNewLead && (
                <InfoField label="Criado / modificado">
                  <p className="mt-1 text-sm font-medium text-fg">
                    {detail.creation ? new Date(detail.creation).toLocaleString('pt-BR') : '—'}
                  </p>
                  <p className="text-xs text-fg-muted">
                    Modificado: {detail.modified ? new Date(detail.modified).toLocaleString('pt-BR') : '—'}
                  </p>
                </InfoField>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Fiscal" description="Tipo de pessoa, documento e inscrição estadual." icon={FileText}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <InfoField label="Tipo de pessoa">
                {editMode ? (
                  <SelectBox value={editFields.personType || ''} onChange={e => setEditFields(prev => ({ ...prev, personType: e.target.value, taxId: '' }))}>
                    <option value="">Selecione</option>
                    <option value="pf">Pessoa Física</option>
                    <option value="pj">Pessoa Jurídica</option>
                  </SelectBox>
                ) : <p className="mt-1 text-sm font-medium text-fg">{detail.person_type === 'pf' ? 'Pessoa Física' : detail.person_type === 'pj' ? 'Pessoa Jurídica' : '—'}</p>}
              </InfoField>
              <InfoField label={editMode && editFields.personType === 'pf' ? 'CPF' : editMode && editFields.personType === 'pj' ? 'CNPJ' : 'CPF/CNPJ'}>
                {editMode ? (
                  <Input
                    value={formatTaxId(editFields.taxId || '', editFields.personType)}
                    onChange={e => {
                      const raw = e.target.value.replace(/\D/g, '');
                      const maxLen = editFields.personType === 'pf' ? 11 : 14;
                      setEditFields(prev => ({ ...prev, taxId: raw.slice(0, maxLen) }));
                    }}
                    className="mt-1 text-sm"
                    placeholder={editFields.personType === 'pf' ? '000.000.000-00' : '00.000.000/0000-00'}
                    disabled={!editFields.personType}
                  />
                ) : <p className="mt-1 text-sm font-medium text-fg">{formatTaxId(detail.tax_id, detail.person_type) || '—'}</p>}
              </InfoField>
              <InfoField label="Contribuinte">
                {editMode ? (
                  <SelectBox value={editFields.contribuinte || '0'} onChange={e => setEditFields(prev => ({ ...prev, contribuinte: e.target.value }))}>
                    {CONTRIBUINTE_OPTS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </SelectBox>
                ) : <p className="mt-1 text-sm font-medium text-fg">{CONTRIBUINTE_OPTS.find(o => o.value === detail.contribuinte)?.label || '—'}</p>}
              </InfoField>
              <InfoField label="Inscrição estadual">
                {editMode ? (
                  <Input value={editFields.inscricaoEstadual || ''} onChange={e => setEditFields(prev => ({ ...prev, inscricaoEstadual: e.target.value }))} className="mt-1 text-sm" placeholder="IE" />
                ) : <p className="mt-1 text-sm font-medium text-fg">{detail.inscricao_estadual || '—'}</p>}
              </InfoField>
            </div>
          </SectionCard>

          <SectionCard title="Endereço" description={addressLine(detail.address)} icon={MapPin}>
            {editMode ? (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                <InfoField label="CEP" className="md:col-span-3">
                  <Input
                    value={editFields.endereco?.cep || ''}
                    onChange={e => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 8);
                      setEditFields(prev => ({ ...prev, endereco: { ...prev.endereco, cep: val } }));
                      if (val.length === 8) lookupCep(val, setEditFields);
                    }}
                    className="mt-1 text-sm"
                    placeholder="00000-000"
                  />
                </InfoField>
                <InfoField label="Município" className="md:col-span-7">
                  <Input value={editFields.endereco?.municipio || ''} onChange={e => setEditFields(prev => ({ ...prev, endereco: { ...prev.endereco, municipio: e.target.value } }))} className="mt-1 text-sm" placeholder="Município" />
                </InfoField>
                <InfoField label="UF" className="md:col-span-2">
                  <SelectBox value={editFields.endereco?.uf || ''} onChange={e => setEditFields(prev => ({ ...prev, endereco: { ...prev.endereco, uf: e.target.value } }))}>
                    <option value="">UF</option>
                    {UFS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                  </SelectBox>
                </InfoField>
                <InfoField label="Endereço" className="md:col-span-9">
                  <Input value={editFields.endereco?.endereco || ''} onChange={e => setEditFields(prev => ({ ...prev, endereco: { ...prev.endereco, endereco: e.target.value } }))} className="mt-1 text-sm" placeholder="Endereço" />
                </InfoField>
                <InfoField label="Número" className="md:col-span-3">
                  <Input value={editFields.endereco?.numero || ''} onChange={e => setEditFields(prev => ({ ...prev, endereco: { ...prev.endereco, numero: e.target.value } }))} className="mt-1 text-sm" placeholder="Nº" />
                </InfoField>
                <InfoField label="Bairro" className="md:col-span-6">
                  <Input value={editFields.endereco?.bairro || ''} onChange={e => setEditFields(prev => ({ ...prev, endereco: { ...prev.endereco, bairro: e.target.value } }))} className="mt-1 text-sm" placeholder="Bairro" />
                </InfoField>
                <InfoField label="Complemento" className="md:col-span-6">
                  <Input value={editFields.endereco?.complemento || ''} onChange={e => setEditFields(prev => ({ ...prev, endereco: { ...prev.endereco, complemento: e.target.value } }))} className="mt-1 text-sm" placeholder="Complemento" />
                </InfoField>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <InfoField label="CEP" value={detail.address?.cep ? detail.address.cep.replace(/^(\d{5})(\d{3})$/, '$1-$2') : ''} />
                <InfoField label="Município/UF" value={[detail.address?.municipio, detail.address?.uf].filter(Boolean).join('/')} />
                <InfoField label="Endereço" value={[detail.address?.endereco, detail.address?.numero].filter(Boolean).join(', ')} className="sm:col-span-2" />
                <InfoField label="Bairro" value={detail.address?.bairro || ''} />
                <InfoField label="Complemento" value={detail.address?.complemento || ''} />
              </div>
            )}
          </SectionCard>
        </div>

        {!isNewLead && (
          <aside className="xl:col-span-4 space-y-5">
          <SectionCard title="Atividade recente" description="Atalhos para o contexto comercial." icon={FileText}>
            <div className="space-y-4">
              {detail.latest_quotation ? (
                <div className="rounded-xl border border-line bg-surface/50 p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="text-[11px] uppercase tracking-wide text-fg-muted">Último orçamento</span>
                      <p className="mt-1 text-sm font-semibold text-fg">{detail.latest_quotation.name}</p>
                    </div>
                    <span className="inline-flex rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-fg-muted">
                      {detail.latest_quotation.status || '—'}
                    </span>
                  </div>
                  <div className="text-xs text-fg-muted space-y-0.5">
                    {detail.latest_quotation.date && <p>Data: {formatDate(detail.latest_quotation.date)}</p>}
                    {detail.latest_quotation.grand_total != null && <p>Total: {formatBRL(detail.latest_quotation.grand_total)}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button variant="outline" size="sm" onClick={() => navigate(`/quotations/${detail.latest_quotation.name}`)}>
                      Abrir página
                    </Button>
                    <a className="inline-flex h-8 items-center justify-center gap-2 rounded-full border border-line px-3 text-xs font-medium text-fg hover:bg-primary/5" href={buildQuotationErpUrl(null, detail.latest_quotation.name)} target="_blank" rel="noopener noreferrer">
                      ERPNext
                      <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-fg-muted">Nenhum orçamento recente vinculado.</p>
              )}

              {detail.deal ? (
                <div className="rounded-xl border border-line bg-surface/50 p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="text-[11px] uppercase tracking-wide text-fg-muted">Deal CRM</span>
                      <p className="mt-1 text-sm font-semibold text-fg">{detail.deal.name}</p>
                    </div>
                    <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      {detail.deal.status || '—'}
                    </span>
                  </div>
                  {detail.deal.next_step && <p className="text-xs text-fg-muted">{detail.deal.next_step}</p>}
                  <a className="inline-flex h-8 items-center justify-center gap-2 rounded-full border border-line px-3 text-xs font-medium text-fg hover:bg-primary/5" href={buildCrmDealErpUrl(null, detail.deal.name)} target="_blank" rel="noopener noreferrer">
                    Abrir no ERPNext
                    <ExternalLink size={12} />
                  </a>
                </div>
              ) : (
                <p className="text-sm text-fg-muted">Nenhum deal CRM vinculado.</p>
              )}
            </div>
          </SectionCard>
          </aside>
        )}
      </div>
    </div>
  );
}
