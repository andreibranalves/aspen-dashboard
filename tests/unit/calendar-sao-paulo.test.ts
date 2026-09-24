import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  addBusinessDays,
  countBusinessDays,
  calendarDateInSaoPaulo,
  isCalendarMonthPeriod,
  resolveNamedPeriod,
  yearMonthOf,
} from '../../api/_shared/calendar-sao-paulo.ts';

describe('addBusinessDays', () => {
  it('skips the weekend when adding two business days from Friday', () => {
    assert.equal(addBusinessDays('2026-09-11', 2), '2026-09-15');
  });

  it('returns Friday when adding three business days from Tuesday', () => {
    assert.equal(addBusinessDays('2026-09-15', 3), '2026-09-18');
  });

  it('rejects malformed or impossible date-only input', () => {
    assert.throws(() => addBusinessDays('2026-9-11', 2));
    assert.throws(() => addBusinessDays('2026-02-31', 2));
  });

  it('skips 20 November and Good Friday but counts Carnival weekdays', () => {
    assert.equal(addBusinessDays('2026-11-10', 20), '2026-12-09');
    assert.equal(addBusinessDays('2026-02-13', 2), '2026-02-17');
    assert.equal(addBusinessDays('2026-04-02', 1), '2026-04-06');
    assert.equal(countBusinessDays('2026-11-10', '2026-12-09'), 20);
  });
});

describe('calendarDateInSaoPaulo', () => {
  it('keeps 22h in Brazil on the São Paulo calendar day, not UTC', () => {
    const lateNightUtc = new Date('2026-09-01T01:00:00.000Z');
    assert.equal(calendarDateInSaoPaulo(lateNightUtc), '2026-08-31');
    assert.equal(lateNightUtc.toISOString().slice(0, 10), '2026-09-01');
  });
});

describe('resolveNamedPeriod', () => {
  it('resolves Este mês and Mês passado on the São Paulo calendar', () => {
    const lateAugust = new Date('2026-09-01T01:00:00.000Z');
    assert.deepEqual(resolveNamedPeriod('today', lateAugust), {
      start: '2026-08-31',
      end: '2026-08-31',
    });
    assert.deepEqual(resolveNamedPeriod('month', lateAugust), {
      start: '2026-08-01',
      end: '2026-08-31',
    });

    const firstOfSeptember = new Date('2026-09-01T03:00:00.000Z');
    assert.deepEqual(resolveNamedPeriod('today', firstOfSeptember), {
      start: '2026-09-01',
      end: '2026-09-01',
    });
    assert.deepEqual(resolveNamedPeriod('last_month', firstOfSeptember), {
      start: '2026-08-01',
      end: '2026-08-31',
    });
  });

  it('counts rolling windows from the São Paulo civil date', () => {
    const now = new Date('2026-08-10T12:00:00.000Z');
    assert.deepEqual(resolveNamedPeriod('7d', now), {
      start: '2026-08-03',
      end: '2026-08-10',
    });
  });

  it('keeps last-30-days on 30/08 while UTC already rolled to 31/08', () => {
    const lateEveningInBrazil = new Date('2026-08-31T02:31:00.000Z');
    assert.equal(calendarDateInSaoPaulo(lateEveningInBrazil), '2026-08-30');
    assert.deepEqual(resolveNamedPeriod('30d', lateEveningInBrazil), {
      start: '2026-07-31',
      end: '2026-08-30',
    });
  });
});

describe('isCalendarMonthPeriod', () => {
  it('marks only Este mês and Mês passado as Meta months', () => {
    assert.equal(isCalendarMonthPeriod('month'), true);
    assert.equal(isCalendarMonthPeriod('last_month'), true);
    assert.equal(isCalendarMonthPeriod('7d'), false);
    assert.equal(isCalendarMonthPeriod('30d'), false);
    assert.equal(yearMonthOf('2026-08-31'), '2026-08');
  });
});
