import { useEffect, useState } from 'react';

import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api/api';

export interface PipelineStage {
  key: string;
  name: string;
  position: number;
  role: 'new' | 'issued' | 'won' | 'lost' | null;
  dealCount: number;
}

function isPipelineStage(value: unknown): value is PipelineStage {
  if (!value || typeof value !== 'object') return false;
  const stage = value as Partial<PipelineStage>;
  return (
    typeof stage.key === 'string' &&
    typeof stage.name === 'string' &&
    typeof stage.position === 'number' &&
    typeof stage.dealCount === 'number' &&
    (stage.role === null || ['new', 'issued', 'won', 'lost'].includes(String(stage.role)))
  );
}

function validStages(value: unknown): value is PipelineStage[] {
  return Array.isArray(value) && value.every(isPipelineStage);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Não foi possível atualizar as etapas.';
}

export function usePipelineStages(open: boolean, onChanged: () => void) {
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    void apiGet<{ stages: PipelineStage[] }>('/crm-pipeline-stages')
      .then((response) => {
        if (!validStages(response.stages)) throw new Error('Resposta inválida das etapas.');
        setStages(response.stages);
      })
      .catch(() => setError('Não foi possível carregar as etapas.'))
      .finally(() => setLoading(false));
  }, [open]);

  async function create(name: string): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const response = await apiPost<{ stage: PipelineStage }>('/crm-pipeline-stages', { name });
      if (!isPipelineStage(response.stage)) throw new Error('Resposta inválida das etapas.');
      setStages((current) => [...current, response.stage]);
      onChanged();
      return true;
    } catch (requestError) {
      setError(errorMessage(requestError));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function rename(key: string, name: string): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const response = await apiPatch<{ stage: PipelineStage }>('/crm-pipeline-stages', {
        key,
        name,
      });
      if (!isPipelineStage(response.stage)) throw new Error('Resposta inválida das etapas.');
      setStages((current) => current.map((stage) => (stage.key === key ? response.stage : stage)));
      onChanged();
      return true;
    } catch (requestError) {
      setError(errorMessage(requestError));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function move(index: number, direction: -1 | 1): Promise<void> {
    const destination = index + direction;
    if (destination < 0 || destination >= stages.length) return;
    const next = [...stages];
    [next[index], next[destination]] = [next[destination], next[index]];
    setSaving(true);
    setError(null);
    try {
      const response = await apiPatch<{ stages: PipelineStage[] }>('/crm-pipeline-stages', {
        ordered_keys: next.map((stage) => stage.key),
      });
      if (!validStages(response.stages)) throw new Error('Resposta inválida das etapas.');
      setStages(response.stages);
      onChanged();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function remove(stage: PipelineStage): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      await apiDelete(`/crm-pipeline-stages?key=${encodeURIComponent(stage.key)}`);
      setStages((current) => current.filter((candidate) => candidate.key !== stage.key));
      onChanged();
      return true;
    } catch (requestError) {
      setError(errorMessage(requestError));
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { stages, loading, saving, error, create, rename, move, remove };
}
