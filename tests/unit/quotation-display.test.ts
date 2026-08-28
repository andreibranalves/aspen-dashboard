import assert from 'node:assert/strict';
import test from 'node:test';
import {
  quotationContentHasText,
  quotationContentsMatch,
  quotationDisplayTitle,
  quotationItemCountLabel,
} from '../../src/lib/quotationDisplay.ts';

test('formats the commercial quotation number without mixing prefixes', () => {
  assert.equal(quotationDisplayTitle('ORC-20261987'), 'Orçamento ORC-20261987');
  assert.equal(quotationDisplayTitle('1048'), 'Orçamento #1048');
  assert.equal(quotationDisplayTitle(''), 'Orçamento');
});

test('pluralizes quotation item counts', () => {
  assert.equal(quotationItemCountLabel(0), '0 itens');
  assert.equal(quotationItemCountLabel(1), '1 item');
  assert.equal(quotationItemCountLabel(2), '2 itens');
});

test('detects visually empty rich text', () => {
  assert.equal(quotationContentHasText('<p><br></p>'), false);
  assert.equal(quotationContentHasText('<p>&nbsp;</p>'), false);
  assert.equal(quotationContentHasText('<p>Prazo confirmado</p>'), true);
});

test('matches duplicated rich text and plain-text commercial content', () => {
  assert.equal(
    quotationContentsMatch(
      '<p>15 a 20 dias úteis após confirmação do pagamento.</p>',
      ' 15 a 20 dias úteis após confirmação do pagamento. '
    ),
    true
  );
  assert.equal(quotationContentsMatch('<p>15 dias</p>', '20 dias'), false);
  assert.equal(quotationContentsMatch('', ''), false);
});
