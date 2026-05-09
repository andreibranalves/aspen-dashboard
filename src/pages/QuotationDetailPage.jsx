/**
 * Detalhe de um orçamento específico.
 * Placeholder — será implementado na Fase 2.
 */
export default function QuotationDetailPage({ id, navigate }) {
  return (
    <div className="space-y-4">
      <button
        onClick={() => navigate('/quotations')}
        className="text-sm text-primary hover:underline"
      >
        ← Voltar para Orçamentos
      </button>
      <div className="bg-white rounded-lg border shadow-sm p-8 text-center">
        <p className="text-lg text-muted-foreground mb-2">
          📄 Detalhe do Orçamento
        </p>
        <p className="text-sm font-mono text-muted-foreground">{id}</p>
        <p className="text-xs text-muted-foreground mt-2">
          Itens, cliente, valores, botão PDF, WhatsApp, editar, excluir
        </p>
      </div>
    </div>
  );
}
