export function ImportProgress({
  label,
  value,
  total,
}: {
  label: string;
  value: number;
  total: number;
}) {
  const percent = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="import-progress">
      <div className="import-progress-label" role="status">
        <span>{label}</span>
        <span>
          {value} / {total} · {percent}%
        </span>
      </div>
      <progress aria-label={label} value={value} max={Math.max(1, total)} />
    </div>
  );
}
