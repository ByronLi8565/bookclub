// A small inline loading spinner with an optional label.
export function Spinner({ label }: { label?: string }): React.ReactElement {
  return (
    <span className="spinner-wrap">
      <span className="spinner" aria-hidden="true" />
      {label !== undefined && <span className="spinner-label">{label}</span>}
    </span>
  );
}
