import * as React from "react";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "border-2 border-hansan-ink bg-hansan-surface-raised text-hansan-ink",
  info: "border-2 border-hansan-ink bg-hansan-blue/10 text-hansan-blue",
  success: "border-2 border-hansan-ink bg-hansan-success/10 text-hansan-success",
  warning: "border-2 border-hansan-ink bg-hansan-warning/10 text-hansan-warning",
  danger: "border-2 border-hansan-ink bg-hansan-danger/10 text-hansan-danger",
};

/** Status badge — UI states (e.g. order states), never business data itself. */
export function Badge({ tone = "neutral", className = "", children, ...rest }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${TONE_CLASS[tone]} ${className}`.trim()}
      {...rest}
    >
      {children}
    </span>
  );
}
