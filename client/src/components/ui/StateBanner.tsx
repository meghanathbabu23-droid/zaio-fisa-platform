import type { ReactNode } from "react";

export type BannerTone = "info" | "success" | "warning" | "error";

const TONE_CLASSES: Record<BannerTone, string> = {
  info: "border-zaio-sun/40 bg-zaio-sun/20 text-zaio-ink",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
  error: "border-red-200 bg-red-50 text-red-800",
};

export function StateBanner({
  tone = "info",
  bleed = false,
  center = false,
  className = "",
  children,
}: {
  /** Full-bleed page banner (no rounding/border) instead of an inset card-like banner. */
  tone?: BannerTone;
  bleed?: boolean;
  center?: boolean;
  /** Additive spacing only (e.g. "mb-4") — never a color/border/radius/font-size override. */
  className?: string;
  children: ReactNode;
}) {
  const shape = bleed ? "px-4 py-2" : "rounded-xl border px-4 py-3 shadow-sm";
  return (
    <div className={`${shape} text-sm leading-relaxed ${center ? "text-center" : ""} ${TONE_CLASSES[tone]} ${className}`}>
      {children}
    </div>
  );
}
