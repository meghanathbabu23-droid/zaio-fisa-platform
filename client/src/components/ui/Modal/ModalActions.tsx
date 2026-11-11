import { Button } from "../Button";

export function ModalActions({
  saving,
  onClose,
  saveLabel,
}: {
  saving: boolean;
  onClose: () => void;
  saveLabel: string;
}) {
  return (
    <div className="flex justify-end gap-3 border-t border-zaio-cloud pt-4">
      <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
        Cancel
      </Button>
      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : saveLabel}
      </Button>
    </div>
  );
}
