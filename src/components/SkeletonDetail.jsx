import Skeleton from '@/components/Skeleton.jsx';

/**
 * SkeletonDetail — simula uma página de detalhe durante o carregamento.
 * Espelha a estrutura do QuotationDetailPage: header, meta grid, tabela de itens, totais e ações.
 */
export default function SkeletonDetail() {
  return (
    <div
      className="space-y-4 max-w-[1060px] mx-auto"
      aria-busy="true"
      aria-label="Carregando detalhes"
    >
      {/* Back button placeholder */}
      <div className="self-start">
        <Skeleton className="h-5 w-28" />
      </div>

      {/* Detail card */}
      <div className="bg-surface rounded-lg border border-line shadow-sm">
        {/* Header — font-mono text-lg font-semibold + badge + botões sm (h-8) */}
        <div className="px-6 py-4 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="h-7 w-36" />
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>

        {/* Meta grid — labels text-xs, valores text-base font-medium */}
        <div className="px-6 py-4 border-b border-line grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-5 w-40" />
          </div>
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-5 w-28" />
          </div>
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-5 w-28" />
          </div>
        </div>

        {/* Items table — header h-10, rows p-4 text-sm */}
        <div className="px-6 py-4">
          <div className="rounded-lg border border-line overflow-hidden">
            {/* Table header */}
            <div className="px-4 border-b border-line flex items-center gap-4 h-10 bg-surface-muted/30">
              <Skeleton className="h-4 w-[25%]" />
              <Skeleton className="h-4 w-[30%]" />
              <Skeleton className="h-4 w-[12%]" />
              <Skeleton className="h-4 w-[15%]" />
              <Skeleton className="h-4 w-[15%] ml-auto" />
            </div>
            {/* Table rows */}
            <div className="divide-y divide-line">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="px-4 flex items-center gap-4 h-14">
                  <Skeleton className="h-4 w-[25%]" />
                  <Skeleton className="h-4 w-[30%]" />
                  <Skeleton className="h-4 w-[12%]" />
                  <Skeleton className="h-4 w-[15%]" />
                  <Skeleton className={`h-4 w-[15%] ml-auto ${i % 2 === 1 ? 'opacity-60' : ''}`} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Totals */}
        <div className="px-6 py-3 border-t border-line flex justify-end">
          <div className="space-y-1.5 text-right">
            <Skeleton className="h-4 w-20 ml-auto" />
            <Skeleton className="h-6 w-28 ml-auto" />
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-line flex items-center gap-3">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
    </div>
  );
}
