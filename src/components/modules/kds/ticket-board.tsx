import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { TicketView } from "@/domain/kds/ticket";
import { aggregateProgress, type AggregateOrderProgress } from "@/domain/kds/aggregate";

export const AGGREGATE_TONE: Record<AggregateOrderProgress, BadgeTone> = {
  new: "info",
  "in-progress": "warning",
  "partially-ready": "warning",
  ready: "success",
  completed: "neutral",
};

const STATION_LABEL = { kitchen: "Kitchen", bar: "Bar" } as const;

function priorityTone(priority: TicketView["priority"]): BadgeTone {
  if (priority === "overdue") return "danger";
  if (priority === "high") return "warning";
  return "neutral";
}

/**
 * StationTicketBoard — KDS operational board for ONE station.
 * Large touch targets, high-legibility tickets, lifecycle states.
 * UI-only during this sprint: renders tickets passed by the caller;
 * with no backend orders the caller passes [] and the honest empty
 * state shows. Never filters the wrong station's items: callers pass
 * pre-split tickets from buildTickets().
 */
export function StationTicketBoard({
  station,
  tickets,
  emptyTitle,
  emptyDescription,
}: {
  station: "kitchen" | "bar";
  tickets: TicketView[];
  emptyTitle: string;
  emptyDescription: string;
}) {
  const mine = tickets.filter((t) => t.station === station);
  if (mine.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <ol className="grid gap-4 lg:grid-cols-2">
      {mine.map((ticket) => (
        <li
          key={`${ticket.orderId}-${ticket.station}`}
          className="rounded-neu border-2 border-hansan-ink bg-hansan-surface-raised p-5 shadow-sleepwise"
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-sm font-black text-hansan-ink">{ticket.orderNumber}</p>
            <Badge tone={priorityTone(ticket.priority)}>{ticket.priority}</Badge>
            <span className="ml-auto font-mono text-xs text-hansan-ink-muted">{ticket.elapsedMinutes}m</span>
          </div>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-hansan-ink-muted">
            {STATION_LABEL[station]} · {ticket.orderType} · {ticket.orderState}
          </p>
          <ul className="mt-4 space-y-2 border-t-2 border-hansan-ink pt-4">
            {ticket.items.map((item) => (
              <li key={item.lineId} className="flex items-baseline gap-3 text-base">
                <span className="font-black tabular-nums text-hansan-ink">×{item.quantity}</span>
                <span className="min-w-0 flex-1 font-bold text-hansan-ink">
                  {item.productName}
                  {item.note && <span className="mt-0.5 block text-sm font-medium text-hansan-ink-muted">“{item.note}”</span>}
                </span>
                <Badge tone={item.prepStatus === "ready" ? "success" : item.prepStatus === "preparing" ? "warning" : "info"}>
                  {item.prepStatus}
                </Badge>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

/**
 * OrderProgressSummary — POS checker strip: per-station progress +
 * derived aggregate. Pure presentation over caller-provided tickets.
 */
export function OrderProgressSummary({ tickets }: { tickets: TicketView[] }) {
  if (tickets.length === 0) {
    return (
      <p className="rounded-sm border border-hansan-line bg-hansan-surface-raised px-4 py-3 text-sm text-hansan-ink-muted">
        No active tickets — station progress appears here once real orders route to Kitchen and Bar.
      </p>
    );
  }
  const byOrder = new Map<string, TicketView[]>();
  for (const t of tickets) {
    const list = byOrder.get(t.orderId) ?? [];
    list.push(t);
    byOrder.set(t.orderId, list);
  }
  return (
    <ul className="space-y-3">
      {Array.from(byOrder.entries()).map(([orderId, group]) => {
        const first = group[0];
        const pseudo = {
          id: first.orderId,
          orderNumber: first.orderNumber,
          lines: group.flatMap((g) =>
            g.items.map((i) => ({
              id: i.lineId,
              productId: i.lineId,
              productName: i.productName,
              quantity: i.quantity,
              unitPriceIdr: 0,
              modifierIds: [],
              station: g.station,
              state: "active" as const,
              prepStatus: i.prepStatus,
            })),
          ),
          state: first.orderState,
        };
        const view = aggregateProgress({
          ...pseudo,
          tenantId: "",
          outletId: "",
          orderType: first.orderType,
          tableId: null,
          customerId: null,
          subtotalIdr: 0,
          discountIdr: 0,
          taxIdr: 0,
          grandTotalIdr: 0,
          paymentState: "unpaid",
          createdBy: "",
          createdAt: first.createdAt,
          updatedAt: first.createdAt,
        });
        const kitchen = view.stations.find((s) => s.station === "kitchen");
        const bar = view.stations.find((s) => s.station === "bar");
        return (
          <li
            key={orderId}
            className="flex flex-wrap items-center gap-2 rounded-sm border border-hansan-line bg-hansan-surface-raised px-4 py-3"
          >
            <span className="font-mono text-sm font-black text-hansan-ink">{view.orderNumber}</span>
            <Badge tone="neutral">
              Kitchen {kitchen?.progress === "empty" ? "—" : `${kitchen?.ready}/${kitchen?.total} ${kitchen?.progress}`}
            </Badge>
            <Badge tone="neutral">
              Bar {bar?.progress === "empty" ? "—" : `${bar?.ready}/${bar?.total} ${bar?.progress}`}
            </Badge>
            <Badge tone={AGGREGATE_TONE[view.aggregate]}>{view.aggregate}</Badge>
          </li>
        );
      })}
    </ul>
  );
}
