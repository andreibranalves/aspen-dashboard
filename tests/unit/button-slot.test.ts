import assert from 'node:assert/strict';
import test from 'node:test';
import { composeButtonSlotProps } from '../../src/lib/button-slot.ts';

const base = {
  variant: 'ghost',
  classes:
    'inline-flex items-center justify-center rounded-full text-sm font-medium focus-visible:ring-2',
};

test('asChild mescla className do Button com o do filho', () => {
  const merged = composeButtonSlotProps(
    {},
    { className: 'text-success' },
    { ...base, classes: `${base.classes} h-10 w-10` },
  );
  assert.match(String(merged.className), /h-10 w-10/);
  assert.match(String(merged.className), /text-success/);
});

test('asChild preserva data-variant e props do Button', () => {
  const onClick = (): void => {};
  const ref = { current: null };
  const merged = composeButtonSlotProps(
    { 'data-variant': 'ignorado', onClick, title: 'Abrir', ref },
    {},
    base,
  );
  assert.equal(merged['data-variant'], 'ignorado');
  assert.equal(merged.title, 'Abrir');
  assert.equal(merged.onClick, onClick);
  assert.equal(merged.ref, ref);
});

test('asChild mescla refs e compõe handlers, mantendo props do filho', () => {
  const order: string[] = [];
  const outer = (): void => { order.push('button'); };
  const inner = (event?: unknown): void => {
    assert.equal(event, 'evt');
    order.push('filho');
  };
  const buttonRef = { current: null as unknown };
  let childRef: unknown = null;
  const merged = composeButtonSlotProps(
    { onClick: outer, target: '_button', ref: buttonRef },
    { onClick: inner, target: '_blank', ref: (value: unknown) => { childRef = value; } },
    base,
  );
  assert.equal(merged.target, '_blank');
  (merged.onClick as (e: unknown) => void)('evt');
  assert.deepEqual(order, ['button', 'filho']);
  const node = { id: 'link' };
  (merged.ref as (value: unknown) => void)(node);
  assert.equal(buttonRef.current, node);
  assert.equal(childRef, node);
});
