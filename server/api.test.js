import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';

test('conflict API, notifications, privacy and recurrence lifecycle', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'todotime-conflicts-test-'));
  const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: '0', NODE_ENV: 'test', TODOTIME_DATA_DIR: directory, JWT_SECRET: 'isolated-test-secret' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const port = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Test server did not start: ' + output)), 10000);
      child.stdout.on('data', chunk => { output += chunk; const match = output.match(/listening on http:\/\/0\.0\.0\.0:(\d+)/); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
      child.stderr.on('data', chunk => { output += chunk; });
      child.once('exit', () => { clearTimeout(timer); reject(new Error(output)); });
    });
    const call = (url, cookie = '', method = 'GET', body) => new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: '/api' + url, method, headers: { 'Content-Type': 'application/json', Cookie: cookie } }, res => {
        let raw = ''; res.on('data', c => { raw += c; }); res.on('end', () => {
          try { const data = JSON.parse(raw); if (res.statusCode >= 400) reject(new Error(`${res.statusCode}: ${raw}`)); else resolve({ ...data, cookie: res.headers['set-cookie']?.[0]?.split(';')[0] }); } catch (error) { reject(error); }
        });
      }); req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
    });
    const a = (await call('/auth/register', '', 'POST', { username: 'alpha', password: 'test-pass-a' })).cookie;
    const b = (await call('/auth/register', '', 'POST', { username: 'beta', password: 'test-pass-b' })).cookie;
    const at = (day, time) => `${day}T${time}:00+08:00`;
    const create = (cookie, title, extra = {}) => call('/tasks', cookie, 'POST', { title, taskDate: '2026-09-23', startAt: at('2026-09-23', '10:00'), endAt: at('2026-09-23', '11:00'), ...extra });
    const view = (cookie = a, from = '2026-09-23', to = from) => call(`/tasks?from=${from}&to=${to}`, cookie);
    const notes = async cookie => (await call('/notifications', cookie)).notifications.filter(n => n.type.startsWith('schedule_'));
    const first = await create(a, 'alpha event');
    assert.equal(first.conflicts.length, 0);
    const second = await create(b, 'beta event');
    assert.equal(second.conflicts[0].type, 'schedule_overlap');
    assert.equal((await notes(a)).length, 1);
    assert.equal((await notes(b)).length, 1);
    const shared = await call(`/tasks/${second.task.id}`, b, 'PUT', { assignment: 'both' });
    assert.equal(shared.conflicts[0].type, 'schedule_conflict');
    assert.deepEqual(shared.conflicts[0].responsibleIds, [1]);
    const count = (await notes(a)).length;
    await view(); await view();
    await call(`/tasks/${second.task.id}`, b, 'PUT', { description: 'unrelated text edit' });
    assert.equal((await notes(a)).length, count, 'reads and unchanged intervals do not duplicate notifications');
    await call(`/tasks/${second.task.id}/complete`, b, 'POST', {});
    assert.equal((await view()).conflicts.length, 0);
    await call(`/tasks/${second.task.id}/complete`, b, 'POST', {});
    await call(`/tasks/${second.task.id}`, b, 'DELETE');
    assert.equal((await view()).conflicts.length, 0);
    const restored = await call(`/tasks/${second.task.id}/restore`, b, 'POST');
    assert.equal(restored.conflicts.length, 1);
    const privateTask = await create(a, 'secret-title-unique', { visibility: 'private', description: 'secret-body-unique' });
    const otherView = await view(b);
    assert.ok(!JSON.stringify(otherView).includes('secret-title-unique'));
    assert.ok(!JSON.stringify(otherView).includes('secret-body-unique'));
    assert.ok(otherView.conflicts.some(c => c.tasks.some(t => t.id === privateTask.task.id && t.title === '私人安排')));
    assert.ok(!JSON.stringify(await call('/notifications', b)).includes('secret-title-unique'));
    const recurring = await create(a, 'fortnightly', { taskDate: '2026-10-01', startAt: at('2026-10-01', '10:00'), endAt: at('2026-10-01', '11:00'), recurrence: { frequency: 'biweekly', until: '2026-11-01' } });
    const oct = await view(a, '2026-10-01', '2026-10-31');
    assert.deepEqual(oct.tasks.filter(t => t.id === recurring.task.id).map(t => t.occurrenceDate), ['2026-10-01', '2026-10-15', '2026-10-29']);
    const target = await create(a, 'recurrence overlap', { taskDate: '2026-10-15', startAt: at('2026-10-15', '10:30'), endAt: at('2026-10-15', '11:30') });
    assert.equal(target.conflicts.length, 1);
    await call(`/tasks/${recurring.task.id}`, a, 'PUT', { scope: 'this', occurrenceDate: '2026-10-15', startAt: at('2026-10-15', '12:00'), endAt: at('2026-10-15', '13:00') });
    assert.equal((await view(a, '2026-10-15')).conflicts.length, 0);
    await call(`/tasks/${recurring.task.id}`, a, 'PUT', { scope: 'this', occurrenceDate: '2026-10-29', startAt: at('2026-12-10', '10:00'), endAt: at('2026-12-10', '11:00') });
    const movedTarget = await create(a, 'moved exception target', { taskDate: '2026-12-10', startAt: at('2026-12-10', '10:30'), endAt: at('2026-12-10', '11:30') });
    assert.equal(movedTarget.conflicts.length, 1, 'moved-in exception detected beyond original series range');
    const series = await create(a, 'daily series', { taskDate: '2027-01-01', startAt: at('2027-01-01', '10:00'), endAt: at('2027-01-01', '11:00'), recurrence: { frequency: 'daily', until: '2027-01-05' } });
    await call(`/tasks/${series.task.id}`, a, 'PUT', { scope: 'all', occurrenceDate: '2027-01-03', taskDate: '2027-01-03', startAt: at('2027-01-03', '12:00'), endAt: at('2027-01-03', '13:00') });
    assert.equal((await view(a, '2027-01-01')).tasks.filter(t => t.id === series.task.id).length, 1, 'all-scope preserves first occurrence');
    const split = await call(`/tasks/${series.task.id}`, a, 'PUT', { scope: 'future', occurrenceDate: '2027-01-03', assignment: 'both' });
    assert.ok(!((await view(a, '2027-01-01')).tasks.some(t => t.id === split.task.id)), 'future series must not duplicate earlier dates');
    assert.equal((await view(a, '2027-01-03')).tasks.filter(t => [series.task.id, split.task.id].includes(t.id)).length, 1);
    assert.equal((await call(`/tasks/${first.task.id}`, a, 'PUT', { endAt: null })).conflicts.length, 0, 'no guessed duration');
    const midnightMonthly = await create(a, 'monthly midnight', { taskDate: '2027-02-01', startAt: at('2027-02-01', '00:00'), endAt: at('2027-02-01', '01:00'), recurrence: { frequency: 'monthly', until: '2027-04-01' } });
    assert.deepEqual((await view(a, '2027-02-01', '2027-04-01')).tasks.filter(t => t.id === midnightMonthly.task.id).map(t => t.occurrenceDate), ['2027-02-01', '2027-03-01', '2027-04-01']);
    const allDay = await create(a, 'all day span', { taskDate: '2027-05-01', startAt: at('2027-05-01', '00:00'), endAt: at('2027-05-04', '00:00'), allDay: true });
    const spanTarget = await create(a, 'inside all day', { taskDate: '2027-05-03', startAt: at('2027-05-03', '10:00'), endAt: at('2027-05-03', '11:00') });
    assert.equal(spanTarget.conflicts.filter(c => c.tasks.some(t => t.id === allDay.task.id)).length, 1);
    assert.equal((await view(a, '2027-05-04')).tasks.filter(t => t.id === allDay.task.id).length, 0, 'exclusive all-day endpoint');
    const cross = await create(a, 'overnight', { taskDate: '2027-06-01', startAt: at('2027-06-01', '23:00'), endAt: at('2027-06-02', '10:00') });
    await create(a, 'next morning', { taskDate: '2027-06-02', startAt: at('2027-06-02', '09:00'), endAt: at('2027-06-02', '11:00') });
    assert.ok((await view(a, '2027-06-02')).conflicts.some(c => c.tasks.some(t => t.id === cross.task.id)));
    const recurringCount = (await notes(a)).length;
    await create(a, 'repeat A', { taskDate: '2027-07-01', startAt: at('2027-07-01', '10:00'), endAt: at('2027-07-01', '11:00'), recurrence: { frequency: 'daily', until: '2027-07-05' } });
    const repeatedB = await create(a, 'repeat B', { taskDate: '2027-07-01', startAt: at('2027-07-01', '10:30'), endAt: at('2027-07-01', '11:30'), recurrence: { frequency: 'daily', until: '2027-07-05' } });
    assert.equal(repeatedB.conflicts.length, 5);
    assert.equal((await notes(a)).length, recurringCount + 1, 'recurring pair grouped into one notice');
    await call(`/tasks/${repeatedB.task.id}/complete`, a, 'POST', { occurrenceDate: '2027-07-03' });
    assert.equal((await view(a, '2027-07-03')).conflicts.length, 0);
    await call(`/tasks/${first.task.id}/permanent`, a, 'DELETE');
    assert.ok(!(await view()).tasks.some(t => t.id === first.task.id), 'notified tasks can be permanently removed without foreign key failure');
  } finally {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    await rm(directory, { recursive: true, force: true });
  }
});
