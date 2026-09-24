// Regras puras das tarefas do operador (#327), sem dependência de rede.

export type TaskLink =
  | { kind: 'sales_order'; id: string; label: string }
  | { kind: 'client'; id: string; label: string };

export interface OperatorTask {
  id: string;
  title: string;
  due_on: string | null;
  link: TaskLink | null;
  created_at: string;
}

export interface TaskListResult {
  tasks: OperatorTask[];
  today: string;
  overdue_count: number;
}

export interface NewTaskInput {
  title: string;
  due_on?: string | null;
  sales_order_id?: string | null;
  client_id?: string | null;
}

export type TaskGroupKey = 'overdue' | 'today' | 'upcoming' | 'undated';

export const TASK_GROUPS: Array<{ key: TaskGroupKey; label: string }> = [
  { key: 'overdue', label: 'Atrasadas' },
  { key: 'today', label: 'Hoje' },
  { key: 'upcoming', label: 'Próximas' },
  { key: 'undated', label: 'Sem data' },
];

export function taskGroup(task: OperatorTask, today: string): TaskGroupKey {
  if (!task.due_on) return 'undated';
  if (task.due_on < today) return 'overdue';
  if (task.due_on === today) return 'today';
  return 'upcoming';
}

export function taskLinkRoute(link: TaskLink): string {
  return link.kind === 'sales_order'
    ? `/sales-orders/${encodeURIComponent(link.id)}`
    : `/leads/cliente/${encodeURIComponent(link.id)}`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Pedido ou cliente aberto na tela atual, para vincular a anotação rápida. */
export function routeTaskContext(route: string): { kind: TaskLink['kind']; id: string } | null {
  const path = route.split('?')[0] || '';
  const order = /^\/sales-orders\/([^/]+)$/.exec(path);
  if (order && UUID_PATTERN.test(decodeURIComponent(order[1]!))) {
    return { kind: 'sales_order', id: decodeURIComponent(order[1]!) };
  }
  const client = /^\/leads\/cliente\/([^/]+)$/.exec(path);
  if (client && UUID_PATTERN.test(decodeURIComponent(client[1]!))) {
    return { kind: 'client', id: decodeURIComponent(client[1]!) };
  }
  return null;
}
