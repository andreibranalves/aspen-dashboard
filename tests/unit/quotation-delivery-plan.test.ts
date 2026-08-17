import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDeliveryPlan,
  type DeliveryPlanInput,
} from '../../api/_functions/lib/quotation-delivery-plan.js';

const revisionId = '22222222-2222-4222-8222-222222222222';

function fixtureInput(overrides: Partial<DeliveryPlanInput> = {}): DeliveryPlanInput {
  return {
    revisionId,
    flowId: 'flow-1',
    businessNumber: 'ORC-20260001',
    baseUrl: 'https://app.test',
    context: {
      businessNumber: 'ORC-20260001',
      nome: 'Cliente',
      phone: '5511999990000',
      items: [{ item_code: 'CNG-001' }],
    },
    flow: {
      id: 'flow-1',
      name: 'Fluxo teste',
      delay_min_seconds: 1,
      delay_max_seconds: 1,
      steps: [
        { type: 'text', template: 'Olá (nome)' },
        { type: 'product_media', max_items: 1 },
        { type: 'document', source: 'quotation_pdf', caption: 'Orçamento (numero_pedido)' },
      ],
    },
    resolveMedia: async () => [{
      type: 'image',
      media: 'https://store.public.blob.vercel-storage.com/aspen-media/canga/reference.jpg',
      fileName: 'reference.jpg',
      caption: 'Referência',
    }],
    random: () => 0,
    ...overrides,
  };
}

test('plan freezes rendered text, approved media and exactly one quotation PDF', async () => {
  const input = fixtureInput();
  const plan = await createDeliveryPlan(input);

  assert.deepEqual(
    plan.steps.map((step) => step.type),
    ['text', 'media', 'quotation_pdf'],
  );
  const [textStep, mediaStep, pdfStep] = plan.steps;
  assert.equal(textStep?.type, 'text');
  assert.equal(mediaStep?.type, 'media');
  assert.equal(pdfStep?.type, 'quotation_pdf');
  if (textStep?.type === 'text') assert.equal(textStep.payload.text, 'Olá Cliente');
  if (mediaStep?.type === 'media') assert.equal(mediaStep.payload.url, 'https://store.public.blob.vercel-storage.com/aspen-media/canga/reference.jpg');
  if (pdfStep?.type === 'quotation_pdf') assert.equal(pdfStep.payload.revisionId, input.revisionId);
  assert.deepEqual(plan.steps.map((step) => step.position), [0, 1, 2]);
  assert.deepEqual(plan.steps.map((step) => step.delayMs), [0, 1000, 1000]);
  assert.equal(JSON.stringify(plan.steps).includes('base64'), false);
});

test('plan rejects disabled flows, excessive expanded steps and delay budget', async () => {
  await assert.rejects(
    createDeliveryPlan(fixtureInput({ flow: { ...fixtureInput().flow!, enabled: false } })),
    /Fluxo não encontrado/i,
  );
  const manySteps = fixtureInput({
    flow: {
      ...fixtureInput().flow!,
      steps: [
        ...Array.from({ length: 64 }, () => ({ type: 'text', template: 'x' })),
        { type: 'document', source: 'quotation_pdf' },
      ],
    },
  });
  await assert.rejects(createDeliveryPlan(manySteps), /limite de etapas/i);
  await assert.rejects(
    createDeliveryPlan(fixtureInput({
      flow: { ...fixtureInput().flow!, delay_min_seconds: 46, delay_max_seconds: 46 },
    })),
    /45 segundos/i,
  );
});
