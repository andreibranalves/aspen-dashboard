/**
 * Lista de orçamentos com tabela, totais, filtros e ações.
 * Placeholder — será implementado na Fase 2.
 */
export default function QuotationsPage({ navigate }) {
  return (
    <div className="space-y-4">
      {/* Totals bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {['Total', 'Enviados', 'Em Negociação', 'Fechados'].map(label => (
          <div key={label} className="bg-white rounded-lg border p-4 shadow-sm">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold">—</p>
          </div>
        ))}
      </div>

      {/* Table placeholder */}
      <div className="bg-white rounded-lg border shadow-sm p-8 text-center">
        <p className="text-muted-foreground text-lg mb-2">
          📋 Lista de Orçamentos
        </p>
        <p className="text-sm text-muted-foreground">
          Tabela com colunas: Nº, Cliente, Data, Valor, Status, Ações
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          (será implementada na Fase 2)
        </p>
      </div>
    </div>
  );
}
