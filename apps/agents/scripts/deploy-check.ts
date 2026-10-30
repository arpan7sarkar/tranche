import { type DeploymentRole, deploymentIssues } from "../src/deployment/config";

const role = process.argv[2];
if (!["web", "worker"].includes(role ?? "")) throw new Error("Usage: deploy:check web|worker");
const issues = deploymentIssues(role as DeploymentRole);
console.log(JSON.stringify({ role, ok: issues.length === 0, issues }));
process.exitCode = issues.length ? 1 : 0;
