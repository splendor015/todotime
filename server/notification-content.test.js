import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commentNotificationBody, conflictNotificationBody, reminderNotificationBody,
  sqliteUtcIso, taskCreatedBody, taskUpdatedBody
} from './notification-content.js';

const task = {
  title: '项目会议',
  description: '确认下周交付范围',
  start_at: '2026-09-25T02:00:00.000Z',
  end_at: '2026-09-25T03:00:00.000Z',
  all_day: 0
};

test('SQLite UTC timestamps are serialized with an explicit timezone', () => {
  assert.equal(sqliteUtcIso('2026-09-25 02:30:00'), '2026-09-25T02:30:00Z');
  assert.equal(sqliteUtcIso('2026-09-25T02:30:00.000Z'), '2026-09-25T02:30:00.000Z');
});

test('created and updated task messages contain useful schedule details', () => {
  const created = taskCreatedBody({ actor: 'Sweet', task });
  assert.match(created, /添加人：Sweet/);
  assert.match(created, /日程：项目会议/);
  assert.match(created, /10:00–11:00/);
  assert.match(created, /说明：确认下周交付范围/);

  const updated = taskUpdatedBody({
    actor: 'Carrot', before: task,
    after: { ...task, start_at: '2026-09-25T04:00:00.000Z', end_at: '2026-09-25T05:00:00.000Z', description: '改为线上会议' }
  });
  assert.match(updated, /原时间：.*10:00–11:00/);
  assert.match(updated, /新时间：.*12:00–13:00/);
  assert.match(updated, /原说明：确认下周交付范围/);
  assert.match(updated, /新说明：改为线上会议/);
});

test('comments, reminders and conflicts use China time and preserve privacy', () => {
  const comment = commentNotificationBody({ actor: 'Carrot', task, comment: '我会提前准备', createdAt: '2026-09-25 02:30:00' });
  assert.match(comment, /评论时间：.*10:30/);
  assert.match(comment, /评论：我会提前准备/);
  assert.match(reminderNotificationBody({ task, minutes: 30 }), /提醒：将在 30 分钟后开始/);

  const conflict = conflictNotificationBody({
    actor: 'Sweet', type: 'schedule_conflict', count: 1,
    startAt: task.start_at, endAt: task.end_at,
    tasks: [task, { ...task, title: '私人安排', description: '', isPrivateMasked: true }]
  });
  assert.match(conflict, /日程2：私人安排/);
  assert.doesNotMatch(conflict, /说明2：/);
});
