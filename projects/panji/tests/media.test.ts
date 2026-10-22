import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectMp4, readBoundedVideo, uploadSignatureExpiry } from '../cloudfunctions/panji/media';
import { MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS } from '../src/shared/domain';
function atom(kind: string, data: Buffer) { const b = Buffer.alloc(data.length + 8); b.writeUInt32BE(b.length); b.write(kind, 4); data.copy(b, 8); return b; }
function movie(seconds = 30, version = 0) {
  const header = Buffer.alloc(version === 1 ? 32 : 20); header[0] = version;
  header.writeUInt32BE(1000, version === 1 ? 20 : 12);
  if (version === 1) header.writeBigUInt64BE(BigInt(seconds * 1000), 24); else header.writeUInt32BE(seconds * 1000, 16);
  return Buffer.concat([atom('ftyp', Buffer.from('isom0000')), atom('moov', atom('mvhd', header)), atom('mdat', Buffer.alloc(8))]);
}
test('服务端读取 MP4 v0/v1 的真实时长', () => { for (const v of [0, 1]) { const b = movie(30, v); assert.deepEqual(inspectMp4(b), { durationSec: 30, byteSize: b.length }); } });
test('服务端接受旧视频、61秒与300秒，严格拒绝超过5分钟和100MiB', () => {
  for (const seconds of [60, 61, MAX_VIDEO_SECONDS]) assert.equal(inspectMp4(movie(seconds)).durationSec, seconds);
  const padded = Buffer.alloc(MAX_VIDEO_BYTES + 1), source = movie(MAX_VIDEO_SECONDS);
  source.copy(padded); padded.writeUInt32BE(MAX_VIDEO_BYTES - source.length, source.length); padded.write('free', source.length + 4);
  assert.equal(inspectMp4(padded.subarray(0, MAX_VIDEO_BYTES)).byteSize, MAX_VIDEO_BYTES);
  assert.throws(() => inspectMp4(padded));
  assert.throws(() => inspectMp4(movie(MAX_VIDEO_SECONDS + 0.001)));
});
test('拒绝伪格式、损坏头和缺失时间信息', () => {
  for (const b of [Buffer.from('not a video'), movie().subarray(0, 35), atom('ftyp', Buffer.alloc(40))]) assert.throws(() => inspectMp4(b));
});
test('云端媒体下载拒绝声明或实际内容超过新大小上限', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(new Uint8Array(1), { headers: { 'content-length': String(MAX_VIDEO_BYTES + 1) } });
    await assert.rejects(readBoundedVideo('https://synthetic.invalid/video.mp4'), /超过 100 MB/);
    globalThis.fetch = async () => new Response(new Uint8Array(MAX_VIDEO_BYTES + 1));
    await assert.rejects(readBoundedVideo('https://synthetic.invalid/video.mp4'), /超过 100 MB/);
  } finally { globalThis.fetch = original; }
});
test('上传票据必须有可验证的时效，拒绝过期、未知格式与超过一小时的签名', () => {
  const now = Date.parse('2026-10-19T04:00:00Z'); const seconds = now / 1000;
  assert.equal(uploadSignatureExpiry(`q-sign-time=${seconds};${seconds + 600}`, now), '2026-10-19T04:10:00.000Z');
  for (const auth of ['unknown-format', `q-sign-time=${seconds - 600};${seconds - 1}`, `q-sign-time=${seconds};${seconds + 7200}`]) assert.throws(() => uploadSignatureExpiry(auth, now));
});
