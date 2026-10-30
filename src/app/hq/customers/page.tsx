"use client";

import * as React from "react";
import { ModulePage } from "@/components/shared/module-page";
import { Section } from "@/components/ui/section";
import { Tabs } from "@/components/ui/tabs";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { Table } from "@/components/ui/table";
import { Alert } from "@/components/ui/alert";

const CUSTOMER_TABS = [
  { value: "all", label: "All" },
  { value: "members", label: "Members" },
  { value: "guests", label: "Guests" },
];

/**
 * HQ Customers — CRM shell (UI sprint).
 * Tabs + toolbar + table are structural only: no customer, loyalty,
 * or visit records are created here. Rows stay [] per §4.
 */
export default function HqCustomersPage() {
  const [tab, setTab] = React.useState("all");
  const [search, setSearch] = React.useState("");
  const [segment, setSegment] = React.useState("all");

  return (
    <ModulePage
      breadcrumbs={[{ label: "HQ", href: "/hq" }, { label: "Customers" }]}
      title="Customers"
      purpose="Customer records: profiles, loyalty state, visit history, and consent preferences."
      status={{
        label: "0 customers",
        detail:
          "No customer records exist. Counts stay at zero — no demo or placeholder people are ever created (§4).",
      }}
      nextAction="Enable customer capture at POS (name/phone at checkout) to start building real customer records."
    >
      <Section eyebrow="CRM" title="Customer directory" description="Search + segment filters preview the future CRM — every count stays zero.">
        <Tabs label="Customer segment" items={CUSTOMER_TABS} value={tab} onChange={setTab} />
        <div className="mt-4">
          <ListToolbar
            label="Filter customers"
            searchValue={search}
            onSearchChange={setSearch}
            onClearSearch={() => setSearch("")}
            searchPlaceholder="Search name or phone (no records yet)"
            filters={[
              {
                id: "segment",
                label: "Segment",
                value: segment,
                options: [
                  { value: "all", label: "All segments" },
                  { value: "new", label: "New" },
                  { value: "returning", label: "Returning" },
                  { value: "loyal", label: "Loyal" },
                ],
                onChange: setSegment,
              },
            ]}
            resultHint="0 customers · 0 loyalty members — search and segments narrow future records only."
          />
        </div>
        <div className="mt-4">
          <Table
            caption="Customers"
            columns={[
              { key: "name", header: "Customer", render: () => "—" },
              { key: "visits", header: "Visits", align: "right", render: () => "—" },
              { key: "points", header: "Points", align: "right", render: () => "—" },
              { key: "last-visit", header: "Last visit", render: () => "—" },
            ]}
            rows={[]}
            rowKey={(r) => r as unknown as string}
            emptyMessage="No customer records exist yet."
          />
        </div>
        <Alert tone="info" title="Loyalty waits for members" className="mt-4">
          Points, vouchers, and visit history attach here once POS starts capturing
          real customers after the backend phase.
        </Alert>
      </Section>
    </ModulePage>
  );
}
