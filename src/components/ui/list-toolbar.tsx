import * as React from "react";
import { Search } from "./search";
import { Select } from "./select";

export interface ListToolbarFilter {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

export interface ListToolbarProps {
  /** Accessible label for the toolbar region. */
  label: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  onClearSearch?: () => void;
  filters?: ListToolbarFilter[];
  /** Right-aligned actions (buttons / links). */
  actions?: React.ReactNode;
  /** Honest result hint, e.g. "0 records · filters do not invent rows". */
  resultHint?: string;
  className?: string;
}

/**
 * ListToolbar — reusable list header for every workspace table surface.
 * Search + filter selects + actions in one responsive row. Controlled only:
 * callers own state locally (no persistence, no fake rows). Renders nothing
 * data-like — tables below must still use rows={[]} until the backend phase.
 */
export function ListToolbar({
  label,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search (no records yet)",
  onClearSearch,
  filters = [],
  actions,
  resultHint,
  className = "",
}: ListToolbarProps) {
  const showSearch = onSearchChange !== undefined;
  return (
    <div
      role="search"
      aria-label={label}
      className={`rounded-sm border border-hansan-line bg-hansan-surface-raised p-4 ${className}`.trim()}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        {showSearch && (
          <div className="min-w-0 flex-1">
            <Search
              aria-label={label}
              placeholder={searchPlaceholder}
              value={searchValue ?? ""}
              onChange={(e) => onSearchChange?.(e.target.value)}
              onClear={onClearSearch}
            />
          </div>
        )}
        {filters.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:items-end">
            {filters.map((f) => (
              <Select
                key={f.id}
                label={f.label}
                value={f.value}
                options={f.options}
                onChange={(e) => f.onChange(e.target.value)}
                className="min-w-36"
              />
            ))}
          </div>
        )}
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {resultHint && (
        <p className="mt-3 border-t border-hansan-line pt-3 text-xs text-hansan-ink-muted">{resultHint}</p>
      )}
    </div>
  );
}
