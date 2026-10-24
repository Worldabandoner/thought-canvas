import test from 'node:test';
import assert from 'node:assert/strict';
import { MINUTE, HOUR, DAY, normalizeDate, localDateTime, deadlineState, durationParts, scheduledNodes, isFinished, createBoard, validateBoard, makeNode, createGroupCopy } from '../model.js';

const now = Date.parse('2026-10-24T04:00:00.000Z');
const timer = (ms, extra = {}) => ({ kind: 'timer', due: new Date(now + ms).toISOString(), startAt: new Date(now - DAY).toISOString(), progressValue: 0, progressTarget: 0, completed: false, ...extra });

test('date-only v1 deadlines retain the end of their local day', () => {
  const iso = normalizeDate('2026-10-24'), date = new Date(iso);
  assert.equal(date.getFullYear(), 2026); assert.equal(date.getMonth(), 9); assert.equal(date.getDate(), 24);
  assert.equal(date.getHours(), 23); assert.equal(date.getMinutes(), 59); assert.equal(date.getSeconds(), 59); assert.equal(date.getMilliseconds(), 999);
});
test('local minute inputs round-trip through UTC and invalid calendar dates are refused', () => {
  assert.equal(localDateTime(normalizeDate('2026-10-24T23:59')), '2026-10-24T23:59');
  assert.ok(normalizeDate('2028-02-29T10:30'));
  for (const invalid of ['2026-02-29', '2026-13-01', '2026-04-31T09:00', '2026-10-24T24:15', '2026-02-31T00:00:00.000Z', 'not a date']) assert.equal(normalizeDate(invalid), '');
});
test('deadline states change at exact boundaries and completion wins over overdue', () => {
  assert.equal(deadlineState(timer(DAY + 1), now).status, 'normal');
  assert.equal(deadlineState(timer(DAY), now).status, 'soon');
  assert.equal(deadlineState(timer(2 * HOUR), now).status, 'urgent');
  assert.equal(deadlineState(timer(0), now).status, 'overdue');
  assert.equal(deadlineState(timer(-HOUR, { completed: true }), now).status, 'completed');
  assert.equal(deadlineState(timer(-HOUR, { progressValue: 10, progressTarget: 10 }), now).status, 'completed');
});
test('time elapsed clamps before start and after deadline without changing actual progress', () => {
  const n = timer(DAY, { progressValue: 3, progressTarget: 10 });
  assert.equal(deadlineState(n, now).elapsed, .5);
  assert.equal(deadlineState(n, now - 2 * DAY).elapsed, 0);
  assert.equal(deadlineState(n, now + 2 * DAY).elapsed, 1);
  assert.equal(deadlineState(n, now - 2 * DAY).notStarted, true);
  assert.equal(n.progressValue, 3);
  assert.equal(deadlineState({ ...n, startAt: '' }, now).elapsed, null);
});
test('countdowns use days, hours or minutes and do not show a negative remaining time', () => {
  assert.deepEqual(durationParts(42 * DAY + 3 * HOUR + 5 * MINUTE), { value: '42', unit: '天', detail: '另有 3 小时 5 分钟' });
  assert.equal(durationParts(5 * HOUR + 9 * MINUTE).value, '5:09');
  assert.equal(durationParts(-5 * HOUR).value, '5:00');
  assert.equal(durationParts(30000).value, '不足 1');
});
test('upcoming items sort by deadline and exclude completed items without moving cards', () => {
  const later = { ...timer(42 * DAY), id: 'exam', x: 10 }, overdue = { ...timer(-HOUR), id: 'late', x: 20 };
  const done = { ...timer(-DAY), id: 'done', completed: true }, noDue = { kind: 'task', items: [], due: '' };
  const nodes = [later, done, noDue, overdue], original = structuredClone(nodes);
  assert.deepEqual(scheduledNodes(nodes, now).map(n => n.id), ['late', 'exam']);
  assert.deepEqual(nodes, original);
  assert.equal(isFinished(noDue), false);
});
test('v1 backups migrate safely and v2 time cards keep their dates, progress and group copies', () => {
  const old = createBoard(); old.version = 1; old.nodes.find(n => n.kind === 'task').due = '2026-10-24';
  const restored = validateBoard(old); assert.equal(restored.version, 2);
  assert.equal(restored.nodes.find(n => n.kind === 'task').due, normalizeDate('2026-10-24'));
  const board = createBoard(true), n = makeNode('timer', { x: 110, y: 110 });
  Object.assign(n, timer(DAY), { id: 'clock', progressValue: 6, progressTarget: 10, progressUnit: '节' });
  board.nodes.push(n); board.groups.push({ id: 'g', kind: 'group', title: '学习', body: '', color: 'sage', x: 100, y: 100, w: 500, h: 500 });
  const copy = createGroupCopy(board, 'g'); board.nodes.push(...copy.nodes); board.groups.push(copy.group);
  const imported = validateBoard(JSON.parse(JSON.stringify(board)));
  assert.equal(imported.nodes.length, 2);
  assert.equal(imported.nodes[1].due, n.due); assert.equal(imported.nodes[1].progressValue, 6); assert.equal(imported.nodes[1].progressUnit, '节');
});
test('invalid dates, impossible time windows and malformed progress are rejected on import', () => {
  const board = createBoard(true), n = { ...makeNode('timer', { x: 0, y: 0 }), ...timer(DAY) }; board.nodes.push(n);
  n.due = ''; assert.throws(() => validateBoard(board), /缺少目标时间/);
  n.due = timer(DAY).due; n.startAt = timer(2 * DAY).due; assert.throws(() => validateBoard(board), /开始时间/);
  n.startAt = ''; n.progressValue = 5; n.progressTarget = 2; assert.throws(() => validateBoard(board), /完成进度/);
});
