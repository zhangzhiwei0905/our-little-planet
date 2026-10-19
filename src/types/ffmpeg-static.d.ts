// ffmpeg-static 是可选依赖（生产服务器用 FFMPEG_PATH 指向自带二进制），本地没装时这个声明兜底
declare module "ffmpeg-static" {
  const ffmpegPath: string | null;
  export default ffmpegPath;
}
