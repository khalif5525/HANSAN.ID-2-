"use client";

import * as React from "react";
import { ModulePage } from "@/components/shared/module-page";
import { Section } from "@/components/ui/section";
import { Tabs } from "@/components/ui/tabs";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { Table } from "@/components/ui/table";

const PO_TABS = [
  { value: "suppliers", label: "Suppliers" },
  { value: "orders", label: "Purchase orders" },
  { value: "receiving", label: "Receiving" },
];

/**
 * HQ Purchasing — procurement shell (UI sprint).
 * Tabs + toolbar + table are structural only; rows stay [] until
 * suppliers and purchase orders exist post-freeze.
 */
export default function HqPurchasingPage() {
  const [tab, setTab] = React.useState("suppliers");
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState("all");

  return (
    <ModulePage
      breadcrumbs={[{ label: "HQ", href: "/hq" }, { label: "Purchasing" }]}
      title="Purchasing"
      purpose="Supplier and purchase-order management: quotes, receiving, and supplier cost history."
      status={{
        label: "No suppliers or orders",
        detail:
          "No suppliers, purchase orders, or receipts exist. This module is structural only during the UI sprint.",
      }}
      nextAction="Register suppliers and create the first purchase order once inventory items are defined."
    >
      <Section eyebrow="Procurement" title="Suppliers & orders" description="Tabs separate suppliers, orders, and receiving — all empty for now.">
        <Tabs label="Purchasing view" items={PO_TABS} value={tab} onChange={setTab} />
        <div className="mt-4">
          <ListToolbar
            label="Filter purchasing records"
            searchValue={search}
            onSearchChange={setSearch}
            onClearSearch={() => setSearch("")}
            searchPlaceholder="Search suppliers or POs (none yet)"
            filters={[
              {
                id: "status",
                label: "Status",
                value: status,
                options: [
                  { value: "all", label: "All statuses" },
                  { value: "draft", label: "Draft" },
                  { value: "sent", label: "Sent" },
                  { value: "received", label: "Received" },
                ],
                onChange: setStatus,
              },
            ]}
            resultHint="0 suppliers · 0 purchase orders — filters narrow future records only."
          />
        </div>
        <div className="mt-4">
          <Table
            caption="Purchasing records"
            columns={[
              { key: "ref", header: "Reference", render: () => "—" },
              { key: "supplier", header: "Supplier", render: () => "—" },
              { key: "status", header: "Status", render: () => "—" },
              { key: "total", header: "Total", align: "right", render: () => "Rp 0" },
            ]}
            rows={[]}
            rowKey={(r) => r as unknown as string}
            emptyMessage="No suppliers, purchase orders, or receipts exist yet."
          />
        </div>
      </Section>
    </ModulePage>
  );
}
