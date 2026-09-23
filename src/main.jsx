import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Bell, CalendarDays, ChevronLeft, ChevronRight, CircleCheck, Clock3, Columns3,
  Filter, Flag, LogOut, MessageCircle, MoreHorizontal, Plus, RotateCcw, Search,
  Settings, Tag, Trash2, UserRound, X, Check, LockKeyhole, Eye, EyeOff, TriangleAlert, Info
} from 'lucide-react';
import './styles.css';
import { TAG_PRESETS, tagStyle } from './tags.js';

const api = async (url, options = {}) => {
  const response = await fetch(`/api${url}`, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
};

const pad = (n) => String(n).padStart(2, '0');
const SHANGHAI_TZ = 'Asia/Shanghai';
// The weekly timeline focuses on the practical daytime window. Tasks still
// keep their original timestamps; only the visible grid starts at 07:00.
const CALENDAR_START_HOUR = 7;
const CALENDAR_END_HOUR = 24;
const CALENDAR_HOUR_HEIGHT = 30;
const chinaParts = (value, options) => {
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: SHANGHAI_TZ, ...options }).formatToParts(value);
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
};
const dateKey = (date) => {
  const parts = chinaParts(date, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const chinaTime = (date) => {
  const parts = chinaParts(date, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${parts.hour}:${parts.minute}`;
};
const chinaClockMinutes = (date) => {
  const parts = chinaParts(date, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return Number(parts.hour) * 60 + Number(parts.minute);
};
const parseKey = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (date, days) => { const d = new Date(date); d.setDate(d.getDate() + days); return d; };
const monday = (date) => { const d = new Date(date); const day = d.getDay() || 7; d.setDate(d.getDate() - day + 1); d.setHours(0, 0, 0, 0); return d; };
const dateLabel = (date) => new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date);
const weekday = ['一', '二', '三', '四', '五', '六', '日'];
const timeLabel = (hour) => `${pad(hour)}:00`;
const isoAt = (key, time) => time ? `${key}T${time}:00+08:00` : null;
const toDateTime = (iso) => iso ? new Date(iso) : null;
const monthStart = (date) => new Date(date.getFullYear(), date.getMonth(), 1);
const monthGridRange = (date) => {
  const first = monthStart(date);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const start = monday(first);
  const end = addDays(monday(last), 6);
  const count = Math.floor((end - start) / 86400000) + 1;
  return { start, end, count };
};
const shiftMonth = (date, amount) => new Date(date.getFullYear(), date.getMonth() + amount, 1);
const taskDayKey = (task) => task.allDay && !task.recurrence ? task.occurrenceDate || task.taskDate : (task.startAt ? dateKey(new Date(task.startAt)) : task.taskDate || task.occurrenceDate);
const SHARED_TASK_COLOR = '#7468b2';
const taskColor = (task) => task.assignment === 'both' ? SHARED_TASK_COLOR : (task.ownerColor || '#267e77');
const assignmentLabel = (assignment) => assignment === 'both' ? '共同负责' : assignment === 'partner' ? '对方负责' : '我负责';
const taskDateLabel = (task) => {
  const day = taskDayKey(task);
  const date = day ? parseKey(day) : null;
  const dateText = date ? `${date.getMonth() + 1}月${date.getDate()}日` : '未安排日期';
  const timeText = task.allDay ? '全天' : task.startAt ? chinaTime(new Date(task.startAt)) : '待安排';
  return `${dateText} · ${timeText}`;
};

function Toast({ message, onClose }) {
  useEffect(() => { const timer = setTimeout(onClose, 3500); return () => clearTimeout(timer); }, [onClose]);
  return <div className="toast"><CircleCheck size={17} /> <span>{message}</span><button onClick={onClose}><X size={15} /></button></div>;
}

const scheduleIdentity = task => `${task.id}:${task.recurrence ? task.occurrenceDate || '' : ''}`;
const scheduleTitle = type => type === 'schedule_conflict' ? '同一负责人被重复安排' : '双方时间重叠';
const saveMessage = (data, success) => {
  const conflicts = data.conflicts || [];
  if (conflicts.some(c => c.type === 'schedule_conflict')) return `${success}，但同一负责人有重复安排，请查看时间检查`;
  if (conflicts.length) return `${success}，双方时间有重叠（不视为冲突）`;
  return success;
};
function ScheduleBadge({ task }) {
  if (!task.scheduleType) return null;
  const conflict = task.scheduleType === 'schedule_conflict';
  return <span className={`schedule-badge ${task.scheduleType}`} title={scheduleTitle(task.scheduleType)} aria-label={scheduleTitle(task.scheduleType)}>{conflict ? <TriangleAlert size={12} /> : <Info size={12} />}</span>;
}
function SchedulePanel({ conflicts, users, onSelect, notice, onDismiss }) {
  return <section className="schedule-panel" aria-label="时间检查">
    <div className="schedule-panel-head"><strong><Clock3 size={16} />时间检查</strong><small>检查当前周／月的全部安排，不受筛选影响 · 仅提示，不阻止保存</small></div>
    {notice && <div className="schedule-save-notice" role="status"><span>{saveMessage(notice, '日程已保存')}。本次检查：{notice.checkedRange?.from} 至 {notice.checkedRange?.to}（90 天）；切换日期可查看其他时段。</span><button className="icon-button" aria-label="关闭保存检查结果" onClick={onDismiss}><X size={15} /></button></div>}
    {notice?.conflicts?.length > 0 && <details className="schedule-saved-details"><summary>查看本次保存涉及的 {notice.conflicts.length} 处重叠（含当前视图之外）</summary><div className="schedule-list">{notice.conflicts.map(c => <div className="schedule-item" key={c.key}><strong>{scheduleTitle(c.type)}</strong><time>{chinaDateTimeLabel(new Date(c.startAt))} — {chinaDateTimeLabel(new Date(c.endAt))}</time><small>请切换到上述日期查看当前安排</small></div>)}</div></details>}
    <div className="schedule-groups">{['schedule_conflict', 'schedule_overlap'].map(type => {
      const items = conflicts.filter(c => c.type === type);
      return <details key={type} className={`schedule-group ${type}`} open={type === 'schedule_conflict' && items.length > 0}>
        <summary>{type === 'schedule_conflict' ? <TriangleAlert size={15} /> : <Info size={15} />}<strong>{scheduleTitle(type)}</strong><span>{items.length} 处</span></summary>
        <p>{type === 'schedule_conflict' ? '相同负责人在同一时间有多项未完成安排，建议调整。' : '双方分别有安排，仅供协调空闲时间，不代表安排有误。'}</p>
        <div className="schedule-list">{items.length ? items.map(c => <div className="schedule-item" key={c.key}>
          <time>{chinaDateTimeLabel(new Date(c.startAt))} — {chinaDateTimeLabel(new Date(c.endAt))}</time>
          {c.responsibleIds.length > 0 && <small>重复安排的负责人：{c.responsibleIds.map(id => users.find(u => u.id === id)?.displayName || '成员').join('、')}</small>}
          <div>{c.tasks.map((task, index) => <React.Fragment key={`${task.occurrenceId}-${index}`}>{index > 0 && <span> 与 </span>}<button type="button" onClick={() => onSelect(task)}>{task.isPrivateMasked && <LockKeyhole size={12} />}{task.title}</button></React.Fragment>)}</div>
        </div>) : <small>当前视图没有此类重叠</small>}</div>
      </details>;
    })}</div>
    <p className="schedule-footnote">仅检查具有开始和结束时间的未完成日程（含全天及重复安排）；首尾相接不算重叠，待安排任务不推测占用时长。</p>
  </section>;
}

function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', password: '', displayName: '' });
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setError(''); setBusy(true);
    try { const data = await api(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(form) }); onAuthed(data); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return <main className="auth-shell">
    <div className="auth-brand"><div className="brand-mark"><CalendarDays size={26} /></div><span>todotime</span></div>
    <section className="auth-card">
      <div className="auth-eyebrow">SHARED SPACE · 01</div>
      <h1>{mode === 'login' ? '登录' : '创建账户'}</h1>
      <form onSubmit={submit}>
        {mode === 'register' && <label>显示名称<input autoFocus placeholder="例如：小林" value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} /></label>}
        <label>用户名<input autoFocus={mode === 'login'} placeholder="输入用户名" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></label>
        <label>密码<input type="password" placeholder="至少 6 位" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary-button full" disabled={busy}>{busy ? '请稍候…' : mode === 'login' ? '进入日历' : '注册并进入'}</button>
      </form>
      <div className="auth-switch">{mode === 'login' ? <>还没有账号？ <button onClick={() => { setMode('register'); setError(''); }}>立即注册</button></> : <>已有账号？ <button onClick={() => { setMode('login'); setError(''); }}>返回登录</button></>}</div>
      {mode === 'login' && <div className="auth-note"><LockKeyhole size={14} /> 私人部署空间 · 管理员可重置密码</div>}
    </section>
  </main>;
}

function TaskModal({ task, users, currentUserId, onClose, onSaved, onDeleted, toast }) {
  const isEdit = Boolean(task?.id);
  const creator = users.find(user => user.id === (task?.ownerId || currentUserId));
  const otherMember = users.find(user => user.id !== creator?.id);
  const initial = useMemo(() => {
    const start = task?.startAt ? new Date(task.startAt) : null; const end = task?.endAt ? new Date(task.endAt) : null;
    return {
      title: task?.isPrivateMasked ? '' : (task?.title || ''), description: task?.description || '', date: start ? dateKey(start) : task?.occurrenceDate || task?.taskDate || task?.date || dateKey(new Date()),
      endDate: task?.endDate || (end ? dateKey(end) : (task?.occurrenceDate || task?.taskDate || task?.date || (start ? dateKey(start) : dateKey(new Date())))),
      start: task?.start || (start ? chinaTime(start) : ''), end: task?.end || (end ? chinaTime(end) : ''), allDay: task?.allDay || false,
      priority: task?.priority || 'normal', tags: (task?.tags || []).join(', '), visibility: task?.visibility || 'shared', assignment: task?.assignment || 'owner',
      backgroundSchedule: task?.backgroundSchedule || false, ignoreDayConflicts: task?.ignoreDayConflicts || false,
      recurrence: task?.recurrence ? task.recurrence.frequency : 'none', recurrenceUntil: task?.recurrence?.until || '', interval: task?.recurrence?.interval || 1
    };
  }, [task]);
  const [form, setForm] = useState(initial); const [tab, setTab] = useState('details'); const [saving, setSaving] = useState(false); const [scope, setScope] = useState('all');
  const [comments, setComments] = useState([]); const [comment, setComment] = useState('');
  useEffect(() => { if (isEdit) api(`/tasks/${task.id}/comments`).then(d => setComments(d.comments)).catch(() => {}); }, [isEdit, task?.id]);
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const save = async (e) => {
    e?.preventDefault(); if (!form.title.trim() && form.visibility !== 'private') return toast('请先填写任务标题');
    setSaving(true);
    const recurrence = form.recurrence !== 'none' ? { frequency: form.recurrence, interval: Number(form.interval) || 1, until: form.recurrenceUntil || null } : null;
    const payload = { title: form.visibility === 'private' && !form.title.trim() ? '私人安排' : form.title, description: form.description, startAt: form.allDay ? isoAt(form.date, '00:00') : (form.start ? isoAt(form.date, form.start) : null), endAt: form.allDay ? isoAt(form.endDate || form.date, '23:59') : (form.end ? isoAt(form.endDate || form.date, form.end) : null), taskDate: form.date, allDay: form.allDay, backgroundSchedule: form.allDay && form.backgroundSchedule, ignoreDayConflicts: form.allDay && form.backgroundSchedule && form.ignoreDayConflicts, priority: form.priority, tags: form.tags.split(',').map(t => t.trim()).filter(Boolean), visibility: form.visibility, assignment: form.assignment, recurrence, scope, occurrenceDate: task?.occurrenceDate };
    try { const data = await api(isEdit ? `/tasks/${task.id}` : '/tasks', { method: isEdit ? 'PUT' : 'POST', body: JSON.stringify(payload) }); onSaved(data.task, data); toast(saveMessage(data, isEdit ? '日程已更新' : '日程已添加')); onClose(); }
    catch (err) { toast(err.message); } finally { setSaving(false); }
  };
  const remove = async () => { if (!confirm('将这条日程移入回收站？')) return; try { await api(`/tasks/${task.id}`, { method: 'DELETE' }); onDeleted(task.id); toast('已移入回收站'); onClose(); } catch (err) { toast(err.message); } };
  const addComment = async (e) => { e.preventDefault(); if (!comment.trim()) return; try { const d = await api(`/tasks/${task.id}/comments`, { method: 'POST', body: JSON.stringify({ body: comment }) }); setComments([...comments, d.comment]); setComment(''); } catch (err) { toast(err.message); } };
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><aside className="task-drawer">
    <header className="drawer-head"><div><span className="drawer-kicker">{isEdit ? '编辑日程' : '新建日程'}</span><h2>{isEdit ? (task.isPrivateMasked ? '私人安排' : task.title) : '新建日程'}</h2></div><button className="icon-button" onClick={onClose}><X size={19} /></button></header>
    <div className="drawer-tabs"><button className={tab === 'details' ? 'active' : ''} onClick={() => setTab('details')}>日程详情</button>{isEdit && <button className={tab === 'comments' ? 'active' : ''} onClick={() => setTab('comments')}>评论 <span>{comments.length || ''}</span></button>}</div>
    {tab === 'details' ? <form className="drawer-body" onSubmit={save}>
      <label className="label-block">标题<input autoFocus={!isEdit} placeholder="输入标题" value={form.title} onChange={e => set('title', e.target.value)} /></label>
      <label className="label-block">备注<textarea rows="3" placeholder="添加一些上下文…" value={form.description} onChange={e => set('description', e.target.value)} /></label>
      <div className="form-grid"><label>开始日期<input type="date" value={form.date} onChange={e => set('date', e.target.value)} /></label><label>结束日期<input type="date" value={form.endDate} min={form.date} onChange={e => set('endDate', e.target.value)} /></label></div>
      <label className="checkbox-line"><input type="checkbox" checked={form.allDay} onChange={e => set('allDay', e.target.checked)} /> 全天任务</label>
      {form.allDay && <div className="background-options"><label className="checkbox-line"><input type="checkbox" checked={form.backgroundSchedule} onChange={e => { set('backgroundSchedule', e.target.checked); if (!e.target.checked) set('ignoreDayConflicts', false); }} /> 多日背景安排</label>{form.backgroundSchedule && <><p>日历会在覆盖日期铺浅色底，其他任务仍显示在上层。</p><label className="checkbox-line"><input type="checkbox" checked={form.ignoreDayConflicts} onChange={e => set('ignoreDayConflicts', e.target.checked)} /> 忽略这条安排与当天任务的冲突提示</label>{form.ignoreDayConflicts && <p>仅忽略这条背景安排；当天其他任务之间仍会正常检查。</p>}</>}</div>}
      {!form.allDay && <div className="form-grid"><label>开始时间<input type="time" value={form.start} onChange={e => set('start', e.target.value)} /></label><label>结束时间<input type="time" value={form.end} onChange={e => set('end', e.target.value)} /></label></div>}
      <div className="section-divider" />
      <div className="form-grid"><label>优先级<select value={form.priority} onChange={e => set('priority', e.target.value)}><option value="low">低</option><option value="normal">普通</option><option value="high">高</option></select></label><label>负责对象<select value={form.assignment} onChange={e => set('assignment', e.target.value)}><option value="owner">{creator?.displayName || '创建者'}负责</option><option value="partner">{otherMember?.displayName || '另一位成员'}负责</option><option value="both">共同负责</option></select></label></div>
      <div className="label-block tag-picker-label">标签<div className="tag-presets">{TAG_PRESETS.map(tag => { const selected = form.tags.split(',').map(value => value.trim()).includes(tag.name); return <button type="button" key={tag.name} className={'tag-preset' + (selected ? ' selected' : '')} style={tagStyle(tag.name)} aria-pressed={selected} onClick={() => { const values = form.tags.split(',').map(value => value.trim()).filter(Boolean); set('tags', selected ? values.filter(value => value !== tag.name).join(', ') : [...values, tag.name].join(', ')); }}>{tag.name}</button>; })}</div><div className="input-with-icon"><Tag size={15} /><input placeholder="也可输入自定义标签，用逗号分隔" value={form.tags} onChange={e => set('tags', e.target.value)} /></div></div>
      <div className="visibility-row"><div><strong>可见范围</strong><small>{form.visibility === 'private' ? '对方只会看到“私人安排”及占用时间' : '双方都能查看详情'}</small></div><button type="button" className={`toggle ${form.visibility === 'private' ? 'on' : ''}`} onClick={() => set('visibility', form.visibility === 'private' ? 'shared' : 'private')}><span /></button></div>
      <div className="recurrence-box"><div className="recurrence-title"><RotateCcw size={15} /> 重复安排</div><div className="form-grid"><select value={form.recurrence} onChange={e => set('recurrence', e.target.value)}><option value="none">不重复</option><option value="daily">每天</option><option value="weekly">每周</option><option value="biweekly">每两周</option><option value="monthly">每月</option></select>{form.recurrence !== 'none' && <input type="date" value={form.recurrenceUntil} onChange={e => set('recurrenceUntil', e.target.value)} />}</div>{form.recurrence !== 'none' && <p>可在编辑时选择只修改本次、此次之后或整个系列。</p>}</div>
      {isEdit && task.recurrence && <div className="scope-select"><span>应用到</span><div><button type="button" className={scope === 'this' ? 'selected' : ''} onClick={() => setScope('this')}>仅本次</button><button type="button" className={scope === 'future' ? 'selected' : ''} onClick={() => setScope('future')}>本次及以后</button><button type="button" className={scope === 'all' ? 'selected' : ''} onClick={() => setScope('all')}>整个系列</button></div></div>}
      <div className="drawer-actions"><button type="button" className="ghost-button" onClick={onClose}>取消</button>{isEdit && <button type="button" className="danger-button" onClick={remove}><Trash2 size={15} /> 删除</button>}<button className="primary-button" disabled={saving}>{saving ? '保存中…' : '保存日程'}</button></div>
    </form> : <div className="comments-body"><div className="comment-list">{comments.length ? comments.map(c => <div className="comment" key={c.id}><div className="avatar mini" style={{ background: c.userColor }}>{c.userName.slice(0, 1)}</div><div><div className="comment-meta"><strong>{c.userName}</strong><span>{new Date(c.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div><p>{c.body}</p></div></div>) : <div className="empty-comments"><MessageCircle size={23} /><p>还没有评论</p></div>}</div><form className="comment-form" onSubmit={addComment}><input placeholder="写一条评论…" value={comment} onChange={e => setComment(e.target.value)} /><button className="primary-button"><Plus size={15} /></button></form></div>}
  </aside></div>;
}

function RecycleBin({ tasks, onRestore, onPermanent, onClose }) {
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><aside className="task-drawer compact-drawer"><header className="drawer-head"><div><span className="drawer-kicker">已删除日程</span><h2>回收站</h2></div><button className="icon-button" onClick={onClose}><X size={19} /></button></header><div className="trash-note">删除的日程会保留 30 天，恢复后会重新出现在日历中。</div><div className="trash-list">{tasks.length ? tasks.map(t => <div className="trash-item" key={t.id}><div><strong>{t.title}</strong><small>{t.startAt ? new Date(t.startAt).toLocaleDateString('zh-CN') : '无日期'} · {t.ownerName}</small></div><div><button className="icon-button" title="恢复" onClick={() => onRestore(t.id)}><RotateCcw size={16} /></button><button className="icon-button danger-icon" title="永久删除" onClick={() => onPermanent(t.id)}><Trash2 size={16} /></button></div></div>) : <div className="empty-comments"><Trash2 size={22} /><p>回收站是空的</p></div>}</div></aside></div>;
}

function Calendar({ tasks, current, onMove, onSelect, onNew, onComplete }) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(current, i)), [current]);
  const hours = Array.from({ length: CALENDAR_END_HOUR - CALENDAR_START_HOUR }, (_, i) => i + CALENDAR_START_HOUR);
  const today = dateKey(new Date());
  const byDay = (key) => tasks.filter(t => taskDayKey(t) === key);
  const timed = (key) => byDay(key).filter(t => !t.allDay && t.startAt);
  const unscheduled = (key) => byDay(key).filter(t => t.allDay || !t.startAt);
  const backgroundFor = key => byDay(key).find(t => t.allDay && t.backgroundSchedule && taskDayKey(t) === key);
  const position = (t) => {
    const start = new Date(t.startAt); const end = t.endAt ? new Date(t.endAt) : new Date(start.getTime() + 45 * 60000);
    const startMinutes = chinaClockMinutes(start); const durationMinutes = Math.max(30, (end - start) / 60000);
    const top = ((startMinutes - CALENDAR_START_HOUR * 60) / 60) * CALENDAR_HOUR_HEIGHT;
    const height = Math.max(30, (durationMinutes / 60) * CALENDAR_HOUR_HEIGHT);
    return { top, height };
  };
  const drop = (e, key, hour) => { e.preventDefault(); const id = e.dataTransfer.getData('task'); if (id) { const task = tasks.find(t => t.occurrenceId === id || String(t.id) === id); if (task) onMove(task, key, hour); } };
  return <div className="calendar-wrap">
    <div className="calendar-toolbar"><div className="today-chip">{dateLabel(current)} – {dateLabel(days[6])}</div><div className="calendar-legend"><span><i className="legend-dot self" />我的安排</span><span><i className="legend-dot partner" />对方安排</span><span><i className="legend-dot shared" />共同负责</span></div></div>
    <div className="week-head"><div className="time-head"><Clock3 size={15} /></div>{days.map((day, i) => <div key={dateKey(day)} className={`day-head ${dateKey(day) === today ? 'is-today' : ''}`}><span>周{weekday[i]}</span><b>{day.getDate()}</b></div>)}</div>
    <div className="unplanned-row"><div className="time-head">待安排</div>{days.map(day => { const key = dateKey(day); const background = backgroundFor(key); return <div key={key} className="unplanned-cell" style={background ? { backgroundColor: tagStyle(background.tags?.[0] || '').backgroundColor } : undefined} onDragOver={e => e.preventDefault()} onDrop={e => drop(e, key, null)}>{unscheduled(key).filter(t => !t.backgroundSchedule).map(t => <TaskPill key={t.occurrenceId} task={t} onSelect={onSelect} onComplete={onComplete} />)}{background && <TaskPill key={background.occurrenceId} task={background} onSelect={onSelect} onComplete={onComplete} />}</div>; })}</div>
    <div className="calendar-scroll"><div className="time-axis">{hours.map(h => <div key={h}>{timeLabel(h)}</div>)}</div><div className="grid-area">{days.map(day => { const key = dateKey(day); const background = backgroundFor(key); return <div className={`day-column ${key === today ? 'today-column' : ''} ${background ? 'has-background-schedule' : ''}`} style={background ? { '--background-color': tagStyle(background.tags?.[0] || '').backgroundColor } : undefined} key={key}>{hours.map(h => <div className="hour-cell" key={h} onDragOver={e => e.preventDefault()} onDrop={e => drop(e, key, h)} onDoubleClick={() => onNew(key, `${pad(h)}:00`)} />)}{timed(key).map(t => <TimedTask key={t.occurrenceId} task={t} position={position(t)} onSelect={onSelect} onComplete={onComplete} />)}</div>; })}</div></div>
  </div>;
}

function MonthCalendar({ tasks, current, onSelect, onNew, onComplete }) {
  const range = monthGridRange(current);
  const days = Array.from({ length: range.count }, (_, index) => addDays(range.start, index));
  const today = dateKey(new Date());
  const monthKey = `${current.getFullYear()}-${current.getMonth()}`;
  const byDay = (key) => tasks.filter(task => taskDayKey(task) === key).sort((a, b) => {
    const aTime = a.startAt ? chinaClockMinutes(new Date(a.startAt)) : -1;
    const bTime = b.startAt ? chinaClockMinutes(new Date(b.startAt)) : -1;
    return aTime - bTime;
  });
  return <div className="month-view">
    <div className="calendar-toolbar"><div className="today-chip">{new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(current)}</div><div className="calendar-legend"><span><i className="legend-dot self" />我的安排</span><span><i className="legend-dot partner" />对方安排</span><span><i className="legend-dot shared" />共同负责</span></div></div>
    <div className="month-week-head">{weekday.map(day => <div key={day}>周{day}</div>)}</div>
    <div className="month-grid">{days.map(day => {
      const key = dateKey(day); const dayTasks = byDay(key); const background = dayTasks.find(task => task.allDay && task.backgroundSchedule); const inMonth = `${day.getFullYear()}-${day.getMonth()}` === monthKey;
      return <div key={key} className={`month-day ${inMonth ? '' : 'outside-month'} ${key === today ? 'is-today' : ''} ${background ? 'has-background-schedule' : ''}`} style={background ? { '--background-color': tagStyle(background.tags?.[0] || '').backgroundColor } : undefined} onDoubleClick={() => onNew(key, '')}>
        <div className="month-day-number">{day.getDate()}</div>
        <div className="month-task-list">{dayTasks.filter(task => !task.backgroundSchedule).slice(0, 5).map(task => <MonthTask key={task.occurrenceId} task={task} onSelect={onSelect} onComplete={onComplete} />)}{background && <MonthTask key={background.occurrenceId} task={background} onSelect={onSelect} onComplete={onComplete} />}{dayTasks.filter(task => !task.backgroundSchedule).length > 5 && <div className="month-more">+{dayTasks.filter(task => !task.backgroundSchedule).length - 5} 项</div>}</div>
      </div>;
    })}</div>
  </div>;
}

function MonthTask({ task, onSelect, onComplete }) {
  const time = task.allDay ? '全天' : (task.startAt ? chinaTime(new Date(task.startAt)) : '待安排');
  return <div className={`month-task ${task.status === 'done' ? 'done' : ''} ${task.isPrivateMasked ? 'private' : ''} ${task.assignment === 'both' ? 'shared-task' : ''} ${task.scheduleType || ''}`} style={{ '--task-color': taskColor(task) }} onClick={() => onSelect(task)}>
    <button onClick={event => { event.stopPropagation(); onComplete(task); }} className="month-check">{task.status === 'done' && <Check size={9} />}</button>
    <span className="month-task-time">{time}</span><strong>{task.title}</strong>{task.tags?.slice(0, 2).map(tag => <em key={tag} className="task-tag" style={tagStyle(tag)}>{tag}</em>)}<ScheduleBadge task={task} />{task.priority === 'high' && <Flag size={10} className="priority-flag" />}
  </div>;
}

function TaskPill({ task, onSelect, onComplete }) { return <div className={`task-pill ${task.status === 'done' ? 'done' : ''} ${task.isPrivateMasked ? 'private' : ''} ${task.assignment === 'both' ? 'shared-task' : ''} ${task.scheduleType || ''}`} style={{ '--task-color': taskColor(task) }} draggable onDragStart={e => e.dataTransfer.setData('task', task.occurrenceId)} onClick={() => onSelect(task)}><button onClick={e => { e.stopPropagation(); onComplete(task); }} className="check-button">{task.status === 'done' && <Check size={11} />}</button><span>{task.title}</span>{task.tags?.slice(0, 1).map(tag => <em key={tag} className="task-tag" style={tagStyle(tag)}>{tag}</em>)}<ScheduleBadge task={task} />{task.priority === 'high' && <Flag size={11} className="priority-flag" />}</div>; }
function TimedTask({ task, position, onSelect, onComplete }) { return <div className={`timed-task ${task.status === 'done' ? 'done' : ''} ${task.isPrivateMasked ? 'private' : ''} ${task.assignment === 'both' ? 'shared-task' : ''} ${task.scheduleType || ''}`} style={{ top: position.top, height: position.height, '--task-color': taskColor(task) }} draggable onDragStart={e => e.dataTransfer.setData('task', task.occurrenceId)} onClick={() => onSelect(task)}><div className="timed-task-head"><button onClick={e => { e.stopPropagation(); onComplete(task); }} className="check-button">{task.status === 'done' && <Check size={11} />}</button><strong>{task.title}</strong><ScheduleBadge task={task} />{task.priority === 'high' && <Flag size={11} className="priority-flag" />}<MoreHorizontal size={14} /></div><span>{task.startAt && chinaTime(new Date(task.startAt))}{task.endAt && ` – ${chinaTime(new Date(task.endAt))}`}</span>{task.tags?.length > 0 && <div className="timed-tags">{task.tags.slice(0, 2).map(tag => <em key={tag} className="task-tag" style={tagStyle(tag)}>{tag}</em>)}</div>}</div>; }

function PriorityPanel({ tasks, onSelect }) {
  const priorityTasks = [...tasks]
    .filter(task => task.priority === 'high' && task.status !== 'done')
    .sort((a, b) => `${taskDayKey(a) || '9999'}${a.startAt || ''}`.localeCompare(`${taskDayKey(b) || '9999'}${b.startAt || ''}`));
  const visibleTasks = priorityTasks.slice(0, 6);
  return <section className={`priority-panel ${priorityTasks.length ? '' : 'is-empty'}`}>
    <div className="priority-panel-head">
      <div className="priority-panel-title"><span className="priority-panel-icon"><Flag size={16} /></span><div><strong>高优先级待办</strong><small>当前视图中需要优先处理的未完成事项</small></div></div>
      <span className="priority-panel-count">{priorityTasks.length} 项</span>
    </div>
    {visibleTasks.length ? <div className="priority-task-list">{visibleTasks.map(task => <button type="button" className={`priority-task ${task.assignment === 'both' ? 'shared-task' : ''}`} style={{ '--task-color': taskColor(task) }} key={task.occurrenceId} onClick={() => onSelect(task)}><span className="priority-task-bar" /><span className="priority-task-content"><strong>{task.title}</strong><small>{taskDateLabel(task)}</small></span><span className={`assignment-chip ${task.assignment}`}>{assignmentLabel(task.assignment)}</span></button>)}{priorityTasks.length > visibleTasks.length && <span className="priority-more">还有 {priorityTasks.length - visibleTasks.length} 项，请切换到对应日期查看</span>}</div> : <div className="priority-empty">当前视图没有未完成的高优先级待办</div>}
  </section>;
}

const notificationDateLabel = (value) => {
  const normalized = value?.includes('T') ? value : `${value?.replace(' ', 'T')}Z`;
  return chinaDateTimeLabel(new Date(normalized));
};
const chinaDateTimeLabel = (date) => new Intl.DateTimeFormat('zh-CN', { timeZone: SHANGHAI_TZ, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);

function NotificationsPage({ notifications, onRead, onReadAll, onBack }) {
  const unreadCount = notifications.filter(notification => !notification.read).length;
  return <section className="content-area notifications-page">
    <div className="page-heading"><div><div className="eyebrow">SHARED SPACE · NOTIFICATIONS</div><h1>通知</h1><p>这里集中显示共享空间里的全部动态。</p></div><div className="heading-actions"><button className="today-button" onClick={onReadAll} disabled={!unreadCount}>全部已读</button><button className="primary-button add-button" onClick={onBack}><CalendarDays size={16} />返回日历</button></div></div>
    <div className="notification-summary"><div className="notification-summary-icon"><Bell size={20} /></div><div><strong>{notifications.length}</strong><span>条通知</span></div><div className="notification-summary-divider" /><div><strong>{unreadCount}</strong><span>条未读</span></div></div>
    <div className="notification-page-list">{notifications.length ? notifications.map(notification => <article key={notification.id} className={`full-notice ${notification.read ? '' : 'unread'} ${notification.type}`} onClick={() => !notification.read && onRead(notification.id)}><div className="full-notice-icon"><Bell size={17} /></div><div className="full-notice-main"><div className="full-notice-title"><strong>{notification.title}</strong>{!notification.read && <span>未读</span>}</div>{notification.body && <p>{notification.body}</p>}<small>{notificationDateLabel(notification.createdAt)}</small></div>{notification.taskId && <span className="full-notice-task">关联日程</span>}</article>) : <div className="notifications-empty"><Bell size={28} /><h3>暂时没有通知</h3><p>当共享空间发生日程或评论变化时，会显示在这里。</p></div>}</div>
  </section>;
}

function App() {
  const [session, setSession] = useState(null); const [loading, setLoading] = useState(true); const [tasks, setTasks] = useState([]); const [users, setUsers] = useState([]); const [notifications, setNotifications] = useState([]); const [activePage, setActivePage] = useState('calendar'); const [viewMode, setViewMode] = useState('week'); const [current, setCurrent] = useState(monday(new Date())); const [modal, setModal] = useState(null); const [toastMessage, setToastMessage] = useState(''); const [filter, setFilter] = useState('all'); const [search, setSearch] = useState(''); const [showTrash, setShowTrash] = useState(false); const [trash, setTrash] = useState([]); const [showReset, setShowReset] = useState(false);
  const notify = (message) => setToastMessage(message);
  const [conflicts, setConflicts] = useState([]);
  const [scheduleNotice, setScheduleNotice] = useState(null);
  const load = async (s = current, viewerId = session?.user?.id) => {
    const range = viewMode === 'month' ? monthGridRange(s) : { start: s, end: addDays(s, 6) };
    const from = dateKey(range.start); const to = dateKey(range.end);
    const [taskData, userData, noteData] = await Promise.all([api(`/tasks?from=${from}&to=${to}`), api('/users'), api('/notifications')]);
    try {
      // Per-account watermark: an initially empty inbox must not suppress the
      // first real notification, and old notifications must not be replayed.
      const key = `todotime_notifications_watermark_${viewerId}`;
      const previous = localStorage.getItem(key);
      const fresh = noteData.notifications.filter(n => n.id > Number(previous || 0) && !n.read);
      if (previous !== null && window.Notification?.permission === 'granted') {
        const ordered = fresh.sort((a, b) => Number(b.type === 'schedule_conflict') - Number(a.type === 'schedule_conflict') || b.id - a.id);
        ordered.slice(0, 3).forEach(n => new Notification(n.title, { body: n.body || '共享空间有新的日程变化', tag: `todotime-${viewerId}-${n.id}` }));
      }
      localStorage.setItem(key, String(Math.max(Number(previous || 0), 0, ...noteData.notifications.map(n => n.id))));
    } catch { /* browser notifications are optional */ }
    setTasks(taskData.tasks); setConflicts(taskData.conflicts || []); setUsers(userData.users); setNotifications(noteData.notifications);
  };
  const openNotifications = async () => {
    if (window.Notification && window.Notification.permission === 'default') { try { await window.Notification.requestPermission(); } catch { /* optional */ } }
    setActivePage('notifications');
  };
  const markNotificationRead = async (id) => {
    try { await api('/notifications/read', { method: 'POST', body: JSON.stringify({ id }) }); setNotifications(old => old.map(notification => notification.id === id ? { ...notification, read: true } : notification)); } catch (error) { notify(error.message); }
  };
  const markAllNotificationsRead = async () => {
    try { await api('/notifications/read', { method: 'POST', body: JSON.stringify({}) }); setNotifications(old => old.map(notification => ({ ...notification, read: true }))); } catch (error) { notify(error.message); }
  };
  useEffect(() => { api('/auth/me').then(data => { setSession(data); load(current, data.user.id).catch(err => notify(err.message)); }).catch(() => {}).finally(() => setLoading(false)); }, []);
  useEffect(() => { if (session) load(current).catch(err => notify(err.message)); }, [current, viewMode]);
  useEffect(() => {
    if (!session) return undefined;
    const timer = setInterval(() => load(current).catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [session, current, viewMode]);
  const changeView = (nextView) => {
    setViewMode(nextView);
    setCurrent(nextView === 'month' ? monthStart(current) : monday(current));
  };
  const goToday = () => setCurrent(viewMode === 'month' ? monthStart(new Date()) : monday(new Date()));
  const goPrevious = () => setCurrent(viewMode === 'month' ? shiftMonth(current, -1) : addDays(current, -7));
  const goNext = () => setCurrent(viewMode === 'month' ? shiftMonth(current, 1) : addDays(current, 7));
  const visibleTasks = tasks.map(task => ({ ...task, scheduleType: conflicts.some(c => c.type === 'schedule_conflict' && c.tasks.some(t => scheduleIdentity(t) === scheduleIdentity(task))) ? 'schedule_conflict' : conflicts.some(c => c.tasks.some(t => scheduleIdentity(t) === scheduleIdentity(task))) ? 'schedule_overlap' : null })).filter(t => filter === 'all' || (filter === 'mine' && t.ownerId === session?.user?.id) || (filter === 'partner' && t.ownerId !== session?.user?.id)).filter(t => !search || t.title.toLowerCase().includes(search.toLowerCase()) || t.tags?.some(tag => tag.toLowerCase().includes(search.toLowerCase())));
  const currentMonthKey = dateKey(current).slice(0, 7);
  const summaryTasks = viewMode === 'month'
    ? visibleTasks.filter(task => taskDayKey(task)?.slice(0, 7) === currentMonthKey)
    : visibleTasks;
  const partnerUser = users.find(user => user.id !== session?.user?.id);
  const saveTask = (_task, data) => { setScheduleNotice(data?.checkedRange ? { conflicts: data.conflicts || [], checkedRange: data.checkedRange } : null); load(current).catch(err => notify(err.message)); };
  const moveTask = async (task, key, hour) => {
    if (task.isPrivateMasked) return notify('私人安排只能由创建者调整');
    const start = new Date(task.startAt || `${key}T09:00:00+08:00`);
    const startAt = hour === null ? null : isoAt(key, `${pad(hour)}:${pad(chinaClockMinutes(start) % 60)}`);
    const duration = task.startAt && task.endAt ? new Date(task.endAt) - new Date(task.startAt) : null;
    const endAt = startAt && duration !== null ? new Date(new Date(startAt).getTime() + duration).toISOString() : null;
    try {
      const data = await api(`/tasks/${task.id}`, { method: 'PUT', body: JSON.stringify({ startAt, endAt, taskDate: key, allDay: false, scope: task.recurrence ? 'this' : 'all', occurrenceDate: task.occurrenceDate }) });
      saveTask(data.task, data); notify(saveMessage(data, '时间已调整'));
    } catch (err) { notify(err.message); }
  };
  const complete = async (task) => { if (task.isPrivateMasked) return notify('私人安排只能由创建者调整'); try { const data = await api(`/tasks/${task.id}/complete`, { method: 'POST', body: JSON.stringify({ occurrenceDate: task.occurrenceDate }) }); setScheduleNotice(null); await load(current); } catch (err) { notify(err.message); } };
  const openTrash = async () => { try { const d = await api('/tasks?deleted=1'); setTrash(d.tasks); setShowTrash(true); } catch (err) { notify(err.message); } };
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); setSession(null); setTasks([]); setConflicts([]); setScheduleNotice(null); setNotifications([]); setActivePage('calendar'); };
  if (loading) return <div className="loading-screen"><div className="brand-mark"><CalendarDays size={26} /></div><span>正在打开你的日历…</span></div>;
  if (!session) return <AuthScreen onAuthed={data => { setSession(data); load(current, data.user.id).catch(() => {}); }} />;
  return <div className="app-shell">
    <aside className="sidebar"><div className="side-brand"><div className="brand-mark small"><CalendarDays size={19} /></div><span>todotime</span></div><div className="space-switcher"><div className="space-icon">2</div><div><strong>共享空间</strong><small>两位成员 · 私人</small></div><ChevronRight size={15} /></div><nav><div className="nav-label">工作台</div><button className={`nav-item ${activePage === 'calendar' ? 'active' : ''}`} onClick={() => setActivePage('calendar')}><CalendarDays size={17} />日历<span className="nav-count">{viewMode === 'week' ? '周' : '月'}</span></button><button className="nav-item" onClick={openTrash}><Trash2 size={17} />回收站</button><button className={`nav-item ${activePage === 'notifications' ? 'active' : ''}`} onClick={openNotifications}><Bell size={17} />通知{notifications.some(n => !n.read) && <i className="notice-dot" />}</button><div className="nav-label second">视图</div><button className={`nav-item ${filter === 'mine' ? 'subactive' : ''}`} onClick={() => setFilter(filter === 'mine' ? 'all' : 'mine')}><span className="member-dot" style={{ background: session.user.color }} />我的安排</button><button className={`nav-item ${filter === 'partner' ? 'subactive' : ''}`} onClick={() => setFilter(filter === 'partner' ? 'all' : 'partner')}><span className="member-dot partner-dot" style={{ background: partnerUser?.color || '#d87b4d' }} />对方安排</button><button className="nav-item" onClick={() => setFilter('all')}><Columns3 size={17} />全部显示</button></nav><div className="sidebar-bottom"><button className="nav-item" onClick={() => setShowReset(true)}><Settings size={17} />空间设置</button><div className="profile-row"><div className="avatar" style={{ background: session.user.color }}>{session.user.displayName.slice(0, 1)}</div><div><strong>{session.user.displayName}</strong><small>{session.user.role === 'admin' ? '管理员' : '成员'}</small></div><button className="icon-button" onClick={logout}><LogOut size={15} /></button></div></div></aside>
    <main className="main-content"><header className="topbar"><div className="breadcrumb"><span>{activePage === 'notifications' ? '通知' : '日历'}</span><ChevronRight size={14} /><strong>{activePage === 'notifications' ? '全部通知' : (viewMode === 'week' ? '本周安排' : '本月安排')}</strong></div><div className="top-actions">{activePage === 'notifications' ? <button className="primary-button add-button" onClick={() => setActivePage('calendar')}><CalendarDays size={16} />返回日历</button> : <><div className="search-box"><Search size={16} /><input placeholder="搜索日程、标签…" value={search} onChange={e => setSearch(e.target.value)} /></div><button className="icon-button notification-button" onClick={openNotifications}><Bell size={18} />{notifications.some(n => !n.read) && <i />}</button><button className="primary-button add-button" onClick={() => setModal({ date: dateKey(new Date()) })}><Plus size={17} />新建日程</button></>}</div></header>
      {activePage === 'notifications' ? <NotificationsPage notifications={notifications} onRead={markNotificationRead} onReadAll={markAllNotificationsRead} onBack={() => setActivePage('calendar')} /> : <section className="content-area"><div className="page-heading"><div><div className="eyebrow">{new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(current)}</div><h1>日历</h1></div><div className="heading-actions"><div className="view-switch" aria-label="切换日历视图"><button className={viewMode === 'week' ? 'active' : ''} onClick={() => changeView('week')}>周</button><button className={viewMode === 'month' ? 'active' : ''} onClick={() => changeView('month')}>月</button></div><button className="today-button" onClick={goToday}>回到今天</button><div className="week-nav"><button className="icon-button" onClick={goPrevious}><ChevronLeft size={17} /></button><button className="icon-button" onClick={goNext}><ChevronRight size={17} /></button></div></div></div><div className="summary-strip"><div><span className="summary-icon teal"><CalendarDays size={17} /></span><div><small>{viewMode === 'week' ? '本周计划' : '本月计划'}</small><strong>{summaryTasks.length} <em>项</em></strong></div></div><div><span className="summary-icon orange"><Clock3 size={17} /></span><div><small>共同负责</small><strong>{summaryTasks.filter(t => t.assignment === 'both').length} <em>项</em></strong></div></div><div><span className="summary-icon purple"><CircleCheck size={17} /></span><div><small>已完成</small><strong>{summaryTasks.filter(t => t.status === 'done').length} <em>项</em></strong></div></div><div className="summary-tip"><span className="summary-priority-icon"><Flag size={16} /></span><div><strong>高优先级待办</strong><small>{summaryTasks.filter(t => t.priority === 'high' && t.status !== 'done').length} 项未完成</small></div></div></div><SchedulePanel conflicts={conflicts} users={users} onSelect={task => task.isPrivateMasked ? notify('这是对方的私人安排，仅显示占用时间') : setModal(task)} notice={scheduleNotice} onDismiss={() => setScheduleNotice(null)} /><PriorityPanel tasks={summaryTasks} onSelect={setModal} /><div className="calendar-card">{viewMode === 'week' ? <Calendar tasks={visibleTasks} current={current} onMove={moveTask} onSelect={setModal} onNew={(date, start) => setModal({ date, start })} onComplete={complete} /> : <MonthCalendar tasks={visibleTasks} current={current} onSelect={setModal} onNew={(date, start) => setModal({ date, start })} onComplete={complete} />}</div></section>}
    </main>
    {modal && <TaskModal task={modal} users={users} currentUserId={session.user.id} onClose={() => setModal(null)} onSaved={saveTask} onDeleted={id => { setTasks(tasks.filter(t => t.id !== id)); setScheduleNotice(null); load(current).catch(err => notify(err.message)); }} toast={notify} />}
    {showTrash && <RecycleBin tasks={trash} onClose={() => setShowTrash(false)} onRestore={async id => { const data = await api(`/tasks/${id}/restore`, { method: 'POST' }); setTrash(trash.filter(t => t.id !== id)); saveTask(data.task, data); notify(saveMessage(data, '日程已恢复')); }} onPermanent={async id => { if (confirm('永久删除后无法恢复，确定继续吗？')) { await api(`/tasks/${id}/permanent`, { method: 'DELETE' }); setTrash(trash.filter(t => t.id !== id)); notify('已永久删除'); } }} />}
    {showReset && <ResetModal users={users} onClose={() => setShowReset(false)} toast={notify} />}
    {toastMessage && <Toast message={toastMessage} onClose={() => setToastMessage('')} />}
  </div>;
}

function ResetModal({ users, onClose, toast }) { const [userId, setUserId] = useState(users[1]?.id || users[0]?.id); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const submit = async e => { e.preventDefault(); setBusy(true); try { await api('/auth/reset-password', { method: 'POST', body: JSON.stringify({ userId, newPassword: password }) }); toast('密码已重置'); onClose(); } catch (err) { toast(err.message); } finally { setBusy(false); } }; return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><aside className="task-drawer settings-drawer"><header className="drawer-head"><div><span className="drawer-kicker">管理员设置</span><h2>重置成员密码</h2></div><button className="icon-button" onClick={onClose}><X size={19} /></button></header><form className="drawer-body" onSubmit={submit}><p className="settings-intro">当前空间固定两位成员。管理员可以在这里帮助成员设置新密码。</p><label className="label-block">选择成员<select value={userId} onChange={e => setUserId(Number(e.target.value))}>{users.map(u => <option key={u.id} value={u.id}>{u.displayName}（{u.username}）</option>)}</select></label><label className="label-block">新密码<input type="password" minLength="6" placeholder="至少 6 位" value={password} onChange={e => setPassword(e.target.value)} /></label><div className="drawer-actions"><button type="button" className="ghost-button" onClick={onClose}>取消</button><button className="primary-button" disabled={busy}>{busy ? '保存中…' : '确认重置'}</button></div></form></aside></div>; }

createRoot(document.getElementById('root')).render(<App />);
