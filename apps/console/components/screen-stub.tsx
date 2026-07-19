import type { ReactNode } from "react";

export interface ScreenStubProps {
  scr: string;
  title: string;
  desc: string;
  note: string;
  children?: ReactNode;
}

/** Scaffold placeholder for a screen route. Detailed UI ships in follow-up issues. */
export function ScreenStub({ scr, title, desc, note, children }: ScreenStubProps) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className="font-mono text-xs text-muted-foreground">{scr}</span>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </header>
      {children ?? (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 p-12 text-center text-sm text-muted-foreground">
          {note}
        </div>
      )}
    </div>
  );
}
