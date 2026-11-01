"use client";

import * as React from "react";
import Link from "next/link";
import { ModulePage } from "@/components/shared/module-page";
import { Section } from "@/components/ui/section";
import { StatStrip } from "@/components/ui/stat-strip";
import { Tabs } from "@/components/ui/tabs";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { Table } from "@/components/ui/table";

const SETTLEMENT_TABS = [
  { value: "today", label: "Today" },
  { value: "history", label: "History" },
];

/**
 * Finance Transactions — ledger + settlement shell (UI sprint).
 * Tabs filter the settlement framing only; the ledger stays rows={[]}
 * and expected/actual/discrepancy stay structural zeros until real
 * POS postings exist post-freeze. No synthetic amounts anywhere.
 */
export default function FinanceTransactionsPage() {
  const [tab, setTab] = React.useState("today");
  const [search, setSearch] = React.useState("");
  const [method, setMethod] = React.useState("all");
  const [status, setStatus] = React.useState("all");

  return (
    <ModulePage
      breadcrumbs={[{ label: "Finance", href: "/finance" }, { label: "Transactions" }]}
      title="Transactions"
      purpose="Ledger of every sale, refund, and adjustment with settlement status."
      status={{
        label: "0 transactions",
        detail:
          "No financial transactions have ever posted to this environment. The ledger starts empty by design.",
      }}
      nextAction="Once POS processes real payments post-freeze, each settlement lands here with full audit detail."
    >
      <Section eyebrow="Settlement" title="Daily reconciliation" description="Expected vs actual per channel — structurally zero until real postings land.">
        <Tabs label="Settlement view" items={SETTLEMENT_TABS} value={tab} onChange={setTab} />
        <div className="mt-4">
          <StatStrip
            items={[
              { label: "Expected", value: "Rp 0", hint: "Cash · no postings" },
              { label: "Actual", value: "Rp 0", hint: "Nothing counted yet" },
              { label: "QRIS", value: "Rp 0", hint: "No QRIS batches" },
              { label: "Discrepancy", value: "Rp 0", hint: "Nothing to reconcile" },
            ]}
          />
        </div>
      </Section>

      <Section eyebrow="Ledger" title="Transaction ledger" description="Search + channel filters narrow future postings — they never invent rows.">
        <p className="mb-4 rounded-sm border border-hansan-line bg-hansan-surface-soft px-4 py-3 text-sm text-hansan-ink-muted">
          Daily reconciliation lives in{" "}
          <Link href="/finance/settlement" className="font-bold text-hansan-blue hover:underline">
            Settlement
          </Link>{" "}
          — this ledger records every posting.
        </p>
        <ListToolbar
          label="Filter transactions"
          searchValue={search}
          onSearchChange={setSearch}
          onClearSearch={() => setSearch("")}
          searchPlaceholder="Search reference (no transactions yet)"
          filters={[
            {
              id: "method",
              label: "Method",
              value: method,
              options: [
                { value: "all", label: "All methods" },
                { value: "cash", label: "Cash" },
                { value: "qris", label: "QRIS" },
                { value: "edc", label: "EDC" },
              ],
              onChange: setMethod,
            },
            {
              id: "status",
              label: "Status",
              value: status,
              options: [
                { value: "all", label: "All statuses" },
                { value: "settled", label: "Settled" },
                { value: "pending", label: "Pending" },
                { value: "refunded", label: "Refunded" },
                { value: "void", label: "Void" },
              ],
              onChange: setStatus,
            },
          ]}
          actions={
            <Link
              href="/finance/settlement"
              className="inline-flex h-10 items-center justify-center rounded-sm border border-hansan-line-strong bg-hansan-surface-raised px-4 text-sm font-bold text-hansan-ink transition hover:border-hansan-ink"
            >
              Open settlement
            </Link>
          }
          resultHint="0 transactions · 0 settlements — filters and channel tabs narrow future postings only."
        />
        <div className="mt-4">
          <Table
            caption="Transactions"
            columns={[
              { key: "date", header: "Date", render: () => "—" },
              { key: "ref", header: "Reference", render: () => "—" },
              { key: "method", header: "Method", render: () => "—" },
              { key: "status", header: "Status", render: () => "—" },
              { key: "amount", header: "Amount", align: "right", render: () => "Rp 0" },
            ]}
            rows={[]}
            rowKey={(r) => r as unknown as string}
            emptyMessage="No transactions recorded."
          />
        </div>
      </Section>
    </ModulePage>
  );
}
