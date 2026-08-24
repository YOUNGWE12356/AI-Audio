import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, ChevronDown, Coins, Laptop, RefreshCw, Sparkles, TriangleAlert, Users } from 'lucide-react';
import {
  fetchUsageSummary,
  ProviderUsage,
  UsagePeriod,
  UsageProviderName,
  UsageSummary,
  UsageUser,
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

function ProviderSummary({ provider, usage }: { provider: typeof PROVIDERS[number]; usage: ProviderUsage }) {
  const Icon = provider.icon;
  const primaryValue = provider.key === 'elevenLabs' ? formatCredits(usage.credits) : formatInteger(usage.totalTokens);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
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
        <p className="text-[10px] text-slate-400">{provider.key === 'elevenLabs' ? 'Credits' : '总 Token'}</p>
        <p className="mt-1 font-mono text-2xl font-semibold text-slate-900">{primaryValue}</p>
      </div>
      {provider.key !== 'elevenLabs' ? (
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-[10px]">
          <span className="text-slate-400">输入 <b className="block font-mono text-xs text-slate-700">{formatInteger(usage.inputTokens)}</b></span>
          <span className="text-slate-400">输出 <b className="block font-mono text-xs text-slate-700">{formatInteger(usage.outputTokens)}</b></span>
          <span className="text-slate-400">思考 <b className="block font-mono text-xs text-slate-700">{formatInteger(usage.reasoningTokens)}</b></span>
        </div>
      ) : usage.unmeteredRequests > 0 ? (
        <p className="mt-3 border-t border-slate-100 pt-3 text-[10px] text-amber-700">
          {usage.unmeteredRequests} 次响应未返回 credit 计费头，已记调用但未计入 credits。
        </p>
      ) : null}
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
}: {
  users: UsageUser[];
  expandedUserId: string | null;
  onToggle: (userId: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-col gap-1 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-xs font-bold text-slate-700">按成员汇总</h3>
        <p className="text-[10px] text-slate-400">当前以设备区分；接入飞书后自动归入真实成员</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-left text-[11px]">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-2.5 font-semibold">成员 / 设备</th>
              <th className="px-3 py-2.5 font-semibold">身份来源</th>
              <th className="px-3 py-2.5 text-right font-semibold">调用</th>
              <th className="px-3 py-2.5 text-right font-semibold">ElevenLabs Credits</th>
              <th className="px-3 py-2.5 text-right font-semibold">Gemini Token</th>
              <th className="px-3 py-2.5 text-right font-semibold">GPT Token</th>
              <th className="px-3 py-2.5 text-right font-semibold">总 Token</th>
              <th className="px-4 py-2.5 text-right font-semibold">最后使用</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map(user => {
              const isExpanded = expandedUserId === user.userId;
              const sourceLabel = user.identitySource === 'feishu'
                ? (user.department || '飞书认证')
                : user.identitySource === 'device' ? '待飞书登录' : '历史未识别';
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
                    <td className="px-3 py-3 text-right font-mono">{formatInteger(user.requests)}</td>
                    <td className="px-3 py-3 text-right font-mono">{formatCredits(user.elevenLabsCredits)}</td>
                    <td className="px-3 py-3 text-right font-mono">{formatInteger(user.geminiTokens)}</td>
                    <td className="px-3 py-3 text-right font-mono">{formatInteger(user.gptTokens)}</td>
                    <td className="px-3 py-3 text-right font-mono font-semibold text-slate-800">{formatInteger(user.totalTokens)}</td>
                    <td className="px-4 py-3 text-right text-slate-500">{formatDateTime(user.lastUsedAt)}</td>
                  </tr>
                  {isExpanded ? (
                    <tr className="bg-slate-50/80">
                      <td colSpan={8} className="px-4 py-3 sm:px-8">
                        <div className="overflow-x-auto border-l-2 border-emerald-500 pl-3">
                          <table className="w-full min-w-[720px] text-[10px]">
                            <thead className="text-slate-400">
                              <tr>
                                <th className="pb-2 text-left font-semibold">功能</th>
                                <th className="pb-2 text-left font-semibold">服务 / 模型</th>
                                <th className="pb-2 text-right font-semibold">调用</th>
                                <th className="pb-2 text-right font-semibold">Credits</th>
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
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">当前周期还没有可归属的 AI 用量。</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function UsageDashboard() {
  const [period, setPeriod] = useState<UsagePeriod>('week');
  const [view, setView] = useState<'features' | 'members'>('features');
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    fetchUsageSummary(period, controller.signal)
      .then(setSummary)
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : '无法读取用量统计');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [period, refreshKey]);

  const rows = useMemo(() => summary ? PROVIDERS.flatMap(provider => (
    summary.providers[provider.key].features.map(feature => ({ provider, feature }))
  )).sort((left, right) => {
    const leftAmount = left.provider.key === 'elevenLabs' ? left.feature.credits : left.feature.totalTokens;
    const rightAmount = right.provider.key === 'elevenLabs' ? right.feature.credits : right.feature.totalTokens;
    return rightAmount - leftAmount;
  }) : [], [summary]);

  const refresh = useCallback(() => setRefreshKey(value => value + 1), []);
  const toggleMember = useCallback((userId: string) => {
    setExpandedUserId(current => current === userId ? null : userId);
  }, []);

  return (
    <section className="border-t border-slate-200 pt-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900">本工具 AI 用量</h2>
          <p className="mt-1 text-[11px] text-slate-500">仅统计通过 AI Audio 发出的请求，不包含同一账户在其他工具中的使用量。</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex h-9 rounded-lg border border-slate-200 bg-white p-1" aria-label="统计周期">
            {(['week', 'month'] as const).map(value => (
              <button
                key={value}
                type="button"
                onClick={() => setPeriod(value)}
                className={`min-w-16 rounded-md px-3 text-xs font-semibold transition ${period === value ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                {value === 'week' ? '本周' : '本月'}
              </button>
            ))}
          </div>
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
              <div key={provider.key}>
                <ProviderSummary provider={provider} usage={summary.providers[provider.key]} />
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
          </div>

          <div className="mt-3">
            {view === 'members' ? (
              <MemberUsageTable
                users={summary.users || []}
                expandedUserId={expandedUserId}
                onToggle={toggleMember}
              />
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
                    <th className="px-3 py-2.5 text-right font-semibold">Credits</th>
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
        </>
      ) : null}
    </section>
  );
}
