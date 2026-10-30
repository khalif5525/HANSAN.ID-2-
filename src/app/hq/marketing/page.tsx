"use client";

import * as React from "react";
import { ModulePage } from "@/components/shared/module-page";
import { Section } from "@/components/ui/section";
import { Tabs } from "@/components/ui/tabs";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { Table } from "@/components/ui/table";
import { Alert } from "@/components/ui/alert";

const PROMO_TABS = [
  { value: "campaigns", label: "Campaigns" },
  { value: "vouchers", label: "Vouchers" },
];

/**
 * HQ Marketing — promotions shell (UI sprint).
 * Tabs + toolbar + table are structural only; rows stay [] until
 * campaigns attach to catalog products post-freeze.
 */
export default function HqMarketingPage() {
  const [tab, setTab] = React.useState("campaigns");
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState("all");

  return (
    <ModulePage
      breadcrumbs={[{ label: "HQ", href: "/hq" }, { label: "Marketing" }]}
      title="Marketing"
      purpose="Promotions engine: discounts, campaigns, vouchers, and their performance attribution."
      status={{
        label: "No campaigns",
        detail:
          "No promotions or vouchers are configured. Any campaign list will remain honestly empty until one is created.",
      }}
      nextAction="Plan a first promotion once the catalog exists — campaigns attach to products and price rules."
    >
      <Section eyebrow="Promotions" title="Campaigns & vouchers" description="Tabs separate campaigns from vouchers — both empty for now.">
        <Tabs label="Promotions view" items={PROMO_TABS} value={tab} onChange={setTab} />
        <div className="mt-4">
          <ListToolbar
            label="Filter promotions"
            searchValue={search}
            onSearchChange={setSearch}
            onClearSearch={() => setSearch("")}
            searchPlaceholder="Search campaigns (none yet)"
            filters={[
              {
                id: "status",
                label: "Status",
                value: status,
                options: [
                  { value: "all", label: "All statuses" },
                  { value: "draft", label: "Draft" },
                  { value: "active", label: "Active" },
                  { value: "ended", label: "Ended" },
                ],
                onChange: setStatus,
              },
            ]}
            resultHint="0 campaigns · 0 vouchers — filters narrow future promotions only."
          />
        </div>
        <div className="mt-4">
          <Table
            caption="Promotions"
            columns={[
              { key: "name", header: "Campaign", render: () => "—" },
              { key: "status", header: "Status", render: () => "—" },
              { key: "uses", header: "Uses", align: "right", render: () => "—" },
            ]}
            rows={[]}
            rowKey={(r) => r as unknown as string}
            emptyMessage="No promotions or vouchers configured yet."
          />
        </div>
        <Alert tone="info" title="Attribution waits for sales" className="mt-4">
          Campaign performance attaches here once promotions run against real
          orders after the backend phase.
        </Alert>
      </Section>
    </ModulePage>
  );
}
