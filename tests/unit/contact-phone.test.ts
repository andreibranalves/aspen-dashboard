import assert from 'node:assert/strict';
import test from 'node:test';
import { parseContactPhone, brazilMobileAlternative, conversationId } from '../../api/_shared/contact-phone.js';

test('phone parsing preserves international prefixes, DDD 55 and old mobile digits', () => {
  assert.equal(parseContactPhone('(55) 99970-1234'), '5555999701234');
  assert.equal(parseContactPhone('+1 202 555 0123'), '12025550123');
  assert.equal(parseContactPhone('+55 41 9970-1234'), '554199701234');
  assert.equal(parseContactPhone('nome 41999701234'), '');
  assert.equal(parseContactPhone('123456789012345@lid'), '');
});

test('ninth digit is a reversible BR mobile suggestion, never a suffix match', () => {
  assert.equal(brazilMobileAlternative('554199701234'), '5541999701234');
  assert.equal(brazilMobileAlternative('5541999701234'), '554199701234');
  assert.equal(brazilMobileAlternative('554133331234'), null);
  assert.equal(brazilMobileAlternative('12025550123'), null);
  assert.equal(brazilMobileAlternative('5500999701234'), null);
  assert.equal(conversationId('123456789@lid'), '123456789@lid');
  assert.equal(conversationId('554199701234@c.us'), '554199701234@s.whatsapp.net');
  assert.equal(conversationId('123456789@g.us'), '');
});
