interface LoadingProps {
  progress?: number;
  className?: string;
}

export function Loading({ progress, className }: LoadingProps): React.ReactElement {
  const pct = progress === undefined ? undefined : Math.max(0, Math.min(100, progress));
  const classes = className ? `loading ${className}` : "loading";

  return (
    <output className={classes} aria-live="polite" aria-label="Loading">
      <span className="loading-text">
        LOADING
        <span className="loading-dots" aria-hidden="true">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </span>
      {pct !== undefined && (
        <span className="loading-progress" aria-hidden="true">
          <span className="loading-progress-fill" style={{ width: `${pct}%` }} />
        </span>
      )}
    </output>
  );
}
