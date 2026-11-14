import { X } from "lucide-react";
import { formatMissingCollections, type SchemaStatus } from "./schemaStatus";

export function SchemaBanner({
  status,
  dismissed,
  onDismiss,
}: {
  status: SchemaStatus | null;
  dismissed: boolean;
  onDismiss: () => void;
}) {
  if (!status || !status.checked || status.ok || dismissed) return null;
  return (
    <div
      className="error"
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
      }}
    >
      <span>
        <strong>Server migration needed:</strong> missing PocketBase{" "}
        {status.missing.length === 1 ? "collection" : "collections"} (
        {formatMissingCollections(status.missing)}). Apply the latest
        migrations in <code>pocketbase/pb_migrations</code>.
      </span>
      <button
        type="button"
        aria-label="Dismiss schema warning"
        onClick={onDismiss}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          flexShrink: 0,
        }}
      >
        <X size={14} /> Dismiss
      </button>
    </div>
  );
}
