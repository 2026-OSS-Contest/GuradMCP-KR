import { readFileSync } from "node:fs";
import path from "node:path";
import { seedRoot } from "../lib/fixtures-root.js";
import { json, ToolError, type ToolDefinition } from "../types.js";

interface Ticket {
  ticketId: string;
  customerName: string;
  channel: string;
  createdAt: string;
  body: string;
}

const tickets: Ticket[] = JSON.parse(readFileSync(path.join(seedRoot, "customer-tickets.json"), "utf8"));

function clampLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export const dbTools: ToolDefinition[] = [
  {
    name: "search_tickets",
    description: "Search customer support tickets by keyword across ticket ID, customer name, channel, and body.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword to search for (case-insensitive substring match)." },
        limit: { type: "number", description: "Maximum number of results; defaults to 20." }
      },
      required: ["query"]
    },
    handler: (args) => {
      if (typeof args.query !== "string" || args.query.length === 0) throw new ToolError("query is required");
      const needle = args.query.toLowerCase();
      const limit = clampLimit(args.limit, 20);
      const matches = tickets.filter((ticket) =>
        ticket.ticketId.toLowerCase().includes(needle) ||
        ticket.customerName.toLowerCase().includes(needle) ||
        ticket.channel.toLowerCase().includes(needle) ||
        ticket.body.toLowerCase().includes(needle)
      );
      return json(matches.slice(0, limit));
    }
  },
  {
    name: "get_ticket",
    description: "Fetch a single customer support ticket by its ticket ID.",
    inputSchema: {
      type: "object",
      properties: { ticketId: { type: "string", description: "Ticket ID, e.g. TCK-2026-0001." } },
      required: ["ticketId"]
    },
    handler: (args) => {
      if (typeof args.ticketId !== "string" || args.ticketId.length === 0) throw new ToolError("ticketId is required");
      const found = tickets.find((ticket) => ticket.ticketId === args.ticketId);
      if (!found) throw new ToolError("Ticket not found", 404);
      return json(found);
    }
  },
  {
    name: "list_all_tickets",
    description: "List every customer support ticket in the sandbox database.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Maximum number of results; defaults to returning every ticket." } }
    },
    // Default limit is deliberately larger than the seed set so a naive
    // "fetch everything" call returns the full dump in one round trip — this
    // is the T-08 bulk-exfiltration pattern the attack lab exercises.
    handler: (args) => json(tickets.slice(0, clampLimit(args.limit, 10_000)))
  }
];
