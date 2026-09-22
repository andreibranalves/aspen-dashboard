import { useState } from 'react';
import { ArrowUpRight, FileText, Image, Trash2, Video } from 'lucide-react';
import type { MediaItem } from '@/lib/api/communicationApi';

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface MediaGridItemProps {
  item: MediaItem;
  onDelete?: (item: MediaItem) => void;
}

export default function MediaGridItem({ item, onDelete }: MediaGridItemProps) {
  const [previewError, setPreviewError] = useState(false);
  const isVideo = item.kind === 'video';
  const isImage = item.content_type?.startsWith('image/') || (!isVideo && item.kind === 'image');
  const Icon = isVideo ? Video : isImage ? Image : FileText;
  const type = isVideo ? 'Vídeo' : isImage ? 'Imagem' : 'Documento';
  const size = formatBytes(item.size_bytes);

  return (
    <article className="group min-w-0 rounded-card bg-surface p-5">
      <div className="grid h-32 place-items-center overflow-hidden rounded-control bg-[#273129] text-light-sage">
        {isImage && !previewError && item.blob_url ? (
          <img src={item.blob_url} alt="" loading="lazy" onError={() => setPreviewError(true)} className="h-full w-full object-cover" />
        ) : <Icon size={34} strokeWidth={1.4} aria-hidden="true" />}
      </div>
      <h3 className="mt-4 truncate text-sm font-semibold" title={item.title || undefined}>{item.title || 'Sem título'}</h3>
      <p className="mt-3 truncate text-xs text-fg-muted">{type}{size ? ` · ${size}` : ''}</p>
      {item.caption && <p className="mt-1 truncate text-[11px] text-fg-muted" title={item.caption}>{item.caption}</p>}
      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {item.active === false && <span className="rounded-control bg-raised px-2 py-1 text-[10px] text-fg-muted">Inativa</span>}
          {onDelete && <button type="button" onClick={() => onDelete(item)} className="inline-flex size-8 items-center justify-center rounded-control text-fg-muted opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100" aria-label={`Remover ${item.title || 'mídia'}`}><Trash2 size={14} aria-hidden="true" /></button>}
        </div>
        {item.blob_url && <a href={item.blob_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-control border border-line px-2 text-xs hover:bg-raised"><ArrowUpRight size={14} aria-hidden="true" />Ver mídia</a>}
      </div>
    </article>
  );
}
