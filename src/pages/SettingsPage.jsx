import { useState, useEffect } from 'react';
import { Check } from 'lucide-react';
import PageHeader from '@/components/PageHeader.jsx';
import { Button } from '@/components/ui/button.jsx';

const WA_DEFAULT = 'Olá, (nome)! Segue seu orçamento (numero_pedido). Qualquer dúvida estamos à disposição. — (empresa)';
const WA_SEQUENCE_DEFAULT = {
  enabled: true,
  vendor_name: 'Juliana',
  delay_min_seconds: 5,
  delay_max_seconds: 8,
  max_images_per_category: 2,
  greeting_template: 'Olá, (primeiro_nome), tudo bem?',
  context_template: 'Meu nome é (vendedora), da (empresa). Estou entrando em contato sobre o seu orçamento de (produto_resumo) personalizado(a).',
  quotation_template: 'Segue o orçamento (numero_pedido):\n(link_orcamento)',
  samples_intro_template: 'Também estou te enviando algumas fotos de referência dos modelos para você visualizar melhor as opções.',
  sample_images_text: '',
};
const LS_RULES = 'aspen_rules';
const LS_WA = 'aspen_wa_template';
const LS_WA_SEQUENCE = 'aspen_wa_sequence_config';

function renderSequencePreview(config) {
  const context = {
    '(Saudacao)': 'Bom dia',
    '(nome)': 'Labo Buriti',
    '(primeiro_nome)': 'Labo',
    '(numero_pedido)': 'ORC-20261289',
    '(empresa)': 'Aspen Estamparia',
    '(link_orcamento)': 'https://orcamento.aspenestamparia.com/api/view?q=ORC-20261289',
    '(vendedora)': config.vendor_name || 'Juliana',
    '(produto_resumo)': 'canga',
  };
  return [
    config.greeting_template,
    config.context_template,
    config.quotation_template,
    config.samples_intro_template,
  ]
    .filter(Boolean)
    .map(text => Object.entries(context).reduce((acc, [key, value]) => acc.replaceAll(key, value), String(text)));
}

export default function SettingsPage() {
  const [rules, setRules] = useState('');
  const [waTemplate, setWaTemplate] = useState('');
  const [waSequence, setWaSequence] = useState(WA_SEQUENCE_DEFAULT);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setRules(localStorage.getItem(LS_RULES) || '');
    setWaTemplate(localStorage.getItem(LS_WA) || WA_DEFAULT);
    try {
      const rawSequence = localStorage.getItem(LS_WA_SEQUENCE);
      setWaSequence(rawSequence ? { ...WA_SEQUENCE_DEFAULT, ...JSON.parse(rawSequence) } : WA_SEQUENCE_DEFAULT);
    } catch {
      setWaSequence(WA_SEQUENCE_DEFAULT);
    }
  }, []);

  const handleSaveRules = () => {
    localStorage.setItem(LS_RULES, rules);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleResetRules = () => {
    setRules('');
    localStorage.setItem(LS_RULES, '');
  };

  const handleSaveWa = () => {
    localStorage.setItem(LS_WA, waTemplate);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleResetWa = () => {
    setWaTemplate(WA_DEFAULT);
    localStorage.setItem(LS_WA, WA_DEFAULT);
  };

  const handleSaveWaSequence = () => {
    localStorage.setItem(LS_WA_SEQUENCE, JSON.stringify({ ...WA_SEQUENCE_DEFAULT, ...waSequence }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleResetWaSequence = () => {
    setWaSequence(WA_SEQUENCE_DEFAULT);
    localStorage.setItem(LS_WA_SEQUENCE, JSON.stringify(WA_SEQUENCE_DEFAULT));
  };

  const updateWaSequence = (patch) => setWaSequence(prev => ({ ...prev, ...patch }));
  const waSequencePreview = renderSequencePreview(waSequence);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurações"
        description="Estas configurações ficam salvas neste navegador."
      />

      {/* Regras de extração */}
      <div className="bg-card rounded-lg border border-border shadow-sm p-5 space-y-3">
        <div>
          <label htmlFor="settings-rules" className="font-medium">
            Regras de Extração
          </label>
          <p className="text-xs text-muted-foreground">
            Instruções adicionais enviadas ao modelo de IA na extração automática (uma por linha).
          </p>
        </div>
        <textarea
          id="settings-rules"
          className="w-full min-h-[120px] rounded-[10px] border border-framer-hairline bg-framer-surface-1 px-3 py-2 text-sm resize-y text-framer-ink placeholder:text-framer-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
          value={rules}
          onChange={e => setRules(e.target.value)}
          placeholder="Ex: Sempre incluir SKU-XYZ para pedidos acima de 100 unidades…"
          aria-label="Regras de extração"
        />
        <div className="flex gap-2">
          <Button onClick={handleSaveRules} variant="default" size="sm">
            Salvar Regras
          </Button>
          <Button onClick={handleResetRules} variant="outline" size="sm">
            Restaurar Padrão
          </Button>
        </div>
      </div>

      {/* Template WhatsApp */}
      <div className="bg-card rounded-lg border border-border shadow-sm p-5 space-y-3">
        <div>
          <label htmlFor="settings-wa" className="font-medium">
            Template WhatsApp
          </label>
          <p className="text-xs text-muted-foreground">
            Mensagem padrão enviada pelo WhatsApp. Variáveis disponíveis:
          </p>
          <p className="text-xs text-muted-foreground font-mono mt-1">
            (nome) · (primeiro_nome) · (numero_pedido) · (empresa) · (Saudacao) · (link_orcamento)
          </p>
        </div>
        <textarea
          id="settings-wa"
          className="w-full min-h-[100px] rounded-[10px] border border-framer-hairline bg-framer-surface-1 px-3 py-2 text-sm resize-y text-framer-ink placeholder:text-framer-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
          value={waTemplate}
          onChange={e => setWaTemplate(e.target.value)}
          aria-label="Template WhatsApp"
        />
        <div className="flex gap-2">
          <Button onClick={handleSaveWa} variant="default" size="sm">
            Salvar Template
          </Button>
          <Button onClick={handleResetWa} variant="outline" size="sm">
            Restaurar Padrão
          </Button>
        </div>
      </div>

      {/* Sequência WhatsApp */}
      <div className="bg-card rounded-lg border border-border shadow-sm p-5 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <label className="font-medium">Sequência de WhatsApp</label>
            <p className="text-xs text-muted-foreground mt-1">
              Configure mensagens separadas, intervalo entre envios e fotos de referência por categoria.
            </p>
            <p className="text-xs text-muted-foreground font-mono mt-1">
              Extras: (vendedora) · (produto_resumo)
            </p>
          </div>
          <label className="inline-flex items-center gap-2 rounded-full border border-framer-hairline px-3 py-2 text-xs font-medium">
            <input
              type="checkbox"
              checked={waSequence.enabled}
              onChange={e => updateWaSequence({ enabled: e.target.checked })}
            />
            Usar sequência no botão de envio
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Vendedora</span>
            <input className="w-full rounded-[10px] border border-framer-hairline bg-framer-surface-1 px-3 py-2 text-sm text-framer-ink" value={waSequence.vendor_name} onChange={e => updateWaSequence({ vendor_name: e.target.value })} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Intervalo mínimo (s)</span>
            <input type="number" min="0" className="w-full rounded-[10px] border border-framer-hairline bg-framer-surface-1 px-3 py-2 text-sm text-framer-ink" value={waSequence.delay_min_seconds} onChange={e => updateWaSequence({ delay_min_seconds: e.target.value })} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Intervalo máximo (s)</span>
            <input type="number" min="0" className="w-full rounded-[10px] border border-framer-hairline bg-framer-surface-1 px-3 py-2 text-sm text-framer-ink" value={waSequence.delay_max_seconds} onChange={e => updateWaSequence({ delay_max_seconds: e.target.value })} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Fotos por categoria</span>
            <input type="number" min="0" max="6" className="w-full rounded-[10px] border border-framer-hairline bg-framer-surface-1 px-3 py-2 text-sm text-framer-ink" value={waSequence.max_images_per_category} onChange={e => updateWaSequence({ max_images_per_category: e.target.value })} />
          </label>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          {[
            ['greeting_template', 'Mensagem 1 — saudação'],
            ['context_template', 'Mensagem 2 — contexto'],
            ['quotation_template', 'Mensagem 3 — orçamento/link'],
            ['samples_intro_template', 'Mensagem 4 — introdução das fotos'],
          ].map(([key, label]) => (
            <label key={key} className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">{label}</span>
              <textarea
                className="w-full min-h-[76px] rounded-[10px] border border-framer-hairline bg-framer-surface-1 px-3 py-2 text-sm resize-y text-framer-ink placeholder:text-framer-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
                value={waSequence[key] || ''}
                onChange={e => updateWaSequence({ [key]: e.target.value })}
              />
            </label>
          ))}
        </div>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Fotos por categoria</span>
          <textarea
            className="w-full min-h-[96px] rounded-[10px] border border-framer-hairline bg-framer-surface-1 px-3 py-2 font-mono text-xs resize-y text-framer-ink placeholder:text-framer-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-framer-accent-blue/25"
            value={waSequence.sample_images_text || ''}
            onChange={e => updateWaSequence({ sample_images_text: e.target.value })}
            placeholder={'canga: https://site/canga-01.jpg, https://site/canga-02.jpg\nlenço: https://site/lenco-01.jpg'}
          />
          <p className="text-xs text-muted-foreground">Uma categoria por linha. Separe múltiplas imagens por vírgula. Categorias aceitas: canga, lenço, boné, chapéu, toalha, ecobag, cachecol.</p>
        </label>

        <div className="rounded-[16px] border border-framer-hairline bg-framer-surface-1/60 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Preview com dados de exemplo</p>
          <div className="space-y-2">
            {waSequencePreview.map((message, index) => (
              <div key={index} className="rounded-[14px] bg-card p-3 text-sm leading-6 text-framer-ink shadow-sm">
                <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Mensagem {index + 1}</span>
                <span className="whitespace-pre-wrap">{message}</span>
              </div>
            ))}
            {waSequence.sample_images_text?.trim() && (
              <div className="rounded-[14px] border border-dashed border-framer-hairline p-3 text-xs text-muted-foreground">
                Depois das mensagens, o app envia até {waSequence.max_images_per_category || 0} foto(s) da categoria detectada no orçamento.
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={handleSaveWaSequence} variant="default" size="sm">
            Salvar Sequência
          </Button>
          <Button onClick={handleResetWaSequence} variant="outline" size="sm">
            Restaurar Padrão
          </Button>
        </div>
      </div>

      {/* Saved toast */}
      {saved && (
        <div className="fixed bottom-6 right-6 bg-framer-success text-white px-4 py-2 rounded-full text-sm shadow-lg animate-in">
          <Check size={20} className="text-white inline mr-1" />Salvo com sucesso!
        </div>
      )}
    </div>
  );
}
