import type { ReactNode } from "react";

export function Card({
  children,
  accent,
  interactive = false,
  className = "",
}: {
  children: ReactNode;
  accent?: "blue" | "sun" | "ink";
  /** Adds a hover elevation — use for cards that are themselves clickable. */
  interactive?: boolean;
  className?: string;
}) {
  const bar = accent === "sun" ? "bg-zaio-sun" : accent === "ink" ? "bg-zaio-ink" : "bg-zaio-blue";
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-zaio-cloud bg-zaio-card p-5 shadow-sm transition-shadow ${
        interactive ? "hover:shadow-md" : ""
      } ${className}`}
    >
      {accent ? <div className={`absolute left-0 top-0 h-1 w-full ${bar}`} /> : null}
      {children}
    </div>
  );
}
