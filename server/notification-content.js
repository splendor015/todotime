const SHANGHAI_TZ = 'Asia/Shanghai';

const taskValue = (task, snake, camel) => task?.[snake] ?? task?.[camel] ?? null;
const validDate = value => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: SHANGHAI_TZ, year: 'numeric', month: 'numeric', day: 'numeric'
});
const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: SHANGHAI_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: SHANGHAI_TZ, year: 'numeric', month: 'numeric', day: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

const dateText = value => {
  const date = validDate(value);
  return date ? dateFormatter.format(date) : '';
};
const timeText = value => {
  const date = validDate(value);
  return date ? timeFormatter.format(date) : '';
};
const dateTimeText = value => {
  const date = validDate(value);
  return date ? dateTimeFormatter.format(date) : '';
};
const taskDateValue = task => {
  const value = taskValue(task, 'task_date', 'taskDate');
  return value ? `${value}T00:00:00+08:00` : null;
};
const tidy = (value, maxLength = 500) => String(value || '')
  .replace(/\r\n?/g, '\n')
  .trim()
  .slice(0, maxLength);

export const sqliteUtcIso = value => {
  if (!value || typeof value !== 'string' || value.includes('T')) return value;
  return `${value.replace(' ', 'T')}Z`;
};

export const taskTimeLabel = task => {
  const start = taskValue(task, 'start_at', 'startAt');
  const end = taskValue(task, 'end_at', 'endAt');
  const allDay = Boolean(taskValue(task, 'all_day', 'allDay'));
  if (allDay) {
    const startDate = start || taskDateValue(task);
    const endDate = validDate(end);
    const lastOccupied = endDate ? new Date(endDate.getTime() - 1) : null;
    const firstLabel = dateText(startDate) || dateText(taskDateValue(task));
    const lastLabel = dateText(lastOccupied);
    if (firstLabel && lastLabel && firstLabel !== lastLabel) return `${firstLabel} 至 ${lastLabel}（全天）`;
    return firstLabel ? `${firstLabel}（全天）` : '全天安排';
  }
  if (start && end) {
    const startDay = dateText(start); const endDay = dateText(end);
    if (startDay === endDay) return `${startDay} ${timeText(start)}–${timeText(end)}`;
    return `${dateTimeText(start)} 至 ${dateTimeText(end)}`;
  }
  if (start) return `${dateTimeText(start)} 开始`;
  if (end) return `${dateTimeText(end)} 截止`;
  const plannedDay = dateText(taskDateValue(task));
  return plannedDay ? `${plannedDay}（待安排时间）` : '待安排';
};

export const taskDescriptionLabel = task => tidy(taskValue(task, 'description', 'description'), 500) || '无';
const taskTitle = task => tidy(taskValue(task, 'title', 'title'), 160) || '未命名日程';

export const taskCreatedBody = ({ actor, task }) => [
  `添加人：${actor}`,
  `日程：${taskTitle(task)}`,
  `时间：${taskTimeLabel(task)}`,
  `说明：${taskDescriptionLabel(task)}`
].join('\n');

export const taskUpdatedBody = ({ actor, before, after }) => {
  const oldTitle = taskTitle(before); const newTitle = taskTitle(after);
  const oldTime = taskTimeLabel(before); const newTime = taskTimeLabel(after);
  const oldDescription = taskDescriptionLabel(before); const newDescription = taskDescriptionLabel(after);
  const lines = [`修改人：${actor}`];
  if (oldTitle === newTitle) lines.push(`日程：${newTitle}`);
  else lines.push(`原标题：${oldTitle}`, `新标题：${newTitle}`);
  if (oldTime === newTime) lines.push(`时间：${newTime}`);
  else lines.push(`原时间：${oldTime}`, `新时间：${newTime}`);
  if (oldDescription === newDescription) lines.push(`说明：${newDescription}`);
  else lines.push(`原说明：${oldDescription}`, `新说明：${newDescription}`);
  return lines.join('\n');
};

export const taskDeletedBody = ({ actor, task }) => [
  `删除人：${actor}`,
  `日程：${taskTitle(task)}`,
  `时间：${taskTimeLabel(task)}`,
  `说明：${taskDescriptionLabel(task)}`
].join('\n');

export const privateTaskBody = ({ actor, action, task }) => [
  `操作人：${actor}`,
  `操作：${action}`,
  '日程：私人安排',
  `时间：${taskTimeLabel(task)}`,
  '说明：仅创建者可见'
].join('\n');

export const commentNotificationBody = ({ actor, task, comment, createdAt }) => [
  `评论人：${actor}`,
  `日程：${taskTitle(task)}`,
  `日程时间：${taskTimeLabel(task)}`,
  `评论时间：${dateTimeText(sqliteUtcIso(createdAt))}`,
  `评论：${tidy(comment, 600)}`
].join('\n');

export const reminderNotificationBody = ({ task, minutes }) => [
  `日程：${taskTitle(task)}`,
  `时间：${taskTimeLabel(task)}`,
  `说明：${taskDescriptionLabel(task)}`,
  `提醒：将在 ${minutes} 分钟后开始`
].join('\n');

export const conflictNotificationBody = ({ actor, type, count, startAt, endAt, tasks }) => {
  const lines = [
    `触发人：${actor}`,
    `类型：${type === 'schedule_conflict' ? '同一负责人被重复安排' : '双方时间重叠'}`,
    `重叠时间：${dateTimeText(startAt)} 至 ${dateTimeText(endAt)}`,
    `发现：${count} 处时间重叠`
  ];
  tasks.slice(0, 2).forEach((task, index) => {
    const number = index + 1;
    lines.push(`日程${number}：${taskTitle(task)}`, `时间${number}：${taskTimeLabel(task)}`);
    if (!task.isPrivateMasked) lines.push(`说明${number}：${tidy(taskValue(task, 'description', 'description'), 240) || '无'}`);
  });
  lines.push(type === 'schedule_conflict' ? '建议：请调整负责人或时间。' : '提示：双方分别负责，仅供协调时间。');
  return lines.join('\n');
};
