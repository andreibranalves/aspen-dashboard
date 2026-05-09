/**
 * Fluxo automático: texto/imagem → extract → cards de revisão → criar orçamento.
 * Placeholder — será implementado na Fase 3.
 */
export default function AutoQuotePage() {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border shadow-sm p-8 text-center">
        <p className="text-lg text-muted-foreground mb-2">
          🤖 Fluxo Automático de Orçamento
        </p>
        <p className="text-sm text-muted-foreground">
          Cole o texto do cliente ou arraste uma imagem para extrair os pedidos
        </p>
        <div className="mt-4 p-6 border-2 border-dashed rounded-lg max-w-xl mx-auto">
          <p className="text-muted-foreground">Área de input (texto/imagem)</p>
        </div>
      </div>
    </div>
  );
}
