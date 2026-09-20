import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import express from 'express';
import { PointsStore, pointsDay, pointsMonth, validateMonth } from '../src/services/pointsStore';
import { pointsMiddleware, timedPoints, textPoints } from '../src/services/pointsBilling';

const member = { userId: 'feishu:ou_test', displayName: '测试成员', identitySource: 'feishu' };
const other = { userId: 'feishu:ou_other', displayName: '其他成员', identitySource: 'feishu' };
const guest = { userId: 'device:test', displayName: '本地游客', identitySource: 'device' };
function setup(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-points-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let date = new Date('2026-09-20T10:00:00Z');
  const file = path.join(dir, 'ledger.json');
  const store = new PointsStore(file, () => date);
  return { store, file, setDate: (value: string) => { date = new Date(value); }, clock: () => date };
}

test('default rules, exact month boundary and rounding match proposal', t => {
  const { store } = setup(t);
  assert.deepEqual(store.limits(), { memberMonthly: 200, companyMonthly: 6000, guestDaily: 20 });
  assert.equal(pointsDay(new Date('2026-09-30T16:00:00Z')), '2026-10-01');
  assert.equal(pointsMonth(new Date('2026-09-30T15:59:59Z')), '2026-09');
  assert.equal(timedPoints(30, 9) * 2, 10);
  assert.equal(timedPoints(180, 5), 15);
  assert.equal(textPoints('你'.repeat(250)), 3);
  assert.equal(textPoints('😀'.repeat(100)), 1);
  assert.throws(() => validateMonth('2026-13'));
});

test('reservation enforces concurrent personal limit; settlement is idempotent and partial credit is returned', t => {
  const { store } = setup(t);
  const id = store.reserve(member, 150, '配音', '150 分');
  assert.equal(store.balance(member).remaining, 50);
  assert.throws(() => store.reserve(member, 51, '音乐', ''), /积分不足/);
  store.finish(id, 100);
  store.finish(id, 100);
  const balance = store.balance(member);
  assert.equal(balance.used, 100); assert.equal(balance.frozen, 0); assert.equal(balance.remaining, 100);
  const entries = store.report('2026-09').entries;
  assert.equal(entries.filter(entry => entry.type === 'debit').length, 1);
  assert.equal(entries.find(entry => entry.type === 'release')?.points, 50);
});

test('company budget includes all members and pending jobs', t => {
  const { store } = setup(t);
  store.settings('2026-09', { memberMonthly: 200, companyMonthly: 20, guestDaily: 20 }, member, '预算测试', store.limits());
  const id = store.reserve(member, 15, '音乐', '');
  assert.throws(() => store.reserve(other, 6, '音效', ''), /积分不足/);
  store.finish(id, 0);
  assert.equal(store.reserve(other, 20, '配音', '').length, 36);
});

test('guest daily reset does not reset monthly consumption', t => {
  const { store, setDate } = setup(t);
  const id = store.reserve(guest, 20, '音乐', ''); store.finish(id, 20);
  assert.throws(() => store.reserve(guest, 1, '音效', ''), /积分不足/);
  setDate('2026-09-21T01:00:00Z');
  assert.equal(store.balance(guest).remaining, 20);
  assert.equal(store.balance(guest).used, 20);
});

test('month settings persist, future settings do not alter current limits, lower caps preserve prior debits', t => {
  const { store, file, clock, setDate } = setup(t);
  store.register(member);
  const id = store.reserve(member, 50, '音乐', ''); store.finish(id, 50);
  store.settings('2026-09', { ...store.limits(), memberMonthly: 40 }, member, '下调预算', store.limits());
  assert.equal(store.balance(member).remaining, 0); assert.equal(store.balance(member).used, 50);
  const expected = store.limits('2026-10');
  store.settings('2026-10', { ...expected, memberMonthly: 300 }, member, '下月预算', expected);
  assert.equal(store.balance(member).limit, 40);
  setDate('2026-10-01T01:00:00Z');
  const reloaded = new PointsStore(file, clock);
  assert.equal(reloaded.balance(member).limit, 300); assert.equal(reloaded.balance(member).used, 0);
  assert.equal(reloaded.balance(member, '2026-09').used, 50);
});

test('member override supports zero and reset; audit records actor and reason', t => {
  const { store } = setup(t);
  store.register(other);
  store.setMemberLimit('2026-09', other.userId, 0, member, '暂停该账户');
  assert.equal(store.balance(other).remaining, 0);
  assert.throws(() => store.reserve(other, 1, '音效', ''), /积分不足/);
  store.setMemberLimit('2026-09', other.userId, 500, member, '项目追加额度');
  assert.equal(store.balance(other).limit, 500);
  store.setMemberLimit('2026-09', other.userId, null, member, '恢复默认');
  assert.equal(store.balance(other).limit, 200);
  const audit = store.report('2026-09').entries;
  assert.equal(audit.length, 3); assert.equal(audit[0].operator, member.displayName);
  assert.match(audit[0].detail, /恢复默认/);
});

test('invalid values, stale policy edits and historical changes are rejected', t => {
  const { store } = setup(t);
  const expected = store.limits();
  for (const value of [-1, 1.5, '200', null, Infinity]) {
    assert.throws(() => store.settings('2026-09', { ...expected, memberMonthly: value as number }, member, '测试', expected));
  }
  assert.throws(() => store.settings('2026-08', expected, member, '历史', expected));
  assert.throws(() => store.settings('2026-09', expected, member, '', expected));
  store.settings('2026-09', { ...expected, companyMonthly: 2000 }, member, '修改预算', expected);
  assert.throws(() => store.settings('2026-09', expected, member, '并发修改', expected), /已被修改/);
});

test('restart releases unfinished reservations without altering settled history', t => {
  const { store, file, clock } = setup(t);
  const done = store.reserve(member, 10, '音乐', ''); store.finish(done, 10);
  store.reserve(member, 20, '音乐', '运行中');
  const reloaded = new PointsStore(file, clock);
  assert.equal(reloaded.balance(member).used, 10); assert.equal(reloaded.balance(member).frozen, 0);
  assert.match(reloaded.report('2026-09').entries[0].detail, /服务重启/);
});

test('cross-month job settles in its reserved period', t => {
  const { store, setDate } = setup(t);
  const id = store.reserve(member, 20, '音乐', '');
  setDate('2026-10-01T00:00:00Z'); store.finish(id, 20);
  assert.equal(store.balance(member).used, 0);
  assert.equal(store.balance(member, '2026-09').used, 20);
});

test('failed persistence never mutates balance or silently recreates a corrupt ledger', t => {
  const { store, file } = setup(t);
  store.register(member);
  fs.mkdirSync(file + '.tmp');
  assert.throws(() => store.reserve(member, 10, '音乐', ''));
  assert.equal(store.balance(member).frozen, 0);
  fs.writeFileSync(file, '{invalid');
  assert.throws(() => new PointsStore(file));
});

test('ledger is paginated and member filter does not reveal another member transactions', t => {
  const { store } = setup(t);
  for (let i = 0; i < 30; i++) { const id = store.reserve(member, 1, '音效', ''); store.finish(id, 1); }
  const id = store.reserve(other, 1, '音效', ''); store.finish(id, 1);
  const first = store.report('2026-09', member.userId, 1), second = store.report('2026-09', member.userId, 2);
  assert.equal(first.entries.length, 50); assert.equal(second.entries.length, 10);
  assert(first.entries.every(entry => entry.userId === member.userId));
});

test('HTTP success settles once, failure refunds, over-budget blocks before generation', async t => {
  const { store } = setup(t);
  const app = express(); let generated = 0;
  app.post('/success', pointsMiddleware(store, () => member, async () => ({ points: 5, feature: '音效', detail: '测试' })), (_req, res) => { generated++; res.json({ ok: true }); });
  app.post('/failure', pointsMiddleware(store, () => member, () => ({ points: 5, feature: '音效', detail: '测试' })), (_req, res) => res.status(502).json({ error: 'provider failed' }));
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status || 500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const address = server.address(); assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const response = await fetch(url + '/success', { method: 'POST' });
  assert.equal(response.status, 200); assert.equal(response.headers.get('X-Creation-Points-Charged'), '5');
  assert.equal(store.balance(member).used, 5); assert.equal(store.balance(member).frozen, 0);
  assert.equal((await fetch(url + '/failure', { method: 'POST' })).status, 502);
  assert.equal(store.balance(member).used, 5); assert.equal(store.balance(member).frozen, 0);
  store.setMemberLimit('2026-09', member.userId, 5, member, '限制测试');
  assert.equal((await fetch(url + '/success', { method: 'POST' })).status, 429); assert.equal(generated, 1);
});
