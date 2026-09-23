import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';

import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
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
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!saving}
      size="md"
      title="Etapas do funil"
      initialFocusRef={newStageRef}
    >
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
        <ol className="mt-5 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface-subtle">
          {stages.map((stage, index) => {
            const removalReason = stage.role
              ? 'Etapa obrigatória'
              : stage.dealCount > 0
                ? `Mova ${stage.dealCount} ${stage.dealCount === 1 ? 'negócio' : 'negócios'} antes de remover`
                : null;
            return (
              <li key={stage.key} className="flex min-h-14 items-center gap-2 px-3 py-2 transition-colors hover:bg-surface-hover">
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

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Remover etapa"
        message={`Remover “${pendingDelete?.name || ''}”? A etapa deixa de aparecer no funil.`}
        confirmLabel="Remover etapa"
        onCancel={() => !saving && setPendingDelete(null)}
        onConfirm={() => void removeStage()}
      />
    </Dialog>
  );
}
