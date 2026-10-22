import { ensure, MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS } from '../../src/shared/domain';

/** Parse the ISO BMFF movie header rather than trusting the client's duration. */
export function inspectMp4(bytes: Buffer): { durationSec: number; byteSize: number } {
  ensure(bytes.length >= 24 && bytes.length <= MAX_VIDEO_BYTES, 'VALIDATION_ERROR', '视频大小不符合限制');
  ensure(bytes.toString('ascii', 4, 8) === 'ftyp', 'VALIDATION_ERROR', '请转换为兼容的 MP4/MOV 视频后重试');
  let duration = 0;
  function atoms(from: number, end: number, depth: number): void {
    if (depth > 3) return;
    for (let at = from; at + 8 <= end;) {
      let size = bytes.readUInt32BE(at); const kind = bytes.toString('ascii', at + 4, at + 8); let header = 8;
      if (size === 1) {
        ensure(at + 16 <= end, 'VALIDATION_ERROR', '视频文件头不完整');
        const n = bytes.readBigUInt64BE(at + 8); ensure(n <= BigInt(MAX_VIDEO_BYTES), 'VALIDATION_ERROR', '视频文件头无效');
        size = Number(n); header = 16;
      }
      if (size === 0) size = end - at;
      ensure(size >= header && at + size <= end, 'VALIDATION_ERROR', '视频文件不完整');
      if (kind === 'moov') atoms(at + header, at + size, depth + 1);
      if (kind === 'mvhd') {
        const p = at + header; const version = bytes[p];
        ensure((version === 0 || version === 1) && p + (version === 1 ? 32 : 20) <= at + size, 'VALIDATION_ERROR', '视频时间信息无效');
        const timescale = bytes.readUInt32BE(p + (version === 1 ? 20 : 12));
        const ticks = version === 1 ? Number(bytes.readBigUInt64BE(p + 24)) : bytes.readUInt32BE(p + 16);
        ensure(timescale > 0, 'VALIDATION_ERROR', '视频时间信息无效'); duration = ticks / timescale;
      }
      at += size;
    }
  }
  atoms(0, bytes.length, 0);
  ensure(Number.isFinite(duration) && duration > 0 && duration <= MAX_VIDEO_SECONDS, 'VALIDATION_ERROR', `视频时长须为 ${MAX_VIDEO_SECONDS / 60} 分钟以内`);
  return { durationSec: duration, byteSize: bytes.length };
}
export async function readBoundedVideo(url: string): Promise<Buffer> {
  ensure(url.startsWith('https://'), 'VALIDATION_ERROR', '视频下载地址无效');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'error' });
    ensure(response.ok && response.body, 'VIDEO_UNAVAILABLE', '视频尚未成功上传，请重新选择');
    const length = Number(response.headers.get('content-length'));
    ensure(!length || length <= MAX_VIDEO_BYTES, 'VALIDATION_ERROR', `视频超过 ${MAX_VIDEO_BYTES / 1024 / 1024} MB`);
    const chunks: Buffer[] = []; let total = 0;
    const reader = response.body.getReader();
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      total += value.length;
      if (total > MAX_VIDEO_BYTES) { await reader.cancel(); throw new Error(`视频超过 ${MAX_VIDEO_BYTES / 1024 / 1024} MB`); }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally { clearTimeout(timer); }
}
export function uploadSignatureExpiry(authorization: string, nowMs = Date.now()): string {
  const params = new URLSearchParams(authorization);
  const value = params.get('q-sign-time') || params.get('q-key-time') || '';
  const [start, end] = value.split(';').map(Number);
  ensure(Number.isFinite(start) && Number.isFinite(end) && start <= nowMs / 1000 + 60 && end > nowMs / 1000,
    'UPLOAD_UNAVAILABLE', '当前云存储签名格式或时效未通过验证');
  ensure(end * 1000 - nowMs <= 3600000, 'UPLOAD_UNAVAILABLE', '上传签名有效期超过安全限制，暂时关闭上传');
  return new Date(end * 1000).toISOString();
}
