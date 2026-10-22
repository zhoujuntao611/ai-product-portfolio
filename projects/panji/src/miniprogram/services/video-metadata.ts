import { MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS } from '../../shared/domain';

export interface SelectedVideo { tempFilePath?: unknown; size?: unknown; duration?: unknown; fileType?: unknown }
export class VideoMetadataError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'VideoMetadataError'; }
}
function positiveNumber(value: unknown): number | null {
  // Platform results are normally numbers. Some device/API combinations can
  // return numeric strings; never turn missing values, booleans or arrays into 0/1.
  if (typeof value === 'string') {
    if (!/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
    value = Number(value.trim());
  }
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
function bytes(value: unknown): number | null {
  const size = positiveNumber(value); return size !== null && Number.isSafeInteger(size) ? size : null;
}
async function fileBytes(filePath: string): Promise<number | null> {
  try {
    const manager = wx.getFileSystemManager();
    if (typeof manager.stat !== 'function') return null;
    const stats = await new Promise<WechatMiniprogram.Stats | WechatMiniprogram.FileStats[]>((resolve, reject) =>
      manager.stat({ path: filePath, recursive: false, success: result => resolve(result.stats), fail: reject }));
    return Array.isArray(stats) ? null : bytes(stats.size);
  } catch { return null; }
}
export async function readVideoMetadata(file: SelectedVideo): Promise<{ filePath: string; byteSize: number; durationSec: number }> {
  if (typeof file.tempFilePath !== 'string' || !file.tempFilePath.trim() || (file.fileType && file.fileType !== 'video')) {
    throw new VideoMetadataError('VIDEO_FILE_UNAVAILABLE', '未能取得视频文件，请重新从相册选择视频。');
  }
  const filePath = file.tempFilePath;
  const [info, actualBytes] = await Promise.all([
    (async () => { try { return await wx.getVideoInfo({ src: filePath }); } catch { return null; } })(),
    fileBytes(filePath),
  ]);
  // stat and chooseMedia both use bytes. getVideoInfo.size is kB and must never
  // be passed directly into byte-based limits, storage accounting or reservations.
  const byteSize = actualBytes ?? bytes(file.size);
  if (byteSize === null) throw new VideoMetadataError('VIDEO_SIZE_UNAVAILABLE', '未能读取视频大小，请确认视频已完整下载到相册后重新选择。');
  if (byteSize > MAX_VIDEO_BYTES) throw new VideoMetadataError('VIDEO_TOO_LARGE', `这段视频超过 ${MAX_VIDEO_BYTES / 1024 / 1024} MB，请先压缩或裁剪后重新选择。`);
  const inspected = positiveNumber(info?.duration), selected = positiveNumber(file.duration);
  if ((inspected !== null && inspected > MAX_VIDEO_SECONDS) || (selected !== null && selected > MAX_VIDEO_SECONDS)) {
    throw new VideoMetadataError('VIDEO_TOO_LONG', `这段视频超过 ${MAX_VIDEO_SECONDS / 60} 分钟，请先裁剪后重新选择。`);
  }
  const durationSec = inspected !== null && inspected >= 0.01 ? inspected : selected !== null && selected >= 0.01 ? selected : null;
  if (durationSec === null) throw new VideoMetadataError('VIDEO_DURATION_UNAVAILABLE', '未能读取视频时长，请先在相册确认可以完整播放，再重新选择；仍失败可另存为兼容的 MP4 后重试。');
  return { filePath, byteSize, durationSec };
}
