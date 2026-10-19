declare module "heic-convert" {
  function convert(opts: {
    buffer: Buffer | Uint8Array;
    format: "JPEG" | "PNG";
    quality?: number;
  }): Promise<Buffer>;

  export default convert;
}
