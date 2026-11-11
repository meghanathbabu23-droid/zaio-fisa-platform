import { Card } from "./ui/Card";

export function SummaryCard({
  label,
  value,
  hint,
  accent = "blue",
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: "blue" | "sun" | "ink";
}) {
  return (
    <Card accent={accent}>
      <p className="text-sm font-medium text-zaio-ink/60">{label}</p>
      <p className="mt-2 font-display text-3xl font-semibold tracking-tight text-zaio-ink">
        {value}
      </p>
      {hint ? <p className="mt-2 text-xs text-zaio-ink/50">{hint}</p> : null}
    </Card>
  );
}
