export function repositoryAllowed(
  workspaceId: string,
  repo: string,
  raw = process.env.GITHUB_WORKSPACE_REPOSITORIES,
): boolean {
  if (!raw) return false;
  try {
    const mapping: unknown = JSON.parse(raw);
    if (!mapping || typeof mapping !== "object" || !Object.hasOwn(mapping, workspaceId))
      return false;
    const repos = (mapping as Record<string, unknown>)[workspaceId];
    return (
      Array.isArray(repos) &&
      repos.some((value) => typeof value === "string" && value.toLowerCase() === repo.toLowerCase())
    );
  } catch {
    return false;
  }
}
