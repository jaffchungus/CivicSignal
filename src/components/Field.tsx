import { cloneElement, useId, type ReactElement } from "react";

export function Field({
  label,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  error?: string | null;
  hint?: string | null;
  className?: string;
  children: ReactElement<any>;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const descriptions = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={`field${className ? ` ${className}` : ""}`}>
      <label className="field-label" htmlFor={id}>{label}</label>
      {cloneElement(children, {
        id,
        "aria-describedby": descriptions,
        "aria-invalid": error ? true : undefined,
      })}
      {hint && <span id={hintId} className="field-hint">{hint}</span>}
      {error && <span id={errorId} className="field-error" role="alert">{error}</span>}
    </div>
  );
}
