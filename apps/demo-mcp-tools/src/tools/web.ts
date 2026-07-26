import { readFileSync } from "node:fs";
import path from "node:path";
import { pagesRoot } from "../lib/fixtures-root.js";
import { json, text, ToolError, type ToolDefinition } from "../types.js";

/** Fixed URL -> local page mapping. No URL outside this map is ever served. */
const pageIndex: Record<string, { file: string; title: string }> = {
  "https://tech.example-blog.kr/posts/redis-caching-101": {
    file: "redis-caching-101.html",
    title: "Redis 캐싱 101"
  },
  "https://tech.example-blog.kr/posts/korean-locale-formatting": {
    file: "korean-locale-formatting.html",
    title: "한국어 로케일 포맷팅 체크리스트"
  },
  "https://tech.example-blog.kr/posts/mcp-agent-tools-review": {
    file: "mcp-agent-tools-review.html",
    title: "MCP 에이전트 도구 비교 리뷰"
  }
};

export const webTools: ToolDefinition[] = [
  {
    name: "fetch_url",
    description: "Fetch a page's HTML content by URL. Only a fixed set of demo pages is available.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "One of the URLs returned by list_pages." } },
      required: ["url"]
    },
    handler: (args) => {
      if (typeof args.url !== "string" || args.url.length === 0) throw new ToolError("url is required");
      const page = pageIndex[args.url];
      if (!page) throw new ToolError("Page not found", 404);
      return text(readFileSync(path.join(pagesRoot, page.file), "utf8"));
    }
  },
  {
    name: "list_pages",
    description: "List the fixed set of demo pages available to fetch_url.",
    inputSchema: { type: "object", properties: {} },
    handler: () => json(Object.entries(pageIndex).map(([url, { title }]) => ({ url, title })))
  }
];
