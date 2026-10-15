import type { NextConfig } from "next";
import { dashboardBasePath } from "./lib/site-path.mjs";

const isGitHubPages = process.env.GITHUB_ACTIONS === "true";
const siteBasePath = dashboardBasePath();

const nextConfig: NextConfig = {
  output: isGitHubPages ? "export" : undefined,
  basePath: siteBasePath,
  assetPrefix: siteBasePath,
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
