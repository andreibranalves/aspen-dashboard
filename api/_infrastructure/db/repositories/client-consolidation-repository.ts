import { inArray, sql } from 'drizzle-orm';
import { getDatabase, type AppDatabase } from '../client.js';
import { clients, quotations, crmDeals, salesOrders } from '../schema.js';

export interface ConsolidationCandidate {
  id: string;
  telefone: string | null;
  documento: string | null;
  createdAt: Date;
  latestQuotation: Date | null;
}

export interface ConsolidationGroup {
  survivor: string;
  removed: string[];
}

/** Brazil local numbers and their +55 representation identify the same phone.
 * Never infer missing ninth digits or merge missing phone numbers. */
export function consolidationPhone(value: string | null): string | null {
  const digits = value?.replace(/\D/g, '') || '';
  if (!digits) return null;
  const national = /^[1-9]{2}(?:[2-5][0-9]{7}|9[0-9]{8})$/.test(digits);
  return national ? `55${digits}` : digits;
}

export function planClientConsolidation(rows: ConsolidationCandidate[]) {
  const phones = new Map<string, ConsolidationCandidate[]>();
  for (const row of rows) {
    const phone = consolidationPhone(row.telefone);
    if (phone) phones.set(phone, [...(phones.get(phone) || []), row]);
  }
  const groups: ConsolidationGroup[] = [];
  const conflicts: string[][] = [];
  for (const group of phones.values()) {
    if (group.length < 2) continue;
    if (new Set(group.map(row => row.documento?.replace(/\D/g, '')).filter(Boolean)).size > 1) {
      conflicts.push(group.map(row => row.id).sort());
      continue;
    }
    group.sort((a, b) =>
      (b.latestQuotation?.getTime() ?? -Infinity) - (a.latestQuotation?.getTime() ?? -Infinity)
      || b.createdAt.getTime() - a.createdAt.getTime()
      || a.id.localeCompare(b.id));
    groups.push({ survivor: group[0].id, removed: group.slice(1).map(row => row.id).sort() });
  }
  return { groups: groups.sort((a, b) => a.survivor.localeCompare(b.survivor)), conflicts };
}

export function createClientConsolidationRepository(database: () => AppDatabase = getDatabase) {
  return {
    /** Backup must durably succeed before any update. A thrown callback rolls back.
     * Table locks keep the selection and all three reference transfers atomic with
     * concurrent client/quotation/order writes, including inserts of duplicates. */
    async run(options: { backup?: (snapshot: unknown) => Promise<void> } = {}) {
      return database().transaction(async tx => {
        await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
        await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
        if (options.backup) {
          await tx.execute(sql`LOCK TABLE clients, quotations, crm_deals, sales_orders IN SHARE ROW EXCLUSIVE MODE`);
        }
        const rows = await tx.select().from(clients);
        const latest = await tx.select({
          clientId: quotations.clientId,
          at: sql<Date | string>`max(${quotations.createdAt})`,
        }).from(quotations).groupBy(quotations.clientId);
        const dates = new Map(latest.map(row => [row.clientId, new Date(row.at)]));
        const plan = planClientConsolidation(rows.map(row => ({ ...row, latestQuotation: dates.get(row.id) || null })));
        const ids = plan.groups.flatMap(group => [group.survivor, ...group.removed]);
        if (!ids.length) return { ...plan, applied: false, transferred: { quotations: 0, deals: 0, orders: 0 } };
        const quoteLinks = await tx.select({ id: quotations.id, clientId: quotations.clientId }).from(quotations).where(inArray(quotations.clientId, ids));
        const dealLinks = await tx.select({ id: crmDeals.id, clientId: crmDeals.clientId }).from(crmDeals).where(inArray(crmDeals.clientId, ids));
        const orderLinks = await tx.select({ id: salesOrders.id, clientId: salesOrders.clientId }).from(salesOrders).where(inArray(salesOrders.clientId, ids));
        const losers = new Set(plan.groups.flatMap(group => group.removed));
        const transferred = {
          quotations: quoteLinks.filter(row => losers.has(row.clientId)).length,
          deals: dealLinks.filter(row => row.clientId && losers.has(row.clientId)).length,
          orders: orderLinks.filter(row => losers.has(row.clientId)).length,
        };
        if (options.backup) {
          const preserved = plan.groups.map(group => {
            const members = [group.survivor, ...group.removed].map(id => rows.find(row => row.id === id)!);
            const survivor = members[0];
            const notes = [...new Set(members.map(row => row.notes?.trim()).filter(Boolean))].join('\n\n');
            if (notes.length > 4000) throw new Error('As observações consolidadas ultrapassam o limite. Revisão necessária.');
            const patch: Partial<typeof survivor> = { notes: notes || null };
            const fields = ['documento', 'email'] as const;
            for (const field of fields) {
              const values = [...new Set(members.map(row => row[field]).filter(Boolean))];
              if (!survivor[field] && values.length === 1) patch[field] = values[0];
            }
            const addressFields = ['endereco', 'numero', 'bairro', 'complemento', 'municipio', 'uf', 'cep'] as const;
            if (!addressFields.some(field => survivor[field])) {
              const addresses = new Map(members.filter(row => addressFields.some(field => row[field]))
                .map(row => [JSON.stringify(addressFields.map(field => row[field])), row]));
              if (addresses.size === 1) {
                const address = [...addresses.values()][0];
                for (const field of addressFields) patch[field] = address[field];
              }
            }
            return { id: group.survivor, patch };
          });
          await options.backup({ version: 1, createdAt: new Date().toISOString(), plan,
            clients: rows.filter(row => ids.includes(row.id)), quotations: quoteLinks, deals: dealLinks, orders: orderLinks });
          const mappings = sql.join(plan.groups.flatMap(group => group.removed.map(id =>
            sql`(${id}::uuid, ${group.survivor}::uuid)`)), sql`, `);
          for (const table of [quotations, crmDeals, salesOrders]) {
            await tx.execute(sql`UPDATE ${table} SET client_id = mapping.survivor
              FROM (VALUES ${mappings}) AS mapping(removed, survivor)
              WHERE ${table.clientId} = mapping.removed`);
          }
          await tx.delete(clients).where(inArray(clients.id, [...losers]));
          // Move a sole CPF/CNPJ only after removing its old unique-key owner.
          for (const entry of preserved) {
            await tx.update(clients).set(entry.patch).where(inArray(clients.id, [entry.id]));
          }
        }
        return { ...plan, applied: Boolean(options.backup), transferred };
      });
    },
  };
}
