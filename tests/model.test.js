import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, validateBoard, History, containedNodes, createGroupCopy, LIMITS, zoomAt, screenToWorld, edgeGeometry } from '../model.js';

test('seed and empty boards survive a JSON export / import round trip', () => {
  for (const empty of [true, false]) {
    const board = createBoard(empty), restored = validateBoard(JSON.parse(JSON.stringify(board)));
    assert.equal(restored.nodes.length, board.nodes.length);
    assert.deepEqual(restored.edges, board.edges);
    assert.equal(restored.title, board.title);
    assert.deepEqual(restored.groups, board.groups);
  }
});
test('zoom keeps the world coordinate under the cursor stationary and clamps scale', () => {
  const view = { x: -240, y: 180, zoom: .8 }, cursor = { x: 420, y: 230 };
  const point = screenToWorld(cursor, view), zoomed = zoomAt(view, cursor, 1.9);
  assert.deepEqual(screenToWorld(cursor, zoomed), point);
  assert.equal(zoomAt(view, cursor, 900).zoom, 2.5);
  assert.equal(zoomAt(view, cursor, .001).zoom, .15);
});
test('group movement includes only cards entirely inside the group', () => {
  const group = { x: 100, y: 100, w: 400, h: 400 };
  const inside = { id: 'a', x: 100, y: 100, w: 200, h: 130 }, crossing = { id: 'b', x: 450, y: 150, w: 200, h: 130 };
  assert.deepEqual(containedNodes(group, [inside, crossing]), [inside]);
});
test('copying a group preserves contents and remaps only its internal edges', () => {
  const board = createBoard(), original = structuredClone(board), source = board.groups[0];
  board.edges.push({ id: 'external', from: 'seed-task', to: 'seed-image', label: '外部关系', arrow: true });
  const before = structuredClone(board), copy = createGroupCopy(board, source.id);
  assert.equal(copy.nodes.length, 3);
  assert.equal(copy.edges.length, 2);
  assert.notEqual(copy.group.id, source.id);
  assert.ok(copy.group.x > Math.max(...[...board.nodes, ...board.groups].map(n => n.x + n.w)));
  for (let i = 0; i < copy.nodes.length; i++) {
    const n = copy.nodes[i], src = board.nodes[i];
    assert.notEqual(n.id, src.id);
    assert.equal(n.x - copy.group.x, src.x - source.x);
    assert.equal(n.y - copy.group.y, src.y - source.y);
    assert.equal(n.title, src.title);
    assert.equal(n.body, src.body);
  }
  const copyIds = new Set(copy.nodes.map(n => n.id));
  for (const edge of copy.edges) {
    assert.ok(copyIds.has(edge.from) && copyIds.has(edge.to));
    assert.ok(!board.edges.some(e => e.id === edge.id));
  }
  assert.deepEqual(copy.edges.map(e => [e.label, e.arrow]), original.edges.slice(0, 2).map(e => [e.label, e.arrow]));
  const task = copy.nodes.find(n => n.kind === 'task'), sourceTask = board.nodes.find(n => n.kind === 'task');
  assert.deepEqual(task.items.map(t => [t.text, t.done]), sourceTask.items.map(t => [t.text, t.done]));
  task.items[0].done = false;
  assert.notEqual(task.items[0].id, sourceTask.items[0].id);
  assert.deepEqual(board, before);
});
test('group copies retain image data and support empty groups without external edges', () => {
  const board = createBoard(), copy = createGroupCopy(board, board.groups[1].id);
  assert.equal(copy.nodes.find(n => n.kind === 'image').src, board.nodes.find(n => n.kind === 'image').src);
  assert.equal(copy.edges.length, 1);
  const emptyBoard = createBoard(true);
  emptyBoard.groups.push({ ...board.groups[0], id: 'empty' });
  const empty = createGroupCopy(emptyBoard, 'empty');
  assert.deepEqual(empty.nodes, []);
  assert.deepEqual(empty.edges, []);
});
test('copying a group refuses item or edge overflow before changing the board', () => {
  const board = createBoard();
  while (board.nodes.length + board.groups.length < LIMITS.maxItems) board.nodes.push({ ...board.nodes[0], id: `extra-${board.nodes.length}`, x: -10000 });
  const before = structuredClone(board);
  assert.throws(() => createGroupCopy(board, board.groups[0].id), /1000/);
  assert.deepEqual(board, before);
  const edgeBoard = createBoard();
  edgeBoard.edges = Array.from({ length: LIMITS.maxEdges }, (_, i) => ({ ...edgeBoard.edges[0], id: `edge-${i}` }));
  assert.throws(() => createGroupCopy(edgeBoard, edgeBoard.groups[0].id), /3000/);
  assert.equal(edgeBoard.nodes.length, 5);
  assert.equal(edgeBoard.groups.length, 2);
});
test('undo / redo snapshots are independent and a new change clears redo', () => {
  const history = new History(2), board = createBoard(true);
  history.push(board); board.title = 'changed';
  const previous = history.undo(board); assert.notEqual(previous.title, board.title);
  const restored = history.redo(previous); assert.equal(restored.title, 'changed');
  history.push(restored); restored.title = 'third'; history.undo(restored);
  history.push(previous); assert.equal(history.redo(previous), null);
});
test('imports reject non-finite positions, duplicate IDs, external images and dangling edges', () => {
  const fresh = () => JSON.parse(JSON.stringify(createBoard()));
  let board = fresh(); board.nodes[0].x = NaN; assert.throws(() => validateBoard(board), /位置或尺寸/);
  board = fresh(); board.nodes[1].id = board.nodes[0].id; assert.throws(() => validateBoard(board), /ID/);
  board = fresh(); board.nodes.find(n => n.kind === 'image').src = 'https://example.com/tracking.png'; assert.throws(() => validateBoard(board), /图片/);
  board = fresh(); board.edges[0].to = 'missing'; assert.throws(() => validateBoard(board), /连线/);
});
test('imports normalize text and color without interpreting markup or prototype keys', () => {
  const board = createBoard(); board.nodes[0].color = '__proto__'; board.nodes[0].title = '<script>example</script>';
  const restored = validateBoard(board); assert.equal(restored.nodes[0].color, 'butter'); assert.equal(restored.nodes[0].title, '<script>example</script>');
});
test('edges have finite geometry for overlapping, vertical and horizontal cards', () => {
  const a = { x: 50, y: 50, w: 290, h: 230 };
  for (const b of [a, { ...a, x: 700 }, { ...a, y: -400 }]) {
    const geometry = edgeGeometry(a, b); assert.ok(!/NaN|Infinity/.test(geometry.d)); assert.ok(Number.isFinite(geometry.label.x));
  }
});
