import test from 'node:test';
import assert from 'node:assert/strict';
import { detectConflicts, responsibleIds } from './conflicts.js';

const day = '2026-09-23';
const at = time => `${day}T${time}:00+08:00`;
const task = (id, ownerId = 1, extra = {}) => ({ id, ownerId, assignment: 'owner', status: 'open', startAt: at('10:00'), endAt: at('11:00'), ...extra });
const check = tasks => detectConflicts(tasks, [1, 2], day, day);

test('assignment is relative to creator, including partner and both', () => {
  assert.deepEqual(responsibleIds(task(1, 1, { assignment: 'partner' }), [1, 2]), [2]);
  assert.deepEqual(responsibleIds(task(1, 2, { assignment: 'partner' }), [1, 2]), [1]);
  assert.deepEqual(responsibleIds(task(1, 1, { assignment: 'both' }), [1, 2]), [1, 2]);
});
test('shared assignee is conflict; different assignees are informational', () => {
  assert.equal(check([task(1), task(2)])[0].type, 'schedule_conflict');
  assert.equal(check([task(1), task(2, 2)])[0].type, 'schedule_overlap');
  assert.equal(check([task(1, 1, { assignment: 'partner' }), task(2, 2)])[0].type, 'schedule_conflict');
  assert.equal(check([task(1, 1, { assignment: 'both' }), task(2, 2)])[0].type, 'schedule_conflict');
});
test('touching endpoints, missing times, invalid intervals, done and trash excluded', () => {
  for (const extra of [{ startAt: at('11:00'), endAt: at('12:00') }, { startAt: null }, { endAt: null }, { endAt: at('09:00') }, { status: 'done' }, { deletedAt: at('09:00') }]) {
    assert.equal(check([task(1), task(2, 1, extra)]).length, 0);
  }
});
test('cross-midnight overlap is detected only in intersecting window', () => {
  const span = task(1, 1, { startAt: '2026-09-22T23:00:00+08:00', endAt: at('10:30') });
  const result = check([span, task(2)]);
  assert.equal(result.length, 1);
  assert.equal(result[0].endAt, new Date(at('10:30')).toISOString());
  assert.equal(detectConflicts([span, task(2)], [1, 2], '2026-09-24', '2026-09-24').length, 0);
});
test('all-day display copies are deduplicated; recurring instances are distinct', () => {
  const all = task(1, 1, { allDay: true, startAt: at('00:00'), endAt: '2026-09-25T00:00:00+08:00' });
  assert.equal(check([{ ...all, occurrenceDate: day }, { ...all, occurrenceDate: '2026-09-24' }, task(2)]).length, 1);
  const one = task(3, 1, { recurrence: { frequency: 'daily' }, occurrenceDate: day });
  const two = { ...one, occurrenceDate: '2026-09-22' };
  assert.equal(check([one, two]).length, 1);
  assert.equal(check([one, task(4)])[0].key, check([task(4), one])[0].key);
});
