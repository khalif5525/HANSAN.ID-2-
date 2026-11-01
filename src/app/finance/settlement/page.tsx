"use client";

import * as React from "react";
import Link from "next/link";
import { ModulePage } from "@/components/shared/module-page";
import { Section } from "@/components/ui/section";
import { StatStrip } from "@/components/ui/stat-strip";
import { Tabs } from "@/components/ui/tabs";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { Table } from "@/components/ui/table";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const SETTLEMENT_TABS = [
  { value: "today", label: "Today" },
  { value: "history", label: "History" },
];

/**
 * Finance Settlement — daily close shell (UI sprint).
 * Reconciliation framing only: batches stay rows={[]}, expected /
 * actual / discrepancy stay structural Rp 0 until real POS postings
 * exist post-freeze. Approval stays disabled with an honest alert.
 */
export default function FinanceSettlementPage() {
  const [tab, setTab] = React.useState("today");
  const [search, setSearch] = React.useState("");
  const [method, setMethod] = React.useState("all");
  const [status, setStatus] = React.useState("all");

  return (
    <ModulePage
      breadcrumbs={[{ label: "Finance", href: "/finance" }, { label: "Settlement" }]}
      title="Settlement"
      purpose="Daily close: expected vs actual per method, discrepancies, and batch approval."
      status={{
        label: "0 settlements",
        detail: "No settlement batches exist — nothing has posted, so nothing is reconciled.",
      }}
      nextAction="POS payments post settlement batches here automatically after the backend phase."
    >
      <Section eyebrow="Reconciliation" title="Daily close" description="Expected vs actual per method — zero until real postings land.">
        <Tabs label="Settlement view" items={SETTLEMENT_TABS} value={tab} onChange={setTab} />
        <div className="mt-4">
          <StatStrip
            items={[
              { label: "Expected", value: "Rp 0", hint: "No postings" },
              { label: "Actual", value: "Rp 0", hint: "Nothing counted yet" },
              { label: "Discrepancy", value: "Rp 0", hint: "Nothing to reconcile" },
              { label: "Pending batches", value: "0", hint: "Nothing awaiting approval" },
            ]}
          />
        </div>
        <div className="mt-4">
          <StatStrip
            items={[
              { label: "Cash", value: "Rp 0", hint: "No cash batches" },
              { label: "QRIS", value: "Rp 0", hint: "No QRIS batches" },
              { label: "EDC", value: "Rp 0", hint: "No EDC batches" },
              { label: "Other", value: "Rp 0", hint: "No other batches" },
            ]}
          />
        </div>
      </Section>
      <Section eyebrow="Batches" title="Settlement batches" description="Method + status filters narrow future batches — they never invent rows.">
        <ListToolbar
          label="Filter settlement batches"
          searchValue={search}
          onSearchChange={setSearch}
          onClearSearch={() => setSearch("")}
          searchPlaceholder="Search batch or reference (no batches yet)"
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
                { value: "other", label: "Other" },
              ],
              onChange: setMethod,
            },
            {
              id: "status",
              label: "Status",
              value: status,
              options: [
                { value: "all", label: "All statuses" },
                { value: "pending", label: "Pending" },
                { value: "matched", label: "Matched" },
                { value: "discrepancy", label: "Discrepancy" },
                { value: "approved", label: "Approved" },
              ],
              onChange: setStatus,
            },
          ]}
          actions={
            <Link
              href="/finance/reports"
              className="inline-flex h-10 items-center justify-center rounded-orbit border-2 border-hansan-ink bg-hansan-ivory px-4 text-sm font-bold text-hansan-ink shadow-orbit-sm transition hover:bg-hansan-surface-raised"
            >
              Settlement reports
            </Link>
          }
          resultHint="0 batches — filters and Today/History tabs narrow future batches only."
        />
        <div className="mt-4">
          <Table
            caption="Settlement batches"
            columns={[
              { key: "date", header: "Date", render: () => "—" },
              { key: "ref", header: "Batch / Reference", render: () => "—" },
              { key: "method", header: "Method", render: () => "—" },
              { key: "expected", header: "Expected", align: "right", render: () => "Rp 0" },
              { key: "actual", header: "Actual", align: "right", render: () => "Rp 0" },
              { key: "diff", header: "Diff", align: "right", render: () => "Rp 0" },
              { key: "status", header: "Status", render: () => "—" },
            ]}
            rows={[]}
            rowKey={(r) => r as unknown as string}
            emptyMessage="No settlement batches — nothing to reconcile yet."
          />
        </div>
      </Section>

      <Section eyebrow="Control" title="Approval" description="Batch close sign-off — disabled until a real batch exists.">
        <div className="rounded-sm border border-hansan-line bg-hansan-surface-raised px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-bold text-hansan-ink">Today&apos;s close — 0 batches ready</p>
            <Button disabled>Approve close</Button>
          </div>
        </div>
        <Alert tone="info" title="Why is approval disabled?" className="mt-4">
          Approval activates when a real settlement batch exists. Nothing is
          approved from an empty state, and no batch is fabricated for display.
        </Alert>
      </Section>
    </ModulePage>
  );
}
