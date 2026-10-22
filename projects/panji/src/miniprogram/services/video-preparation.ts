import { readVideoMetadata, SelectedVideo, VideoMetadataError } from './video-metadata';
import { MAX_VIDEO_SECONDS } from '../../shared/domain';

async function trim(file: SelectedVideo): Promise<SelectedVideo> {
  if (typeof wx.openVideoEditor !== 'function') throw new VideoMetadataError('VIDEO_EDITOR_UNAVAILABLE', '当前微信不支持视频裁剪，请先在手机相册裁剪后重新选择。');
  const edited = await new Promise<WechatMiniprogram.OpenVideoEditorSuccessCallbackResult>((resolve,reject) =>
    wx.openVideoEditor({filePath: String(file.tempFilePath), minDuration:'1',maxDuration:String(MAX_VIDEO_SECONDS),success:resolve,fail:reject}));
  // The native editor reports milliseconds; chooseMedia/getVideoInfo use seconds.
  const milliseconds = Number(edited.duration);
  return {tempFilePath:edited.tempFilePath,size:edited.size,duration:Number.isFinite(milliseconds)&&milliseconds>0?milliseconds/1000:undefined,fileType:'video'};
}
async function compress(file: SelectedVideo): Promise<SelectedVideo> {
  if (typeof wx.compressVideo !== 'function') throw new VideoMetadataError('VIDEO_COMPRESS_UNAVAILABLE', '当前微信不支持视频压缩，请先在手机相册压缩后重新选择。');
  wx.showLoading({title:'正在压缩视频',mask:true});
  try {
    const result = await new Promise<WechatMiniprogram.CompressVideoSuccessCallbackResult>((resolve,reject) =>
      wx.compressVideo({src:String(file.tempFilePath),bitrate:1500,fps:30,resolution:1,success:resolve,fail:reject}));
    // Compression's size is kB. Read actual bytes from the output file instead.
    return {tempFilePath:result.tempFilePath,duration:file.duration,fileType:'video'};
  } finally { wx.hideLoading(); }
}
export async function prepareVideo(file: SelectedVideo, edit = false): Promise<Awaited<ReturnType<typeof readVideoMetadata>> | null> {
  let candidate = file;
  if (typeof candidate.tempFilePath !== 'string' || !candidate.tempFilePath) return readVideoMetadata(candidate);
  if (edit) {
    const choice = await wx.showActionSheet({itemList:['裁剪视频','压缩视频','裁剪后压缩']});
    if(choice.tapIndex===0)candidate=await trim(candidate);
    else if(choice.tapIndex===1)candidate=await compress(candidate);
    else if(choice.tapIndex===2)candidate=await compress(await trim(candidate));
    else return null;
  }
  // A clip may exceed both limits: allow compression followed by trimming,
  // validating the output after each step. Bound retries if processing fails.
  for(let attempt=0;attempt<3;attempt++){
    try {return await readVideoMetadata(candidate);}
    catch(error){
      const code=(error as {code?:string}).code;
      if(attempt>=2||!['VIDEO_TOO_LONG','VIDEO_TOO_LARGE'].includes(code||'')||typeof wx.showActionSheet!=='function')throw error;
      const tooLong=code==='VIDEO_TOO_LONG';
      const choice=await wx.showActionSheet({itemList:tooLong?[`裁剪到${MAX_VIDEO_SECONDS / 60}分钟内`,'裁剪后压缩','取消']:['压缩视频','裁剪视频','取消']});
      if(choice.tapIndex===2)return null;
      candidate=tooLong?(choice.tapIndex===0?await trim(candidate):await compress(await trim(candidate))):(choice.tapIndex===0?await compress(candidate):await trim(candidate));
    }
  }
  return null;
}
