import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { createHttpError } from '../_shared/http-error.js';
import {
  createPostgresCrmPipelineStageRepository,
  normalizeCrmPipelineStageName,
  type CrmPipelineStageRepository,
} from '../_infrastructure/db/repositories/crm-pipeline-stages-repository.js';
import { safeErrorSummary } from '../_shared/safe-error.js';

export interface CrmPipelineStagesHandlerDependencies {
  repository?: CrmPipelineStageRepository;
}

function json(statusCode: number, body: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function parsePayload(body: string | undefined): Record<string, unknown> {
  try {
    const payload = JSON.parse(body || '{}');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('body');
    return payload as Record<string, unknown>;
  } catch {
    throw createHttpError(400, 'JSON inválido.');
  }
}

function requiredKey(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 32) {
    throw createHttpError(400, 'Etapa inválida.');
  }
  return value.trim();
}

async function ensureCompleteOrder(
  repository: CrmPipelineStageRepository,
  value: unknown
): Promise<string[]> {
  if (!Array.isArray(value) || value.some((key) => typeof key !== 'string')) {
    throw createHttpError(400, 'Informe todas as etapas uma única vez.');
  }
  const keys = value.map((key) => requiredKey(key));
  const existing = await repository.list();
  const expected = new Set(existing.map((stage) => stage.key));
  if (
    keys.length !== expected.size ||
    new Set(keys).size !== keys.length ||
    keys.some((key) => !expected.has(key))
  ) {
    throw createHttpError(400, 'Informe todas as etapas uma única vez.');
  }
  return keys;
}

export function createCrmPipelineStagesHandler(
  dependencies: CrmPipelineStagesHandlerDependencies = {}
): (event: FunctionEvent) => Promise<FunctionResult> {
  const repository = dependencies.repository || createPostgresCrmPipelineStageRepository();
  return async (event) => {
    try {
      if (event.httpMethod === 'GET') {
        return json(200, { stages: await repository.list() });
      }
      if (!['POST', 'PATCH', 'DELETE'].includes(event.httpMethod)) {
        return json(405, { error: 'Método não permitido.' });
      }

      const payload = parsePayload(event.body);
      if (event.httpMethod === 'POST') {
        const stage = await repository.create(normalizeCrmPipelineStageName(payload.name));
        return json(201, { stage });
      }

      if (event.httpMethod === 'PATCH') {
        if (payload.ordered_keys !== undefined) {
          return json(200, {
            stages: await repository.reorder(
              await ensureCompleteOrder(repository, payload.ordered_keys)
            ),
          });
        }
        const key = requiredKey(payload.key);
        const stage = await repository.rename(key, normalizeCrmPipelineStageName(payload.name));
        if (!stage) throw createHttpError(404, 'Etapa não encontrada.');
        return json(200, { stage });
      }

      if (event.httpMethod === 'DELETE') {
        const key = requiredKey(event.queryStringParameters?.key);
        const stage = (await repository.list()).find((candidate) => candidate.key === key);
        if (!stage) throw createHttpError(404, 'Etapa não encontrada.');
        if (stage.role) {
          throw createHttpError(409, 'Esta etapa é obrigatória para o funcionamento do CRM.');
        }
        if (stage.dealCount > 0) {
          throw createHttpError(409, 'Mova os negócios desta etapa antes de removê-la.');
        }
        if (!(await repository.remove(key))) throw createHttpError(404, 'Etapa não encontrada.');
        return json(200, { success: true, key });
      }

      return json(405, { error: 'Método não permitido.' });
    } catch (error) {
      const httpError = error as { statusCode?: number; message?: string; logMessage?: string };
      const statusCode = Number.isInteger(httpError.statusCode) ? httpError.statusCode! : 500;
      console.error(
        '[crm-pipeline-stages]',
        httpError.logMessage ||
          httpError.message ||
          (safeErrorSummary(error))
      );
      return json(statusCode, {
        error: httpError.statusCode ? httpError.message : 'Erro interno.',
      });
    }
  };
}

export const handler = createCrmPipelineStagesHandler();
