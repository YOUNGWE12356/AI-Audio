import { useCallback, useEffect, useRef, useState } from 'react';
import { getSfxLibraryAdminHeaders } from '../services/sfxLibraryAdminService';
import type { PointsStore, PointsLimits } from '../services/pointsStore';

type Report = ReturnType<PointsStore['report']> & { rules: string[][] };
const currentMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(new Date());
const number = (value: number) => value.toLocaleString('zh-CN');
const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50';
const buttonClass = 'rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50';
async function request(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers: getSfxLibraryAdminHeaders({ 'Content-Type': 'application/json' }), cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || '积分管理请求失败。');
  return body;
}
export default function PointsManagement() {
  const [month, setMonth] = useState(currentMonth);
  const [userId, setUserId] = useState('');
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<Report | null>(null);
  const [policy, setPolicy] = useState<PointsLimits>({ memberMonthly: 200, companyMonthly: 6000, guestDaily: 20 });
  const [reason, setReason] = useState('');
  const [memberLimit, setMemberLimit] = useState('');
  const [memberReason, setMemberReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const historical = month < currentMonth();
  const load = useCallback(async () => {
    const id = ++sequence.current;
    setLoading(true); setError('');
    try {
      const data = await request(`/api/points/admin?${new URLSearchParams({ month, userId, page: String(page) })}`) as Report;
      if (id !== sequence.current) return;
      setReport(data); setPolicy(data.policy);
      const member = data.users.find(user => user.userId === userId);
      setMemberLimit(member?.override == null ? '' : String(member.override));
    } catch (cause) {
      if (id === sequence.current) { setError(cause instanceof Error ? cause.message : '加载失败'); setReport(null); }
    } finally { if (id === sequence.current) setLoading(false); }
  }, [month, userId, page]);
  useEffect(() => { void load(); return () => { sequence.current++; }; }, [load]);
  const save = async (member = false) => {
    if (!report || saving) return;
    setSaving(true); setError(''); setFeedback('');
    try {
      await request(`/api/points/admin/${member ? 'member' : 'settings'}`, {
        method: 'PUT', body: JSON.stringify(member
          ? { month, userId, limit: memberLimit === '' ? null : Number(memberLimit), reason: memberReason }
          : { month, policy, expected: report.policy, reason }),
      });
      setFeedback(member ? '个人当月上限已保存。' : '月度规则已保存，按所选月份生效。');
      setReason(''); setMemberReason('');
      window.dispatchEvent(new Event('ai-audio:points-changed'));
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败。'); }
    finally { setSaving(false); }
  };
  const used = report?.users.reduce((total, user) => total + user.used, 0) || 0;
  const frozen = report?.users.reduce((total, user) => total + user.frozen, 0) || 0;
  const chosen = report?.users.find(user => user.userId === userId);
  return <section className="mt-8 space-y-5" aria-labelledby="points-title">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><h2 id="points-title" className="text-lg font-bold text-slate-900">创作积分管理</h2><p className="mt-1 text-xs text-slate-500">北京时间自然月统计。只记录模块启用后的任务，不追扣历史用量。</p></div>
      <div className="flex items-end gap-3"><label className="text-xs text-slate-600">统计月份<input aria-label="积分统计月份" type="month" value={month} disabled={saving} onChange={event => { if (event.target.value) { setMonth(event.target.value); setPage(1); setFeedback(''); } }} className={`mt-1 ${inputClass}`} /></label><button onClick={() => void load()} disabled={loading || saving} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">{loading ? '加载中…' : '刷新'}</button></div>
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {feedback && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{feedback}</p>}
    {report && <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[['公司月上限', report.policy.companyMonthly], ['已消费', used], ['任务冻结', frozen], ['公司可用', Math.max(0, report.policy.companyMonthly - used - frozen)]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{number(Number(value))}<span className="ml-1 text-xs font-normal text-slate-400">分</span></p></div>)}</div>
      <form onSubmit={event => { event.preventDefault(); void save(); }} className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-bold text-slate-800">每月积分上限</h3>
        <p className="mt-2 text-xs leading-5 text-slate-500">规则从所选月份生效，延续到下一次设置。0 表示停止发放；调低上限不删除已有消费。{historical && '历史月份只读。'}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">{([['memberMonthly', '每人默认月上限'], ['companyMonthly', '公司共享月上限'], ['guestDaily', '本地游客每日上限']] as const).map(([key, label]) => <label key={key} className="text-xs font-medium text-slate-600">{label}<input type="number" min="0" max="10000000" step="1" required value={Number.isNaN(policy[key]) ? '' : policy[key]} disabled={historical || saving || loading} onChange={event => setPolicy(previous => ({ ...previous, [key]: event.target.value === '' ? NaN : Number(event.target.value) }))} className={`mt-2 ${inputClass}`} /></label>)}</div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row"><input aria-label="月度上限修改原因" placeholder="修改原因（必填，将记录到操作流水）" required maxLength={300} value={reason} disabled={historical || saving} onChange={event => setReason(event.target.value)} className={inputClass} /><button disabled={historical || saving || loading || !reason.trim()} className={`${buttonClass} shrink-0`}>{saving ? '保存中…' : '保存月度上限'}</button></div>
      </form>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4"><h3 className="text-sm font-bold">成员积分与明细</h3><select aria-label="筛选积分成员" value={userId} disabled={saving} onChange={event => { setUserId(event.target.value); setPage(1); }} className="max-w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="">全部成员</option>{report.users.map(user => <option key={user.userId} value={user.userId}>{user.displayName} · {user.userId}</option>)}</select></div>
        <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['成员', '身份', '月上限', '已用', '冻结', '个人月余额', '操作'].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{report.users.filter(user => !userId || user.userId === userId).map(user => <tr key={user.userId} className="border-t border-slate-100"><td className="px-4 py-3"><p className="font-medium">{user.displayName}</p><p className="mt-1 text-[10px] text-slate-400">{user.userId}</p></td><td className="px-4 py-3">{user.identitySource === 'feishu' ? '飞书成员' : '本地游客 / 设备'}</td>{[user.limit, user.used, user.frozen, user.personalRemaining].map((value, index) => <td key={index} className="px-4 py-3 tabular-nums">{number(value)}</td>)}<td className="px-4 py-3"><button disabled={saving} onClick={() => { setUserId(user.userId); setPage(1); }} className="text-emerald-700 underline">查看 / 设置</button></td></tr>)}</tbody></table></div>
        {!report.users.length && <p className="p-8 text-center text-sm text-slate-500">暂无积分账户。成员进入工作台后会自动建立账户。</p>}
        {chosen && <form onSubmit={event => { event.preventDefault(); void save(true); }} className="space-y-3 border-t border-slate-100 bg-slate-50 p-4"><p className="text-sm font-semibold">{chosen.displayName} · {month} 专项上限（仅当月有效）</p><div className="grid gap-3 sm:grid-cols-[180px_1fr_auto]"><input aria-label="成员当月积分上限" type="number" min="0" max="10000000" step="1" placeholder="留空恢复默认" value={memberLimit} disabled={historical || saving} onChange={event => setMemberLimit(event.target.value)} className={inputClass} /><input aria-label="成员上限修改原因" placeholder="修改原因" required maxLength={300} value={memberReason} disabled={historical || saving} onChange={event => setMemberReason(event.target.value)} className={inputClass} /><button disabled={historical || saving || loading || !memberReason.trim()} className={buttonClass}>保存个人上限</button></div></form>}
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><h3 className="p-4 text-sm font-bold">积分流水</h3><p className="px-4 pb-3 text-xs text-slate-500">冻结不算消费；成功扣分、失败退回，保留任务编号、计费依据及管理操作。</p><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="whitespace-nowrap bg-slate-50 text-slate-500"><tr>{['时间', '成员', '类型', '积分', '功能 / 计费依据'].map(label => <th className="px-4 py-3 font-medium" key={label}>{label}</th>)}</tr></thead><tbody>{report.entries.map(entry => <tr className="border-t border-slate-100 align-top" key={entry.id}><td className="whitespace-nowrap px-4 py-3">{new Date(entry.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</td><td className="whitespace-nowrap px-4 py-3">{entry.displayName}</td><td className="whitespace-nowrap px-4 py-3">{{ reserve: '冻结', debit: '消费', release: '退回', settings: '管理操作' }[entry.type]}</td><td className="px-4 py-3 tabular-nums">{number(entry.points)}</td><td className="min-w-64 max-w-lg break-words px-4 py-3"><p className="font-medium">{entry.feature}</p><p className="mt-1 leading-5 text-slate-500">{entry.detail}</p>{entry.taskId && <p className="mt-1 text-[10px] text-slate-400">任务 {entry.taskId}</p>}</td></tr>)}</tbody></table></div>{!report.entries.length && <p className="p-8 text-center text-sm text-slate-500">该月份暂无积分流水。</p>}<div className="flex items-center justify-between border-t border-slate-100 p-4 text-xs"><span>共 {report.total} 条 · 第 {page} / {Math.max(1, Math.ceil(report.total / 50))} 页</span><div className="flex gap-3"><button disabled={page <= 1 || loading || saving} onClick={() => setPage(value => value - 1)} className="disabled:opacity-40">上一页</button><button disabled={page * 50 >= report.total || loading || saving} onClick={() => setPage(value => value + 1)} className="disabled:opacity-40">下一页</button></div></div></div>
      <details className="rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">创作积分规则 v1</summary><ul className="mt-3 space-y-2 text-xs text-slate-600">{report.rules.map(([feature, price]) => <li key={feature}>{feature}：{price}</li>)}</ul><p className="mt-3 text-xs text-slate-500">时长按秒折算，向上取整，最低 1 分；A/B 两版分别计费。结算不超过冻结上限，系统重试不重复扣分。Dubbing V2 暂未开放计价。</p></details>
    </>}
  </section>;
}
export function PointsBalance({ compact = false }: { compact?: boolean }) {
  const [balance, setBalance] = useState<ReturnType<PointsStore['balance']> | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch('/api/points/me', { cache: 'no-store' });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (active) { setBalance(data.balance); setError(false); }
      } catch { if (active) setError(true); }
    };
    void load();
    window.addEventListener('ai-audio:points-changed', load); window.addEventListener('focus', load);
    const interval = window.setInterval(load, 30_000);
    return () => { active = false; window.removeEventListener('ai-audio:points-changed', load); window.removeEventListener('focus', load); window.clearInterval(interval); };
  }, []);
  return <div className="mt-3 text-xs text-emerald-700" title={balance ? `本月已用 ${balance.used} / ${balance.limit} 分，冻结 ${balance.frozen} 分；可用余额受公司共享额度和游客日上限约束。` : undefined}>{error ? '积分暂不可用' : balance ? <><span className="font-semibold">{number(balance.remaining)}</span> {compact ? '分' : '创作积分可用'}{!compact && <p className="mt-1 text-[10px] text-slate-500">本月 {number(balance.used)} / {number(balance.limit)} · 冻结 {number(balance.frozen)}</p>}</> : '积分加载中…'}</div>;
}
