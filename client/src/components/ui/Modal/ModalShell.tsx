import type { ReactNode } from "react";

export function ModalShell({
  title,
  onClose,
  size = "md",
  children,
}: {
  title: string;
  onClose: () => void;
  /** md = max-w-lg (default forms), lg = max-w-2xl (forms with a builder section). */
  size?: "md" | "lg";
  children: ReactNode;
}) {
  const maxWidth = size === "lg" ? "max-w-2xl" : "max-w-lg";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        className={`max-h-[90vh] w-full ${maxWidth} overflow-y-auto rounded-2xl border border-zaio-cloud bg-zaio-card shadow-2xl shadow-zaio-paper/60`}
      >
        <div className="flex items-center justify-between border-b border-zaio-cloud px-6 py-4">
          <h2 className="font-display text-lg font-semibold text-zaio-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-zaio-ink/60 transition-colors hover:bg-zaio-mist hover:text-zaio-ink"
          >
            Close
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
