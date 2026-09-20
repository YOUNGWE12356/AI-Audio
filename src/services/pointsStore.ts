import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type PointsActor = { userId: string; displayName: string; identitySource: string };
export type PointsLimits = { memberMonthly: number; companyMonthly: number; guestDaily: number };
export type PointsEntry = PointsActor & {
  id: string; taskId: string; month: string; day: string; timestamp: string;
  type: 'reserve' | 'debit' | 'release' | 'settings'; points: number; feature: string;
  detail: string; operator?: string; operatorId?: string;
};
type Reservation = PointsActor & { id: string; month: string; day: string; points: number; feature: string; detail: string };
type State = {
  version: 1; users: Record<string, PointsActor>; limits: Record<string, PointsLimits>;
  overrides: Record<string, Record<string, number>>; entries: PointsEntry[];
  pending: Record<string, Reservation>;
};
export const pointsDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);
export const pointsMonth = (date = new Date()) => pointsDay(date).slice(0, 7);
export function validateMonth(month: unknown): string {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Object.assign(new Error('请选择有效月份。'), { status: 400 });
  return month;
}
const defaults: PointsLimits = { memberMonthly: 200, companyMonthly: 6000, guestDaily: 20 };
const error = (message: string, status = 400) => Object.assign(new Error(message), { status });
const validLimit = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000;

// Single Node process: synchronous atomic snapshots make balance checks and reservations indivisible.
// The snapshot is the authoritative ledger, separate from provider usage logs.
export class PointsStore {
  private state: State;
  constructor(private file: string, private clock: () => Date = () => new Date()) {
    if (fs.existsSync(file)) {
      this.state = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (this.state.version !== 1 || !Array.isArray(this.state.entries) || !this.state.pending || !this.state.limits || !this.state.users || !this.state.overrides) {
        throw new Error('积分账本格式无效，已停止启动，请恢复备份。');
      }
    } else {
      this.state = { version: 1, users: {}, limits: {}, overrides: {}, entries: [], pending: {} };
      this.save(this.state);
    }
    // Jobs cannot resume after this application's process restarts. Return their frozen balance.
    for (const id of Object.keys(this.state.pending)) this.finish(id, 0, '服务重启，未完成任务退回冻结积分');
  }
  private save(state: State) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
    this.state = state;
  }
  private change(action: (next: State) => void) {
    const next = structuredClone(this.state);
    action(next);
    this.save(next);
  }
  private entry(reservation: Reservation, type: PointsEntry['type'], points: number, detail: string): PointsEntry {
    return { ...reservation, id: randomUUID(), taskId: reservation.id, type, points, detail, timestamp: this.clock().toISOString() };
  }
  register(actor: PointsActor) {
    if (!/^(feishu|device):[a-zA-Z0-9._:-]+$/.test(actor.userId)) throw error('无法识别积分账户，请刷新页面后重试。');
    if (JSON.stringify(this.state.users[actor.userId]) !== JSON.stringify(actor)) this.change(next => { next.users[actor.userId] = actor; });
  }
  limits(month = pointsMonth(this.clock())) {
    validateMonth(month);
    const effective = Object.keys(this.state.limits).filter(key => key <= month).sort().at(-1);
    return { ...(effective ? this.state.limits[effective] : defaults) };
  }
  balance(actor: PointsActor, month = pointsMonth(this.clock())) {
    validateMonth(month);
    const day = pointsDay(this.clock());
    const policy = this.limits(month);
    const entries = this.state.entries.filter(entry => entry.month === month && entry.type === 'debit');
    const pending = Object.values(this.state.pending).filter(entry => entry.month === month);
    const sum = (rows: { points: number }[]) => rows.reduce((total, row) => total + row.points, 0);
    const used = sum(entries.filter(entry => entry.userId === actor.userId));
    const frozen = sum(pending.filter(entry => entry.userId === actor.userId));
    const limit = this.state.overrides[month]?.[actor.userId] ?? policy.memberMonthly;
    const companyUsed = sum(entries), companyFrozen = sum(pending);
    const dailyUsed = sum(entries.filter(entry => entry.userId === actor.userId && entry.day === day));
    const dailyFrozen = sum(pending.filter(entry => entry.userId === actor.userId && entry.day === day));
    const personalRemaining = Math.max(0, limit - used - frozen);
    const companyRemaining = Math.max(0, policy.companyMonthly - companyUsed - companyFrozen);
    const guestRemaining = Math.max(0, policy.guestDaily - dailyUsed - dailyFrozen);
    return { ...actor, month, limit, used, frozen, personalRemaining, companyRemaining,
      companyUsed, companyFrozen, companyLimit: policy.companyMonthly, guestDaily: policy.guestDaily,
      dailyUsed, dailyFrozen, override: this.state.overrides[month]?.[actor.userId] ?? null,
      remaining: Math.min(personalRemaining, companyRemaining, actor.identitySource === 'feishu' ? Infinity : guestRemaining) };
  }
  reserve(actor: PointsActor, points: number, feature: string, detail: string) {
    this.register(actor);
    if (!validLimit(points) || points < 1) throw error('积分报价无效。');
    const balance = this.balance(actor);
    if (points > balance.remaining) throw Object.assign(error(`创作积分不足：本次需要 ${points} 分，可用 ${balance.remaining} 分。`, 429), { code: 'POINTS_INSUFFICIENT', balance });
    const id = randomUUID();
    const reservation: Reservation = { ...actor, id, month: pointsMonth(this.clock()), day: pointsDay(this.clock()), points, feature, detail };
    this.change(next => { next.pending[id] = reservation; next.entries.push(this.entry(reservation, 'reserve', points, detail)); });
    return id;
  }
  finish(id: string, points: number, detail = '') {
    const pending = this.state.pending[id];
    if (!pending) return; // Idempotent settlement, including duplicate callbacks.
    if (!validLimit(points)) throw error('积分结算无效。');
    // Never charge more than the accepted reservation; system estimation differences are absorbed.
    const charged = Math.min(points, pending.points);
    this.change(next => {
      delete next.pending[id];
      if (charged) next.entries.push(this.entry(pending, 'debit', charged, detail || pending.detail));
      if (pending.points > charged) next.entries.push(this.entry(pending, 'release', pending.points - charged, detail || '任务失败或结算退回剩余冻结积分'));
    });
  }
  settings(month: string, policy: PointsLimits, actor: PointsActor, reason: string, expected: PointsLimits) {
    validateMonth(month);
    if (month < pointsMonth(this.clock())) throw error('历史月份不可修改。');
    if (!policy || !['memberMonthly', 'companyMonthly', 'guestDaily'].every(key => validLimit(policy[key]))) throw error('积分上限必须是 0～10000000 的整数。');
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 300) throw error('请填写 1～300 字的修改原因。');
    const previous = this.limits(month);
    if (!expected || Object.keys(defaults).some(key => expected[key] !== previous[key])) throw error('配置已被修改，请刷新后重试。', 409);
    const limits = { memberMonthly: policy.memberMonthly, companyMonthly: policy.companyMonthly, guestDaily: policy.guestDaily };
    this.change(next => {
      next.limits[month] = limits;
      next.entries.push({ ...actor, id: randomUUID(), taskId: '', month, day: pointsDay(this.clock()), timestamp: this.clock().toISOString(), type: 'settings', points: 0, feature: '月度上限设置', detail: `${reason.trim()}；${JSON.stringify(previous)} → ${JSON.stringify(limits)}`, operator: actor.displayName, operatorId: actor.userId });
    });
  }
  setMemberLimit(month: string, userId: string, limit: number | null, actor: PointsActor, reason: string) {
    validateMonth(month);
    if (month < pointsMonth(this.clock())) throw error('历史月份不可修改。');
    if (!Object.hasOwn(this.state.users, userId)) throw error('积分账户不存在。');
    if (limit !== null && !validLimit(limit)) throw error('个人上限必须是非负整数。');
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 300) throw error('请填写修改原因（最多 300 字）。');
    const previous = this.state.overrides[month]?.[userId] ?? null;
    this.change(next => {
      next.overrides[month] ||= {};
      if (limit === null) delete next.overrides[month][userId];
      else next.overrides[month][userId] = limit;
      next.entries.push({ ...this.state.users[userId], id: randomUUID(), taskId: '', month, day: pointsDay(this.clock()), timestamp: this.clock().toISOString(), type: 'settings', points: 0, feature: '个人月度上限设置', detail: `${this.state.users[userId].displayName} (${userId})：${previous ?? '默认'} → ${limit ?? '默认'}；${reason.trim()}；操作人 ${actor.displayName} (${actor.userId})`, operator: actor.displayName, operatorId: actor.userId });
    });
  }
  report(month: string, userId = '', page = 1) {
    validateMonth(month);
    const users = Object.values(this.state.users).map(actor => this.balance(actor, month)).sort((a, b) => b.used - a.used);
    const entries = this.state.entries.filter(entry => entry.month === month && (!userId || entry.userId === userId)).reverse();
    return { month, policy: this.limits(month), users, entries: entries.slice((page - 1) * 50, page * 50), total: entries.length, page, pageSize: 50 };
  }
}
