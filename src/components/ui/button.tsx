import * as React from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "border-2 border-hansan-ink bg-hansan-orange text-white shadow-orbit hover:brightness-105 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none",
  secondary:
    "border-2 border-hansan-ink bg-hansan-ivory text-hansan-ink shadow-orbit-sm hover:bg-hansan-surface-raised active:translate-x-[2px] active:translate-y-[2px] active:shadow-none",
  ghost: "border-2 border-transparent text-hansan-ink hover:border-hansan-line hover:bg-hansan-surface-sunken",
  danger:
    "border-2 border-hansan-ink bg-hansan-danger text-white shadow-orbit hover:brightness-105 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-5 text-sm",
  lg: "h-12 px-6 text-base",
};

/**
 * Generic Button primitive — approved ORBIT treatment.
 * 2px ink outline + rounded-orbit (14px) + hard offset shadow (zero
 * blur); pressed state collapses the offset. Visual states only.
 * Disabled + loading states required per §22.
 */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      type="button"
      aria-busy={loading || undefined}
      disabled={isDisabled}
      className={`inline-flex items-center justify-center gap-2 rounded-orbit font-semibold transition duration-fast focus-visible:outline-none focus-visible:[box-shadow:var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]} ${className}`.trim()}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}
