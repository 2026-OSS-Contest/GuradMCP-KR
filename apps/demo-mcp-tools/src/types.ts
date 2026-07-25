/** MCP-style tool-result content block: plain text only, this demo never returns binaries. */
export interface ToolContent {
  type: "text";
  text: string;
}

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

/** Advertised in `/tools/list`. Descriptions stay clinical — never a place to hide instructions. */
export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export interface ToolDefinition extends ToolDescriptor {
  handler: (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>;
}

export function text(value: string): ToolResult {
  return { content: [{ type: "text", text: value }] };
}

export function json(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Bypasses the {type:"text",text} content-block convention used everywhere
 * else. Exists only for the `customer_lookup` legacy-compat tool, which must
 * return its content array verbatim (see src/tools/legacy.ts for why).
 */
export function rawContent(value: unknown): ToolResult {
  return { content: [value] as unknown as ToolContent[] };
}

export class ToolError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
