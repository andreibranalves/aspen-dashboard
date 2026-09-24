import { useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '@/lib/api/api';
import type { NewTaskInput, OperatorTask, TaskListResult } from './taskRules.ts';

export * from './taskRules.ts';

export const TASKS_CHANGED_EVENT = 'aspen:tasks-changed';

function notifyChanged(): void {
  window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));
}

export function fetchTasks(): Promise<TaskListResult> {
  return apiGet('/tasks');
}

export async function createTask(input: NewTaskInput): Promise<OperatorTask> {
  const result = await apiPost<{ task: OperatorTask }>('/tasks', input);
  notifyChanged();
  return result.task;
}

export async function updateTaskDueOn(id: string, dueOn: string | null): Promise<OperatorTask> {
  const result = await apiPatch<{ task: OperatorTask }>(`/tasks?id=${encodeURIComponent(id)}`, {
    due_on: dueOn,
  });
  notifyChanged();
  return result.task;
}

export async function completeTask(id: string): Promise<void> {
  await apiPatch(`/tasks?id=${encodeURIComponent(id)}`, { action: 'complete' });
  notifyChanged();
}

/** Tarefas atrasadas, para o número do item Tarefas no menu. */
export function useOverdueTaskCount(route: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () => {
      apiGet<{ overdue_count?: unknown }>('/tasks?view=alerts')
        .then((result) => {
          const value = Number(result?.overdue_count);
          if (active) setCount(Number.isSafeInteger(value) && value > 0 ? value : 0);
        })
        .catch(() => undefined);
    };
    load();
    window.addEventListener(TASKS_CHANGED_EVENT, load);
    return () => {
      active = false;
      window.removeEventListener(TASKS_CHANGED_EVENT, load);
    };
  }, [route]);
  return count;
}
