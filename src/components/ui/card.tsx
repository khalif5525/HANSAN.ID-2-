import * as React from "react";

export type CardElevation = "raised" | "flat" | "sleepwise";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  elevation?: CardElevation;
  padding?: "none" | "sm" | "md" | "lg";
}

const PADDING_CLASS = {
  none: "p-0",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
} as const;

/**
 * Card primitive — approved SleepWise treatment for prominent cards.
 * flat (default): bordered white operational surfaces.
 * sleepwise: warm ivory surface + 2px ink outline + crisp offset shadow
 *   for prominent dashboard cards. Use sparingly — never nested.
 * raised: legacy soft shadow for dialogs/login/floating summaries only.
 */
export function Card({
  elevation = "flat",
  padding = "md",
  className = "",
  children,
  ...rest
}: CardProps) {
  const elevationClass =
    elevation === "sleepwise"
      ? "border-2 border-hansan-ink bg-hansan-ivory shadow-sleepwise"
      : elevation === "raised"
        ? "border border-hansan-line bg-hansan-surface-soft shadow-neu-raised"
        : "border border-hansan-line bg-hansan-surface-raised";
  return (
    <div
      className={`rounded-neu ${elevationClass} ${PADDING_CLASS[padding]} ${className}`.trim()}
      {...rest}
    >
      {children}
    </div>
  );
}
