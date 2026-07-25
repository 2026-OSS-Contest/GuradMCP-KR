import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { outboxRoot } from "../lib/fixtures-root.js";
import { json, text, ToolError, type ToolDefinition } from "../types.js";

interface OutboxMessage {
  id: string;
  to: string;
  subject: string;
  body: string;
  sentAt: string;
}

function ensureOutboxDir(): string {
  const dir = outboxRoot();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Filenames only ever come from a sanitized slug plus a random id — the raw
 * `to` value is never interpolated into a path, so a crafted address can't
 * escape the outbox directory. */
function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9@._-]/g, "_").slice(0, 60);
}

export const emailTools: ToolDefinition[] = [
  {
    name: "send_email",
    description: "Send an email. This sandbox never contacts a real SMTP server; the message is recorded to a local outbox only.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address." },
        subject: { type: "string", description: "Email subject." },
        body: { type: "string", description: "Email body." }
      },
      required: ["to", "subject", "body"]
    },
    handler: (args) => {
      if (typeof args.to !== "string" || args.to.length === 0) throw new ToolError("to is required");
      if (typeof args.subject !== "string") throw new ToolError("subject is required");
      if (typeof args.body !== "string") throw new ToolError("body is required");
      const dir = ensureOutboxDir();
      const message: OutboxMessage = {
        id: randomUUID(),
        to: args.to,
        subject: args.subject,
        body: args.body,
        sentAt: new Date().toISOString()
      };
      const filename = `${message.sentAt.replace(/[:.]/g, "-")}-${slug(message.to)}-${message.id.slice(0, 8)}.json`;
      writeFileSync(path.join(dir, filename), JSON.stringify(message, null, 2), "utf8");
      return text(`전송되었습니다: ${message.to} (id: ${message.id})`);
    }
  },
  {
    name: "list_outbox",
    description: "List every message recorded in the local outbox so far.",
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const dir = ensureOutboxDir();
      const messages = readdirSync(dir)
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => JSON.parse(readFileSync(path.join(dir, entry), "utf8")) as OutboxMessage)
        .sort((left, right) => left.sentAt.localeCompare(right.sentAt));
      return json(messages);
    }
  }
];
