import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export function renderMessage(message) {
  if (!message || typeof message.content !== "string" || !["user", "assistant"].includes(message.role)) {
    throw new Error("Expected conversation messages with user/assistant roles and text content");
  }
  const header = [message.role, message.id, message.kind].filter(Boolean).join(" · ");
  const choices = Array.isArray(message.options) ? message.options.filter(option => option != null) : [];
  const options = choices.length
    ? "\nOptions:\n" + choices.map(option => `- ${typeof option === "string" ? option : option.label ?? JSON.stringify(option)}`).join("\n")
    : "";
  return `[${header}]\n${message.content}${options}\n\n`;
}

async function main() {
  const fixture = JSON.parse(await readFile(new URL("./conversation-output.json", import.meta.url), "utf8"));
  if (!Array.isArray(fixture.messages)) throw new Error("Conversation fixture must contain messages[]");
  const rendered = fixture.messages.map(renderMessage);
  console.error(`Replaying ${rendered.length} conversation entries as text.`);
  for (const text of rendered) {
    // Keep surrogate pairs together while producing small, delayed stdout writes.
    const characters = Array.from(text);
    for (let offset = 0; offset < characters.length; offset += 256) {
      if (!process.stdout.write(characters.slice(offset, offset + 256).join(""))) await once(process.stdout, "drain");
      await setTimeout(15);
    }
    await setTimeout(250);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
