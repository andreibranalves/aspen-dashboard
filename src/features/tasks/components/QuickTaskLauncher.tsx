import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ListPlus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/shared/toast';
import { createTask, routeTaskContext } from '../tasks';

const SHORTCUT_KEY = 't';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
}

/** `compact`: só o ícone, para a barra superior do celular. */
export default function QuickTaskLauncher({ route, compact = false }: { route: string; compact?: boolean }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [linked, setLinked] = useState(true);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const context = routeTaskContext(route);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() !== SHORTCUT_KEY) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (isEditableTarget(event.target) || document.querySelector('[role=dialog]')) return;
      event.preventDefault();
      setOpen(true);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const close = () => {
    setOpen(false);
    setTitle('');
    setDueOn('');
    setLinked(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await createTask({
        title,
        due_on: dueOn || null,
        sales_order_id: linked && context?.kind === 'sales_order' ? context.id : null,
        client_id: linked && context?.kind === 'client' ? context.id : null,
      });
      toast('Tarefa criada.', 'success');
      close();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Não foi possível criar a tarefa.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="soft"
        size={compact ? 'icon' : 'sm'}
        onClick={() => setOpen(true)}
        title={compact ? undefined : 'Nova tarefa (T)'}
        aria-label={compact ? 'Nova tarefa' : undefined}
      >
        {compact ? <ListPlus aria-hidden="true" /> : <Plus aria-hidden="true" />}
        {!compact && 'Tarefa'}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="Nova tarefa"
        dismissible={!saving}
        initialFocusRef={titleRef}
      >
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <div className="flex gap-2">
            <Input
              ref={titleRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={300}
              placeholder="O que precisa ser feito?"
              aria-label="Título da tarefa"
            />
            <Input
              type="date"
              value={dueOn}
              onChange={(event) => setDueOn(event.target.value)}
              aria-label="Data da tarefa"
              className="w-40 shrink-0"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            {context ? (
              <label className="flex items-center gap-2 text-xs text-fg-muted">
                <input
                  type="checkbox"
                  checked={linked}
                  onChange={(event) => setLinked(event.target.checked)}
                />
                {context.kind === 'sales_order' ? 'Vincular a este pedido' : 'Vincular a este cliente'}
              </label>
            ) : (
              <span />
            )}
            <Button type="submit" size="sm" disabled={!title.trim() || saving}>
              {saving ? 'Salvando...' : 'Criar'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
