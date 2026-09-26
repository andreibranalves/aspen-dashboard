import assert from 'node:assert/strict';
import test from 'node:test';
import type { ErrorEvent } from '@sentry/node';
import { scrubUnhandledException } from '../../api/_infrastructure/integrations/sentry/client.js';

function postgresError(): Error {
  const error = new Error('duplicate key value (phone)=(5511999998888)');
  Object.assign(error, { code: '23505', table_name: 'contacts' });
  return error;
}

test('sentry scrub: an unhandled exception keeps only the safe summary', () => {
  const event: ErrorEvent = {
    type: undefined,
    exception: {
      values: [
        {
          type: 'Error',
          value: 'duplicate key value (phone)=(5511999998888)',
          mechanism: { type: 'onuncaughtexception', handled: false },
        },
      ],
    },
    extra: { __serialized__: { phone: '5511999998888' } },
  };
  const scrubbed = scrubUnhandledException(event, { originalException: postgresError() });
  assert.equal(scrubbed.exception?.values?.[0]?.value, 'Error code=23505 table=contacts');
  assert.equal(scrubbed.extra, undefined);
  assert.doesNotMatch(JSON.stringify(scrubbed), /5511999998888/);
});

test('sentry scrub: explicit captures pass through untouched', () => {
  const event: ErrorEvent = {
    type: undefined,
    exception: {
      values: [
        {
          type: 'PostgresError',
          value: 'PostgresError code=23505 table=contacts',
          mechanism: { type: 'generic', handled: true },
        },
      ],
    },
  };
  const scrubbed = scrubUnhandledException(event, { originalException: new Error('x') });
  assert.equal(scrubbed.exception?.values?.[0]?.value, 'PostgresError code=23505 table=contacts');
});
