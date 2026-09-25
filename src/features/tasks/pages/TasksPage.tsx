import { useCallback, useEffect, useState } from 'react';
import { Check, ListTodo } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import ListPageLayout from '@/components/shared/ListPageLayout';
import SkeletonTable from '@/components/shared/SkeletonTable';
import ErrorState from '@/components/shared/ErrorState';
import { EmptyState } from '@/components/shared/EmptyState';
import { useToast } from '@/components/shared/toast';
import { Button } from '@/components/ui/button';
import { Heading } from '@/components/ui/heading';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  TASK_GROUPS,
  TASKS_CHANGED_EVENT,
  completeTask,
  fetchTasks,
  taskGroup,
  taskLinkRoute,
  updateTaskDueOn,
  type OperatorTask,
} from '../tasks';
import { useMediaQuery } from '@/hooks/useMediaQuery';

export default function TasksPage({ navigate }: { navigate: (hash: string) => void }) {
  // A dica do atalho T só vale com teclado e ponteiro fino.
  const hasKeyboard = useMediaQuery('(pointer: fine)');
  const { toast } = useToast();
  const [tasks, setTasks] = useState<OperatorTask[]>([]);
  const [today, setToday] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await fetchTasks();
      setTasks(result.tasks);
      setToday(result.today);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const reload = () => void load();
    window.addEventListener(TASKS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(TASKS_CHANGED_EVENT, reload);
  }, [load]);

  const complete = async (task: OperatorTask) => {
    setTasks((current) => current.filter((item) => item.id !== task.id));
    try {
      await completeTask(task.id);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não foi possível concluir a tarefa.', 'error');
      void load();
    }
  };

  const changeDueOn = async (task: OperatorTask, value: string) => {
    try {
      await updateTaskDueOn(task.id, value || null);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não foi possível alterar a data.', 'error');
      void load();
    }
  };

  const groups = TASK_GROUPS.map((group) => ({
    ...group,
    tasks: tasks.filter((task) => taskGroup(task, today) === group.key),
  })).filter((group) => group.tasks.length > 0);

  return (
    <ListPageLayout header={<PageHeader title="Tarefas" />}>
      {loading && <SkeletonTable rows={4} />}
      {!loading && error && (
        <ErrorState title="Não foi possível carregar as tarefas" onRetry={() => void load()} />
      )}
      {!loading && !error && tasks.length === 0 && (
        <EmptyState
          icon={ListTodo}
          title="Nenhuma tarefa aberta."
          description={hasKeyboard ? 'Pressione T ou use + Tarefa para anotar.' : 'Use o botão de tarefa no topo para anotar.'}
        />
      )}
      {!loading &&
        !error &&
        groups.map((group) => (
          <section
            key={group.key}
            aria-label={group.label}
            className="flex flex-col gap-2 rounded-card bg-surface p-5"
          >
            <Heading level="subsection" as="h2">
              {group.label}{' '}
              <span
                className={cn(
                  'font-normal',
                  group.key === 'overdue' ? 'text-destructive' : 'text-fg-muted'
                )}
              >
                {group.tasks.length}
              </span>
            </Heading>
            <ul className="flex flex-col divide-y divide-line">
              {group.tasks.map((task) => (
                <li key={task.id} className="flex flex-wrap items-center gap-3 py-2">
                  <Button
                    type="button"
                    variant="ghost-muted"
                    size="icon-sm"
                    aria-label={`Concluir ${task.title}`}
                    title="Concluir"
                    onClick={() => void complete(task)}
                  >
                    <Check aria-hidden="true" />
                  </Button>
                  <span className="min-w-0 flex-1 break-words text-sm text-fg">{task.title}</span>
                  {task.link && (
                    <Button
                      type="button"
                      variant="link"
                      size="inline"
                      onClick={() => navigate(taskLinkRoute(task.link!))}
                    >
                      {task.link.label}
                    </Button>
                  )}
                  <Input
                    type="date"
                    size="xs"
                    defaultValue={task.due_on || ''}
                    key={`${task.id}:${task.due_on || ''}`}
                    onBlur={(event) => {
                      if (event.target.value !== (task.due_on || '')) {
                        void changeDueOn(task, event.target.value);
                      }
                    }}
                    aria-label={`Data de ${task.title}`}
                    className="w-36 shrink-0"
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
    </ListPageLayout>
  );
}
