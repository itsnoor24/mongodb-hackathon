import { config } from "../src/config.js";

/** Pipe any command's stdout here. No source SDK or agent permissions required. */
async function main() {
  const base = `http://localhost:${config.port}/api/streams`;
  const headers = { Authorization: `Bearer ${config.agentApiKey}` };
  let id = process.argv[2];
  if (!id) {
    const response = await fetch(base, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ label: "Piped agent output" }) });
    if (!response.ok) throw new Error(await response.text());
    id = (await response.json() as { stream: { _id: string } }).stream._id;
  }
  console.error(`Observing stream ${id}: http://localhost:5173/?stream=${encodeURIComponent(id)}`);
  const response = await fetch(`${base}/${encodeURIComponent(id)}/text`, {
    method: "POST", headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
    body: process.stdin as unknown as BodyInit,
    duplex: "half",
  } as RequestInit & { duplex: string });
  if (!response.ok) throw new Error(await response.text());
  console.error(JSON.stringify(await response.json()));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
