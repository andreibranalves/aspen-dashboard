import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  readWhatsappMessageContent,
  whatsappMessagePreview,
} from '../../api/_modules/whatsapp-message-content.js';

describe('whatsapp-message-content', () => {
  it('keeps line breaks and spacing of the body verbatim', () => {
    const body = 'Olá!\n\nLista:\n  - 200 canecas\n  - 50 squeezes  ';
    assert.deepEqual(readWhatsappMessageContent({ message: { conversation: body } }), {
      type: 'text',
      body,
    });
    assert.deepEqual(readWhatsappMessageContent({ message: { extendedTextMessage: { text: body } } }), {
      type: 'text',
      body,
    });
  });

  it('collapses whitespace only in the list preview', () => {
    assert.equal(whatsappMessagePreview({ type: 'text', body: 'a\n\n b' }), 'a b');
    assert.equal(whatsappMessagePreview({ type: 'image', body: null }), 'Imagem');
    assert.equal(whatsappMessagePreview({ type: 'text', body: 'x'.repeat(400) }).length, 280);
  });

  it('unwraps ephemeral, view-once and captioned document wrappers', () => {
    assert.deepEqual(
      readWhatsappMessageContent({ message: { ephemeralMessage: { message: { conversation: 'oi' } } } }),
      { type: 'text', body: 'oi' },
    );
    assert.deepEqual(
      readWhatsappMessageContent({
        message: { documentWithCaptionMessage: { message: { documentMessage: { caption: 'Arte final' } } } },
      }),
      { type: 'document', body: 'Arte final' },
    );
  });

  it('classifies media and keeps captions', () => {
    assert.deepEqual(readWhatsappMessageContent({ message: { imageMessage: { caption: 'logo\nnovo' } } }), {
      type: 'image',
      body: 'logo\nnovo',
    });
    assert.deepEqual(readWhatsappMessageContent({ message: { audioMessage: {} } }), {
      type: 'audio',
      body: null,
    });
  });

  it('drops protocol events and keeps unknown content visible as unsupported', () => {
    assert.equal(readWhatsappMessageContent({ message: { reactionMessage: { text: '👍' } } }), null);
    assert.equal(readWhatsappMessageContent({ message: { protocolMessage: { type: 0 } } }), null);
    assert.deepEqual(readWhatsappMessageContent({ message: { pollCreationMessage: {} } }), {
      type: 'unsupported',
      body: null,
    });
    assert.deepEqual(
      readWhatsappMessageContent({ message: { messageContextInfo: {}, conversation: 'ok' } }),
      { type: 'text', body: 'ok' },
    );
  });

  it('removes only NUL characters that PostgreSQL cannot store', () => {
    assert.deepEqual(readWhatsappMessageContent({ message: { conversation: 'a\u0000b' } }), {
      type: 'text',
      body: 'ab',
    });
  });
});
