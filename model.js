export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

// Date-only backups used the end of the selected local day. New deadlines are
// stored as UTC instants; datetime-local inputs are interpreted on this device.
export function normalizeDate(value) {
  if (typeof value !== 'string' || !value) return '';
  const local = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value);
  if (local) {
    const [, yy, mm, dd, hh, min] = local;
    const y = +yy, m = +mm - 1, d = +dd, h = hh === undefined ? 23 : +hh, minute = min === undefined ? 59 : +min;
    if (y < 1900 || y > 9999) return '';
    const date = new Date(y, m, d, h, minute, hh === undefined ? 59 : 0, hh === undefined ? 999 : 0);
    if (date.getFullYear() !== y || date.getMonth() !== m || date.getDate() !== d || date.getHours() !== h || date.getMinutes() !== minute) return '';
    return date.toISOString();
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return '';
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value && +value.slice(0, 4) >= 1900 ? value : '';
}
export function localDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function deadlineTimestamp(node) { const iso = normalizeDate(node.due); return iso ? Date.parse(iso) : null; }
export function isFinished(node) {
  if (node.kind === 'task') return node.items.length > 0 && node.items.every(t => t.done);
  if (node.kind === 'timer') return node.completed === true || (node.progressTarget > 0 && node.progressValue >= node.progressTarget);
  return false;
}
export function deadlineState(node, now = Date.now()) {
  const due = deadlineTimestamp(node);
  if (due === null) return null;
  const remaining = due - now, completed = isFinished(node);
  const start = normalizeDate(node.startAt), startMs = start ? Date.parse(start) : null;
  return {
    due, remaining, completed,
    status: completed ? 'completed' : remaining <= 0 ? 'overdue' : remaining <= 2 * HOUR ? 'urgent' : remaining <= DAY ? 'soon' : 'normal',
    elapsed: startMs !== null && startMs < due ? Math.max(0, Math.min(1, (now - startMs) / (due - startMs))) : null,
    notStarted: startMs !== null && now < startMs,
  };
}
export function durationParts(milliseconds) {
  const value = Math.abs(milliseconds);
  if (value < MINUTE) return { value: value === 0 ? '0' : '不足 1', unit: '分钟', detail: '' };
  if (value >= DAY) return { value: String(Math.floor(value / DAY)), unit: '天', detail: `另有 ${Math.floor(value % DAY / HOUR)} 小时 ${Math.floor(value % HOUR / MINUTE)} 分钟` };
  if (value >= HOUR) return { value: `${Math.floor(value / HOUR)}:${String(Math.floor(value % HOUR / MINUTE)).padStart(2, '0')}`, unit: '小时 : 分钟', detail: '' };
  return { value: String(Math.floor(value / MINUTE)), unit: '分钟', detail: '' };
}
export function deadlineLabel(node, now = Date.now()) {
  const state = deadlineState(node, now); if (!state) return '';
  if (state.completed) return '已完成';
  const parts = durationParts(state.remaining);
  const prefix = state.remaining <= 0 ? node.kind === 'timer' ? '已到期' : '已逾期' : '剩余';
  const duration = parts.unit === '小时 : 分钟' ? `${parts.value.split(':')[0]} 小时 ${Number(parts.value.split(':')[1])} 分` : `${parts.value} ${parts.unit}`;
  return `${prefix} ${duration}`;
}
export function scheduledNodes(nodes, now = Date.now()) {
  return nodes.filter(n => deadlineState(n, now) && !isFinished(n)).sort((a, b) => deadlineTimestamp(a) - deadlineTimestamp(b));
}


export const COLORS = {
  butter: { name: '柔黄', bg: '#fffbed', border: '#ece5c6', ink: '#69603c', text: '#99906e', accent: '#b0a271', swatch: '#f4e9b6' },
  sage: { name: '鼠尾草', bg: '#f5f9ef', border: '#dce6ce', ink: '#4e6542', text: '#819573', accent: '#91a27b', swatch: '#dce8cb' },
  blue: { name: '雾蓝', bg: '#f1f6fb', border: '#dce5ef', ink: '#526c85', text: '#869bb0', accent: '#9caec0', swatch: '#d7e5f1' },
  lilac: { name: '浅紫', bg: '#f7f3fb', border: '#e6deee', ink: '#776384', text: '#a292ad', accent: '#b1a0bd', swatch: '#e6dbef' },
  peach: { name: '杏粉', bg: '#fff5ef', border: '#f0dfd2', ink: '#916f59', text: '#b29987', accent: '#c5a88f', swatch: '#f2ddcc' },
  paper: { name: '纸白', bg: '#fffefa', border: '#e3e7dc', ink: '#5a6951', text: '#89947f', accent: '#a0ac94', swatch: '#f2f2ea' },
};
export const LIMITS = { minZoom: 0.15, maxZoom: 2.5, maxItems: 1000, maxEdges: 3000, maxImageLength: 8_000_000 };
export const uid = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const clone = value => structuredClone(value);
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function screenToWorld(point, view) { return { x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom }; }
export function zoomAt(view, point, zoom) {
  zoom = clamp(zoom, LIMITS.minZoom, LIMITS.maxZoom);
  const world = screenToWorld(point, view);
  return { x: point.x - world.x * zoom, y: point.y - world.y * zoom, zoom };
}
export function containedNodes(group, nodes) {
  return nodes.filter(n => n.x >= group.x && n.y >= group.y && n.x + n.w <= group.x + group.w && n.y + n.h <= group.y + group.h);
}
export function boundsOf(items) {
  if (!items.length) return null;
  const x = Math.min(...items.map(n => n.x)), y = Math.min(...items.map(n => n.y));
  return { x, y, w: Math.max(...items.map(n => n.x + n.w)) - x, h: Math.max(...items.map(n => n.y + n.h)) - y };
}
export function createGroupCopy(board, groupId) {
  const source = board.groups.find(g => g.id === groupId);
  if (!source) throw new Error('没有找到要复制的分组');
  const members = containedNodes(source, board.nodes);
  const memberIds = new Set(members.map(n => n.id));
  const internalEdges = board.edges.filter(e => memberIds.has(e.from) && memberIds.has(e.to));
  if (board.nodes.length + board.groups.length + members.length + 1 > LIMITS.maxItems) throw new Error('复制后会超过 1000 个内容项，未复制任何内容');
  if (board.edges.length + internalEdges.length > LIMITS.maxEdges) throw new Error('复制后会超过 3000 条连线，未复制任何内容');

  // Place the copy beyond the current canvas contents. An overlapping copy would
  // accidentally pick up original cards on its next spatial group move.
  const bounds = boundsOf([...board.nodes, ...board.groups]);
  let x = bounds.x + bounds.w + 64;
  if (x + source.w > 1e7) x = bounds.x - source.w - 64;
  if (x < -1e7) throw new Error('画布边界附近没有足够空间复制分组');
  const dx = x - source.x, idMap = new Map(members.map(n => [n.id, uid()]));
  const group = { ...clone(source), id: uid(), x, title: `${source.title.slice(0, 155)} · 副本` };
  const nodes = members.map(n => {
    const copy = { ...clone(n), id: idMap.get(n.id), x: n.x + dx };
    if (copy.items) copy.items.forEach(t => { t.id = uid(); });
    return copy;
  });
  const edges = internalEdges.map(e => ({ ...clone(e), id: uid(), from: idMap.get(e.from), to: idMap.get(e.to) }));
  return { group, nodes, edges };
}
export function edgeGeometry(a, b) {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = bc.x - ac.x, dy = bc.y - ac.y;
  const horizontal = Math.abs(dx) / ((a.w + b.w) / 2) >= Math.abs(dy) / ((a.h + b.h) / 2);
  const sign = (horizontal ? dx : dy) >= 0 ? 1 : -1;
  let p, q, c1, c2;
  if (horizontal) {
    p = { x: ac.x + sign * (a.w / 2 + 6), y: ac.y }; q = { x: bc.x - sign * (b.w / 2 + 7), y: bc.y };
    const bend = Math.max(32, Math.abs(q.x - p.x) * .48);
    c1 = { x: p.x + sign * bend, y: p.y }; c2 = { x: q.x - sign * bend, y: q.y };
  } else {
    p = { x: ac.x, y: ac.y + sign * (a.h / 2 + 6) }; q = { x: bc.x, y: bc.y - sign * (b.h / 2 + 7) };
    const bend = Math.max(32, Math.abs(q.y - p.y) * .48);
    c1 = { x: p.x, y: p.y + sign * bend }; c2 = { x: q.x, y: q.y - sign * bend };
  }
  return { d: `M${p.x},${p.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${q.x},${q.y}`, label: { x: (p.x + 3 * c1.x + 3 * c2.x + q.x) / 8, y: (p.y + 3 * c1.y + 3 * c2.y + q.y) / 8 - 9 } };
}
export function makeNode(kind, point) {
  return { id: uid(), kind, x: Math.round(point.x), y: Math.round(point.y), w: kind === 'group' ? 500 : kind === 'timer' ? 320 : 290, h: kind === 'group' ? 360 : kind === 'timer' ? 390 : kind === 'task' ? 320 : 230,
    title: kind === 'group' ? '新的分组' : kind === 'timer' ? '一件值得期待的事' : kind === 'task' ? '一件想做的事' : kind === 'image' ? '一张灵感图片' : '一个新的想法', body: '', color: kind === 'timer' ? 'blue' : kind === 'task' || kind === 'group' ? 'sage' : kind === 'image' ? 'paper' : 'butter',
    ...(['task', 'timer'].includes(kind) ? { due: '', startAt: new Date().toISOString() } : {}),
    ...(kind === 'task' ? { items: [{ id: uid(), text: '迈出第一小步', done: false }] } : {}),
    ...(kind === 'timer' ? { progressValue: 0, progressTarget: 0, progressUnit: '项', completed: false } : {}),
  };
}
export function createBoard(empty = false) {
  const board = { version: 2, id: uid(), title: '我的第一张画布', nodes: [], groups: [], edges: [], view: null, updatedAt: new Date().toISOString() };
  if (empty) return board;
  board.nodes = [
    { id: 'seed-start', kind: 'note', x: 100, y: 155, w: 286, h: 235, title: '把脑中的画面，\n放在这里。', body: '一个念头、一件小事，\n或一个还没想清楚的问题。\n\n让它先有位置，答案慢慢长出来。', color: 'butter' },
    { id: 'seed-task', kind: 'task', x: 492, y: 170, w: 290, h: 245, title: '从一个小行动开始', color: 'sage', body: '', due: '', items: [{ id: 'seed-t1', text: '给这个空间起个名字', done: true }, { id: 'seed-t2', text: '放下此刻脑中的一个念头', done: false }, { id: 'seed-t3', text: '把有关的想法连接起来', done: false }] },
    { id: 'seed-position', kind: 'note', x: 158, y: 452, w: 310, h: 210, title: '每个位置，都有你的含义', body: '左上角，可以是今天最在意的事。\n靠近一点，可能意味着彼此有关。\n\n这里的秩序，由你定义。', color: 'blue' },
    { id: 'seed-image', kind: 'image', x: 904, y: 176, w: 300, h: 225, title: '给灵感留一扇窗', body: '', color: 'paper', src: './assets/landscape.svg' },
    { id: 'seed-idea', kind: 'note', x: 918, y: 444, w: 288, h: 218, title: '还没想好，也没关系', body: '那些暂时用不上的灵感，\n也值得有一个停靠的地方。\n\n双击编辑，或拖一张图片进来。', color: 'lilac' },
  ];
  board.groups = [{ id: 'seed-g1', kind: 'group', x: 64, y: 122, w: 752, h: 550, title: '01  /  此刻，正在发生', body: '', color: 'sage' }, { id: 'seed-g2', kind: 'group', x: 866, y: 122, w: 376, h: 550, title: '02  /  留一点想象的空间', body: '', color: 'lilac' }];
  board.edges = [{ id: 'seed-e1', from: 'seed-start', to: 'seed-task', label: '落地成行动', arrow: true }, { id: 'seed-e2', from: 'seed-start', to: 'seed-position', label: '找到自己的位置', arrow: false }, { id: 'seed-e3', from: 'seed-image', to: 'seed-idea', label: '由此想到', arrow: true }];
  return board;
}

// Import only the documented schema. Rebuild every object rather than trusting arbitrary JSON.
export function validateBoard(raw) {
  const fail = message => { throw new Error(`画布文件无效：${message}`); };
  if (!raw || typeof raw !== 'object' || ![1, 2].includes(raw.version)) fail('不支持的文件版本');
  const str = (v, max, fallback = '') => typeof v === 'string' ? v.slice(0, max) : fallback;
  const number = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail('位置或尺寸超出范围');
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.groups) || !Array.isArray(raw.edges)) fail('缺少内容列表');
  if (raw.nodes.length + raw.groups.length > LIMITS.maxItems || raw.edges.length > LIMITS.maxEdges) fail('内容数量过多');
  const ids = new Set();
  function item(n, group) {
    if (!n || typeof n !== 'object' || typeof n.id !== 'string' || !n.id || n.id.length > 100 || ids.has(n.id)) fail('内容 ID 重复或缺失');
    ids.add(n.id);
    if (group ? n.kind !== 'group' : !['note', 'task', 'image', 'timer'].includes(n.kind)) fail('未知的卡片类型');
    const result = { id: n.id, kind: n.kind, title: str(n.title, 160, '未命名'), body: str(n.body, 20000), color: Object.hasOwn(COLORS, n.color) ? n.color : 'butter', x: number(n.x, -1e7, 1e7), y: number(n.y, -1e7, 1e7), w: number(n.w, group ? 280 : 200, 5000), h: number(n.h, group ? 180 : 130, 5000) };
    if (n.kind === 'task') {
      if (!Array.isArray(n.items) || n.items.length > 200) fail('待办项格式错误');
      result.items = n.items.map(t => {
        if (!t || typeof t !== 'object') fail('待办项格式错误');
        return { id: uid(), text: str(t.text, 1000), done: t.done === true };
      });
    }
    if (n.kind === 'task' || n.kind === 'timer') {
      result.due = normalizeDate(n.due);
      result.startAt = normalizeDate(n.startAt);
      if (n.due && !result.due) fail('截止时间格式错误');
      if (n.startAt && !result.startAt) fail('开始时间格式错误');
      if (result.due && result.startAt && Date.parse(result.startAt) >= Date.parse(result.due)) fail('开始时间必须早于截止时间');
    }
    if (n.kind === 'timer') {
      if (!result.due) fail('时间卡片缺少目标时间');
      const value = n.progressValue ?? 0, target = n.progressTarget ?? 0;
      if (!Number.isSafeInteger(value) || !Number.isSafeInteger(target) || value < 0 || target < 0 || target > 1e6 || value > target) fail('完成进度格式错误');
      result.progressValue = value; result.progressTarget = target;
      result.progressUnit = str(n.progressUnit, 12, '项'); result.completed = n.completed === true;
    }
    if (n.kind === 'image') {
      if (typeof n.src !== 'string' || n.src.length > LIMITS.maxImageLength || !(n.src === './assets/landscape.svg' || /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/.test(n.src))) fail('图片格式不受支持');
      result.src = n.src;
    }
    return result;
  }
  const nodes = raw.nodes.map(n => item(n, false)), groups = raw.groups.map(n => item(n, true));
  const nodeIds = new Set(nodes.map(n => n.id)), edgeIds = new Set();
  const edges = raw.edges.map(e => {
    if (!e || typeof e.id !== 'string' || !e.id || e.id.length > 100 || edgeIds.has(e.id) || !nodeIds.has(e.from) || !nodeIds.has(e.to) || e.from === e.to) fail('连线引用错误');
    edgeIds.add(e.id);
    return { id: e.id, from: e.from, to: e.to, label: str(e.label, 80), arrow: e.arrow === true };
  });
  const view = raw.view && typeof raw.view.x === 'number' && Number.isFinite(raw.view.x) && Math.abs(raw.view.x) <= 1e8 && typeof raw.view.y === 'number' && Number.isFinite(raw.view.y) && Math.abs(raw.view.y) <= 1e8 && typeof raw.view.zoom === 'number' && Number.isFinite(raw.view.zoom) ? { x: raw.view.x, y: raw.view.y, zoom: clamp(raw.view.zoom, LIMITS.minZoom, LIMITS.maxZoom), width: typeof raw.view.width === 'number' && Number.isFinite(raw.view.width) ? raw.view.width : 0, height: typeof raw.view.height === 'number' && Number.isFinite(raw.view.height) ? raw.view.height : 0 } : null;
  return { version: 2, id: str(raw.id, 100, uid()), title: str(raw.title, 80, '未命名画布'), nodes, groups, edges, view, updatedAt: str(raw.updatedAt, 100, new Date().toISOString()) };
}
export class History {
  constructor(limit = 50) { this.limit = limit; this.past = []; this.future = []; }
  push(board) { this.past.push(clone(board)); if (this.past.length > this.limit) this.past.shift(); this.future = []; }
  undo(board) { if (!this.past.length) return null; this.future.push(clone(board)); return this.past.pop(); }
  redo(board) { if (!this.future.length) return null; this.past.push(clone(board)); return this.future.pop(); }
}

// A library has its own version so individual v1/v2 canvas backups stay compatible.
export const LIBRARY_FORMAT = 'thought-canvas-library';
export const MAX_BOARDS = 100;
export function boardEntry(board, now = new Date().toISOString()) {
  return { board, createdAt: now, openedAt: now, trashedAt: null };
}
export function createLibrary(board = createBoard()) {
  return { format: LIBRARY_FORMAT, version: 1, boards: [boardEntry(board)], lastBoardId: board.id, autoOpenLast: false };
}
export function validateLibrary(raw) {
  if (!raw || raw.format !== LIBRARY_FORMAT || raw.version !== 1 || !Array.isArray(raw.boards) || raw.boards.length > MAX_BOARDS) throw new Error('画布库格式无效或画布超过 100 张');
  const ids = new Set(), now = new Date().toISOString();
  const boards = raw.boards.map(entry => {
    if (typeof entry?.board?.id !== 'string' || !entry.board.id || entry.board.id.length > 100) throw new Error('画布库中的画布 ID 缺失或无效');
    const board = validateBoard(entry?.board);
    if (!board.id || ids.has(board.id)) throw new Error('画布库中的画布 ID 重复或缺失');
    ids.add(board.id);
    if (entry.trashedAt != null && !normalizeDate(entry.trashedAt)) throw new Error('回收站记录无效');
    return { board, createdAt: normalizeDate(entry.createdAt) || now, openedAt: normalizeDate(entry.openedAt) || now, trashedAt: entry.trashedAt || null };
  });
  return { format: LIBRARY_FORMAT, version: 1, boards, lastBoardId: boards.some(e => e.board.id === raw.lastBoardId && !e.trashedAt) ? raw.lastBoardId : null, autoOpenLast: raw.autoOpenLast === true };
}
export function prepareImport(raw, existingCount = 0) {
  const entries = raw?.format === LIBRARY_FORMAT ? validateLibrary(raw).boards : [boardEntry(validateBoard(raw))];
  if (!entries.length) throw new Error('备份中没有画布');
  if (existingCount + entries.length > MAX_BOARDS) throw new Error('画布库最多保存 100 张画布（含回收站），请先导出并清理不需要的画布');
  // New canvas identities make repeated imports additive. Node IDs are scoped to a canvas.
  return entries.map(entry => ({ ...entry, board: { ...entry.board, id: uid() } }));
}
export function libraryReminders(library, currentBoardId = null) {
  return library.boards.filter(e => !e.trashedAt && (!currentBoardId || e.board.id === currentBoardId))
    .flatMap(e => scheduledNodes(e.board.nodes).map(node => ({ node, boardId: e.board.id, boardTitle: e.board.title })))
    .sort((a, b) => deadlineTimestamp(a.node) - deadlineTimestamp(b.node));
}
