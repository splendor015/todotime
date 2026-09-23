// Assignment is relative to the creator, not the person currently viewing.
export function responsibleIds(task, userIds) {
  if (task.assignment === 'both') return userIds;
  if (task.assignment === 'partner') return userIds.filter(id => id !== task.ownerId);
  return [task.ownerId];
}

export function detectConflicts(tasks, userIds, from, to) {
  const windowStart = Date.parse(`${from}T00:00:00+08:00`);
  const windowEnd = Date.parse(`${to}T00:00:00+08:00`) + 86400000;
  // Multi-day all-day tasks can have one display entry per day. Check their
  // actual interval only once. Missing endpoints never imply a made-up duration.
  const unique = new Map();
  for (const task of tasks) {
    if (task.status === 'done' || task.deletedAt || task.ignoreDayConflicts || !task.startAt || !task.endAt) continue;
    const start = Date.parse(task.startAt);
    const end = Date.parse(task.endAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    if (start >= windowEnd || end <= windowStart) continue;
    const identity = JSON.stringify([task.id, task.recurrence ? task.occurrenceDate : null, start, end]);
    unique.set(identity, { task, start, end, identity });
  }
  const intervals = [...unique.values()].sort((a, b) => a.start - b.start);
  const result = [];
  for (let i = 0; i < intervals.length; i++) {
    const a = intervals[i];
    for (let j = i + 1; j < intervals.length && intervals[j].start < a.end; j++) {
      const b = intervals[j];
      const start = Math.max(a.start, b.start);
      const end = Math.min(a.end, b.end);
      if (start >= end || start >= windowEnd || end <= windowStart) continue;
      const owners = responsibleIds(a.task, userIds);
      const common = responsibleIds(b.task, userIds).filter(id => owners.includes(id));
      const type = common.length ? 'schedule_conflict' : 'schedule_overlap';
      result.push({
        key: JSON.stringify([type, [...common].sort((a, b) => a - b), ...[a.identity, b.identity].sort()]),
        type, startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(),
        responsibleIds: common, tasks: [a.task, b.task]
      });
    }
  }
  return result;
}
