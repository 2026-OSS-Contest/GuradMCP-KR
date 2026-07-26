import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * The type scale generated from Figma is a set of plain CSS classes named `text-<group>-…`
 * (`text-body-text-b3-md`, `text-caption-mono-c-rg`). tailwind-merge claims anything starting
 * with `text-` for its colour group, so it reads one of those as conflicting with
 * `text-red-300` and drops it — the element silently falls back to the inherited 16px.
 *
 * They are not Tailwind utilities, so they are held out of the merge entirely and the last one
 * wins, which is how tailwind-merge resolves a group anyway.
 */
const FIGMA_TYPE = /^text-(display|header|title|body|caption)-/;

export function cn(...inputs: ClassValue[]): string {
  const classes = clsx(inputs).split(" ").filter(Boolean);
  const type = classes.filter((c) => FIGMA_TYPE.test(c));
  const rest = classes.filter((c) => !FIGMA_TYPE.test(c));
  return [twMerge(rest.join(" ")), type.at(-1)].filter(Boolean).join(" ");
}
