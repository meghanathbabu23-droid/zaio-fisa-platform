type LogoVariant = "horizontal" | "mark";
type LogoTone = "light" | "dark";

const SRC: Record<LogoVariant, Record<LogoTone, string>> = {
  horizontal: {
    light: "/brand/zaio-horizontal-black.svg",
    dark: "/brand/zaio-horizontal-white.svg",
  },
  mark: {
    light: "/brand/zaio-mark-black.svg",
    dark: "/brand/zaio-mark-white.svg",
  },
};

/** Official Zaio logo asset. Never recolour/stretch — pick `tone` to match the background instead. */
export function Logo({
  variant = "horizontal",
  tone = "dark",
  className = "",
}: {
  variant?: LogoVariant;
  tone?: LogoTone;
  className?: string;
}) {
  const sizing = variant === "horizontal" ? "h-8 min-w-[120px] w-auto" : "h-8 w-8";
  return (
    <img
      src={SRC[variant][tone]}
      alt="Zaio"
      className={`${sizing} ${className}`}
    />
  );
}
