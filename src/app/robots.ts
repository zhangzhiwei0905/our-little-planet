import type { MetadataRoute } from "next";

/** 这本手账是私密的，谢绝一切搜索引擎 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
