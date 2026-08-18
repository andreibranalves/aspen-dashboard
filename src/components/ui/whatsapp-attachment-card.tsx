import { FileText, Image as ImageIcon, Music, FileSpreadsheet } from 'lucide-react';
import { type WhatsappAttachment } from '@/lib/api/whatsappInboxApi';
import { cn } from '@/lib/utils';

export function WhatsAppAttachmentCard({ attachment }: { attachment: WhatsappAttachment }) {
  const isQuotation = attachment.documentRole === 'quotation_pdf';

  const icon = isQuotation ? (
    <FileSpreadsheet className="text-primary size-5" />
  ) : attachment.kind === 'image' ? (
    <ImageIcon className="text-fg-muted size-5" />
  ) : attachment.kind === 'audio' ? (
    <Music className="text-fg-muted size-5" />
  ) : (
    <FileText className="text-fg-muted size-5" />
  );

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg p-3 border',
        isQuotation ? 'border-primary bg-primary/5' : 'border-line bg-surface-muted'
      )}
    >
      {icon}
      <div className="flex-1 min-w-0">
        <p
          className={cn('text-xs font-semibold truncate', isQuotation ? 'text-primary' : 'text-fg')}
        >
          {isQuotation ? 'Orçamento PDF' : attachment.fileName || 'Arquivo'}
        </p>
        <p className="text-[10px] text-fg-muted truncate">
          {attachment.caption ||
            (attachment.kind === 'image'
              ? 'Imagem'
              : attachment.kind === 'audio'
                ? 'Áudio'
                : 'Documento')}
        </p>
      </div>
    </div>
  );
}
