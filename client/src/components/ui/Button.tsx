import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "sun" | "ink";
type Size = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-zaio-blue text-white shadow-sm hover:bg-zaio-deep hover:shadow-md",
  secondary: "border border-zaio-cloud text-zaio-ink hover:border-zaio-ink/25 hover:bg-zaio-mist",
  ghost: "text-zaio-blue hover:underline",
  sun: "bg-zaio-sun text-zaio-paper shadow-sm hover:bg-zaio-sun/90 hover:shadow-md",
  ink: "bg-zaio-ink text-zaio-paper shadow-sm hover:bg-zaio-graphite hover:shadow-md",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "rounded-xl px-3 py-1.5 text-sm font-medium",
  md: "rounded-xl px-4 py-2 text-sm font-medium",
  lg: "rounded-xl py-3 text-sm font-medium",
};

export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}) {
  const shape = variant === "ghost" ? "text-sm font-medium" : SIZE_CLASSES[size];
  return (
    <button
      className={[
        shape,
        VARIANT_CLASSES[variant],
        "transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zaio-blue focus-visible:ring-offset-2",
        fullWidth ? "w-full" : "",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}
