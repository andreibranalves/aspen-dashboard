// GET/POST/PATCH /api/tasks - tarefas do operador (#327).
import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { createHttpError } from '../_shared/http-error.js';
import {
  createPostgresOperatorTasksRepository,
  type OperatorTaskInput,
  type OperatorTasksRepository,
} from '../_infrastructure/db/repositories/operator-tasks-repository.js';

export interface TasksHandlerDependencies {
  repository?: OperatorTasksRepository;
}

function json(statusCode: number, body: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function parseBody(body: string): OperatorTaskInput & { action?: unknown } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body || '');
  } catch {
    throw createHttpError(400, 'JSON inválido.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw createHttpError(400, 'Envie um payload válido.');
  }
  return parsed as OperatorTaskInput & { action?: unknown };
}

function logError(error: unknown): void {
  const value = error as { logMessage?: string; message?: string; name?: string };
  console.error('[tasks]', value.logMessage || value.name || 'erro');
}

export function createTasksHandler(
  dependencies: TasksHandlerDependencies = {}
): (event: FunctionEvent) => Promise<FunctionResult> {
  let repository = dependencies.repository;
  const repo = () => (repository ||= createPostgresOperatorTasksRepository());
  return async (event: FunctionEvent): Promise<FunctionResult> => {
    const method = event.httpMethod;
    if (method !== 'GET' && method !== 'POST' && method !== 'PATCH') {
      return {
        ...json(405, { error: 'Método não permitido.' }),
        headers: { 'Content-Type': 'application/json', Allow: 'GET, POST, PATCH' },
      };
    }
    try {
      const query = event.queryStringParameters || {};
      if (method === 'GET') {
        if (query.view === 'alerts') {
          return json(200, { success: true, overdue_count: await repo().overdueCount() });
        }
        return json(200, { success: true, ...(await repo().listOpen()) });
      }
      const body = parseBody(event.body);
      if (method === 'POST') {
        return json(201, { success: true, task: await repo().create(body) });
      }
      if (!query.id) throw createHttpError(400, 'ID da tarefa é obrigatório.');
      if (body.action === 'complete') {
        return json(200, { success: true, ...(await repo().complete(query.id)) });
      }
      if (body.action !== undefined && body.action !== 'update') {
        throw createHttpError(400, 'Ação inválida para a tarefa.');
      }
      return json(200, { success: true, task: await repo().update(query.id, body) });
    } catch (error) {
      logError(error);
      const value = error as { statusCode?: unknown; expose?: unknown; logMessage?: unknown };
      const statusCode = Number.isInteger(value?.statusCode) ? Number(value.statusCode) : 500;
      const exposed =
        statusCode < 500 && (value.expose === true || typeof value.logMessage === 'string');
      return json(statusCode, {
        error: exposed ? (error as Error).message : 'Erro interno.',
      });
    }
  };
}

export const createHandler = createTasksHandler;
export const handler = createTasksHandler();
