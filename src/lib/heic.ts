import sharp from "sharp";

/** HEIC/HEIF 转 JPEG（服务端）。
 *  sharp 的预编译版读不了 HEVC 压缩的 HEIC 像素数据，
 *  所以解码走 heic-convert（WASM 版 libheif），再用 sharp 摆正方向、压边长、输出 JPEG。
 *  HEIC 在桌面 Chrome/Firefox 里显示不了，转成 JPG 后所有端都能看。 */
export async function heicToJpeg(input: Buffer): Promise<{ buf: Buffer; width: number; height: number }> {
  const { default: convert } = await import("heic-convert");
  const decoded = await convert({ buffer: input, format: "JPEG", quality: 0.92 });
  const out = await sharp(decoded)
    .rotate()
    .resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  return { buf: out.data, width: out.info.width, height: out.info.height };
}
