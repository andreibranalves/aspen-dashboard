// src/components/CustomerMetadataForm.jsx
// Client metadata form: name, email, phone, urgent checkbox, lead source, CNPJ, and collapsible address.
// Extracted from AutoQuotePage.jsx.

import { Mail, Phone, User, Building2, MapPin, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Input } from '@/components/ui/input.jsx';
import { formatPhoneInput, normalizePhoneDigits } from '@/lib/formatters.js';
import {
  LEAD_SOURCES,
  isValidCnpj,
  formatCnpj,
  normalizeCnpj,
  hasAnyAddressField,
  formatAddressSummary,
} from '@/lib/clientMetadata.js';

export default function CustomerMetadataForm({
  draft,
  draftIdx,
  isApproved,
  updateDraftField,
  updateDraftAddressField,
  onUrgenteToggle,
}) {
  const edited = draft.edited;
  const original = draft.original;

  return (
    <>
      {/* ── Name ── */}
      <Input
        className="mt-2 h-10 max-w-[320px] border-transparent bg-transparent px-0 text-lg font-semibold text-framer-ink shadow-none focus-visible:ring-0"
        value={edited.nome}
        onChange={e => updateDraftField(draftIdx, 'nome', e.target.value)}
        placeholder="Nome do cliente"
        disabled={isApproved}
      />

      {/* ── Client metadata card ── */}
      <div className="rounded-[20px] border border-framer-hairline bg-framer-surface-1/40 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-framer-ink">
          <User size={16} className="text-primary" /> Cliente
        </div>

        {/* Email + Phone */}
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-medium text-framer-ink-muted">Email</span>
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-framer-ink-muted" />
              <Input
                className="h-10 pl-9 text-sm"
                value={edited.email}
                onChange={e => updateDraftField(draftIdx, 'email', e.target.value)}
                placeholder="email@exemplo.com"
                disabled={isApproved}
              />
            </div>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-framer-ink-muted">Telefone</span>
            <div className="relative">
              <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-framer-ink-muted" />
              <Input
                className="h-10 pl-9 text-sm"
                value={formatPhoneInput(edited.telefone)}
                onChange={e => updateDraftField(draftIdx, 'telefone', normalizePhoneDigits(e.target.value))}
                placeholder="(99) 99999-9999"
                disabled={isApproved}
              />
            </div>
          </label>
        </div>

        {/* Urgente toggle */}
        <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-full border border-framer-hairline px-3 py-2 text-xs font-medium text-framer-ink-muted">
          <input
            type="checkbox"
            checked={edited.urgente}
            onChange={e => onUrgenteToggle(draftIdx, e.target.checked)}
            disabled={isApproved}
          />
          Pedido urgente
        </label>

        {/* ── Origem ── */}
        <div className="mt-4 space-y-1">
          <label className="text-xs font-medium text-framer-ink-muted">Origem do lead *</label>
          <select
            className={cn(
              'w-full rounded-[12px] border px-3 py-2 text-sm',
              isApproved ? 'border-framer-hairline bg-framer-surface-1 text-framer-ink' : 'border-framer-hairline bg-card text-framer-ink',
            )}
            value={edited.origem || ''}
            onChange={e => updateDraftField(draftIdx, 'origem', e.target.value)}
            disabled={isApproved}
          >
            <option value="">Selecione a origem…</option>
            {LEAD_SOURCES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          {original?.origem && edited.origem === original.origem && (
            <span className="inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              Sugerido pela IA
            </span>
          )}
        </div>

        {/* ── CNPJ ── */}
        <div className="mt-3 space-y-1">
          <label className="text-xs font-medium text-framer-ink-muted">CNPJ (opcional)</label>
          <div className="relative">
            <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-framer-ink-muted" />
            <Input
              className="h-10 pl-9 text-sm font-mono"
              value={edited.cnpj ? formatCnpj(edited.cnpj) : ''}
              onChange={e => updateDraftField(draftIdx, 'cnpj', normalizeCnpj(e.target.value))}
              placeholder="00.000.000/0000-00"
              disabled={isApproved}
            />
          </div>
          {edited.cnpj && !isValidCnpj(edited.cnpj) && (
            <p className="text-xs text-red-500">CNPJ inválido. Corrija ou deixe em branco.</p>
          )}
        </div>

        {/* ── Endereço colapsável ── */}
        <div className="mt-3">
          <button
            type="button"
            onClick={() => updateDraftField(draftIdx, '_showAddr', !edited._showAddr)}
            className="flex items-center gap-2 text-xs font-medium text-framer-ink-muted hover:text-framer-ink transition-colors"
          >
            <MapPin size={14} />
            Endereço opcional
            {edited._showAddr ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {edited._showAddr && (
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-[10px] text-framer-ink-muted">CEP</span>
                <Input
                  className="h-9 text-sm font-mono"
                  value={edited.endereco?.cep || ''}
                  onChange={e => updateDraftAddressField(draftIdx, 'cep', e.target.value)}
                  placeholder="00000-000"
                  disabled={isApproved}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-framer-ink-muted">Logradouro</span>
                <Input
                  className="h-9 text-sm"
                  value={edited.endereco?.logradouro || ''}
                  onChange={e => updateDraftAddressField(draftIdx, 'logradouro', e.target.value)}
                  placeholder="Rua, Avenida"
                  disabled={isApproved}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-framer-ink-muted">Número</span>
                <Input
                  className="h-9 text-sm"
                  value={edited.endereco?.numero || ''}
                  onChange={e => updateDraftAddressField(draftIdx, 'numero', e.target.value)}
                  placeholder="123"
                  disabled={isApproved}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-framer-ink-muted">Complemento</span>
                <Input
                  className="h-9 text-sm"
                  value={edited.endereco?.complemento || ''}
                  onChange={e => updateDraftAddressField(draftIdx, 'complemento', e.target.value)}
                  placeholder="Apto, Sala"
                  disabled={isApproved}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-framer-ink-muted">Bairro</span>
                <Input
                  className="h-9 text-sm"
                  value={edited.endereco?.bairro || ''}
                  onChange={e => updateDraftAddressField(draftIdx, 'bairro', e.target.value)}
                  placeholder="Bairro"
                  disabled={isApproved}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-framer-ink-muted">Cidade</span>
                <Input
                  className="h-9 text-sm"
                  value={edited.endereco?.cidade || ''}
                  onChange={e => updateDraftAddressField(draftIdx, 'cidade', e.target.value)}
                  placeholder="Cidade"
                  disabled={isApproved}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-framer-ink-muted">UF</span>
                <Input
                  className="h-9 text-sm w-20"
                  value={edited.endereco?.uf || ''}
                  onChange={e => updateDraftAddressField(draftIdx, 'uf', e.target.value.toUpperCase().slice(0, 2))}
                  placeholder="SP"
                  maxLength={2}
                  disabled={isApproved}
                />
              </label>
            </div>
          )}
          {!edited._showAddr && hasAnyAddressField(edited.endereco) && (
            <p className="mt-1 text-xs text-framer-ink-muted">{formatAddressSummary(edited.endereco)}</p>
          )}
        </div>
      </div>
    </>
  );
}
