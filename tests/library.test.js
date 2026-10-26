import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBoard, createLibrary, validateLibrary, boardEntry, prepareImport, libraryReminders, makeNode, MAX_BOARDS } from '../model.js';

test('single-board migration preserves the board, its spatial content and viewport', () => {
  const original = createBoard(); original.view = { x: -456, y: 128, zoom: .75, width: 1440, height: 900 };
  const library = createLibrary(original), restored = validateLibrary(JSON.parse(JSON.stringify(library)));
  assert.equal(restored.lastBoardId, original.id);
  assert.equal(restored.autoOpenLast, false);
  assert.deepEqual(restored.boards[0].board.view, original.view);
  assert.deepEqual(restored.boards[0].board.groups, original.groups);
  assert.deepEqual(restored.boards[0].board.edges, original.edges);
  assert.deepEqual(restored.boards[0].board.nodes.map(n => [n.id, n.x, n.y, n.title]), original.nodes.map(n => [n.id, n.x, n.y, n.title]));
});

test('importing a single board repeatedly creates distinct canvases without changing the source', () => {
  const board = createBoard(), before = JSON.stringify(board);
  const first = prepareImport(board, 1)[0], second = prepareImport(board, 2)[0];
  assert.notEqual(first.board.id, board.id); assert.notEqual(first.board.id, second.board.id);
  assert.deepEqual(first.board.edges, board.edges);
  first.board.nodes[0].title = 'different';
  assert.equal(JSON.stringify(board), before);
});

test('whole-library backups retain trash, settings, metadata, images and independent views', () => {
  const library = createLibrary(), second = createBoard(); second.view = { x: 123, y: 987, zoom: .3, width: 800, height: 600 };
  library.boards.push(boardEntry(second)); library.boards[1].trashedAt = '2026-10-26T00:00:00.000Z'; library.autoOpenLast = true;
  const restored = validateLibrary(JSON.parse(JSON.stringify(library)));
  assert.equal(restored.boards.length, 2); assert.equal(restored.autoOpenLast, true);
  for (const key of ['createdAt', 'openedAt', 'trashedAt']) assert.equal(restored.boards[1][key], library.boards[1][key]);
  assert.equal(restored.boards[1].board.nodes.find(n => n.kind === 'image').src, './assets/landscape.svg');
  assert.deepEqual(restored.boards[1].board.view, second.view);
  const imported = prepareImport(library);
  assert.equal(imported[1].trashedAt, library.boards[1].trashedAt);
  assert.notEqual(imported[0].board.id, library.boards[0].board.id);
});

test('cross-canvas reminders are scoped, sorted, exclude trash and completion, and allow repeated node IDs', () => {
  const a = createBoard(true), b = createBoard(true), c = createBoard(true);
  const timer = due => ({ ...makeNode('timer', { x: 1, y: 2 }), id: 'same-node', due });
  a.nodes.push(timer('2026-11-20T00:00:00.000Z')); b.nodes.push(timer('2026-11-01T00:00:00.000Z')); c.nodes.push(timer('2026-10-01T00:00:00.000Z'));
  const completed = timer('2026-10-02T00:00:00.000Z'); completed.id = 'done'; completed.completed = true; a.nodes.push(completed);
  const library = createLibrary(a); library.boards.push(boardEntry(b), { ...boardEntry(c), trashedAt: '2026-10-26T00:00:00.000Z' });
  const before = JSON.stringify(library), all = libraryReminders(library);
  assert.deepEqual(all.map(e => e.boardId), [b.id, a.id]);
  assert.deepEqual(libraryReminders(library, a.id).map(e => e.node), [a.nodes[0]]);
  assert.equal(JSON.stringify(library), before);
});

test('invalid or duplicate library entries fail atomically and counts include trash', () => {
  const library = createLibrary(); library.boards.push(structuredClone(library.boards[0]));
  assert.throws(() => validateLibrary(library), /ID/);
  assert.throws(() => prepareImport(createBoard(), MAX_BOARDS), /100/);
  assert.throws(() => validateLibrary({ ...createLibrary(), version: 99 }), /格式/);
  const corrupt = createLibrary(); corrupt.boards.push({ board: { version: 2, nodes: [] } });
  assert.throws(() => prepareImport(corrupt));
  const trashLast = createLibrary(); trashLast.boards[0].trashedAt = '2026-10-26T00:00:00.000Z';
  assert.equal(validateLibrary(trashLast).lastBoardId, null);
  const empty = { ...createLibrary(), boards: [], lastBoardId: null };
  assert.equal(validateLibrary(empty).boards.length, 0);
  assert.throws(() => prepareImport(empty), /没有画布/);
});

test('the distributed library example imports as three separate canvases', async () => {
  const raw = JSON.parse(await readFile(new URL('../画布库示例.json', import.meta.url), 'utf8'));
  const entries = prepareImport(raw);
  assert.deepEqual(entries.map(e => e.board.title), ['灵感角落', '学习计划', '工作空间']);
  assert.deepEqual(entries.map(e => e.board.nodes.length), [5, 3, 2]);
  assert.equal(new Set(entries.map(e => e.board.id)).size, 3);
});
