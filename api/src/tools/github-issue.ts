import { config } from "../config.js";

export interface CreateIssueArgs {
  owner: string;
  repo: string;
  title: string;
  body: string;
}

export interface CreateIssueResult {
  issueNumber: number;
  url: string;
}

/** Validate the configured demo target before resetting a run or issuing a write. */
export async function verifyGithubRepository(): Promise<void> {
  if (!config.githubToken) throw new Error("Set GITHUB_TOKEN in api/.env");
  const owner = config.githubAllowedOwner || config.githubOwner;
  if (!owner || !config.githubRepo) throw new Error("Set GITHUB_ALLOWED_OWNER and GITHUB_DEMO_REPO in api/.env");
  const res = await fetch(`https://api.github.com/repos/${owner}/${config.githubRepo}`, {
    headers: {
      Authorization: `Bearer ${config.githubToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "sentinel-hackathon-demo",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`GitHub repository access failed (${res.status})`);
  const repo = await res.json() as { private: boolean; has_issues: boolean };
  if (config.githubRequirePrivate && !repo.private) throw new Error("Demo repo must be private; explicitly set GITHUB_REQUIRE_PRIVATE=false for synthetic public demos");
  if (!repo.has_issues) throw new Error("Enable GitHub Issues on the demo repository");
}

export async function githubCreateIssue(
  args: CreateIssueArgs,
): Promise<CreateIssueResult> {
  if (!config.githubToken) {
    throw new Error("GITHUB_TOKEN not configured");
  }
  const res = await fetch(
    `https://api.github.com/repos/${args.owner}/${args.repo}/issues`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.githubToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "sentinel-hackathon-demo",
      },
      body: JSON.stringify({ title: args.title, body: args.body }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { number: number; html_url: string };
  return { issueNumber: data.number, url: data.html_url };
}

export async function githubVerifyIssue(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<boolean> {
  if (!config.githubToken) return false;
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
    {
      headers: {
        Authorization: `Bearer ${config.githubToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "sentinel-hackathon-demo",
      },
    },
  );
  if (!res.ok) return false;
  const issue = await res.json() as { number?: number; pull_request?: unknown };
  return issue.number === issueNumber && !issue.pull_request;
}
