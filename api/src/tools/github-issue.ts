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
  return res.ok;
}