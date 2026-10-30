"use client";

import * as React from "react";
import { ModulePage } from "@/components/shared/module-page";
import { Section } from "@/components/ui/section";
import { StatStrip } from "@/components/ui/stat-strip";
import { Tabs } from "@/components/ui/tabs";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { Table } from "@/components/ui/table";

const STOCK_TABS = [
  { value: "items", label: "Items" },
  { value: "movements", label: "Movements" },
  { value: "low-stock", label: "Low stock" },
];

/**
 * HQ Inventory — stock-control shell (UI sprint).
 * Structural tabs + toolbar + tables only: rows stay [] and low-stock
 * stays honest-zero until items + opening quantities persist post-freeze.
 */
export default function HqInventoryPage() {
  const [tab, setTab] = React.useState("items");
  const [search, setSearch] = React.useState("");
  const [outlet, setOutlet] = React.useState("all");
  const [status, setStatus] = React.useState("all");

  return (
    <ModulePage
      breadcrumbs={[{ label: "HQ", href: "/hq" }, { label: "Inventory" }]}
      title="Inventory"
      purpose="Stock control: items, stock levels, low-stock alerts, and movement history across outlets."
      status={{
        label: "0 items",
        detail:
          "No stock items or movements are recorded. Counts show zero because no inventory exists in this environment.",
      }}
      nextAction="After the catalog is set up, define stock items and opening quantities to activate low-stock monitoring."
    >
      <Section eyebrow="Stock" title="Levels at a glance" description="Honest zeros — thresholds only matter once items exist.">
        <StatStrip
          items={[
            { label: "Items", value: "0", hint: "No stock items defined" },
            { label: "Low stock", value: "0", hint: "Nothing below threshold" },
            { label: "Out of stock", value: "0", hint: "Nothing depleted" },
            { label: "Movements (7d)", value: "0", hint: "No receipts or usage" },
          ]}
        />
      </Section>

      <Section eyebrow="Control" title="Stock records" description="Tabs separate items, history, and alerts — all empty by design for now.">
        <Tabs label="Inventory view" items={STOCK_TABS} value={tab} onChange={setTab} />
        <div className="mt-4">
          <ListToolbar
            label="Filter inventory"
            searchValue={search}
            onSearchChange={setSearch}
            onClearSearch={() => setSearch("")}
            searchPlaceholder="Search items (no items yet)"
            filters={[
              {
                id: "outlet",
                label: "Outlet",
                value: outlet,
                options: [{ value: "all", label: "All outlets" }],
                onChange: setOutlet,
              },
              {
                id: "status",
                label: "Status",
                value: status,
                options: [
                  { value: "all", label: "All statuses" },
                  { value: "in-stock", label: "In stock" },
                  { value: "low", label: "Low stock" },
                  { value: "out", label: "Out of stock" },
                ],
                onChange: setStatus,
              },
            ]}
            resultHint="0 rows — filters preview how stock will be narrowed once items and movements exist."
          />
        </div>
        <div className="mt-4">
          <Table
            caption="Inventory records"
            columns={[
              { key: "item", header: "Item", render: () => "—" },
              { key: "outlet", header: "Outlet", render: () => "—" },
              { key: "on-hand", header: "On hand", align: "right", render: () => "—" },
              { key: "status", header: "Status", render: () => "—" },
            ]}
            rows={[]}
            rowKey={(r) => r as unknown as string}
            emptyMessage="No stock items or movements are recorded yet."
          />
        </div>
      </Section>
    </ModulePage>
  );
}
