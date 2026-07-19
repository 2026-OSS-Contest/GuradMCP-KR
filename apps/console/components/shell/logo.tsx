/* Brand logo from the official asset kit (wordmark + favicon mark). */
export function Logo({ iconOnly = false }: { iconOnly?: boolean }) {
  return iconOnly ? (
    <img src="/brand/mark.svg" alt="GuardMCP-KR" className="size-7" />
  ) : (
    <img src="/brand/logo-horizontal.svg" alt="GuardMCP-KR" className="h-7 w-auto" />
  );
}
