import { and, asc, eq, isNull, lt, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { getDatabase, type AppDatabase } from '../client.js';
import { clients, operatorTasks, salesOrders } from '../schema.js';
import { calendarDateInSaoPaulo } from '../../../_shared/calendar-sao-paulo.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_TASK_TITLE_LENGTH = 300;
const MAX_OPEN_TASKS = 500;

export class OperatorTaskInputError extends Error {
  readonly statusCode = 400;
  readonly expose = true;

  constructor(message: string) {
    super(message);
    this.name = 'OperatorTaskInputError';
  }
}

export class OperatorTaskNotFoundError extends Error {
  readonly statusCode = 404;
  readonly expose = true;

  constructor(message = 'Tarefa não encontrada.') {
    super(message);
    this.name = 'OperatorTaskNotFoundError';
  }
}

export interface OperatorTask {
  id: string;
  title: string;
  due_on: string | null;
  link:
    | { kind: 'sales_order'; id: string; label: string }
    | { kind: 'client'; id: string; label: string }
    | null;
  created_at: string;
}

export interface OperatorTaskInput {
  title?: unknown;
  due_on?: unknown;
  sales_order_id?: unknown;
  client_id?: unknown;
}

export interface OperatorTasksRepository {
  listOpen(): Promise<{ tasks: OperatorTask[]; today: string; overdue_count: number }>;
  overdueCount(): Promise<number>;
  create(input: OperatorTaskInput): Promise<OperatorTask>;
  update(id: string, input: OperatorTaskInput): Promise<OperatorTask>;
  complete(id: string): Promise<{ id: string }>;
}

export interface OperatorTasksRepositoryOptions {
  now?: () => Date;
  idFactory?: () => string;
}

type DatabaseProvider = () => AppDatabase;

function parseTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!title) throw new OperatorTaskInputError('Informe o título da tarefa.');
  if (title.length > MAX_TASK_TITLE_LENGTH) {
    throw new OperatorTaskInputError(`O título aceita até ${MAX_TASK_TITLE_LENGTH} caracteres.`);
  }
  return title;
}

function parseDueOn(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new OperatorTaskInputError('Data da tarefa inválida.');
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new OperatorTaskInputError('Data da tarefa inválida.');
  }
  return value;
}

function parseOptionalId(value: unknown, message: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new OperatorTaskInputError(message);
  }
  return value.toLowerCase();
}

function assertTaskId(id: string): string {
  if (!UUID_PATTERN.test(id)) throw new OperatorTaskNotFoundError();
  return id.toLowerCase();
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function createPostgresOperatorTasksRepository(
  getDb: DatabaseProvider = getDatabase,
  options: OperatorTasksRepositoryOptions = {}
): OperatorTasksRepository {
  const nowFactory = options.now || (() => new Date());
  const idFactory = options.idFactory || randomUUID;
  const today = () => calendarDateInSaoPaulo(nowFactory());

  const selection = {
    id: operatorTasks.id,
    title: operatorTasks.title,
    dueOn: operatorTasks.dueOn,
    salesOrderId: operatorTasks.salesOrderId,
    clientId: operatorTasks.clientId,
    createdAt: operatorTasks.createdAt,
    orderNumber: salesOrders.orderNumber,
    clientName: clients.nome,
  };

  type Row = {
    id: string;
    title: string;
    dueOn: string | null;
    salesOrderId: string | null;
    clientId: string | null;
    createdAt: Date | string;
    orderNumber: string | null;
    clientName: string | null;
  };

  function project(row: Row): OperatorTask {
    let link: OperatorTask['link'] = null;
    if (row.salesOrderId) {
      link = { kind: 'sales_order', id: row.salesOrderId, label: row.orderNumber || 'Pedido' };
    } else if (row.clientId) {
      link = { kind: 'client', id: row.clientId, label: row.clientName || 'Cliente' };
    }
    return {
      id: row.id,
      title: row.title,
      due_on: row.dueOn,
      link,
      created_at: isoString(row.createdAt),
    };
  }

  async function readOne(db: AppDatabase, id: string): Promise<OperatorTask> {
    const [row] = await db
      .select(selection)
      .from(operatorTasks)
      .leftJoin(salesOrders, eq(salesOrders.id, operatorTasks.salesOrderId))
      .leftJoin(clients, eq(clients.id, operatorTasks.clientId))
      .where(and(eq(operatorTasks.id, id), isNull(operatorTasks.completedAt)))
      .limit(1);
    if (!row) throw new OperatorTaskNotFoundError();
    return project(row);
  }

  async function assertLinkExists(
    db: AppDatabase,
    salesOrderId: string | null,
    clientId: string | null
  ): Promise<void> {
    if (salesOrderId) {
      const [order] = await db
        .select({ id: salesOrders.id })
        .from(salesOrders)
        .where(eq(salesOrders.id, salesOrderId))
        .limit(1);
      if (!order) throw new OperatorTaskInputError('Pedido vinculado não encontrado.');
    }
    if (clientId) {
      const [client] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.id, clientId))
        .limit(1);
      if (!client) throw new OperatorTaskInputError('Cliente vinculado não encontrado.');
    }
  }

  function parseLink(input: OperatorTaskInput): { salesOrderId: string | null; clientId: string | null } {
    const salesOrderId = parseOptionalId(input.sales_order_id, 'Pedido vinculado inválido.');
    const clientId = parseOptionalId(input.client_id, 'Cliente vinculado inválido.');
    if (salesOrderId && clientId) {
      throw new OperatorTaskInputError('Vincule a tarefa a um pedido ou a um cliente, não aos dois.');
    }
    return { salesOrderId, clientId };
  }

  async function overdueCountWith(db: AppDatabase, day: string): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(operatorTasks)
      .where(and(isNull(operatorTasks.completedAt), lt(operatorTasks.dueOn, day)));
    return Number(row?.count) || 0;
  }

  return {
    async listOpen() {
      const db = getDb();
      const day = today();
      const rows = await db
        .select(selection)
        .from(operatorTasks)
        .leftJoin(salesOrders, eq(salesOrders.id, operatorTasks.salesOrderId))
        .leftJoin(clients, eq(clients.id, operatorTasks.clientId))
        .where(isNull(operatorTasks.completedAt))
        .orderBy(sql`${operatorTasks.dueOn} ASC NULLS LAST`, asc(operatorTasks.createdAt))
        .limit(MAX_OPEN_TASKS);
      const tasks = rows.map(project);
      const overdue = tasks.filter((task) => task.due_on !== null && task.due_on < day).length;
      return { tasks, today: day, overdue_count: overdue };
    },

    async overdueCount() {
      return overdueCountWith(getDb(), today());
    },

    async create(input) {
      const db = getDb();
      const title = parseTitle(input.title);
      const dueOn = parseDueOn(input.due_on);
      const { salesOrderId, clientId } = parseLink(input);
      await assertLinkExists(db, salesOrderId, clientId);
      const id = idFactory();
      const now = nowFactory();
      await db.insert(operatorTasks).values({
        id,
        title,
        dueOn,
        salesOrderId,
        clientId,
        createdAt: now,
        updatedAt: now,
      });
      return readOne(db, id);
    },

    async update(rawId, input) {
      const db = getDb();
      const id = assertTaskId(rawId);
      const patch: Partial<typeof operatorTasks.$inferInsert> = { updatedAt: nowFactory() };
      if (input.title !== undefined) patch.title = parseTitle(input.title);
      if (input.due_on !== undefined) patch.dueOn = parseDueOn(input.due_on);
      if (input.sales_order_id !== undefined || input.client_id !== undefined) {
        const { salesOrderId, clientId } = parseLink(input);
        await assertLinkExists(db, salesOrderId, clientId);
        patch.salesOrderId = salesOrderId;
        patch.clientId = clientId;
      }
      const updated = await db
        .update(operatorTasks)
        .set(patch)
        .where(and(eq(operatorTasks.id, id), isNull(operatorTasks.completedAt)))
        .returning({ id: operatorTasks.id });
      if (!updated.length) throw new OperatorTaskNotFoundError();
      return readOne(db, id);
    },

    async complete(rawId) {
      const db = getDb();
      const id = assertTaskId(rawId);
      const now = nowFactory();
      const updated = await db
        .update(operatorTasks)
        .set({ completedAt: now, updatedAt: now })
        .where(and(eq(operatorTasks.id, id), isNull(operatorTasks.completedAt)))
        .returning({ id: operatorTasks.id });
      if (!updated.length) throw new OperatorTaskNotFoundError();
      return { id };
    },
  };
}
