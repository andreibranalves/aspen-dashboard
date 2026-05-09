import { useState, useEffect } from 'react';

const WA_DEFAULT = 'Olá, (nome)! Segue seu orçamento (numero_pedido). Qualquer dúvida estamos à disposição. — (empresa)';
const LS_RULES = 'aspen_rules';
const LS_WA = 'aspen_wa_template';

export default function SettingsPage() {
  const [rules, setRules] = useState('');
  const [waTemplate, setWaTemplate] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setRules(localStorage.getItem(LS_RULES) || '');
    setWaTemplate(localStorage.getItem(LS_WA) || WA_DEFAULT);
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

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-lg font-semibold">Configurações</h1>

      {/* Regras de extração */}
      <div className="bg-white rounded-lg border shadow-sm p-5 space-y-3">
        <div>
          <h2 className="font-medium">Regras de Extração</h2>
          <p className="text-xs text-muted-foreground">
            Instruções adicionais enviadas ao modelo de IA na extração automática (uma por linha).
          </p>
        </div>
        <textarea
          className="w-full min-h-[120px] rounded-md border bg-background px-3 py-2 text-sm resize-y"
          value={rules}
          onChange={e => setRules(e.target.value)}
          placeholder="Ex: Sempre incluir SKU-XYZ para pedidos acima de 100 unidades…"
        />
        <div className="flex gap-2">
          <button onClick={handleSaveRules} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90">
            Salvar Regras
          </button>
          <button onClick={handleResetRules} className="px-4 py-2 border rounded-md text-sm hover:bg-muted">
            Restaurar Padrão
          </button>
        </div>
      </div>

      {/* Template WhatsApp */}
      <div className="bg-white rounded-lg border shadow-sm p-5 space-y-3">
        <div>
          <h2 className="font-medium">Template WhatsApp</h2>
          <p className="text-xs text-muted-foreground">
            Mensagem padrão enviada pelo WhatsApp. Variáveis disponíveis:
          </p>
          <p className="text-xs text-muted-foreground font-mono mt-1">
            (nome) · (primeiro_nome) · (numero_pedido) · (empresa) · (Saudacao) · (link_orcamento)
          </p>
        </div>
        <textarea
          className="w-full min-h-[100px] rounded-md border bg-background px-3 py-2 text-sm resize-y"
          value={waTemplate}
          onChange={e => setWaTemplate(e.target.value)}
        />
        <div className="flex gap-2">
          <button onClick={handleSaveWa} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90">
            Salvar Template
          </button>
          <button onClick={handleResetWa} className="px-4 py-2 border rounded-md text-sm hover:bg-muted">
            Restaurar Padrão
          </button>
        </div>
      </div>

      {/* Saved toast */}
      {saved && (
        <div className="fixed bottom-6 right-6 bg-green-600 text-white px-4 py-2 rounded-lg text-sm shadow-lg animate-in">
          ✓ Salvo com sucesso!
        </div>
      )}
    </div>
  );
}
