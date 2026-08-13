const RESERVED_LEASE_MS = 5 * 60 * 1000;

export function createFakeWhatsappReservationStore() {
  const records = new Map();

  function conflict(record) {
    return record
      ? { ok: false, reason: 'conflict', record }
      : { ok: false, reason: 'missing' };
  }

  function transition(input) {
    const record = records.get(input.key);
    if (!record) return { ok: false, reason: 'missing' };
    if (record.owner !== input.owner || record.version !== input.expectedVersion || record.phase !== input.from) {
      return conflict(record);
    }
    const now = Date.now();
    if (!Number.isInteger(input.currentStep) && (input.to === 'transporting' || input.to === 'accepted_partial')) {
      return { ok: false, reason: 'invalid', record };
    }
    if (input.to === 'transporting' && input.currentStep !== record.acceptedSteps.length) {
      return { ok: false, reason: 'invalid', record };
    }
    if (input.to === 'accepted_partial'
      && (!input.acceptedStep || input.acceptedStep.step !== input.currentStep || input.currentStep !== record.acceptedSteps.length)) {
      return { ok: false, reason: 'invalid', record };
    }
    record.version += 1;
    record.phase = input.to;
    record.updatedAt = now;
    delete record.transportStartedAt;
    delete record.currentStep;
    delete record.result;
    delete record.errorMessage;
    delete record.resolvedAt;
    delete record.resolution;
    if (input.to === 'transporting') {
      record.currentStep = input.currentStep;
      record.transportStartedAt = now;
    }
    if (input.to === 'accepted_partial') {
      record.currentStep = input.currentStep;
      record.acceptedSteps.push({ ...input.acceptedStep, acceptedAt: now });
      if (input.errorMessage !== undefined) record.errorMessage = input.errorMessage;
    }
    if (input.to === 'completed') record.result = input.result;
    if (input.to === 'retryable') record.acceptedSteps = [];
    records.set(input.key, record);
    return { ok: true, record };
  }

  return {
    records,
    async reserve(input) {
      const existing = records.get(input.key);
      if (!existing) {
        const now = Date.now();
        const record = {
          schema: 3,
          ...input,
          version: 1,
          phase: 'reserved',
          owner: `owner-${records.size}`,
          createdAt: now,
          updatedAt: now,
          reservedAt: now,
          acceptedSteps: [],
        };
        records.set(input.key, record);
        return { kind: 'reserved', record };
      }
      if (existing.phase === 'retryable') {
        const now = Date.now();
        existing.phase = 'reserved';
        existing.version += 1;
        existing.owner = `owner-${records.size}-${now}`;
        existing.reservedAt = now;
        existing.updatedAt = now;
        existing.acceptedSteps = [];
        delete existing.result;
        delete existing.errorMessage;
        delete existing.transportStartedAt;
        delete existing.currentStep;
        delete existing.resolvedAt;
        delete existing.resolution;
        return { kind: 'reserved', record: existing };
      }
      const now = Date.now();
      if (existing.phase === 'reserved'
        && existing.transportStartedAt == null
        && existing.currentStep == null
        && Array.isArray(existing.acceptedSteps)
        && existing.acceptedSteps.length === 0
        && now - existing.updatedAt >= RESERVED_LEASE_MS) {
        existing.version += 1;
        existing.owner = `owner-${records.size}-${now}`;
        existing.reservedAt = now;
        existing.updatedAt = now;
        existing.acceptedSteps = [];
        delete existing.result;
        delete existing.errorMessage;
        delete existing.resolvedAt;
        delete existing.resolution;
        return { kind: 'reserved', record: existing };
      }
      return { kind: 'existing', record: existing };
    },
    async compareAndSet(input) {
      return transition(input);
    },
    async cas(input) {
      return transition(input);
    },
    async resolve(input) {
      const record = records.get(input.key);
      if (!record) return { ok: false, reason: 'missing' };
      if (record.version !== input.expectedVersion || !['transporting', 'accepted_partial'].includes(record.phase)) {
        return conflict(record);
      }
      const now = Date.now();
      record.version += 1;
      record.phase = input.to;
      record.updatedAt = now;
      record.resolvedAt = now;
      record.resolution = input.to === 'completed' ? 'operator_completed' : 'operator_retryable';
      delete record.transportStartedAt;
      delete record.currentStep;
      if (input.to === 'completed') {
        record.result = {
          success: true,
          dry_run: false,
          send_status: 'completed',
          duplicate_warning: false,
          duplicate_message: '',
          flow_id: record.flowId,
          flow_name: 'Fluxo reconciliado',
          quotation_id: record.quotationId,
          deal_id: null,
          product_summary: 'produtos',
          categories: [],
          steps_count: record.acceptedSteps.length,
          steps: record.acceptedSteps.map((step) => ({ type: step.kind })),
          send_event_id: null,
        };
      } else {
        delete record.result;
      }
      return { ok: true, record };
    },
    async transition(input) {
      return transition({
        ...input,
        expectedVersion: input.expectedVersion ?? input.version,
      });
    },
    async get(key) {
      return records.get(key) || null;
    },
  };
}
