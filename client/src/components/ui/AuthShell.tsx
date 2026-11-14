import type { ReactNode } from "react";
import { Logo } from "./Logo";

/**
 * Shared chrome for every standalone auth screen (student sign-in, admin
 * sign-in, forgot/reset password): centered logo, a soft decorative
 * background, and an elevated card. One definition instead of four
 * near-identical copies, so refining the look happens in one place.
 */
export function AuthShell({ children, maxWidth = "max-w-md" }: { children: ReactNode; maxWidth?: string }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-zaio-paper px-4">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -right-24 h-80 w-80 rounded-full bg-zaio-blue/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-zaio-sun/10 blur-3xl" />
      </div>
      <div className="relative mb-8">
        <Logo />
      </div>
      <div className={`relative w-full ${maxWidth} rounded-2xl border border-zaio-cloud bg-zaio-card p-8 shadow-xl shadow-zaio-paper/50`}>
        {children}
      </div>
    </div>
  );
}
