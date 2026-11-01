import { ModulePage } from "@/components/shared/module-page";
import { Section } from "@/components/ui/section";
import { Table } from "@/components/ui/table";
import { Alert } from "@/components/ui/alert";
import { OrderProgressSummary } from "@/components/modules/kds/ticket-board";

/**
 * POS Checker — full-order view with independent station progress.
 * Station columns stay structurally separate; the aggregate badge is
 * derived from per-station prepStatus (never copied from one station).
 * UI-only: tickets={[]} until backend orders exist. Read-only —
 * no order-level action mutates station states here.
 */
export default function PosHistoryPage() {
  return (
    <ModulePage
      breadcrumbs={[{ label: "POS", href: "/pos" }, { label: "History" }]}
      title="Order History"
      purpose="Checker view: full customer order with Kitchen and Bar progress tracked separately and an aggregate status derived from both. This History page hosts the checker strip — no separate Checker role or route exists."
      status={{
        label: "0 orders",
        detail:
          "No order history exists — this environment has never processed a transaction. History is never backfilled with demo orders.",
      }}
      nextAction="Take a real order after backend launch; completed orders will list here with time, type, and total."
      actionLabel="Start new order"
      actionHref="/pos/order-type"
    >
      <Section eyebrow="Stations" title="Live station progress" description="Kitchen and Bar advance independently — aggregate derives from both.">
        <OrderProgressSummary tickets={[]} />
        <Alert tone="info" title="Checker is read-only" className="mt-4">
          Station statuses change only at their own boards. No order-level
          action here overwrites an individual station state.
        </Alert>
      </Section>

      <Section eyebrow="History" title="Recent orders" description="Receipts, voids, and reprints by time range.">
        <Table
          caption="Recent orders"
          columns={[
            { key: "time", header: "Time", render: () => "—" },
            { key: "type", header: "Order type", render: () => "—" },
            { key: "kitchen", header: "Kitchen", render: () => "—" },
            { key: "bar", header: "Bar", render: () => "—" },
            { key: "total", header: "Total", align: "right", render: () => "Rp 0" },
            { key: "status", header: "Status", render: () => "—" },
          ]}
          rows={[]}
          rowKey={(r) => r as unknown as string}
          emptyMessage="No orders yet — history stays empty until real orders are taken."
        />
      </Section>
    </ModulePage>
  );
}
