import { asc, count, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { getDatabase, type AppDatabase } from '../client.js';
import { crmDeals, crmPipelineStages, type CrmPipelineStageRole } from '../schema.js';

const MAX_STAGES = 20;
const MAX_NAME_LENGTH = 80;

export interface CrmPipelineStage {
  key: string;
  name: string;
  position: number;
  role: CrmPipelineStageRole | null;
  dealCount: number;
}

export class CrmPipelineStageInputError extends Error {
  readonly statusCode = 400;
  readonly logMessage: string;

  constructor(message: string) {
    super(message);
    this.name = 'CrmPipelineStageInputError';
    this.logMessage = message;
  }
}

export class CrmPipelineStageConflictError extends Error {
  readonly statusCode = 409;
  readonly logMessage: string;

  constructor(message: string) {
    super(message);
    this.name = 'CrmPipelineStageConflictError';
    this.logMessage = message;
  }
}

export class CrmPipelineStageRepositoryError extends Error {
  readonly statusCode = 503;
  readonly logMessage = 'Falha ao acessar as etapas do CRM.';

  constructor() {
    super('Não foi possível acessar as etapas do CRM.');
    this.name = 'CrmPipelineStageRepositoryError';
  }
}

export interface CrmPipelineStageRepository {
  list(): Promise<CrmPipelineStage[]>;
  create(name: string): Promise<CrmPipelineStage>;
  rename(key: string, name: string): Promise<CrmPipelineStage | null>;
  reorder(keys: string[]): Promise<CrmPipelineStage[]>;
  remove(key: string): Promise<boolean>;
}

export interface CrmPipelineStageRepositoryOptions {
  now?: () => Date;
  keyFactory?: () => string;
}

type DatabaseProvider = () => AppDatabase;

export function normalizeCrmPipelineStageName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CrmPipelineStageInputError('Nome da etapa é obrigatório.');
  }
  const name = value.trim();
  if (name.length > MAX_NAME_LENGTH) {
    throw new CrmPipelineStageInputError(
      `Nome da etapa deve ter no máximo ${MAX_NAME_LENGTH} caracteres.`
    );
  }
  return name;
}

function normalizeKey(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 32) {
    throw new CrmPipelineStageInputError('Etapa inválida.');
  }
  return value.trim();
}

function customKey(value: string): string {
  return `custom_${value.replaceAll('-', '').slice(0, 24)}`;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
}

function safeRepositoryError(error: unknown): never {
  if (
    error instanceof CrmPipelineStageInputError ||
    error instanceof CrmPipelineStageConflictError ||
    error instanceof CrmPipelineStageRepositoryError
  ) {
    throw error;
  }
  if (isUniqueViolation(error)) {
    throw new CrmPipelineStageConflictError('Já existe uma etapa com este nome.');
  }
  console.error(
    '[crm-pipeline-stages-repository]',
    error instanceof Error ? error.name : typeof error
  );
  throw new CrmPipelineStageRepositoryError();
}

async function listStages(database: AppDatabase): Promise<CrmPipelineStage[]> {
  const rows = await database
    .select({
      key: crmPipelineStages.key,
      name: crmPipelineStages.name,
      position: crmPipelineStages.position,
      role: crmPipelineStages.role,
      dealCount: count(crmDeals.id),
    })
    .from(crmPipelineStages)
    .leftJoin(crmDeals, eq(crmDeals.status, crmPipelineStages.key))
    .groupBy(
      crmPipelineStages.key,
      crmPipelineStages.name,
      crmPipelineStages.position,
      crmPipelineStages.role
    )
    .orderBy(asc(crmPipelineStages.position), asc(crmPipelineStages.key));
  return rows.map((row) => ({ ...row, dealCount: Number(row.dealCount) }));
}

export function createPostgresCrmPipelineStageRepository(
  getDb: DatabaseProvider = getDatabase,
  options: CrmPipelineStageRepositoryOptions = {}
): CrmPipelineStageRepository {
  const now = options.now || (() => new Date());
  const keyFactory = options.keyFactory || randomUUID;

  return {
    async list() {
      try {
        return await listStages(getDb());
      } catch (error) {
        return safeRepositoryError(error);
      }
    },

    async create(value) {
      const name = normalizeCrmPipelineStageName(value);
      try {
        const database = getDb();
        return await database.transaction(async (transaction) => {
          await transaction.execute(
            sql`LOCK TABLE ${crmPipelineStages} IN SHARE ROW EXCLUSIVE MODE`
          );
          const existing = await transaction.select().from(crmPipelineStages);
          if (existing.length >= MAX_STAGES) {
            throw new CrmPipelineStageConflictError(
              `O funil pode ter no máximo ${MAX_STAGES} etapas.`
            );
          }
          const timestamp = now();
          const [created] = await transaction
            .insert(crmPipelineStages)
            .values({
              key: customKey(keyFactory()),
              name,
              position: existing.length,
              createdAt: timestamp,
              updatedAt: timestamp,
            })
            .returning();
          return { ...created, dealCount: 0 };
        });
      } catch (error) {
        return safeRepositoryError(error);
      }
    },

    async rename(value, requestedName) {
      const key = normalizeKey(value);
      const name = normalizeCrmPipelineStageName(requestedName);
      try {
        const database = getDb();
        const [updated] = await database
          .update(crmPipelineStages)
          .set({ name, updatedAt: now() })
          .where(eq(crmPipelineStages.key, key))
          .returning();
        if (!updated) return null;
        const [stage] = await listStages(database).then((stages) =>
          stages.filter((candidate) => candidate.key === key)
        );
        return stage || null;
      } catch (error) {
        return safeRepositoryError(error);
      }
    },

    async reorder(values) {
      const keys = values.map(normalizeKey);
      try {
        const database = getDb();
        await database.transaction(async (transaction) => {
          await transaction.execute(
            sql`LOCK TABLE ${crmPipelineStages} IN SHARE ROW EXCLUSIVE MODE`
          );
          const existing = await transaction
            .select({ key: crmPipelineStages.key })
            .from(crmPipelineStages);
          const expected = new Set(existing.map((stage) => stage.key));
          if (keys.length !== expected.size || new Set(keys).size !== keys.length) {
            throw new CrmPipelineStageInputError('Informe todas as etapas uma única vez.');
          }
          if (keys.some((key) => !expected.has(key))) {
            throw new CrmPipelineStageInputError('Informe todas as etapas uma única vez.');
          }
          for (const [position, key] of keys.entries()) {
            await transaction
              .update(crmPipelineStages)
              .set({ position, updatedAt: now() })
              .where(eq(crmPipelineStages.key, key));
          }
        });
        return await listStages(database);
      } catch (error) {
        return safeRepositoryError(error);
      }
    },

    async remove(value) {
      const key = normalizeKey(value);
      try {
        const database = getDb();
        return await database.transaction(async (transaction) => {
          await transaction.execute(
            sql`LOCK TABLE ${crmPipelineStages} IN SHARE ROW EXCLUSIVE MODE`
          );
          const [stage] = await transaction
            .select()
            .from(crmPipelineStages)
            .where(eq(crmPipelineStages.key, key))
            .for('update')
            .limit(1);
          if (!stage) return false;
          if (stage.role) {
            throw new CrmPipelineStageConflictError(
              'Esta etapa é obrigatória para o funcionamento do CRM.'
            );
          }
          const [{ dealCount }] = await transaction
            .select({ dealCount: count(crmDeals.id) })
            .from(crmDeals)
            .where(eq(crmDeals.status, key));
          if (Number(dealCount) > 0) {
            throw new CrmPipelineStageConflictError(
              'Mova os negócios desta etapa antes de removê-la.'
            );
          }
          await transaction.delete(crmPipelineStages).where(eq(crmPipelineStages.key, key));
          const remaining = await transaction
            .select({ key: crmPipelineStages.key })
            .from(crmPipelineStages)
            .orderBy(asc(crmPipelineStages.position), asc(crmPipelineStages.key));
          for (const [position, candidate] of remaining.entries()) {
            await transaction
              .update(crmPipelineStages)
              .set({ position, updatedAt: now() })
              .where(eq(crmPipelineStages.key, candidate.key));
          }
          return true;
        });
      } catch (error) {
        return safeRepositoryError(error);
      }
    },
  };
}
