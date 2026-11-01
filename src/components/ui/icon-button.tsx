import * as React from "react";

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: "sm" | "md";
}

/** Icon-only button — 2px ink outline, ORBIT radius, hard offset on hover-capable surfaces. */
export function IconButton({
  label,
  size = "md",
  className = "",
  children,
  ...rest
}: IconButtonProps) {
  const sizeClass = size === "sm" ? "h-8 w-8" : "h-10 w-10";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center rounded-orbit border-2 border-hansan-ink bg-hansan-ivory text-hansan-ink shadow-orbit-sm transition duration-fast hover:bg-hansan-surface-raised focus-visible:outline-none focus-visible:[box-shadow:var(--focus-ring)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none ${sizeClass} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}
