import type { ClipboardEvent, DragEvent, ReactNode } from 'react';
import { Loader2, PackagePlus, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Heading } from '@/components/ui/heading';
import { Textarea } from '@/components/ui/textarea';

interface QuoteOrderStepProps {
  text: string;
  onTextChange: (text: string) => void;
  imagePreview: string | null;
  onImageFile: (file: File | null) => void;
  onClearImage: () => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  extracting: boolean;
  /** Emissão, salvamento ou preço em andamento: nada no pedido pode mudar. */
  blocked: boolean;
  canExtract: boolean;
  onExtract: () => void;
  canReset: boolean;
  onReset: () => void;
  onManageTemplates: () => void;
  /** Avisos do pedido: demanda do Atendimento, falha de extração ou de modelos. */
  notices?: ReactNode;
}

/** Etapa 1 do card: o texto ou a imagem do pedido e a extração. */
export default function QuoteOrderStep({
  text,
  onTextChange,
  imagePreview,
  onImageFile,
  onClearImage,
  onDragOver,
  onDragLeave,
  onDrop,
  extracting,
  blocked,
  canExtract,
  onExtract,
  canReset,
  onReset,
  onManageTemplates,
  notices,
}: QuoteOrderStepProps) {
  return (
    <>
      <div className="flex flex-col gap-3 px-5 py-3.5 md:px-6">
        <div className="flex items-center justify-between gap-3">
          <Heading level="card">Cole o pedido do cliente</Heading>
          <Button type="button" variant="ghost-muted" size="xs" onClick={onManageTemplates} disabled={blocked}>
            <SlidersHorizontal size={14} /> Gerenciar modelos
          </Button>
        </div>
        {notices}
        <div className="relative rounded-control border border-border-control bg-raised">
          <Textarea
            aria-label="Mensagem do cliente para extração"
            value={text}
            disabled={extracting || blocked}
            onChange={(event) => onTextChange(event.target.value)}
            onPaste={(event: ClipboardEvent<HTMLTextAreaElement>) => {
              for (const item of Array.from(event.clipboardData?.items || [])) {
                if (item.type.startsWith('image/')) {
                  event.preventDefault();
                  onImageFile(item.getAsFile());
                  break;
                }
              }
            }}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            placeholder="Cole aqui a mensagem do cliente..."
            variant="bare"
            className={imagePreview ? 'min-h-48 pt-20' : 'min-h-48'}
          />
          {imagePreview && (
            // eslint-disable-next-line no-restricted-syntax -- miniatura da imagem é o próprio botão
            <button
              type="button"
              aria-label="Remover imagem colada"
              title="Remover imagem"
              disabled={blocked}
              onClick={onClearImage}
              className="group absolute left-3 top-3 size-14 overflow-hidden rounded-control disabled:opacity-50"
            >
              <img src={imagePreview} alt="" className="size-full object-cover" />
              <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <X size={14} />
              </span>
            </button>
          )}
        </div>
      </div>
      <footer className="flex flex-wrap items-center gap-2 px-5 pb-4 pt-5 md:px-6">
        <Button type="button" variant="ghost" onClick={onReset} disabled={!canReset}>
          Limpar
        </Button>
        <Button type="button" className="ml-auto" onClick={onExtract} disabled={!canExtract}>
          {extracting ? <><Loader2 size={14} className="animate-spin" /> Extraindo…</> : <><PackagePlus size={14} /> Extrair dados</>}
        </Button>
      </footer>
    </>
  );
}
