import { Coins } from 'lucide-react';
import { estimateBatchSfxCost } from '../services/sfxBatchBilling';
import { SOUND_EFFECT_POINTS_PER_SECOND } from '../services/companyPointRates';
import type { SfxBatchRequirement } from '../services/sfxBatch';

type CostRow = Pick<SfxBatchRequirement, 'duration' | 'keywords' | 'description' | 'searchQuery'> & { searchQuerySource?: string };
const format = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);

export default function BatchSfxCostHint({ rows, kind, compact = false, inline = false }: {
  rows: readonly CostRow[]; kind: 'search' | 'generate'; compact?: boolean; inline?: boolean;
}) {
  const cost = estimateBatchSfxCost(rows);
  const label = !rows.length ? ''
    : kind === 'search' ? '搜索成功整批共 1 积分，全部未找到不扣搜索积分'
    : cost.generationPoints === null ? '请将每条时长设为 0.5～30 秒'
    : `AI 生成预计 ${format(cost.generationPoints)} 积分${compact ? '' : `（${rows.length} 条，共 ${format(cost.seconds)} 秒）`}`;
  return <div className={`${inline ? 'flex items-center gap-3 whitespace-nowrap' : 'space-y-1'} text-[10px] leading-relaxed text-amber-700`} aria-label={kind === 'search' ? '搜索积分预估' : '生成积分预估'}>
    {label && <span className={`inline-flex ${inline ? 'items-center' : 'items-start'} gap-1 font-semibold`}><Coins size={12} className={`${inline ? '' : 'mt-0.5'} shrink-0`} />{label}</span>}
    {!compact && kind === 'generate' && <p>{SOUND_EFFECT_POINTS_PER_SECOND} 分/秒/版本，按实际生成时长结算；每条生成 1 版。</p>}
    {!!rows.length && !!cost.queryConversions && <p>{cost.queryConversions} 条关键词需 AI 转换，按实际 Token 另计。</p>}
  </div>;
}
