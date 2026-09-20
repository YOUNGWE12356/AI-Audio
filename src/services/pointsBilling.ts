import type express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { PointsStore, type PointsActor } from './pointsStore';

export const POINTS_RULES = [
  ['AI 音效', '2 分/条/版本'], ['AI 音乐', '9 分/分钟/版本'], ['云端配音', '1 分/100 字符'],
  ['云端变声、人声提取', '10 分/输入分钟'], ['语音转文字', '4 分/输入分钟'],
  ['翻译配音', '转录积分 + 配音字符积分，翻译免费'], ['本地克隆、Seed-VC、音频转 MIDI', '3 分/分钟'],
  ['Demucs 分轨', '2 分/输入分钟，包含全部轨道'], ['高质量六轨分离', '5 分/输入分钟，包含六轨'],
  ['试听、下载、混音、普通导出及 FFmpeg 基础分离', '免费'],
];
export const timedPoints = (seconds: number, rate: number) => Math.max(1, Math.ceil(seconds * rate / 60));
export const textPoints = (text: string) => Math.max(1, Math.ceil(Array.from(text.trim()).length / 100));

export async function mediaSeconds(file: Express.Multer.File, binary: string, tempDir: string) {
  let temporary = '';
  const filePath = file.path || (temporary = path.join(tempDir, `.points-probe-${randomUUID()}`));
  if (temporary) await fs.promises.writeFile(temporary, file.buffer);
  try {
    const stderr = await new Promise<string>((resolve, reject) => {
      execFile(binary, ['-hide_banner', '-i', filePath], { timeout: 20_000, maxBuffer: 2 * 1024 * 1024 }, (error, _out, diagnostic) => {
        if (error && (error as any).killed) return reject(new Error('无法读取音频时长，请重新上传。'));
        resolve(String(diagnostic));
      });
    });
    const duration = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    const seconds = duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : 0;
    if (!Number.isFinite(seconds) || seconds <= 0) throw Object.assign(new Error('无法读取媒体时长，未扣除积分。'), { status: 400 });
    return seconds;
  } finally {
    if (temporary) await fs.promises.unlink(temporary).catch(() => undefined);
  }
}

type Quote = { points: number; feature: string; detail: string; actual?: (body: any) => number };
export function pointsMiddleware(store: PointsStore, actor: (req: express.Request, res: express.Response) => PointsActor,
  quote: (req: express.Request, res: express.Response) => Promise<Quote> | Quote): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve().then(() => quote(req, res)).then(pricing => {
      const id = store.reserve(actor(req, res), pricing.points, pricing.feature, pricing.detail);
      res.setHeader('X-Creation-Points-Reserved', pricing.points);
      let body: any;
      let settled = false;
      const json = res.json;
      res.json = function (value) { body = value; return json.call(this, value); };
      const end = res.end;
      res.end = function (...args: any[]) {
        if (!settled) {
          const success = res.statusCode >= 200 && res.statusCode < 300;
          const actual = success ? pricing.actual?.(body) ?? pricing.points : 0;
          store.finish(id, actual, success ? pricing.detail : '任务失败，退回冻结积分');
          settled = true;
          if (!res.headersSent) res.setHeader('X-Creation-Points-Charged', Math.min(actual, pricing.points));
        }
        return end.apply(this, args);
      } as typeof res.end;
      next();
    }).catch(next);
  };
}
