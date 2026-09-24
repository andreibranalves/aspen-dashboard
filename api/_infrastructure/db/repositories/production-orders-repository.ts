import { randomUUID } from 'node:crypto';
import { and, desc, eq, ne } from 'drizzle-orm';
import { getDatabase, type AppDatabase } from '../client.js';
import { clients, salesOrderNotes, salesOrders } from '../schema.js';
import { calendarDateInSaoPaulo } from '../../../_shared/calendar-sao-paulo.js';
import {
  PRODUCTION_STAGES, calendarDaysSince, productionAlert, productionDueDate,
  type ProductionStage,
} from '../../../_modules/production-order-rules.js';
import { deriveSalesOrderStatus } from './sales-orders-repository.js';

const ORDER_NUMBER = /^PED-\d{4}-\d{4}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNDO_MS = 10_000;
type Order = typeof salesOrders.$inferSelect;
type Db = AppDatabase;
type Tx = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];
type Access = Db | Tx;

export class ProductionInputError extends Error { readonly statusCode = 400; }
export class ProductionConflictError extends Error { readonly statusCode = 409; }
export class ProductionNotFoundError extends Error { readonly statusCode = 404; }

export type ProductionAction =
  | { action: 'advance'; id: string; stage: ProductionStage; date?: string; amount?: number }
  | { action: 'undo'; id: string; token: string }
  | { action: 'dates'; id: string; entry_received_date?: string | null; entry_received_amount?: number | null; art_approved_date?: string | null; balance_received_date?: string | null; due_date_override?: string | null }
  | { action: 'note'; id: string; content: string }
  | { action: 'edit_note'; id: string; note_id: string; content: string }
  | { action: 'delete_note'; id: string; note_id: string };

function predicate(id: string) {
  if (UUID.test(id)) return eq(salesOrders.id, id);
  if (ORDER_NUMBER.test(id)) return eq(salesOrders.orderNumber, id);
  throw new ProductionInputError('Pedido inválido.');
}

function date(value: unknown, label: string, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ProductionInputError(`${label} inválida.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ProductionInputError(`${label} inválida.`);
  }
  return value;
}

function amount(value: unknown, total: number, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > total ||
    Math.abs(Math.round(value * 100) - value * 100) > 0.000001) {
    throw new ProductionInputError('Valor da entrada inválido.');
  }
  return value.toFixed(2);
}

function projection(order: Order, clientName: string, today: string) {
  const stage = order.productionStage as ProductionStage;
  const dueDate = productionDueDate(order.artApprovedDate, order.productionDays, order.dueDateOverride);
  const alert = productionAlert(stage, order.artApprovedDate, dueDate, today);
  const entry = Number(order.entryReceivedAmount || 0);
  const total = Number(order.grandTotal);
  return {
    id: order.orderNumber,
    internal_id: order.id,
    customer_name: clientName,
    stage,
    stage_changed_at: order.stageChangedAt.toISOString(),
    art_approved_date: order.artApprovedDate,
    production_days: order.productionDays,
    due_date: dueDate,
    due_date_override: order.dueDateOverride,
    alert,
    stalled_days: stage === 'aguardando entrada' || stage === 'aguardando arte'
      ? calendarDaysSince(calendarDateInSaoPaulo(order.stageChangedAt), today) : null,
    entry_received_date: order.entryReceivedDate,
    entry_received_amount: entry,
    balance_received_date: order.balanceReceivedDate,
    received_amount: order.balanceReceivedDate ? total : entry,
    grand_total: total,
    undo_token: order.undoToken && order.undoUntil && order.undoUntil > new Date() ? order.undoToken : null,
    delivered_at: order.deliveredAt?.toISOString() || null,
  };
}

async function read(database: Access, id: string) {
  const [record] = await database.select({ order: salesOrders, clientName: clients.nome })
    .from(salesOrders).innerJoin(clients, eq(salesOrders.clientId, clients.id))
    .where(predicate(id)).limit(1);
  if (!record) throw new ProductionNotFoundError('Pedido não encontrado.');
  return record;
}

export function createProductionOrdersRepository(getDb: () => AppDatabase = getDatabase, now: () => Date = () => new Date()) {
  return {
    async list() {
      const today = calendarDateInSaoPaulo(now());
      const records = await getDb().select({ order: salesOrders, clientName: clients.nome })
        .from(salesOrders).innerJoin(clients, eq(salesOrders.clientId, clients.id))
        .where(ne(salesOrders.status, 'Cancelled'))
        .orderBy(desc(salesOrders.createdAt)).limit(1000);
      const items = records.map(({ order, clientName }) => projection(order, clientName, today))
        .filter((item) => item.stage !== 'entregue' ||
          (item.delivered_at && now().getTime() - Date.parse(item.delivered_at) < 7 * 86400000))
        .sort((a, b) => {
          const priority = (alert: string | null) => alert === 'atrasado' ? 0 : alert === 'em risco' ? 1 : 2;
          return priority(a.alert) - priority(b.alert) ||
            PRODUCTION_STAGES.indexOf(a.stage) - PRODUCTION_STAGES.indexOf(b.stage) ||
            a.id.localeCompare(b.id);
        });
      return { items, alert_count: items.filter((item) => item.alert).length };
    },
    async get(id: string) {
      const record = await read(getDb(), id);
      const notes = await getDb().select().from(salesOrderNotes)
        .where(eq(salesOrderNotes.salesOrderId, record.order.id))
        .orderBy(desc(salesOrderNotes.createdAt), desc(salesOrderNotes.id));
      return {
        ...projection(record.order, record.clientName, calendarDateInSaoPaulo(now())),
        notes: notes.map((note) => ({
          id: note.id, kind: note.kind, content: note.content,
          created_at: note.createdAt.toISOString(), updated_at: note.updatedAt.toISOString(),
        })),
      };
    },
    async change(input: ProductionAction) {
      return getDb().transaction(async (transaction) => {
        const [order] = await transaction.select().from(salesOrders)
          .where(predicate(input.id)).for('update').limit(1);
        if (!order) throw new ProductionNotFoundError('Pedido não encontrado.');
        if (order.status === 'Cancelled' || order.status === 'Closed' || order.status === 'Draft') {
          throw new ProductionConflictError('Pedido não pode ser alterado.');
        }
        const current = now();
        const today = calendarDateInSaoPaulo(current);
        const total = Number(order.grandTotal);
        if (input.action === 'advance') {
          const currentIndex = PRODUCTION_STAGES.indexOf(order.productionStage as ProductionStage);
          const targetIndex = PRODUCTION_STAGES.indexOf(input.stage);
          if (targetIndex !== currentIndex + 1) throw new ProductionConflictError('A etapa só pode avançar para a próxima.');
          const effectiveDate = date(input.date ?? today, 'Data')!;
          const snapshot = {
            productionStage: order.productionStage, stageChangedAt: order.stageChangedAt.toISOString(),
            entryReceivedDate: order.entryReceivedDate, entryReceivedAmount: order.entryReceivedAmount,
            artApprovedDate: order.artApprovedDate, deliveryDate: order.deliveryDate,
            readyAt: order.readyAt?.toISOString() || null, deliveredAt: order.deliveredAt?.toISOString() || null,
            status: order.status, perDelivered: order.perDelivered, perBilled: order.perBilled,
          };
          const token = randomUUID();
          const noteId = randomUUID();
          const updates: Partial<Order> = {
            productionStage: input.stage, stageChangedAt: current, updatedAt: current,
            undoToken: token, undoUntil: new Date(current.getTime() + UNDO_MS),
            undoSnapshot: { ...snapshot, noteId },
          };
          if (currentIndex === 0) {
            updates.entryReceivedDate = effectiveDate;
            updates.entryReceivedAmount = amount(input.amount ?? Math.round(total * 50) / 100, total)!;
            updates.perBilled = String(total ? Math.min(100, Math.round(Number(updates.entryReceivedAmount) / total * 10000) / 100) : 0);
            updates.status = deriveSalesOrderStatus(order.status, Number(updates.perBilled), Number(order.perDelivered));
          }
          if (currentIndex === 1) {
            updates.artApprovedDate = effectiveDate;
            updates.deliveryDate = productionDueDate(effectiveDate, order.productionDays, order.dueDateOverride);
          }
          if (input.stage === 'pronto') updates.readyAt = current;
          if (input.stage === 'entregue') {
            updates.deliveredAt = current;
            updates.perDelivered = '100';
            updates.status = 'Completed';
          }
          await transaction.update(salesOrders).set(updates).where(eq(salesOrders.id, order.id));
          await transaction.insert(salesOrderNotes).values({
            id: noteId, salesOrderId: order.id, kind: 'stage',
            content: `Etapa: ${order.productionStage} → ${input.stage}`, createdAt: current, updatedAt: current,
          });
        } else if (input.action === 'undo') {
          if (order.undoToken !== input.token || !order.undoUntil || order.undoUntil <= current || !order.undoSnapshot) {
            throw new ProductionConflictError('O prazo para desfazer terminou.');
          }
          const snapshot = order.undoSnapshot;
          await transaction.update(salesOrders).set({
            productionStage: String(snapshot.productionStage),
            stageChangedAt: new Date(String(snapshot.stageChangedAt)),
            entryReceivedDate: snapshot.entryReceivedDate as string | null,
            entryReceivedAmount: snapshot.entryReceivedAmount as string | null,
            artApprovedDate: snapshot.artApprovedDate as string | null,
            deliveryDate: snapshot.deliveryDate as string | null,
            readyAt: snapshot.readyAt ? new Date(String(snapshot.readyAt)) : null,
            deliveredAt: snapshot.deliveredAt ? new Date(String(snapshot.deliveredAt)) : null,
            status: String(snapshot.status), perDelivered: String(snapshot.perDelivered),
            perBilled: String(snapshot.perBilled), updatedAt: current,
            undoToken: null, undoUntil: null, undoSnapshot: null,
          }).where(eq(salesOrders.id, order.id));
          await transaction.delete(salesOrderNotes).where(and(
            eq(salesOrderNotes.id, String(snapshot.noteId)), eq(salesOrderNotes.salesOrderId, order.id)));
        } else if (input.action === 'dates') {
          const updates: Partial<Order> = { updatedAt: current, undoToken: null, undoUntil: null, undoSnapshot: null };
          if (input.entry_received_date !== undefined) updates.entryReceivedDate = date(input.entry_received_date, 'Data da entrada', true);
          if (input.entry_received_amount !== undefined) updates.entryReceivedAmount = amount(input.entry_received_amount, total, true);
          if (input.art_approved_date !== undefined) updates.artApprovedDate = date(input.art_approved_date, 'Data da arte', true);
          if (input.balance_received_date !== undefined) updates.balanceReceivedDate = date(input.balance_received_date, 'Data do saldo', true);
          if (input.due_date_override !== undefined) updates.dueDateOverride = date(input.due_date_override, 'Prazo final', true);
          const artDate = updates.artApprovedDate === undefined ? order.artApprovedDate : updates.artApprovedDate;
          const override = updates.dueDateOverride === undefined ? order.dueDateOverride : updates.dueDateOverride;
          updates.deliveryDate = productionDueDate(artDate, order.productionDays, override);
          const entry = Number(updates.entryReceivedAmount === undefined ? order.entryReceivedAmount || 0 : updates.entryReceivedAmount || 0);
          const paid = updates.balanceReceivedDate === undefined ? order.balanceReceivedDate : updates.balanceReceivedDate;
          updates.perBilled = String(paid ? 100 : total ? Math.round(entry / total * 10000) / 100 : 0);
          updates.status = order.productionStage === 'entregue'
            ? 'Completed'
            : deriveSalesOrderStatus(order.status, Number(updates.perBilled), Number(order.perDelivered));
          await transaction.update(salesOrders).set(updates).where(eq(salesOrders.id, order.id));
        } else if (input.action === 'note' || input.action === 'edit_note') {
          const content = input.content.trim();
          if (!content || content.length > 2000) throw new ProductionInputError('Anotação deve ter até 2000 caracteres.');
          if (input.action === 'note') {
            await transaction.insert(salesOrderNotes).values({
              id: randomUUID(), salesOrderId: order.id, kind: 'note', content,
              createdAt: current, updatedAt: current,
            });
          } else {
            if (!UUID.test(input.note_id)) throw new ProductionInputError('Anotação inválida.');
            const changed = await transaction.update(salesOrderNotes).set({ content, updatedAt: current })
              .where(and(eq(salesOrderNotes.id, input.note_id), eq(salesOrderNotes.salesOrderId, order.id),
                eq(salesOrderNotes.kind, 'note'))).returning({ id: salesOrderNotes.id });
            if (!changed.length) throw new ProductionNotFoundError('Anotação não encontrada.');
          }
        } else {
          if (!UUID.test(input.note_id)) throw new ProductionInputError('Anotação inválida.');
          const changed = await transaction.delete(salesOrderNotes).where(and(
            eq(salesOrderNotes.id, input.note_id), eq(salesOrderNotes.salesOrderId, order.id),
            eq(salesOrderNotes.kind, 'note'))).returning({ id: salesOrderNotes.id });
          if (!changed.length) throw new ProductionNotFoundError('Anotação não encontrada.');
        }
        return { success: true };
      });
    },
  };
}
