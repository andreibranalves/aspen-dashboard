import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Settings2, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePipelineStages, type PipelineStage } from './usePipelineStages';

interface PipelineStagesDialogProps {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}

export default function PipelineStagesDialog({
  open,
  onClose,
  onChanged,
}: PipelineStagesDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const newStageRef = useRef<HTMLInputElement>(null);
  const [newName, setNewName] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<PipelineStage | null>(null);
  const { stages, loading, saving, error, create, rename, move, remove } = usePipelineStages(
    open,
    onChanged
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setEditingKey(null);
    setPendingDelete(null);
  }, [open]);

  useEffect(() => {
    if (open && !loading) newStageRef.current?.focus();
  }, [loading, open]);

  async function createStage(event: FormEvent) {
    event.preventDefault();
    if (await create(newName)) {
      setNewName('');
      newStageRef.current?.focus();
    }
  }

  async function saveName(event: FormEvent) {
    event.preventDefault();
    if (editingKey && (await rename(editingKey, editingName))) setEditingKey(null);
  }

  async function removeStage() {
    if (pendingDelete && (await remove(pendingDelete))) setPendingDelete(null);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="pipeline-stages-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
      onClose={onClose}
      className="m-auto max-h-[calc(100vh-2rem)] w-[min(36rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-line bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div className="flex items-center gap-3">
          <Settings2 className="text-fg-muted" aria-hidden="true" />
          <h2 id="pipeline-stages-title" className="font-semibold">
            Editar etapas do funil
          </h2>
        </div>
        <Button variant="ghost" size="icon" aria-label="Fechar" onClick={onClose} disabled={saving}>
          <X aria-hidden="true" />
        </Button>
      </div>

      <div className="max-h-[calc(100vh-9rem)] overflow-y-auto p-5">
        <form className="flex gap-2" onSubmit={createStage}>
          <label htmlFor="new-pipeline-stage" className="sr-only">
            Nova etapa
          </label>
          <Input
            ref={newStageRef}
            id="new-pipeline-stage"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Nome da nova etapa"
            maxLength={80}
            disabled={saving}
          />
          <Button type="submit" disabled={saving || !newName.trim()}>
            <Plus aria-hidden="true" /> Adicionar
          </Button>
        </form>

        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status" className="py-10 text-center text-sm text-fg-muted">
            Carregando etapas…
          </p>
        ) : (
          <ol className="mt-5 divide-y divide-line rounded-lg border border-line">
            {stages.map((stage, index) => {
              const removalReason = stage.role
                ? 'Etapa obrigatória'
                : stage.dealCount > 0
                  ? `Mova ${stage.dealCount} ${stage.dealCount === 1 ? 'negócio' : 'negócios'} antes de remover`
                  : null;
              return (
                <li key={stage.key} className="flex min-h-14 items-center gap-2 px-3 py-2">
                  <div className="flex shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={saving || index === 0}
                      aria-label={`Mover ${stage.name} para cima`}
                      onClick={() => void move(index, -1)}
                    >
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={saving || index === stages.length - 1}
                      aria-label={`Mover ${stage.name} para baixo`}
                      onClick={() => void move(index, 1)}
                    >
                      <ArrowDown aria-hidden="true" />
                    </Button>
                  </div>
                  {editingKey === stage.key ? (
                    <form className="flex min-w-0 flex-1 gap-2" onSubmit={saveName}>
                      <label htmlFor={`pipeline-stage-${stage.key}`} className="sr-only">
                        Nome da etapa
                      </label>
                      <Input
                        id={`pipeline-stage-${stage.key}`}
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                        maxLength={80}
                        disabled={saving}
                        autoFocus
                      />
                      <Button size="sm" type="submit" disabled={saving || !editingName.trim()}>
                        Salvar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        type="button"
                        onClick={() => setEditingKey(null)}
                        disabled={saving}
                      >
                        Cancelar
                      </Button>
                    </form>
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{stage.name}</p>
                        <p className="text-xs text-fg-muted">
                          {stage.role
                            ? 'Obrigatória'
                            : `${stage.dealCount} ${stage.dealCount === 1 ? 'negócio' : 'negócios'}`}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Renomear ${stage.name}`}
                        onClick={() => {
                          setEditingKey(stage.key);
                          setEditingName(stage.name);
                        }}
                        disabled={saving}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={
                          removalReason
                            ? `Não é possível remover ${stage.name}: ${removalReason}`
                            : `Remover ${stage.name}`
                        }
                        title={removalReason || `Remover ${stage.name}`}
                        onClick={() => setPendingDelete(stage)}
                        disabled={saving || removalReason !== null}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {pendingDelete && (
          <div
            role="alertdialog"
            aria-labelledby="remove-stage-title"
            className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4"
          >
            <p id="remove-stage-title" className="text-sm font-medium">
              Remover “{pendingDelete.name}”?
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPendingDelete(null)}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void removeStage()}
                disabled={saving}
              >
                Remover etapa
              </Button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
