// MediaUploader — file drag-drop + picker for Vercel Blob client upload.
// The existing upload and metadata calls remain unchanged.

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { CheckCircle2, Loader2, Upload } from 'lucide-react';
import { upload } from '@vercel/blob/client';
import { Button } from '@/components/ui/button';
import InlineAlert from '@/components/shared/InlineAlert';
import { Select } from '@/components/ui/select';
import {
  createMedia,
  fetchProductCategories,
  mediaGroupPathSegment,
  normalizeProductGroup,
} from '@/lib/api/communicationApi';
import type { ProductGroup } from '@/lib/api/communicationApi';
import { Heading } from '@/components/ui/heading';

export interface MediaUploaderProps {
  onUploadComplete?: () => void;
}

function errorMessage(_error: unknown, fallback: string): string {
  return fallback;
}

export default function MediaUploader({ onUploadComplete }: MediaUploaderProps) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [error, setError] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [groups, setGroups] = useState<Array<{ value: ProductGroup; label: string }>>([]);
  const [selectedGroup, setSelectedGroup] = useState<ProductGroup>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadGroups = useCallback(async () => {
    setGroupsLoading(true);
    setCategoryError('');
    try {
      const categories = await fetchProductCategories();
      const seen = new Set<string>();
      const options = categories.flatMap((label) => {
        const value = normalizeProductGroup(label);
        if (!value || seen.has(value)) return [];
        seen.add(value);
        return [{ value, label }];
      });
      setGroups(options);
      setSelectedGroup((current) =>
        options.some((option) => option.value === current) ? current : options[0]?.value || ''
      );
    } catch (loadError) {
      setCategoryError(errorMessage(loadError, 'Não foi possível carregar os grupos de produto.'));
    } finally {
      setGroupsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      if (!selectedGroup) {
        setError('Selecione um grupo de produto antes de enviar o arquivo.');
        return;
      }

      const file = files[0];
      const isVideo = file.type.startsWith('video/');
      const maxSize = isVideo ? 16 * 1024 * 1024 : 5 * 1024 * 1024;
      if (file.size > maxSize) {
        setError(`Arquivo muito grande. Máximo: ${isVideo ? '16 MB' : '5 MB'}.`);
        return;
      }

      setError('');
      setSuccessMessage('');
      setUploading(true);

      try {
        const groupPath = await mediaGroupPathSegment(selectedGroup);
        const pathname = `aspen-media/${groupPath}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

        const result = await upload(pathname, file, {
          access: 'public',
          handleUploadUrl: '/api/communication-media-upload',
          clientPayload: JSON.stringify({ product_group: selectedGroup }),
        });

        const title = file.name.replace(/\.[^.]+$/, '');
        await createMedia({
          title,
          product_group: selectedGroup,
          kind: isVideo ? 'video' : 'image',
          blob_url: result.url,
          pathname: result.pathname || pathname,
          content_type: file.type,
          size_bytes: file.size,
          caption: '',
        });

        setSuccessMessage(`Arquivo “${title}” enviado para a biblioteca.`);
        onUploadComplete?.();
      } catch (uploadError) {
        setError(
          errorMessage(
            uploadError,
            'Não foi possível concluir o upload. Verifique a configuração do armazenamento.'
          )
        );
      } finally {
        setUploading(false);
      }
    },
    [onUploadComplete, selectedGroup]
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      void handleFiles(event.dataTransfer?.files ?? null);
    },
    [handleFiles]
  );

  const onDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (!uploading && groups.length > 0) setDragging(true);
    },
    [groups.length, uploading]
  );

  const onDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
  }, []);

  const onDropZoneKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (uploading || groups.length === 0 || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      fileInputRef.current?.click();
    },
    [groups.length, uploading]
  );

  return (
    <section
      className="space-y-4 rounded-card bg-surface p-5 sm:p-5.5"
      aria-labelledby="media-upload-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Heading level="section" id="media-upload-title">
            Adicionar mídia
          </Heading>
          <p className="mt-1 text-sm text-fg-muted">
            Envie uma imagem ou vídeo para um grupo de produto existente.
          </p>
        </div>
        <Upload size={20} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden="true" />
      </div>

      <label htmlFor="media-product-group" className="flex flex-col gap-1.5 text-sm text-fg">
        <span className="font-medium">Grupo de produto</span>
        <Select
          id="media-product-group"
          value={selectedGroup}
          onChange={(event) => setSelectedGroup(event.target.value as ProductGroup)}
          disabled={uploading || groupsLoading || groups.length === 0}
          className="w-full"
        >
          {groupsLoading && <option value="">Carregando grupos…</option>}
          {!groupsLoading && groups.length === 0 && (
            <option value="">Nenhuma categoria cadastrada</option>
          )}
          {groups.map((group) => (
            <option key={group.value} value={group.value}>
              {group.label}
            </option>
          ))}
        </Select>
      </label>

      {categoryError && (
        <InlineAlert
          action={
            <Button variant="outline" size="sm" onClick={() => void loadGroups()}>
              Tentar novamente
            </Button>
          }
        >
          {categoryError}
        </InlineAlert>
      )}

      <div
        role="button"
        tabIndex={uploading || groups.length === 0 ? -1 : 0}
        aria-disabled={uploading || groups.length === 0}
        aria-label="Selecionar arquivo de imagem ou vídeo para upload"
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onKeyDown={onDropZoneKeyDown}
        onClick={() => !uploading && groups.length > 0 && fileInputRef.current?.click()}
        className={[
          'relative flex min-h-36 items-center justify-center rounded-control border border-dashed p-6 text-center transition-colors',
          dragging
            ? 'border-light-sage bg-sage/20'
            : 'border-line bg-raised hover:border-light-sage hover:bg-surface-hover',
          uploading || groups.length === 0 ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        ].join(' ')}
      >
        {uploading ? (
          <div className="flex flex-col items-center gap-2" role="status" aria-live="polite">
            <Loader2 size={32} className="animate-spin text-primary" aria-hidden="true" />
            <p className="text-sm text-fg-muted">Enviando arquivo…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload size={32} className="text-fg-muted" aria-hidden="true" />
            <p className="text-sm text-fg-muted">
              Arraste uma imagem ou vídeo aqui, ou pressione Enter para selecionar
            </p>
            <p className="text-xs text-fg-muted/70">JPEG, PNG, WebP (até 5 MB) · MP4 (até 16 MB)</p>
          </div>
        )}
        <input
          ref={fileInputRef}
          id="media-file"
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4"
          onChange={(event) => {
            void handleFiles(event.target.files);
            event.currentTarget.value = '';
          }}
          className="sr-only"
          tabIndex={-1}
        />
      </div>

      {error && (
        <InlineAlert>{error}</InlineAlert>
      )}

      {successMessage && (
        <div
          className="flex items-start gap-2 rounded-control border border-success/25 bg-success/10 p-3 text-sm text-fg"
          role="status"
          aria-live="polite"
        >
          <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
          <p>{successMessage}</p>
        </div>
      )}
    </section>
  );
}
