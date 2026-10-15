// configure-pages supplies an empty base path for a custom domain and /repo for
// a project URL. Keep assets, favicon, and the app manifest on the same path.
export function dashboardBasePath(env = process.env) {
  if (env.GITHUB_ACTIONS !== "true") return "";
  const repository = env.GITHUB_REPOSITORY?.split("/")[1] ?? "smooth-studios-team-portal";
  return env.GITHUB_PAGES_BASE_PATH ?? `/${repository}`;
}
