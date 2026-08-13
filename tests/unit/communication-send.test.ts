import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeWithSendLock,
  isSendableQuotationStatus,
  sendContextKey,
  sendIdempotencyKey,
} from '../../src/lib/communicationSend.ts';

const context = { quotationId: 'ORC-1', revisionId: 'REV-1', flowId: 'FLOW-1' };
const otherFlow = { ...context, flowId: 'FLOW-2' };

function installBrowser(options: { locks?: unknown } = {}): { values: Map<string, string>; restore: () => void } {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: options.locks === undefined ? {} : { locks: options.locks } });
  return {
    values,
    restore: () => {
      if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
      if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
      else delete (globalThis as { navigator?: unknown }).navigator;
    },
  };
}

test('only issued or approved quotations are sendable', () => {
  assert.equal(isSendableQuotationStatus('enviado'), true);
  assert.equal(isSendableQuotationStatus('aprovado'), true);
  assert.equal(isSendableQuotationStatus('rascunho'), false);
  assert.equal(isSendableQuotationStatus(undefined), false);
});

test('idempotency key includes exact quotation, revision, and flow independently', () => {
  assert.notEqual(sendContextKey(context), sendContextKey(otherFlow));
  assert.match(sendIdempotencyKey(context), /ORC-1/);
  assert.match(sendIdempotencyKey(context), /REV-1/);
  assert.match(sendIdempotencyKey(context), /FLOW-1/);
});

test('forged localStorage cannot skip a backend send', async () => {
  const browser = installBrowser();
  try {
    browser.values.set('aspen.whatsapp-send-locks-v1', JSON.stringify({ state: 'accepted', context }));
    let calls = 0;
    const result = await executeWithSendLock(context, async () => {
      calls += 1;
      return { deliveryAccepted: false };
    });
    assert.equal(result.kind, 'completed');
    assert.equal(calls, 1);
  } finally {
    browser.restore();
  }
});

test('accepted response remains call-local and is never persisted', async () => {
  const browser = installBrowser();
  try {
    const result = await executeWithSendLock(context, async () => ({ deliveryAccepted: true }));
    assert.equal(result.kind, 'accepted');
    assert.equal(browser.values.size, 0);
  } finally {
    browser.restore();
  }
});

test('without Web Locks concurrent requests both reach backend seam', async () => {
  const browser = installBrowser();
  try {
    let backendCalls = 0;
    let providerCalls = 0;
    const send = async () => {
      backendCalls += 1;
      if (backendCalls === 1) providerCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { deliveryAccepted: false };
    };
    await Promise.all([executeWithSendLock(context, send), executeWithSendLock(context, send)]);
    assert.equal(backendCalls, 2);
    assert.equal(providerCalls, 1);
  } finally {
    browser.restore();
  }
});

test('Web Locks rejection falls back to the backend reservation seam', async () => {
  const browser = installBrowser({ locks: { request: async () => { throw new Error('locks unavailable'); } } });
  try {
    let calls = 0;
    const result = await executeWithSendLock(context, async () => {
      calls += 1;
      return { deliveryAccepted: false };
    });
    assert.equal(result.kind, 'completed');
    assert.equal(calls, 1);
  } finally {
    browser.restore();
  }
});

test('Web Locks serialize supported tabs but still call backend once', async () => {
  let held = false;
  const locks = {
    request: async (_name: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => {
      if (held) return callback(null);
      held = true;
      try { await callback({}); } finally { held = false; }
    },
  };
  const browser = installBrowser({ locks });
  try {
    let calls = 0;
    const result = await executeWithSendLock(context, async () => {
      calls += 1;
      return { deliveryAccepted: false };
    });
    assert.equal(result.kind, 'completed');
    assert.equal(calls, 1);
  } finally {
    browser.restore();
  }
});
