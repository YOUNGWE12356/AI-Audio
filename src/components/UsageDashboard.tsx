import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Bot, Check, ChevronDown, Coins, Cpu, Laptop, Minus, Pencil, Plus, RefreshCw, RotateCcw, ShieldCheck, Sparkles, TriangleAlert, Users, X } from 'lucide-react';
import {
  ElevenLabsQuotaSummary,
  ElevenLabsQuotaUser,
  fetchElevenLabsQuotaSummary,
  fetchUsageSummary,
  fetchUsageSummaryRange,
  formatDateInputValue,
  getElevenLabsBillingCycleStart,
  parseDateInputEnd,
  parseDateInputStart,
  ProviderUsage,
  UsagePeriod,
  UsageProviderName,
  UsageSummary,
  UsageUser,
  setElevenLabsAccountQuotaTotal,
  setElevenLabsQuotaBonus,
} from '../services/usageService';

const integerFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const formatInteger = (value: number) => integerFormatter.format(value);
const formatCredits = (value: number) => decimalFormatter.format(value);
const formatDateTime = (value: string) => new Intl.DateTimeFormat('zh-CN', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
}).format(new Date(value));
const formatDate = (value: Date) => new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
}).format(value);

function QuotaManagement({
  summary,
  updatingUserId,
  accountTotalUpdating,
  feedback,
  onSetBonus,
  onSetAccountTotal,
}: {
  summary: ElevenLabsQuotaSummary;
  updatingUserId: string | null;
  accountTotalUpdating: boolean;
  feedback: { message: string; error: boolean } | null;
  onSetBonus: (user: ElevenLabsQuotaUser, bonusCredits: number) => void;
  onSetAccountTotal: (totalCredits: number) => Promise<boolean>;
}) {
  const periodLabel = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    timeZone: summary.period.timeZone,
  }).format(new Date(summary.period.start));
  const accountCycle = summary.accountBillingCycle;
  const [isEditingAccountTotal, setIsEditingAccountTotal] = useState(false);
  const [accountTotalInput, setAccountTotalInput] = useState(String(accountCycle.totalCredits));
  const parsedAccountTotal = Number(accountTotalInput);
  const accountTotalIsValid = accountTotalInput.trim() !== ''
    && Number.isFinite(parsedAccountTotal)
    && parsedAccountTotal >= 0
    && parsedAccountTotal <= 100_000_000;
  const accountUsagePercent = accountCycle.totalCredits > 0
    ? Math.min(100, Math.max(0, accountCycle.usedCredits / accountCycle.totalCredits * 100))
    : 100;

  useEffect(() => {
    if (!isEditingAccountTotal) setAccountTotalInput(String(accountCycle.totalCredits));
  }, [accountCycle.totalCredits, isEditingAccountTotal]);

  const submitAccountTotal = async () => {
    if (!accountTotalIsValid || accountTotalUpdating) return;
    const saved = await onSetAccountTotal(Math.round(parsedAccountTotal));
    if (saved) setIsEditingAccountTotal(false);
  };

  return (
    <section className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white" aria-labelledby="elevenlabs-quota-title">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="elevenlabs-quota-title" className="text-xs font-bold text-slate-800">ElevenLabs 成员月度配额</h3>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${summary.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                {summary.enabled ? '限制已启用' : '仅统计，未限制'}
              </span>
            </div>
            <p className="mt-1 text-[10px] text-slate-400">
              {periodLabel} · 每人基础 {formatInteger(summary.defaultMonthlyCredits)} 积分 · 次月自动恢复基础额度
            </p>
          </div>
          {feedback ? (
            <p className={`text-[10px] font-medium ${feedback.error ? 'text-rose-600' : 'text-emerald-700'}`} role="status">
              {feedback.message}
            </p>
          ) : null}
        </div>

        <div className="mt-3 grid gap-x-8 gap-y-3 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.1fr]">
          <div>
            <p className="text-[10px] text-slate-400">本账期总额度</p>
            {isEditingAccountTotal ? (
              <form
                className="mt-1 flex items-center gap-1.5"
                onSubmit={event => {
                  event.preventDefault();
                  void submitAccountTotal();
                }}
              >
                <input
                  type="number"
                  min="0"
                  max="100000000"
                  step="1000"
                  value={accountTotalInput}
                  onChange={event => setAccountTotalInput(event.target.value)}
                  className="h-8 w-36 rounded-md border border-slate-200 px-2 font-mono text-sm font-semibold text-slate-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  aria-label="本账期总额度"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!accountTotalIsValid || accountTotalUpdating}
                  className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                  title="保存总额度"
                  aria-label="保存本账期总额度"
                >
                  {accountTotalUpdating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingAccountTotal(false)}
                  disabled={accountTotalUpdating}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                  title="取消修改"
                  aria-label="取消修改本账期总额度"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </form>
            ) : (
              <div className="mt-1 flex items-center gap-1.5">
                <p className="font-mono text-lg font-semibold text-slate-900">{formatInteger(accountCycle.totalCredits)}</p>
                <button
                  type="button"
                  onClick={() => setIsEditingAccountTotal(true)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  title="修改本账期总额度"
                  aria-label="修改本账期总额度"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                {accountCycle.adjusted ? (
                  <button
                    type="button"
                    onClick={() => void onSetAccountTotal(accountCycle.defaultTotalCredits)}
                    disabled={accountTotalUpdating}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                    title={`恢复默认额度 ${formatInteger(accountCycle.defaultTotalCredits)}`}
                    aria-label="恢复默认本账期总额度"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            )}
          </div>
          <div>
            <p className="text-[10px] text-slate-400">本工具已用</p>
            <p className="mt-1 font-mono text-lg font-semibold text-slate-700">{formatCredits(accountCycle.usedCredits)}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400">剩余额度</p>
            <p className={`mt-1 font-mono text-lg font-semibold ${accountCycle.remainingCredits <= 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
              {formatCredits(accountCycle.remainingCredits)}
            </p>
          </div>
          <div className="sm:text-right">
            <p className="text-[10px] text-slate-400">账期</p>
            <p className="mt-1 text-xs font-semibold text-slate-700">
              {formatDate(new Date(accountCycle.periodStart))} - {formatDate(new Date(accountCycle.periodEnd))}
            </p>
            <p className="mt-0.5 text-[9px] text-slate-400">{accountCycle.adjusted ? '本账期已手动调整' : '每月 11 日恢复默认额度'}</p>
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-label={`本账期已使用 ${accountUsagePercent.toFixed(0)}%`}>
          <div
            className={`h-full rounded-full ${accountCycle.remainingCredits <= 0 ? 'bg-rose-500' : accountUsagePercent >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
            style={{ width: `${accountUsagePercent}%` }}
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[940px] text-left text-[11px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-2.5 font-semibold">成员 / 设备</th>
              <th className="px-3 py-2.5 text-right font-semibold">本月已用</th>
              <th className="px-3 py-2.5 text-right font-semibold">本月额度</th>
              <th className="px-3 py-2.5 text-right font-semibold">剩余</th>
              <th className="w-40 px-3 py-2.5 font-semibold">使用进度</th>
              <th className="px-4 py-2.5 text-right font-semibold">调整额度</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {summary.users.map(user => {
              const usagePercent = user.limitCredits > 0
                ? Math.min(100, Math.max(0, user.usedCredits / user.limitCredits * 100))
                : 100;
              const isUpdating = updatingUserId === user.userId;
              return (
                <tr key={user.userId} className="text-slate-600">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {user.identitySource === 'device'
                        ? <Laptop className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        : <Users className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-800">{user.displayName}</p>
                        <p className="mt-0.5 text-[9px] text-slate-400">
                          {user.identitySource === 'feishu' ? (user.department || '飞书成员') : '设备身份'}
                          {user.bonusCredits > 0 ? ` · 已追加 ${formatInteger(user.bonusCredits)}` : ''}
                          {user.bonusCredits < 0 ? ` · 已减少 ${formatInteger(Math.abs(user.bonusCredits))}` : ''}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono">{formatCredits(user.usedCredits)}</td>
                  <td className="px-3 py-3 text-right font-mono font-semibold text-slate-800">{formatInteger(user.limitCredits)}</td>
                  <td className={`px-3 py-3 text-right font-mono font-semibold ${user.blocked ? 'text-rose-600' : 'text-emerald-700'}`}>
                    {formatCredits(user.remainingCredits)}
                  </td>
                  <td className="px-3 py-3">
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${user.blocked ? 'bg-rose-500' : usagePercent >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                        style={{ width: `${usagePercent}%` }}
                      />
                    </div>
                    <p className="mt-1 text-right font-mono text-[9px] text-slate-400">{usagePercent.toFixed(0)}%</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => onSetBonus(user, Math.max(-user.baseCredits, user.bonusCredits - 10_000))}
                        disabled={isUpdating || user.limitCredits <= 0}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 px-2 font-semibold text-slate-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                        title="本月减少 10,000 积分"
                        aria-label={`将 ${user.displayName} 的本月额度减少 10,000 积分`}
                      >
                        <Minus className="h-3 w-3" />1 万
                      </button>
                      <button
                        type="button"
                        onClick={() => onSetBonus(user, user.bonusCredits + 10_000)}
                        disabled={isUpdating}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 px-2 font-semibold text-slate-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50"
                        title="本月追加 10,000 积分"
                      >
                        <Plus className="h-3 w-3" />1 万
                      </button>
                      {user.bonusCredits !== 0 ? (
                        <button
                          type="button"
                          onClick={() => onSetBonus(user, 0)}
                          disabled={isUpdating}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                          title="恢复本月基础额度"
                          aria-label={`将 ${user.displayName} 恢复为本月基础额度`}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
            {summary.users.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">本月还没有可识别的成员或设备。</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const PROVIDERS: Array<{
  key: UsageProviderName;
  label: string;
  icon: typeof Bot;
  iconClass: string;
}> = [
  { key: 'elevenLabs', label: 'ElevenLabs', icon: Coins, iconClass: 'bg-fuchsia-50 text-fuchsia-700' },
  { key: 'gemini', label: 'Gemini', icon: Sparkles, iconClass: 'bg-blue-50 text-blue-700' },
  { key: 'gpt', label: 'GPT', icon: Bot, iconClass: 'bg-emerald-50 text-emerald-700' },
];

const PERIOD_OPTIONS: Array<{ value: UsagePeriod; label: string }> = [
  { value: 'week', label: '本周' },
  { value: 'month', label: '本月' },
  { value: 'billingCycle', label: '本账期' },
  { value: 'custom', label: '自定义' },
];

function ProviderSummary({
  provider,
  usage,
  billingCycle,
}: {
  provider: typeof PROVIDERS[number];
  usage: ProviderUsage;
  billingCycle?: {
    start: Date;
    credits: number;
    requests: number;
  };
}) {
  const Icon = provider.icon;
  const primaryValue = provider.key === 'elevenLabs' ? formatCredits(usage.credits) : formatInteger(usage.totalTokens);
  return (
    <div className="flex h-full min-h-[138px] flex-col rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${provider.iconClass}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-800">{provider.label}</h3>
            <p className="text-[10px] text-slate-400">{formatInteger(usage.requests)} 次调用</p>
          </div>
        </div>
        <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${usage.status === 'tracking' ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
          {usage.status === 'tracking' ? '本工具采集' : '未配置'}
        </span>
      </div>
      <div className="mt-4">
        <p className="text-[10px] text-slate-400">{provider.key === 'elevenLabs' ? '已消耗积分' : '总 Token'}</p>
        <p className="mt-1 font-mono text-2xl font-semibold text-slate-900">{primaryValue}</p>
      </div>
      {provider.key === 'elevenLabs' && billingCycle ? (
        <div className="mt-3 rounded-lg border border-fuchsia-100 bg-fuchsia-50/60 px-3 py-2">
          <div className="flex items-center justify-between gap-3 text-[10px] text-fuchsia-700">
            <span>本账期（{formatDate(billingCycle.start)} 起）</span>
            <span>{formatInteger(billingCycle.requests)} 次调用</span>
          </div>
          <p className="mt-1 font-mono text-lg font-semibold text-fuchsia-950">{formatCredits(billingCycle.credits)}</p>
        </div>
      ) : null}
      {provider.key !== 'elevenLabs' ? (
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-[10px]">
          <span className="text-slate-400">输入 <b className="block font-mono text-xs text-slate-700">{formatInteger(usage.inputTokens)}</b></span>
          <span className="text-slate-400">输出 <b className="block font-mono text-xs text-slate-700">{formatInteger(usage.outputTokens)}</b></span>
          <span className="text-slate-400">思考 <b className="block font-mono text-xs text-slate-700">{formatInteger(usage.reasoningTokens)}</b></span>
        </div>
      ) : usage.unmeteredRequests > 0 ? (
        <details className="mt-3 border-t border-slate-100 pt-3 text-[10px] text-amber-700">
          <summary className="cursor-pointer select-none font-semibold">
            {usage.unmeteredRequests} 次调用未返回积分计费信息，点击查看明细
          </summary>
          <div className="mt-2 space-y-1.5 text-slate-500">
            {(usage.unmeteredEvents || []).map((event, index) => (
              <div key={`${event.timestamp}-${event.model}-${index}`} className="rounded-md bg-amber-50/70 px-2 py-1.5">
                <span className="font-mono text-slate-700">{formatDateTime(event.timestamp)}</span>
                <span className="mx-1">·</span>
                <span>{event.feature}</span>
                <span className="mx-1">·</span>
                <span className="font-mono">{event.model}</span>
                <span className="mx-1">·</span>
                <span>{event.identitySource === 'feishu' ? event.displayName : event.displayName || '未识别设备'}</span>
              </div>
            ))}
            {usage.unmeteredRequests > (usage.unmeteredEvents?.length || 0) ? (
              <p className="text-slate-400">仅显示最近 {usage.unmeteredEvents?.length || 0} 条。</p>
            ) : null}
          </div>
        </details>
      ) : (
        <div className="mt-auto h-[45px] border-t border-transparent pt-3" aria-hidden="true" />
      )}
    </div>
  );
}

const providerLabel = (provider: UsageUser['details'][number]['provider']) => (
  provider === 'elevenlabs' ? 'ElevenLabs' : provider === 'gemini' ? 'Gemini' : 'GPT'
);

function MemberUsageTable({
  users,
  expandedUserId,
  onToggle,
  blacklistedIps,
  blacklistLoading,
  blacklistUpdatingUserId,
  blacklistFeedback,
  onSetMemberBlacklist,
}: {
  users: UsageUser[];
  expandedUserId: string | null;
  onToggle: (userId: string) => void;
  blacklistedIps: string[];
  blacklistLoading: boolean;
  blacklistUpdatingUserId: string | null;
  blacklistFeedback: string | null;
  onSetMemberBlacklist: (user: UsageUser, shouldBlock: boolean) => void;
}) {
  const blacklistedIpSet = useMemo(() => new Set(blacklistedIps), [blacklistedIps]);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-col gap-1 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-xs font-bold text-slate-700">按成员汇总</h3>
        <div className="text-right text-[10px]">
          {blacklistFeedback ? <p className="font-medium text-slate-600" role="status">{blacklistFeedback}</p> : null}
          <p className="text-slate-400">当前以设备区分；接入飞书后自动归入真实成员。IP 仅表示连接来源，不等于个人身份。</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1280px] text-left text-[11px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-2.5 font-semibold">成员 / 设备</th>
              <th className="px-3 py-2.5 font-semibold">身份来源</th>
              <th className="px-3 py-2.5 font-semibold">IP 地址</th>
              <th className="px-3 py-2.5 text-right font-semibold">调用</th>
              <th className="px-3 py-2.5 text-right font-semibold">ElevenLabs 积分</th>
              <th className="px-3 py-2.5 text-right font-semibold">Gemini Token</th>
              <th className="px-3 py-2.5 text-right font-semibold">GPT Token</th>
              <th className="px-3 py-2.5 text-right font-semibold">总 Token</th>
              <th className="px-3 py-2.5 text-right font-semibold">IP 黑名单</th>
              <th className="px-4 py-2.5 text-right font-semibold">最后使用</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map(user => {
              const isExpanded = expandedUserId === user.userId;
              const sourceLabel = user.identitySource === 'feishu'
                ? (user.department || '飞书认证')
                : user.identitySource === 'device' ? '待飞书登录' : '历史未识别';
              const memberIps = user.ipAddresses || [];
              const blockedIpCount = memberIps.reduce(
                (count, ip) => count + (blacklistedIpSet.has(ip) ? 1 : 0),
                0,
              );
              const hasBlockedIp = blockedIpCount > 0;
              const allIpsBlocked = memberIps.length > 0 && blockedIpCount === memberIps.length;
              const isUpdatingBlacklist = blacklistUpdatingUserId === user.userId;
              return (
                <Fragment key={`${user.identitySource}-${user.userId}`}>
                  <tr className="text-slate-600">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => onToggle(user.userId)}
                        className="flex min-w-0 items-center gap-2 text-left font-semibold text-slate-800 hover:text-emerald-700"
                        aria-expanded={isExpanded}
                      >
                        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        <span>{user.displayName}</span>
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center gap-1.5 ${user.identitySource === 'feishu' ? 'text-emerald-700' : 'text-slate-500'}`}>
                        {user.identitySource === 'device' ? <Laptop className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
                        {sourceLabel}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-[10px] text-slate-500">
                      {user.ipAddresses?.length ? user.ipAddresses.join(', ') : '未记录'}
                    </td>
                    <td className="px-3 py-3 text-right font-mono">{formatInteger(user.requests)}</td>
                    <td className="px-3 py-3 text-right font-mono">{formatCredits(user.elevenLabsCredits)}</td>
                    <td className="px-3 py-3 text-right font-mono">{formatInteger(user.geminiTokens)}</td>
                    <td className="px-3 py-3 text-right font-mono">{formatInteger(user.gptTokens)}</td>
                    <td className="px-3 py-3 text-right font-mono font-semibold text-slate-800">{formatInteger(user.totalTokens)}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <span className={`whitespace-nowrap text-[10px] font-semibold ${
                          allIpsBlocked ? 'text-rose-600' : hasBlockedIp ? 'text-amber-600' : 'text-slate-400'
                        }`}>
                          {memberIps.length === 0
                            ? '无可用 IP'
                            : allIpsBlocked
                              ? '已拉黑'
                              : hasBlockedIp ? `部分拉黑 ${blockedIpCount}/${memberIps.length}` : '正常'}
                        </span>
                        <button
                          type="button"
                          onClick={() => onSetMemberBlacklist(user, !hasBlockedIp)}
                          disabled={blacklistLoading || memberIps.length === 0}
                          className={`inline-flex h-7 min-w-16 items-center justify-center gap-1 rounded-md border px-2 font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                            hasBlockedIp
                              ? 'border-slate-200 text-slate-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700'
                              : 'border-rose-200 text-rose-600 hover:bg-rose-50'
                          }`}
                          aria-label={`${hasBlockedIp ? '将' : '把'} ${user.displayName} ${hasBlockedIp ? '移出' : '加入'} IP 黑名单`}
                          title={memberIps.length === 0 ? '该成员没有已记录的 IP' : `${hasBlockedIp ? '移出' : '加入'} IP 黑名单`}
                        >
                          {isUpdatingBlacklist
                            ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            : hasBlockedIp
                              ? <ShieldCheck className="h-3.5 w-3.5" />
                              : <Ban className="h-3.5 w-3.5" />}
                          {hasBlockedIp ? '移出' : '拉黑'}
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500">{formatDateTime(user.lastUsedAt)}</td>
                  </tr>
                  {isExpanded ? (
                    <tr className="bg-slate-50/80">
                      <td colSpan={10} className="px-4 py-3 sm:px-8">
                        <div className="overflow-x-auto border-l-2 border-emerald-500 pl-3">
                          <table className="w-full min-w-[720px] text-[10px]">
                            <thead className="text-slate-400">
                              <tr>
                                <th className="pb-2 text-left font-semibold">功能</th>
                                <th className="pb-2 text-left font-semibold">服务 / 模型</th>
                                <th className="pb-2 text-right font-semibold">调用</th>
                                <th className="pb-2 text-right font-semibold">积分</th>
                                <th className="pb-2 text-right font-semibold">输入</th>
                                <th className="pb-2 text-right font-semibold">输出</th>
                                <th className="pb-2 text-right font-semibold">思考</th>
                                <th className="pb-2 text-right font-semibold">总 Token</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                              {user.details.map(detail => (
                                <tr key={`${detail.provider}-${detail.feature}-${detail.model}`}>
                                  <td className="py-2 pr-3 font-semibold text-slate-700">{detail.feature}</td>
                                  <td className="py-2 pr-3 text-slate-500">{providerLabel(detail.provider)} · {detail.model}</td>
                                  <td className="py-2 text-right font-mono">{formatInteger(detail.requests)}</td>
                                  <td className="py-2 text-right font-mono">{detail.provider === 'elevenlabs' ? formatCredits(detail.credits) : '-'}</td>
                                  <td className="py-2 text-right font-mono">{detail.provider === 'elevenlabs' ? '-' : formatInteger(detail.inputTokens)}</td>
                                  <td className="py-2 text-right font-mono">{detail.provider === 'elevenlabs' ? '-' : formatInteger(detail.outputTokens)}</td>
                                  <td className="py-2 text-right font-mono">{detail.provider === 'elevenlabs' ? '-' : formatInteger(detail.reasoningTokens)}</td>
                                  <td className="py-2 text-right font-mono font-semibold text-slate-700">{detail.provider === 'elevenlabs' ? '-' : formatInteger(detail.totalTokens)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {users.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-400">当前周期还没有可归属的 AI 用量。</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type ModelUsageRow = {
  provider: typeof PROVIDERS[number];
  model: string;
  amount: number;
  unit: '积分' | 'Token';
};

function ModelUsageTable({ rows }: { rows: ModelUsageRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-col gap-1 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-xs font-bold text-slate-700">按模型统计</h3>
        <p className="text-[10px] text-slate-400">ElevenLabs 按积分统计；Gemini / GPT 按总 Token 统计。</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-[11px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-2.5 font-semibold">服务</th>
              <th className="px-3 py-2.5 font-semibold">模型</th>
              <th className="px-3 py-2.5 text-right font-semibold">单位</th>
              <th className="px-4 py-2.5 text-right font-semibold">使用量</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(row => {
              const Icon = row.provider.icon;
              return (
                <tr key={`${row.provider.key}-${row.model}`} className="text-slate-600">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2 font-semibold text-slate-800">
                      <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${row.provider.iconClass}`}>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      {row.provider.label}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-mono text-slate-600">{row.model}</td>
                  <td className="px-3 py-3 text-right text-slate-400">{row.unit}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">
                    {row.unit === '积分' ? formatCredits(row.amount) : formatInteger(row.amount)}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400">当前周期还没有模型使用量。</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type UsageDashboardProps = {
  blacklistedIps: string[];
  blacklistLoading: boolean;
  blacklistUpdatingUserId: string | null;
  blacklistFeedback: string | null;
  onSetMemberBlacklist: (user: UsageUser, shouldBlock: boolean) => void;
};

export default function UsageDashboard({
  blacklistedIps,
  blacklistLoading,
  blacklistUpdatingUserId,
  blacklistFeedback,
  onSetMemberBlacklist,
}: UsageDashboardProps) {
  const [period, setPeriod] = useState<UsagePeriod>('week');
  const [customStart, setCustomStart] = useState(() => formatDateInputValue(getElevenLabsBillingCycleStart()));
  const [customEnd, setCustomEnd] = useState(() => formatDateInputValue(new Date()));
  const [view, setView] = useState<'features' | 'members' | 'models'>('features');
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [billingCycleSummary, setBillingCycleSummary] = useState<UsageSummary | null>(null);
  const [quotaSummary, setQuotaSummary] = useState<ElevenLabsQuotaSummary | null>(null);
  const [quotaUpdatingUserId, setQuotaUpdatingUserId] = useState<string | null>(null);
  const [accountQuotaUpdating, setAccountQuotaUpdating] = useState(false);
  const [quotaFeedback, setQuotaFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    const billingCycleStart = getElevenLabsBillingCycleStart();
    const customStartDate = parseDateInputStart(customStart);
    const customEndDate = parseDateInputEnd(customEnd);
    const selectedStart = period === 'custom'
      ? customStartDate
      : undefined;
    const selectedEnd = period === 'custom'
      ? customEndDate
      : undefined;
    if (period === 'custom' && (!selectedStart || !selectedEnd || selectedStart > selectedEnd)) {
      setError('请选择有效的自定义统计周期');
      setIsLoading(false);
      return () => controller.abort();
    }
    Promise.all([
      period === 'custom' && selectedStart && selectedEnd
        ? fetchUsageSummaryRange(selectedStart, selectedEnd, controller.signal)
        : fetchUsageSummary(period, controller.signal),
      fetchUsageSummaryRange(billingCycleStart, new Date(), controller.signal),
      fetchElevenLabsQuotaSummary(controller.signal),
    ])
      .then(([periodSummary, cycleSummary, currentQuotaSummary]) => {
        setSummary(periodSummary);
        setBillingCycleSummary(cycleSummary);
        setQuotaSummary(currentQuotaSummary);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : '无法读取用量统计');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [period, customStart, customEnd, refreshKey]);

  const rows = useMemo(() => summary ? PROVIDERS.flatMap(provider => (
    summary.providers[provider.key].features.map(feature => ({ provider, feature }))
  )).sort((left, right) => {
    const leftAmount = left.provider.key === 'elevenLabs' ? left.feature.credits : left.feature.totalTokens;
    const rightAmount = right.provider.key === 'elevenLabs' ? right.feature.credits : right.feature.totalTokens;
    return rightAmount - leftAmount;
  }) : [], [summary]);

  const modelRows = useMemo(() => summary ? PROVIDERS.flatMap(provider => (
    summary.providers[provider.key].models.map(model => ({
      provider,
      model: model.model,
      amount: model.amount,
      unit: provider.key === 'elevenLabs' ? '积分' as const : 'Token' as const,
    }))
  )).sort((left, right) => right.amount - left.amount) : [], [summary]);

  const refresh = useCallback(() => setRefreshKey(value => value + 1), []);
  const toggleMember = useCallback((userId: string) => {
    setExpandedUserId(current => current === userId ? null : userId);
  }, []);
  const updateQuotaBonus = useCallback(async (user: ElevenLabsQuotaUser, bonusCredits: number) => {
    setQuotaUpdatingUserId(user.userId);
    setQuotaFeedback(null);
    try {
      const nextSummary = await setElevenLabsQuotaBonus(user.userId, bonusCredits);
      setQuotaSummary(nextSummary);
      setQuotaFeedback({
        message: `已将 ${user.displayName} 的本月额度调整为 ${formatInteger(user.baseCredits + bonusCredits)}。`,
        error: false,
      });
    } catch (reason) {
      setQuotaFeedback({
        message: reason instanceof Error ? reason.message : '更新成员配额失败。',
        error: true,
      });
    } finally {
      setQuotaUpdatingUserId(null);
    }
  }, []);
  const updateAccountQuotaTotal = useCallback(async (totalCredits: number) => {
    setAccountQuotaUpdating(true);
    setQuotaFeedback(null);
    try {
      const nextSummary = await setElevenLabsAccountQuotaTotal(totalCredits);
      setQuotaSummary(nextSummary);
      setQuotaFeedback({
        message: `已将本账期总额度调整为 ${formatInteger(totalCredits)}。`,
        error: false,
      });
      return true;
    } catch (reason) {
      setQuotaFeedback({
        message: reason instanceof Error ? reason.message : '更新本账期总额度失败。',
        error: true,
      });
      return false;
    } finally {
      setAccountQuotaUpdating(false);
    }
  }, []);
  const elevenLabsBillingCycle = useMemo(() => {
    if (!billingCycleSummary) return undefined;
    const usage = billingCycleSummary.providers.elevenLabs;
    return {
      start: getElevenLabsBillingCycleStart(),
      credits: usage.credits,
      requests: usage.requests,
    };
  }, [billingCycleSummary]);

  return (
    <section className="border-t border-slate-200 pt-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900">本工具 AI 用量</h2>
          <p className="mt-1 text-[11px] text-slate-500">仅统计通过 AI Audio 发出的请求，不包含同一账户在其他工具中的使用量。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex h-9 rounded-lg border border-slate-200 bg-white p-1" aria-label="统计周期">
            {PERIOD_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPeriod(option.value)}
                className={`min-w-16 rounded-md px-3 text-xs font-semibold transition ${period === option.value ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {period === 'custom' ? (
            <div className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[11px] text-slate-500">
              <input
                type="date"
                value={customStart}
                onChange={event => setCustomStart(event.target.value)}
                className="h-7 rounded-md border border-slate-200 px-2 text-[11px] text-slate-700 outline-none focus:border-emerald-300"
                aria-label="统计开始日期"
              />
              <span>至</span>
              <input
                type="date"
                value={customEnd}
                onChange={event => setCustomEnd(event.target.value)}
                className="h-7 rounded-md border border-slate-200 px-2 text-[11px] text-slate-700 outline-none focus:border-emerald-300"
                aria-label="统计结束日期"
              />
            </div>
          ) : null}
          <button
            type="button"
            onClick={refresh}
            disabled={isLoading}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50"
            aria-label="刷新用量"
            title="刷新用量"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {isLoading && !summary ? (
        <div className="flex min-h-40 items-center justify-center text-xs text-slate-500" role="status">
          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />正在读取本工具用量...
        </div>
      ) : summary ? (
        <>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {PROVIDERS.map(provider => (
              <div key={provider.key} className="h-full">
                <ProviderSummary
                  provider={provider}
                  usage={summary.providers[provider.key]}
                  billingCycle={provider.key === 'elevenLabs' ? elevenLabsBillingCycle : undefined}
                />
              </div>
            ))}
          </div>

          <div className="mt-4 inline-flex h-9 rounded-lg border border-slate-200 bg-white p-1" aria-label="统计维度">
            <button
              type="button"
              onClick={() => setView('features')}
              className={`inline-flex min-w-24 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition ${view === 'features' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              按功能
            </button>
            <button
              type="button"
              onClick={() => setView('members')}
              className={`inline-flex min-w-24 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition ${view === 'members' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              <Users className="h-3.5 w-3.5" />
              按成员
            </button>
            <button
              type="button"
              onClick={() => setView('models')}
              className={`inline-flex min-w-24 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition ${view === 'models' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              <Cpu className="h-3.5 w-3.5" />
              按模型
            </button>
          </div>

          <div className="mt-3">
            {view === 'members' ? (
              <MemberUsageTable
                users={summary.users || []}
                expandedUserId={expandedUserId}
                onToggle={toggleMember}
                blacklistedIps={blacklistedIps}
                blacklistLoading={blacklistLoading}
                blacklistUpdatingUserId={blacklistUpdatingUserId}
                blacklistFeedback={blacklistFeedback}
                onSetMemberBlacklist={onSetMemberBlacklist}
              />
            ) : view === 'models' ? (
              <ModelUsageTable rows={modelRows} />
            ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-xs font-bold text-slate-700">按功能明细</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-[11px]">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">功能</th>
                    <th className="px-3 py-2.5 font-semibold">服务 / 模型</th>
                    <th className="px-3 py-2.5 text-right font-semibold">调用</th>
                    <th className="px-3 py-2.5 text-right font-semibold">积分</th>
                    <th className="px-3 py-2.5 text-right font-semibold">输入 Token</th>
                    <th className="px-3 py-2.5 text-right font-semibold">输出 Token</th>
                    <th className="px-3 py-2.5 text-right font-semibold">思考 Token</th>
                    <th className="px-4 py-2.5 text-right font-semibold">总 Token</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(({ provider, feature }) => (
                    <tr key={`${provider.key}-${feature.feature}`} className="text-slate-600">
                      <td className="px-4 py-3 font-semibold text-slate-800">{feature.feature}</td>
                      <td className="px-3 py-3">
                        <span className="font-semibold">{provider.label}</span>
                        <span className="ml-1 text-slate-400">{feature.models.map(item => item.model).join(', ')}</span>
                      </td>
                      <td className="px-3 py-3 text-right font-mono">{formatInteger(feature.requests)}</td>
                      <td className="px-3 py-3 text-right font-mono">{provider.key === 'elevenLabs' ? formatCredits(feature.credits) : '-'}</td>
                      <td className="px-3 py-3 text-right font-mono">{provider.key === 'elevenLabs' ? '-' : formatInteger(feature.inputTokens)}</td>
                      <td className="px-3 py-3 text-right font-mono">{provider.key === 'elevenLabs' ? '-' : formatInteger(feature.outputTokens)}</td>
                      <td className="px-3 py-3 text-right font-mono">{provider.key === 'elevenLabs' ? '-' : formatInteger(feature.reasoningTokens)}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-slate-800">{provider.key === 'elevenLabs' ? '-' : formatInteger(feature.totalTokens)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">当前周期还没有本工具产生的 AI 用量。</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
            )}
          </div>

          <p className="mt-3 text-[10px] leading-5 text-slate-400">
            精细功能分类自 {formatDateTime(summary.detailedSince)} 开始；成员归属自 {formatDateTime(summary.identitySince)} 开始。更早的记录显示为“升级前未分类 / 历史未识别用户”。
          </p>

          {quotaSummary ? (
            <QuotaManagement
              summary={quotaSummary}
              updatingUserId={quotaUpdatingUserId}
              accountTotalUpdating={accountQuotaUpdating}
              feedback={quotaFeedback}
              onSetBonus={updateQuotaBonus}
              onSetAccountTotal={updateAccountQuotaTotal}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
