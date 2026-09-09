import { randomUUID } from 'node:crypto';
import { and, eq, ilike, or } from 'drizzle-orm';
import { getDatabase, type AppDatabase } from '../client.js';
import { clients, whatsappClientLinks } from '../schema.js';
import { parseContactPhone } from '../../../_shared/contact-phone.js';

export type ClientLink = typeof whatsappClientLinks.$inferSelect;
export type LinkScope = { accountId: string; conversationId: string };
export class LinkConflict extends Error {}

export function createWhatsappClientLinksRepository(database: () => AppDatabase = getDatabase) {
  const scopeWhere = (scope: LinkScope) => and(eq(whatsappClientLinks.accountId, scope.accountId), eq(whatsappClientLinks.conversationId, scope.conversationId));
  return {
    async get(scope: LinkScope) {
      return (await database().select().from(whatsappClientLinks).where(scopeWhere(scope)).limit(1))[0] || null;
    },
    async search(query: string) {
      const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
      return database().select({ id: clients.id, nome: clients.nome, telefone: clients.telefone, email: clients.email })
        .from(clients).where(and(eq(clients.arquivado, false), or(ilike(clients.nome, pattern), ilike(clients.telefone, pattern))))
        .orderBy(clients.nome, clients.id).limit(20);
    },
    async save(scope: LinkScope, input: { clientId: string; observedPhone: string | null; expectedVersion: string | null; expectedClientPhone: string | null; expectedClientName: string }) {
      return database().transaction(async tx => {
        const [client] = await tx.select({ id: clients.id, nome: clients.nome, telefone: clients.telefone }).from(clients).where(and(eq(clients.id, input.clientId), eq(clients.arquivado, false))).for('share');
        if (!client || client.telefone !== input.expectedClientPhone || client.nome !== input.expectedClientName) throw new LinkConflict();
        const values = { clientId: client.id, observedPhone: input.observedPhone, clientPhone: parseContactPhone(client.telefone) || null, version: randomUUID(), updatedAt: new Date() };
        const rows = input.expectedVersion
          ? await tx.update(whatsappClientLinks).set(values).where(and(scopeWhere(scope), eq(whatsappClientLinks.version, input.expectedVersion))).returning()
          : await tx.insert(whatsappClientLinks).values({ ...scope, ...values }).onConflictDoNothing().returning();
        if (!rows[0]) throw new LinkConflict();
        return rows[0];
      });
    },
    async remove(scope: LinkScope, expectedVersion: string) {
      const rows = await database().delete(whatsappClientLinks).where(and(scopeWhere(scope), eq(whatsappClientLinks.version, expectedVersion))).returning();
      if (!rows[0]) throw new LinkConflict();
    },
  };
}

export type WhatsappClientLinksRepository = ReturnType<typeof createWhatsappClientLinksRepository>;
