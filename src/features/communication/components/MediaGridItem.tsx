import { useState } from 'react';
import { ArrowUpRight, FileText, Image, Trash2, Video } from 'lucide-react';
import type { MediaItem } from '@/lib/api/communicationApi';
import { Button } from '@/components/ui/button';

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
      <div className="grid h-32 place-items-center overflow-hidden rounded-control bg-surface-selected text-light-sage">
        {isImage && !previewError && item.blob_url ? (
          <img src={item.blob_url} alt="" loading="lazy" onError={() => setPreviewError(true)} className="h-full w-full object-cover" />
        ) : <Icon size={34} strokeWidth={1.4} aria-hidden="true" />}
      </div>
      <h3 className="mt-4 truncate text-sm font-semibold" title={item.title || undefined}>{item.title || 'Sem título'}</h3>
      <p className="mt-3 truncate text-xs text-fg-muted">{type}{size ? ` · ${size}` : ''}</p>
      {item.caption && <p className="mt-1 truncate text-2xs text-fg-muted" title={item.caption}>{item.caption}</p>}
      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {item.active === false && <span className="rounded-control bg-raised px-2 py-1 text-3xs text-fg-muted">Inativa</span>}
          {onDelete && <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"><Button type="button" variant="ghost-muted-destructive" size="icon-sm" onClick={() => onDelete(item)} aria-label={`Remover ${item.title || 'mídia'}`}><Trash2 aria-hidden="true" /></Button></span>}
        </div>
        {item.blob_url && <Button asChild variant="outline" size="xs"><a href={item.blob_url} target="_blank" rel="noopener noreferrer"><ArrowUpRight aria-hidden="true" />Ver mídia</a></Button>}
      </div>
    </article>
  );
}
