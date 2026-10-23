import { COLORS, LIMITS, uid, clone, clamp, screenToWorld, zoomAt, containedNodes, boundsOf, edgeGeometry, makeNode, createBoard, validateBoard, History } from './model.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const NS = 'http://www.w3.org/2000/svg';
const viewport = $('#viewport'), world = $('#world');
let board = createBoard(), view = { x: 0, y: 0, zoom: 1 }, selected = null, tool = 'select', connectFrom = null;
let drag = null, spaceHeld = false, filter = 'all', search = '', editing = null, editingEdge = null, draftColor = 'butter';
let imagePoint = null, toastTimer, saveTimer, revision = 0, savedRevision = 0, savePromise = null, db = null, storageBlocked = false;
let history = new History(40);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function icon(name) {
  const svg = document.createElementNS(NS, 'svg'), use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#i-${name}`); svg.append(use); svg.setAttribute('aria-hidden', 'true'); return svg;
}
function svgEl(tag, attrs) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4200); }
function status(text, state = '') { $('#save-status').textContent = text; $('#save-dot').className = `status-dot ${state}`; }
function currentItem() { return !selected ? null : (selected.type === 'edge' ? board.edges : selected.type === 'group' ? board.groups : board.nodes).find(n => n.id === selected.id); }
function localPoint(event) { const r = viewport.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
function worldPoint(event) { return screenToWorld(localPoint(event), view); }
function centerPoint() { return screenToWorld({ x: viewport.clientWidth / 2 - 145, y: viewport.clientHeight / 2 - 110 }, view); }
function ensureCapacity() { if (board.nodes.length + board.groups.length >= LIMITS.maxItems) { toast('这张画布已达到 1000 项。请先导出备份，再创建新画布。'); return false; } return true; }

async function openStorage() {
  db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('thought-canvas', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('boards');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('本地数据库被其他窗口占用'));
  });
  db.onversionchange = () => { db.close(); storageBlocked = true; status('数据库已更新，请刷新页面', 'error'); };
  return new Promise((resolve, reject) => {
    const request = db.transaction('boards', 'readonly').objectStore('boards').get('current');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function writeStorage(snapshot) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('boards', 'readwrite');
    tx.objectStore('boards').put(snapshot, 'current');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('保存被中断'));
  });
}
function scheduleSave() {
  board.view = { ...view, width: viewport.clientWidth, height: viewport.clientHeight }; board.updatedAt = new Date().toISOString(); revision++;
  status(storageBlocked ? '保存不可用，请导出备份' : '正在保存…', storageBlocked ? 'error' : 'pending');
  clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 300);
}
async function flushSave() {
  clearTimeout(saveTimer);
  if (savePromise) return savePromise;
  if (storageBlocked || !db) return;
  savePromise = (async () => {
    try {
      while (savedRevision < revision) {
        const target = revision;
        await writeStorage(clone(board));
        savedRevision = target;
      }
      status('所有改动已保存在此浏览器');
    } catch (error) {
      status('保存失败，请导出备份', 'error'); toast('本地保存失败，可能是浏览器空间不足。请立即导出备份。');
      console.error('本地保存失败', error);
    } finally { savePromise = null; }
  })();
  return savePromise;
}
function mutate(fn) { history.push(board); fn(); render(); scheduleSave(); }
function applyView(save = false) {
  world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.zoom})`;
  viewport.style.backgroundSize = `${22 * view.zoom}px ${22 * view.zoom}px`;
  viewport.style.backgroundPosition = `${view.x}px ${view.y}px`;
  $('#zoom-value').textContent = `${Math.round(view.zoom * 100)}%`;
  if (save) scheduleSave();
}
function fitAll(save = true) {
  const bounds = boundsOf([...board.nodes, ...board.groups]);
  if (!bounds) { view = { x: 70, y: 130, zoom: 1 }; applyView(save); return; }
  const top = 120, bottom = 120, side = viewport.clientWidth < 700 ? 28 : 40;
  const availableH = Math.max(120, viewport.clientHeight - top - bottom);
  const zoom = clamp(Math.min((viewport.clientWidth - side * 2) / bounds.w, availableH / bounds.h, 1.05), LIMITS.minZoom, LIMITS.maxZoom);
  view = { x: (viewport.clientWidth - bounds.w * zoom) / 2 - bounds.x * zoom, y: top + (availableH - bounds.h * zoom) / 2 - bounds.y * zoom, zoom };
  applyView(save);
}
function focusItem(item, type = 'node') {
  setSelection({ id: item.id, type });
  const zoom = clamp(Math.min(view.zoom, (viewport.clientWidth - 70) / item.w, (viewport.clientHeight - 290) / item.h), .25, 1.25);
  view = { x: viewport.clientWidth / 2 - (item.x + item.w / 2) * zoom, y: viewport.clientHeight / 2 - (item.y + item.h / 2) * zoom, zoom };
  applyView(true);
}
function zoomBy(multiplier) { view = zoomAt(view, { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }, view.zoom * multiplier); applyView(true); }

function paintCard(element, item, group = false) {
  const c = COLORS[item.color] || COLORS.butter;
  for (const [key, value] of Object.entries({ '--card-bg': c.bg, '--card-border': c.border, '--card-ink': c.ink, '--card-text': c.text, '--card-accent': c.accent, '--group-border': c.border, '--group-bg': `${c.bg}85`, '--group-ink': c.accent })) element.style.setProperty(key, value);
  element.style.left = `${item.x}px`; element.style.top = `${item.y}px`; element.style.width = `${item.w}px`; element.style.height = `${item.h}px`;
  element.dataset.id = item.id;
  element.classList.toggle('selected', selected?.id === item.id && selected?.type === (group ? 'group' : 'node'));
}
function renderNodes() {
  const fragment = document.createDocumentFragment();
  for (const n of board.nodes) {
    const card = el('article', `canvas-node ${n.kind}-node`);
    paintCard(card, n);
    card.tabIndex = 0; card.setAttribute('aria-label', `${n.kind === 'task' ? '待办' : n.kind === 'image' ? '图片' : '便签'}：${n.title}`);
    card.classList.toggle('connect-source', connectFrom === n.id);
    const top = el('div', 'node-top'), type = el('span', 'node-type');
    type.append(icon(n.kind === 'task' ? 'task' : n.kind === 'image' ? 'image' : 'note'), el('span', '', n.kind === 'task' ? '让想法发生' : n.kind === 'image' ? '灵感切片' : '一页思绪'));
    const more = el('button', 'node-more'); more.append(icon('more')); more.dataset.action = 'edit'; more.title = '编辑卡片'; more.setAttribute('aria-label', `编辑 ${n.title}`); top.append(type, more);
    const content = el('div', 'node-content'), title = el('h2', 'node-title', n.title);
    if (n.kind === 'image') {
      const img = el('img'); img.src = n.src; img.alt = n.title; img.draggable = false; img.addEventListener('error', () => { img.alt = '图片未能加载，请重新导入'; }); content.append(img, title);
    } else {
      content.append(title);
      if (n.body) content.append(el('p', 'node-body', n.body));
      if (n.kind === 'task') {
        const list = el('div', 'task-list');
        for (const item of n.items) {
          const row = el('label', `task-row${item.done ? ' checked' : ''}`), check = el('input');
          check.type = 'checkbox'; check.checked = item.done; check.dataset.taskId = item.id;
          check.setAttribute('aria-label', item.text); row.append(check, el('span', '', item.text)); list.append(row);
        }
        content.append(list);
        if (n.due) {
          const today = new Date(); const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
          content.append(el('div', `task-due${n.due < localDate && n.items.some(t => !t.done) ? ' overdue' : ''}`, `截止于 ${n.due.replaceAll('-', '.')}`));
        }
      }
    }
    card.append(top, content);
    if (n.kind === 'task') {
      const footer = el('div', 'node-footer'), progress = el('div', 'task-progress'), fill = el('span');
      const done = n.items.filter(t => t.done).length;
      fill.style.width = `${n.items.length ? done / n.items.length * 100 : 0}%`; progress.append(fill); footer.append(progress, el('span', '', `${done} / ${n.items.length} 已完成`)); card.append(footer);
    }
    const resize = el('span', 'resize-handle'); resize.dataset.resize = 'true'; resize.title = '拖动调整尺寸'; card.append(resize); fragment.append(card);
  }
  $('#node-layer').replaceChildren(fragment); applySearch();
}
function renderGroups() {
  const fragment = document.createDocumentFragment();
  for (const n of board.groups) {
    const group = el('section', 'canvas-group'); paintCard(group, n, true);
    const title = el('div', 'group-title'); title.append(icon('group'), el('span', '', n.title));
    title.tabIndex = 0; title.setAttribute('aria-label', `分组：${n.title}，拖动可移动整个分组`);
    const edit = el('button'); edit.append(icon('more')); edit.dataset.action = 'edit'; edit.setAttribute('aria-label', `编辑分组 ${n.title}`); title.append(edit);
    const resize = el('span', 'resize-handle'); resize.dataset.resize = 'true'; group.append(title, resize); fragment.append(group);
  }
  $('#group-layer').replaceChildren(fragment);
}
function renderEdges() {
  const fragment = document.createDocumentFragment(), nodes = new Map(board.nodes.map(n => [n.id, n]));
  for (const e of board.edges) {
    const a = nodes.get(e.from), b = nodes.get(e.to); if (!a || !b) continue;
    const geometry = edgeGeometry(a, b), g = svgEl('g', { class: `edge-group${selected?.type === 'edge' && selected.id === e.id ? ' selected' : ''}`, 'data-id': e.id });
    const path = svgEl('path', { class: 'edge-line', d: geometry.d }); if (e.arrow) path.setAttribute('marker-end', 'url(#arrowhead)');
    const hit = svgEl('path', { class: 'edge-hit', d: geometry.d });
    g.append(path, hit);
    if (e.label) { const text = svgEl('text', { class: 'edge-label', x: geometry.label.x, y: geometry.label.y, 'text-anchor': 'middle' }); text.textContent = e.label; g.append(text); }
    fragment.append(g);
  }
  $('#edges').replaceChildren(fragment);
}
function renderOutline() {
  const list = $('#outline-list'), fragment = document.createDocumentFragment();
  const all = filter === 'tasks' ? board.nodes.filter(n => n.kind === 'task') : [...board.groups, ...board.nodes];
  const matches = all.filter(matchesSearch);
  for (const n of matches) {
    const button = el('button', `outline-item${selected?.id === n.id ? ' selected' : ''}${n.kind === 'task' && n.items.length && n.items.every(t => t.done) ? ' done' : ''}`);
    if (n.kind === 'note') { const dot = el('i', 'outline-dot'); dot.style.background = COLORS[n.color].swatch; button.append(dot); }
    else button.append(icon(n.kind === 'group' ? 'group' : n.kind === 'task' ? 'task' : 'image'));
    button.append(el('span', '', n.title)); button.title = n.title; button.addEventListener('click', () => { focusItem(n, n.kind === 'group' ? 'group' : 'node'); if (innerWidth < 700) setSidebarCollapsed(true); }); fragment.append(button);
  }
  if (!matches.length) fragment.append(el('p', 'outline-empty', search ? '没有找到这个想法。' : filter === 'tasks' ? '还没有待办。按 T，在画布上放下一件想做的事。' : '还没有内容，放下第一个想法吧。'));
  list.replaceChildren(fragment);
  $('#node-count').textContent = board.nodes.length;
  $('#task-count').textContent = board.nodes.filter(n => n.kind === 'task').reduce((sum, n) => sum + n.items.filter(t => !t.done).length, 0);
}
function matchesSearch(n) { return !search || `${n.title} ${n.body || ''} ${(n.items || []).map(t => t.text).join(' ')}`.toLowerCase().includes(search); }
function applySearch() {
  for (const card of $$('.canvas-node')) {
    const node = board.nodes.find(n => n.id === card.dataset.id);
    card.classList.toggle('search-dim', !!search && !matchesSearch(node)); card.classList.toggle('search-match', !!search && matchesSearch(node));
  }
}
function renderSelection() {
  const item = currentItem(); $('#selection-bar').hidden = !item;
  if (item) $('#selection-name').textContent = selected.type === 'edge' ? item.label || '关系连线' : item.title;
  $('#duplicate-selected').hidden = selected?.type === 'edge';
  for (const card of $$('.canvas-node,.canvas-group,.edge-group')) {
    const type = card.classList.contains('edge-group') ? 'edge' : card.classList.contains('canvas-group') ? 'group' : 'node';
    card.classList.toggle('selected', selected?.id === card.dataset.id && selected?.type === type);
  }
}
function setSelection(selection) { selected = selection; renderSelection(); renderOutline(); }
function render() {
  $('#board-title').value = board.title; $('#breadcrumb-title').textContent = board.title; document.title = `${board.title} · 思想画布`;
  renderGroups(); renderNodes(); renderEdges(); renderOutline(); renderSelection();
  $('#empty-state').hidden = board.nodes.length + board.groups.length > 0;
  $('#canvas-stats').textContent = `${board.nodes.length} 个想法  /  ${board.edges.length} 条连接`;
  $('#undo-btn').disabled = !history.past.length; $('#redo-btn').disabled = !history.future.length;
}
function setTool(next) {
  tool = next; connectFrom = null;
  $$('.tool[data-tool]').forEach(button => { button.classList.toggle('active', button.dataset.tool === tool); button.setAttribute('aria-pressed', String(button.dataset.tool === tool)); });
  viewport.className = `viewport tool-${tool}`;
  $$('.connect-source').forEach(n => n.classList.remove('connect-source'));
  const hints = { note: '在想放的位置点一下，留下一页思绪', task: '在想放的位置点一下，放下一件待办', group: '点击放下一个分组区域，拖动右下角调整大小', connect: '依次点击两张卡片，连接它们的关系', hand: '按住并拖动，探索你的画布' };
  $('#mode-hint').hidden = !hints[tool]; $('#mode-hint').textContent = hints[tool] || '';
}
function connectNode(id) {
  if (!connectFrom) { connectFrom = id; $$('.canvas-node').find(n => n.dataset.id === id)?.classList.add('connect-source'); $('#mode-hint').textContent = '再点击另一张卡片，建立连接'; return; }
  if (connectFrom === id) { toast('选另一张卡片，就能建立连接'); return; }
  if (board.edges.some(e => e.from === connectFrom && e.to === id)) { toast('这两张卡片已有同方向的连接'); setTool('select'); return; }
  if (board.edges.length >= LIMITS.maxEdges) { toast('连线数量已达到上限'); return; }
  const edge = { id: uid(), from: connectFrom, to: id, label: '', arrow: true };
  mutate(() => board.edges.push(edge)); setTool('select'); setSelection({ type: 'edge', id: edge.id }); openEdgeEditor(edge);
}

function addAt(kind, point) {
  if (!ensureCapacity()) return;
  const item = makeNode(kind, point); setTool('select'); openEditor(item, true);
}
function renderColorOptions() {
  $('#color-options').replaceChildren(...Object.entries(COLORS).map(([name, color]) => {
    const button = el('button', `color-option${draftColor === name ? ' active' : ''}`); button.type = 'button'; button.style.setProperty('--swatch', color.swatch); button.title = color.name; button.setAttribute('aria-label', color.name); button.setAttribute('aria-pressed', String(draftColor === name)); button.addEventListener('click', () => { draftColor = name; renderColorOptions(); }); return button;
  }));
}
function addTaskEditorRow(item = { id: uid(), text: '', done: false }) {
  if ($('#edit-task-list').children.length >= 200) return toast('每张待办卡片最多 200 项');
  const row = el('div', 'edit-task-row'); row.dataset.id = item.id;
  const check = el('input'); check.type = 'checkbox'; check.checked = item.done; check.setAttribute('aria-label', '已完成');
  const input = el('input', 'text-field'); input.type = 'text'; input.value = item.text; input.placeholder = '一件具体的小事'; input.maxLength = 1000; input.setAttribute('aria-label', '待办内容');
  const remove = el('button', 'small-icon danger'); remove.type = 'button'; remove.append(icon('close')); remove.setAttribute('aria-label', '移除这一项'); remove.addEventListener('click', () => row.remove());
  row.append(check, input, remove); $('#edit-task-list').append(row); return input;
}
function openEditor(item, isNew = false) {
  editing = { item: clone(item), isNew };
  const labels = { note: '便签', task: '待办', group: '分组', image: '图片' };
  $('#editor-heading').textContent = `${isNew ? '放下一个' : '编辑'}${labels[item.kind]}`;
  $('#editor-eyebrow').textContent = isNew ? '每个想法，都值得一个位置' : '让思绪，再清楚一点';
  $('#edit-title').value = isNew && item.kind !== 'image' ? '' : item.title;
  $('#edit-title').placeholder = item.title; $('#edit-body').value = item.body || '';
  $('#body-field').hidden = item.kind === 'group' || item.kind === 'image';
  $('#task-fields').hidden = item.kind !== 'task'; $('#image-editor-info').hidden = item.kind !== 'image';
  $('#edit-task-list').replaceChildren();
  if (item.kind === 'task') { item.items.forEach(addTaskEditorRow); $('#edit-due').value = item.due || ''; }
  draftColor = item.color; renderColorOptions(); $('#editor-dialog').showModal(); $('#edit-title').focus();
}
$('#editor-form').addEventListener('submit', event => {
  event.preventDefault(); if (!editing) return;
  const item = editing.item; item.title = $('#edit-title').value.trim() || item.title; item.body = $('#edit-body').value.trim(); item.color = draftColor;
  if (item.kind === 'task') {
    item.due = $('#edit-due').value;
    item.items = [...$('#edit-task-list').children].map(row => ({ id: row.dataset.id, text: row.querySelector('input[type=text]').value.trim(), done: row.querySelector('input[type=checkbox]').checked })).filter(t => t.text);
  }
  if (editing.isNew && !ensureCapacity()) return;
  mutate(() => {
    const collection = item.kind === 'group' ? board.groups : board.nodes;
    if (editing.isNew) collection.push(item); else { const index = collection.findIndex(n => n.id === item.id); if (index >= 0) collection[index] = item; }
    selected = { type: item.kind === 'group' ? 'group' : 'node', id: item.id };
  });
  $('#editor-dialog').close(); editing = null;
});
$('#add-task-item').addEventListener('click', () => addTaskEditorRow()?.focus());
function openEdgeEditor(edge) { editingEdge = edge.id; $('#edge-label').value = edge.label; $('#edge-arrow').checked = edge.arrow; $('#edge-dialog').showModal(); $('#edge-label').focus(); }
$('#edge-form').addEventListener('submit', event => {
  event.preventDefault(); const edge = board.edges.find(e => e.id === editingEdge); if (!edge) return;
  mutate(() => { edge.label = $('#edge-label').value.trim(); edge.arrow = $('#edge-arrow').checked; }); $('#edge-dialog').close(); editingEdge = null;
});
function editSelected() { const item = currentItem(); if (!item) return; if (selected.type === 'edge') openEdgeEditor(item); else openEditor(item); }
function deleteSelected() {
  if (!currentItem()) return;
  const selection = { ...selected };
  mutate(() => {
    if (selection.type === 'node') { board.nodes = board.nodes.filter(n => n.id !== selection.id); board.edges = board.edges.filter(e => e.from !== selection.id && e.to !== selection.id); }
    else if (selection.type === 'group') board.groups = board.groups.filter(n => n.id !== selection.id);
    else board.edges = board.edges.filter(e => e.id !== selection.id);
    selected = null;
  });
  toast(selection.type === 'group' ? '已移除分组框，里面的内容仍在原处。可按 Ctrl / ⌘ Z 撤销' : '已删除，可按 Ctrl / ⌘ Z 撤销');
}
function duplicateSelected() {
  const item = currentItem(); if (!item || selected.type === 'edge' || !ensureCapacity()) return;
  const copy = clone(item); copy.id = uid(); copy.x += 35; copy.y += 35; copy.title += ' · 副本';
  if (copy.items) copy.items.forEach(t => { t.id = uid(); });
  mutate(() => { (selected.type === 'group' ? board.groups : board.nodes).push(copy); selected = { type: selected.type, id: copy.id }; });
}
function undo() { const previous = history.undo(board); if (!previous) return; board = previous; selected = null; connectFrom = null; render(); scheduleSave(); }
function redo() { const next = history.redo(board); if (!next) return; board = next; selected = null; connectFrom = null; render(); scheduleSave(); }

viewport.addEventListener('pointerdown', event => {
  if (event.button !== 0 && event.button !== 1) return;
  if (event.target.closest('button,input,label')) return;
  const card = event.target.closest('.canvas-node'), group = event.target.closest('.canvas-group'), edge = event.target.closest('.edge-group');
  const pan = event.button === 1 || spaceHeld || tool === 'hand';
  if (pan) { startPan(event); return; }
  if (card && tool === 'connect') { connectNode(card.dataset.id); event.preventDefault(); return; }
  if (!card && !edge && !event.target.closest('.group-title') && ['note', 'task', 'group'].includes(tool)) { addAt(tool, worldPoint(event)); return; }
  if (edge) { setSelection({ type: 'edge', id: edge.dataset.id }); return; }
  const groupHandle = group && (event.target.closest('.group-title') || event.target.dataset.resize);
  if (card || groupHandle) {
    const type = card ? 'node' : 'group', element = card || group;
    const item = (card ? board.nodes : board.groups).find(n => n.id === element.dataset.id); if (!item) return;
    setSelection({ type, id: item.id });
    const resize = !!event.target.dataset.resize;
    const members = !resize && type === 'group' ? containedNodes(item, board.nodes) : [];
    drag = { type: resize ? 'resize' : 'move', pointer: event.pointerId, start: localPoint(event), item, element, initial: { x: item.x, y: item.y, w: item.w, h: item.h }, members: members.map(n => ({ item: n, x: n.x, y: n.y })), moved: false };
    event.preventDefault();
  } else { setSelection(null); startPan(event); }
});
function startPan(event) {
  drag = { type: 'pan', pointer: event.pointerId, start: localPoint(event), initial: { x: view.x, y: view.y }, moved: false };
  viewport.setPointerCapture(event.pointerId); viewport.classList.add('is-panning'); event.preventDefault();
}
viewport.addEventListener('pointermove', event => {
  if (!drag || drag.pointer !== event.pointerId) return;
  const point = localPoint(event), dx = point.x - drag.start.x, dy = point.y - drag.start.y;
  if (!drag.moved && Math.hypot(dx, dy) < 3) return;
  if (!drag.moved && drag.type !== 'pan') { history.push(board); viewport.setPointerCapture(event.pointerId); }
  drag.moved = true;
  if (drag.type === 'pan') { view.x = drag.initial.x + dx; view.y = drag.initial.y + dy; applyView(); return; }
  const { item, initial } = drag;
  if (drag.type === 'resize') {
    item.w = Math.round(clamp(initial.w + dx / view.zoom, item.kind === 'group' ? 280 : 200, 5000));
    item.h = Math.round(clamp(initial.h + dy / view.zoom, item.kind === 'group' ? 180 : 130, 5000));
  } else {
    item.x = Math.round(clamp(initial.x + dx / view.zoom, -1e7, 1e7)); item.y = Math.round(clamp(initial.y + dy / view.zoom, -1e7, 1e7));
    for (const member of drag.members) {
      member.item.x = member.x + item.x - initial.x; member.item.y = member.y + item.y - initial.y;
      const element = $$('.canvas-node').find(n => n.dataset.id === member.item.id); if (element) paintCard(element, member.item);
    }
  }
  paintCard(drag.element, item, item.kind === 'group'); renderEdges();
});
function finishDrag(event) {
  if (!drag || event && event.pointerId !== drag.pointer) return;
  const previous = drag; drag = null;
  if (viewport.hasPointerCapture(previous.pointer)) viewport.releasePointerCapture(previous.pointer);
  viewport.classList.remove('is-panning');
  if (previous.moved) { $('#undo-btn').disabled = !history.past.length; $('#redo-btn').disabled = !history.future.length; scheduleSave(); }
}
viewport.addEventListener('pointerup', finishDrag); viewport.addEventListener('pointercancel', finishDrag); viewport.addEventListener('lostpointercapture', finishDrag);
viewport.addEventListener('dblclick', event => {
  if (event.target.closest('button,input,label')) return;
  const card = event.target.closest('.canvas-node'), group = event.target.closest('.group-title'), edge = event.target.closest('.edge-group');
  if (card) openEditor(board.nodes.find(n => n.id === card.dataset.id));
  else if (group) openEditor(board.groups.find(n => n.id === group.closest('.canvas-group').dataset.id));
  else if (edge) openEdgeEditor(board.edges.find(e => e.id === edge.dataset.id));
  else if (tool === 'select') addAt('note', worldPoint(event));
});
viewport.addEventListener('click', event => {
  const edit = event.target.closest('[data-action=edit]'); if (!edit) return;
  const container = edit.closest('.canvas-node,.canvas-group'), group = container.classList.contains('canvas-group');
  const item = (group ? board.groups : board.nodes).find(n => n.id === container.dataset.id);
  if (tool === 'connect' && !group) { connectNode(item.id); return; }
  setSelection({ type: group ? 'group' : 'node', id: item.id }); openEditor(item);
});
viewport.addEventListener('change', event => {
  const input = event.target.closest('input[data-task-id]'); if (!input) return;
  const node = board.nodes.find(n => n.id === input.closest('.canvas-node').dataset.id), item = node?.items.find(t => t.id === input.dataset.taskId);
  if (item) mutate(() => { item.done = input.checked; });
});
viewport.addEventListener('wheel', event => {
  if (event.target.closest('.node-content')) {
    const content = event.target.closest('.node-content');
    if (!event.ctrlKey && content.scrollHeight > content.clientHeight + 1) return;
  }
  event.preventDefault(); if (drag) return;
  if (event.shiftKey && !event.ctrlKey) { view.x -= event.deltaY; view.y -= event.deltaX; }
  else { const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY; view = zoomAt(view, localPoint(event), view.zoom * Math.exp(-clamp(delta, -150, 150) * .0018)); }
  applyView(true);
}, { passive: false });

async function readImage(file) {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('请使用 PNG、JPG、WebP 或 GIF 图片');
  if (file.size > 25 * 1024 * 1024) throw new Error('单张图片请控制在 25 MB 以内');
  const src = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('无法读取图片')); reader.readAsDataURL(file); });
  const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('图片损坏或格式不支持')); img.src = src; });
  const max = 1800, scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  // Persist one compact, non-executable image format. GIFs use their first frame.
  return { src: canvas.toDataURL('image/webp', .88), ratio: canvas.height / canvas.width };
}
async function addImages(files, point) {
  const images = [...files].filter(f => f.type.startsWith('image/'));
  if (!images.length) return toast('请拖入或选择图片文件');
  if (images.length > 12) return toast('一次最多导入 12 张图片');
  toast('正在把图片放到画布上…'); const items = [];
  for (const file of images) {
    if (board.nodes.length + board.groups.length + items.length >= LIMITS.maxItems) { toast('内容数量已达到上限'); break; }
    try {
      const data = await readImage(file), node = makeNode('image', { x: point.x + items.length * 35, y: point.y + items.length * 35 });
      node.title = file.name.replace(/\.[^.]+$/, '').slice(0, 160) || '一张灵感图片'; node.src = data.src; node.w = 320; node.h = clamp(Math.round(296 * data.ratio + 82), 190, 500); items.push(node);
    } catch (error) { toast(error.message); }
  }
  if (items.length) { mutate(() => { board.nodes.push(...items); selected = { type: 'node', id: items.at(-1).id }; }); setTool('select'); toast(`已放入 ${items.length} 张图片`); }
}
$('#image-input').addEventListener('change', async event => { const files = [...event.target.files]; event.target.value = ''; await addImages(files, imagePoint || centerPoint()); imagePoint = null; });
viewport.addEventListener('dragover', event => { if ([...event.dataTransfer.types].includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; viewport.classList.add('drag-over'); } });
viewport.addEventListener('dragleave', event => { if (!viewport.contains(event.relatedTarget)) viewport.classList.remove('drag-over'); });
viewport.addEventListener('drop', event => { event.preventDefault(); viewport.classList.remove('drag-over'); addImages(event.dataTransfer.files, worldPoint(event)); });
document.addEventListener('paste', event => { if (isEditingText() || document.querySelector('dialog[open]')) return; const files = [...(event.clipboardData?.files || [])]; if (files.some(f => f.type.startsWith('image/'))) { event.preventDefault(); addImages(files, centerPoint()); } });

async function confirmAction(title, message, label = '确认') {
  const dialog = $('#confirm-dialog'); $('#confirm-title').textContent = title; $('#confirm-message').textContent = message; $('#confirm-accept').textContent = label;
  dialog.returnValue = ''; dialog.showModal(); return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
}
function exportBoard() {
  const blob = new Blob([JSON.stringify({ ...board, view: { ...view, width: viewport.clientWidth, height: viewport.clientHeight } }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = el('a'); a.href = url;
  const date = new Date(); const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  a.download = `${board.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') || '思想画布'}-${stamp}.json`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); toast('画布备份已导出，图片也包含在备份中');
}
$('#import-input').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try {
    if (file.size > 60 * 1024 * 1024) throw new Error('备份文件不能超过 60 MB');
    const imported = validateBoard(JSON.parse(await file.text()));
    if (!await confirmAction('导入这张画布？', `「${imported.title}」包含 ${imported.nodes.length} 个想法和 ${imported.edges.length} 条连接。导入会替换当前画布，可通过撤销恢复。建议先导出当前画布备份。`, '导入画布')) return;
    history.push(board); board = imported; selected = null; search = ''; $('#search-input').value = ''; setTool('select'); render(); fitAll(false); scheduleSave(); toast('画布已导入');
  } catch (error) { toast(error instanceof SyntaxError ? '文件无法解析，请选择从思想画布导出的 JSON 文件' : error.message); }
});
$('#new-btn').addEventListener('click', async () => {
  closeMenu(); if (!await confirmAction('给新的想法腾个地方', '这会清空当前画布。建议先导出备份；清空后也可以通过撤销恢复。', '开始新画布')) return;
  history.push(board); board = createBoard(true); board.title = '一张新的思想画布'; selected = null; search = ''; $('#search-input').value = ''; setTool('select'); render(); fitAll(false); scheduleSave();
});

$$('[data-tool]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.tool === 'image') { imagePoint = centerPoint(); $('#image-input').click(); return; }
  setTool(button.dataset.tool); viewport.focus({ preventScroll: true });
}));
$('#edit-selected').addEventListener('click', editSelected); $('#delete-selected').addEventListener('click', deleteSelected); $('#duplicate-selected').addEventListener('click', duplicateSelected);
$('#undo-btn').addEventListener('click', undo); $('#redo-btn').addEventListener('click', redo);
$('#zoom-in').addEventListener('click', () => zoomBy(1.2)); $('#zoom-out').addEventListener('click', () => zoomBy(1 / 1.2)); $('#fit-btn').addEventListener('click', () => fitAll());
$('#zoom-value').addEventListener('click', () => { view = zoomAt(view, { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }, 1); applyView(true); });
$('#export-btn').addEventListener('click', exportBoard); $('#import-btn').addEventListener('click', () => { closeMenu(); $('#import-input').click(); });
$('#empty-add').addEventListener('click', () => addAt('note', centerPoint())); $('#sidebar-add').addEventListener('click', () => addAt('note', centerPoint()));
$('#board-title').addEventListener('change', event => { const title = event.target.value.trim() || '未命名画布'; if (title !== board.title) mutate(() => { board.title = title; }); else event.target.value = title; });
$('#board-title').addEventListener('keydown', event => { if (event.key === 'Enter') event.target.blur(); });
$('#search-input').addEventListener('input', event => { search = event.target.value.trim().toLowerCase(); renderOutline(); applySearch(); });
function setFilter(next) { filter = next; $('#overview-btn').classList.toggle('active', next === 'all'); $('#tasks-btn').classList.toggle('active', next === 'tasks'); $('#outline-title').textContent = next === 'tasks' ? '我的待办卡片' : '画布中的内容'; renderOutline(); }
$('#overview-btn').addEventListener('click', () => { setFilter('all'); fitAll(); }); $('#tasks-btn').addEventListener('click', () => setFilter('tasks'));
function setSidebarCollapsed(collapsed) {
  $('#sidebar').classList.toggle('collapsed', collapsed); $('#sidebar').inert = collapsed;
  $('#toggle-sidebar').setAttribute('aria-expanded', String(!collapsed));
}
$('#toggle-sidebar').addEventListener('click', () => setSidebarCollapsed(!$('#sidebar').classList.contains('collapsed')));
$('#close-sidebar').addEventListener('click', () => setSidebarCollapsed(true));
function closeMenu() { $('#more-menu').hidden = true; $('#more-btn').setAttribute('aria-expanded', 'false'); }
$('#more-btn').addEventListener('click', () => { const hidden = !$('#more-menu').hidden; $('#more-menu').hidden = hidden; $('#more-btn').setAttribute('aria-expanded', String(!hidden)); });
document.addEventListener('click', event => { if (!event.target.closest('#more-btn,#more-menu')) closeMenu(); });
function showHelp() { closeMenu(); $('#help-dialog').showModal(); }
$('#help-btn').addEventListener('click', showHelp); $('#help-menu-btn').addEventListener('click', showHelp);
$$('[data-close]').forEach(button => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));
function isEditingText() { return document.activeElement?.matches('input,textarea,[contenteditable=true]'); }
document.addEventListener('keydown', event => {
  if (event.isComposing || isEditingText() || document.querySelector('dialog[open]')) return;
  const command = event.ctrlKey || event.metaKey;
  if (command && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
  if (command && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
  if (command && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected(); return; }
  if (event.code === 'Space') { event.preventDefault(); spaceHeld = true; viewport.classList.add('tool-hand'); return; }
  if (command || event.altKey) return;
  if (event.key === 'Escape') { setTool('select'); setSelection(null); closeMenu(); if (innerWidth < 700) setSidebarCollapsed(true); }
  else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected(); }
  else if (event.key === 'Enter' && selected) { event.preventDefault(); editSelected(); }
  else if (event.key === '1') fitAll();
  else if (event.key === '+' || event.key === '=') zoomBy(1.2);
  else if (event.key === '-') zoomBy(1 / 1.2);
  else {
    const tools = { v: 'select', h: 'hand', n: 'note', t: 'task', g: 'group', l: 'connect' };
    if (tools[event.key.toLowerCase()]) setTool(tools[event.key.toLowerCase()]);
    else if (event.key.toLowerCase() === 'i') { imagePoint = centerPoint(); $('#image-input').click(); }
  }
});
document.addEventListener('keyup', event => { if (event.code === 'Space') { spaceHeld = false; if (tool !== 'hand') viewport.classList.remove('tool-hand'); } });
window.addEventListener('blur', () => { spaceHeld = false; if (tool !== 'hand') viewport.classList.remove('tool-hand'); finishDrag(); });
window.addEventListener('beforeunload', event => { if (revision > savedRevision) { flushSave(); event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });

async function init() {
  setSidebarCollapsed(innerWidth < 700);
  try {
    const stored = await openStorage(); if (stored) board = validateBoard(stored);
    status('所有改动已保存在此浏览器');
  } catch (error) { storageBlocked = true; status('本地读取失败，请导出备份', 'error'); toast('无法读取本地存储。当前可以使用画布，请通过导出保存内容。'); console.error('本地存储不可用', error); }
  render();
  if (board.view && board.view.width === viewport.clientWidth && board.view.height === viewport.clientHeight) { view = { x: board.view.x, y: board.view.y, zoom: board.view.zoom }; applyView(); }
  else if (viewport.clientWidth < 700 && board.nodes.length) {
    const first = board.nodes[0]; view = { x: viewport.clientWidth / 2 - (first.x + first.w / 2) * .9, y: 155 - first.y * .9, zoom: .9 }; applyView();
  } else fitAll(false);
  let oldSize = { w: viewport.clientWidth, h: viewport.clientHeight };
  new ResizeObserver(() => {
    const w = viewport.clientWidth, h = viewport.clientHeight;
    if (w === oldSize.w && h === oldSize.h) return;
    view.x += (w - oldSize.w) / 2; view.y += (h - oldSize.h) / 2;
    oldSize = { w, h }; applyView(true);
  }).observe(viewport);
  if (!storageBlocked) scheduleSave();
}
await init();
