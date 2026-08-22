import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Eye, Loader2, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { Input } from '@/components/ui/input';
import {
  archiveQuotationTemplate,
  createQuotationTemplate,
  getQuotationTemplate,
  listQuotationTemplates,
  saveQuotationTemplateVersion,
  setDefaultQuotationTemplate,
  validateQuotationTemplate,
  type QuotationTemplateDetail,
  type QuotationTemplateMetadata,
} from '@/lib/api/quotationTemplatesApi';

interface QuotationTemplateManagerProps {
  onTemplatesChanged?: (defaultKey?: string) => void;
}

function errorMessage(error: unknown, fallback: string) {
  return (error as { message?: string })?.message || fallback;
}

export function QuotationTemplateManager({ onTemplatesChanged }: QuotationTemplateManagerProps) {
  const [templates, setTemplates] = useState<QuotationTemplateMetadata[]>([]);
  const [defaultKey, setDefaultKey] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<QuotationTemplateDetail | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [source, setSource] = useState('');
  const [validation, setValidation] = useState<{ warnings: string[]; preview: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<'archive' | 'set_default' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const result = await listQuotationTemplates();
      const available = result.templates || result.data || [];
      setTemplates(available);
      setDefaultKey(result.default_key || available.find((item) => item.is_default)?.key || '');
      setSelectedId((current) => current || available[0]?.id || null);
    } catch (error) {
      setListError(errorMessage(error, 'Não foi possível carregar os templates.'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const result = await getQuotationTemplate(id);
      setDetail(result);
      setName(result.name);
      setKey(result.key);
      setSource(result.current_source);
      setValidation(null);
      setMessage(null);
    } catch (error) {
      setDetail(null);
      setDetailError(errorMessage(error, 'Não foi possível carregar o template.'));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  function resetNew() {
    setSelectedId(null);
    setDetail(null);
    setName('');
    setKey('');
    setSource('');
    setValidation(null);
    setMessage(null);
  }

  async function validate() {
    setMessage(null);
    try {
      setValidation(await validateQuotationTemplate(source, key));
    } catch (error) {
      setMessage(errorMessage(error, 'Não foi possível validar o template.'));
    }
  }

  async function save() {
    if (!name.trim() || !key.trim() || !source.trim()) {
      setMessage('Informe chave, nome e fonte HTML completa.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      if (detail) {
        await saveQuotationTemplateVersion(detail.id, { name, source });
        await loadDetail(detail.id);
      } else {
        const created = await createQuotationTemplate({ key, name, source });
        setSelectedId(created.id);
      }
      await loadTemplates();
      setMessage('Template salvo com sucesso.');
      onTemplatesChanged?.(defaultKey);
    } catch (error) {
      setMessage(errorMessage(error, 'Não foi possível salvar o template.'));
    } finally {
      setSaving(false);
    }
  }

  async function setDefault() {
    if (!detail) return;
    setSaving(true);
    try {
      const result = await setDefaultQuotationTemplate(detail.id);
      setDefaultKey(result.default_key);
      await loadTemplates();
      onTemplatesChanged?.(result.default_key);
      setMessage('Template padrão alterado.');
    } catch (error) {
      setMessage(errorMessage(error, 'Não foi possível alterar o template padrão.'));
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!detail) return;
    setSaving(true);
    try {
      await archiveQuotationTemplate(detail.id);
      await loadTemplates();
      await loadDetail(detail.id);
      setMessage('Template arquivado.');
    } catch (error) {
      setMessage(errorMessage(error, 'Não foi possível arquivar o template.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-6 space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-fg">Modelos de orçamento</h2>
        <p className="mt-1 text-sm text-fg-muted">Gerencie modelos HTML e suas versões.</p>
      </div>
      {loading && !templates.length && <div aria-label="Carregando templates" className="text-sm text-fg-muted">Carregando templates...</div>}
      {listError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm">
          <AlertCircle size={18} className="mt-0.5 shrink-0 text-destructive" />
          <div className="flex-1"><p>{listError}</p><Button className="mt-3" size="sm" variant="outline" onClick={() => void loadTemplates()}><RefreshCw size={14} /> Recarregar modelos</Button></div>
        </div>
      )}
      {!listError && (
        <div className="grid gap-5 lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.5fr)]">
          <div className="space-y-2">
            <Button type="button" variant="outline" size="sm" onClick={resetNew}><Plus size={14} /> Novo modelo</Button>
            {templates.map((template) => (
              <button
                type="button"
                key={template.id}
                onClick={() => setSelectedId(template.id)}
                className={`block w-full rounded-lg border p-3 text-left ${selectedId === template.id ? 'border-primary bg-primary/5' : 'border-line'}`}
              >
                <span className="block font-medium text-fg">{template.name}</span>
                <span className="mt-1 block text-xs text-fg-muted">{template.key} · Usado por {template.usage_count} revisões</span>
                <span className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                  {template.is_default && <span className="tone-info-soft inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">Padrão</span>}
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${template.archived ? 'bg-surface-muted text-fg-muted' : 'tone-success-soft'}`}>{template.archived ? 'Arquivado' : 'Ativo'}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="space-y-4">
            {detailLoading && <div aria-label="Carregando detalhe do template" className="text-sm text-fg-muted">Carregando detalhe...</div>}
            {detailError && selectedId && (
              <div role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm">
                <p>{detailError}</p>
                <Button className="mt-3" size="sm" variant="outline" onClick={() => void loadDetail(selectedId)}><RefreshCw size={14} /> Tentar novamente</Button>
              </div>
            )}
            {!detailLoading && !detailError && <>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm text-fg"><span className="font-medium">Nome</span><Input value={name} onChange={(event) => setName(event.target.value)} disabled={saving} /></label>
              <label className="space-y-1.5 text-sm text-fg"><span className="font-medium">Chave imutável</span><Input value={key} onChange={(event) => setKey(event.target.value)} disabled={saving || !!detail} /></label>
            </div>
            {detail && <p className="text-xs text-fg-muted">Versão atual: {detail.current_version || 1}</p>}
            <label className="block space-y-1.5 text-sm text-fg"><span className="font-medium">Fonte HTML</span><textarea value={source} onChange={(event) => setSource(event.target.value)} disabled={saving} rows={14} className="w-full resize-y rounded-[10px] border border-line bg-surface px-3.5 py-2.5 font-mono text-xs leading-[1.4] text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50" /></label>
            {validation?.warnings.map((warning) => <p key={warning} className="text-sm text-warning">Aviso: {warning}</p>)}
            {/* Fundo branco intencional: preview de e-mail é sempre renderizado em fundo claro */}
            {validation?.preview && <iframe title="Preview do template" sandbox="" srcDoc={validation.preview} className="h-80 w-full rounded-lg border border-line bg-white" />}
            {message && <p role="status" className="text-sm text-fg">{message}</p>}
            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              <Button type="button" variant="outline" onClick={() => void validate()} disabled={saving || !source || !key}><Eye size={14} /> Validar e visualizar preview</Button>
              <Button type="button" onClick={() => void save()} disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <Save />} {detail ? 'Salvar nova versão' : 'Criar modelo'}</Button>
              {detail && !detail.is_default && !detail.archived && <Button type="button" variant="outline" onClick={() => setPendingConfirm('set_default')} disabled={saving}>Definir como padrão</Button>}
              {detail && !detail.is_default && !detail.archived && <Button type="button" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => setPendingConfirm('archive')} disabled={saving}><Trash2 size={14} /> Arquivar</Button>}
            </div>
            {defaultKey && <p className="text-xs text-fg-muted">Modelo padrão: {defaultKey}</p>}
            </>}
          </div>
        </div>
      )}
          <ConfirmDialog
        open={pendingConfirm !== null}
        title={pendingConfirm === 'archive' ? 'Arquivar este modelo?' : 'Definir como padrão?'}
        message={
          pendingConfirm === 'archive'
            ? 'O modelo deixará de estar disponível para novos orçamentos, mas o histórico é preservado.'
            : 'Novos orçamentos usarão este modelo por padrão.'
        }
        confirmLabel={pendingConfirm === 'archive' ? 'Arquivar' : 'Definir como padrão'}
        cancelLabel="Cancelar"
        variant={pendingConfirm === 'archive' ? 'destructive' : 'default'}
        onConfirm={() => {
          const action = pendingConfirm;
          setPendingConfirm(null);
          if (action === 'archive') void archive();
          if (action === 'set_default') void setDefault();
        }}
        onCancel={() => setPendingConfirm(null)}
      />
    </section>
  );
}
