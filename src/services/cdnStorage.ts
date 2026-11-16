import qiniu from 'qiniu';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export type CdnConfig = { accessKey: string; secretKey: string; bucket: string; domain: string };
export function readCdnConfig(env: NodeJS.ProcessEnv = process.env): CdnConfig {
  const config = { accessKey: env.QINIU_ACCESS_KEY?.trim(), secretKey: env.QINIU_SECRET_KEY?.trim(),
    bucket: env.QINIU_BUCKET?.trim(), domain: env.QINIU_CDN_DOMAIN?.trim().replace(/\/+$/, '') };
  if (Object.values(config).some(value => !value)) {
    throw Object.assign(new Error('请配置七牛 CDN 的 QINIU_ACCESS_KEY、QINIU_SECRET_KEY、QINIU_BUCKET、QINIU_CDN_DOMAIN。'),
      { code: 'CDN_NOT_CONFIGURED', status: 503 });
  }
  const url = new URL(config.domain!);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('QINIU_CDN_DOMAIN must be an HTTPS URL');
  return config as CdnConfig;
}

export function isCdnUrl(value: unknown, domain = process.env.QINIU_CDN_DOMAIN): boolean {
  if (typeof value !== 'string' || !domain) return false;
  try {
    const base = new URL(`${domain.replace(/\/+$/, '')}/`), url = new URL(value);
    return url.protocol === 'https:' && url.origin === base.origin && url.pathname.startsWith(base.pathname)
      && !url.username && !url.password && !url.search && !url.hash
      && !/%(?:2f|5c|2e)/i.test(url.pathname);
  } catch { return false; }
}

/** Same Qiniu SDK, bucket-scoped token and East China zone as kakavideogenerator. */
export async function uploadCdnFile(file: string, namespace = 'media', config = readCdnConfig()): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  const extension = path.extname(file).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12);
  const key = `ai-audio/${namespace}/${digest.digest('hex')}${extension}`;
  const mac = new qiniu.auth.digest.Mac(config.accessKey, config.secretKey);
  const token = new qiniu.rs.PutPolicy({ scope: `${config.bucket}:${key}`, expires: 3600 }).uploadToken(mac);
  const options = new qiniu.conf.Config();
  options.zone = qiniu.zone.Zone_z0;
  const uploader = new qiniu.form_up.FormUploader(options);
  await new Promise<void>((resolve, reject) => {
    uploader.putFile(token, key, file, new qiniu.form_up.PutExtra(), (error, _body, info) => {
      if (error || info?.statusCode !== 200) reject(Object.assign(new Error('CDN 上传失败，请重试。'),
        { code: 'CDN_UPLOAD_FAILED', status: 502 }));
      else resolve();
    });
  });
  return `${config.domain}/${key}`;
}

/** Only configured CDN URLs may be fetched; never follow redirects into private networks. */
export async function downloadCdnFile(url: string, destination: string, maxBytes = 100 * 1024 * 1024) {
  if (!isCdnUrl(url)) throw Object.assign(new Error('无效 CDN 文件地址。'), { status: 400 });
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(120_000), referrerPolicy: 'no-referrer' });
  if (!response.ok || !response.body) throw Object.assign(new Error('CDN 文件读取失败。'), { code: 'CDN_DOWNLOAD_FAILED', status: 502 });
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body.cancel(); throw new Error('CDN file exceeds size limit'); }
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${randomUUID()}.part`;
  const output = await fs.promises.open(temporary, 'wx', 0o600);
  try {
    let bytes = 0;
    for await (const chunk of response.body as any) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error('CDN file exceeds size limit');
      await output.writeFile(chunk);
    }
    await output.close();
    await fs.promises.rename(temporary, destination);
  } catch (error) {
    await output.close().catch(() => {});
    await fs.promises.unlink(temporary).catch(() => {});
    throw error;
  }
}
