import { useEffect, useMemo, useState } from 'react';
import { Coins } from 'lucide-react';

export type PointCostKind =
  | 'tts-standard'
  | 'tts-fast'
  | 'music'
  | 'sound-effect'
  | 'voice-changer'
  | 'audio-isolation'
  | 'speech-to-text'
  | 'dubbing-v2'
  | 'token';

const RATE = {
  'tts-standard': { unit: 'character', value: 0.1, label: '100 分 / 千字符' },
  'tts-fast': { unit: 'character', value: 0.05, label: '50 分 / 千字符' },
  music: { unit: 'second', value: 2.5, label: '2.5 分 / 秒 / 版本' },
  'sound-effect': { unit: 'second', value: 2, label: '2 分 / 秒 / 版本' },
  'voice-changer': { unit: 'second', value: 2, label: '120 分 / 分钟 / 版本' },
  'audio-isolation': { unit: 'second', value: 2, label: '120 分 / 分钟' },
  'speech-to-text': { unit: 'second', value: 36 / 60, label: '36 分 / 分钟' },
  'dubbing-v2': { unit: 'second', value: 2204 / 60, label: '约 2,204 分 / 源分钟' },
  token: { unit: 'token', value: 0, label: '按实际 Token 结算' },
} as const;

const countCharacters = (text: string) => Array.from(text.trim()).length;

export const estimateCompanyPoints = ({
  kind,
  text = '',
  durationSeconds,
  outputs = 1,
}: {
  kind: PointCostKind;
  text?: string;
  durationSeconds?: number;
  outputs?: number;
}) => {
  const rate = RATE[kind];
  if (rate.unit === 'token') return null;
  const quantity = rate.unit === 'character' ? countCharacters(text) : durationSeconds;
  if (!quantity || !Number.isFinite(quantity)) return null;
  return Math.max(0.1, quantity * rate.value * Math.max(1, outputs));
};

const formatPoints = (value: number) => new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: value < 10 ? 1 : 0,
}).format(value);

function useMediaDuration(file?: File | Blob | null) {
  const [duration, setDuration] = useState<number>();

  useEffect(() => {
    setDuration(undefined);
    if (!file || typeof document === 'undefined') return;
    const url = URL.createObjectURL(file);
    const media = document.createElement(String(file.type || '').startsWith('video/') ? 'video' : 'audio');
    media.preload = 'metadata';
    media.onloadedmetadata = () => {
      if (Number.isFinite(media.duration) && media.duration > 0) setDuration(media.duration);
      URL.revokeObjectURL(url);
    };
    media.onerror = () => URL.revokeObjectURL(url);
    media.src = url;
    return () => {
      media.removeAttribute('src');
      media.load();
      URL.revokeObjectURL(url);
    };
  }, [file]);

  return duration;
}

export default function PointCostHint({
  kind,
  text,
  durationSeconds,
  file,
  outputs = 1,
  className = '',
}: {
  kind: PointCostKind;
  text?: string;
  durationSeconds?: number;
  file?: File | Blob | null;
  outputs?: number;
  className?: string;
}) {
  const detectedDuration = useMediaDuration(durationSeconds ? null : file);
  const effectiveDuration = durationSeconds || detectedDuration;
  const points = useMemo(() => estimateCompanyPoints({
    kind,
    text,
    durationSeconds: effectiveDuration,
    outputs,
  }), [effectiveDuration, kind, outputs, text]);
  const rate = RATE[kind];
  const outputLabel = outputs > 1 ? `，含 ${outputs} 个版本` : '';
  const pendingLabel = rate.unit === 'character'
    ? '输入内容后显示预计积分'
    : '选择素材后显示预计积分';
  const label = kind === 'token'
    ? '按实际 Token 扣分'
    : points === null
      ? `${pendingLabel}${outputLabel}`
      : `预计 ${formatPoints(points)} 积分${outputLabel}`;

  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 ${className}`}
      title={`${rate.label}${outputLabel}`}
      aria-label={`${label}；计费标准：${rate.label}`}
    >
      <Coins className="h-3 w-3 shrink-0" />
      {label}
    </span>
  );
}
