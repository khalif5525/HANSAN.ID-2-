"use client";

import * as React from "react";
import { ModulePage } from "@/components/shared/module-page";
import { Section } from "@/components/ui/section";
import { StatStrip } from "@/components/ui/stat-strip";
import { Tabs } from "@/components/ui/tabs";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { Table } from "@/components/ui/table";

const RANGE_TABS = [
  { value: "today", label: "Today" },
  { value: "week", label: "7 days" },
  { value: "month", label: "30 days" },
];

/**
 * HQ Analytics — insight shell (UI sprint).
 * Period tabs + toolbar frame future analysis; every metric stays
 * zero and the table stays rows={[]} until real orders exist.
 */
export default function HqAnalyticsPage() {
  const [range, setRange] = React.useState("today");
  const [search, setSearch] = React.useState("");
  const [channel, setChannel] = React.useState("all");

  return (
    <ModulePage
      breadcrumbs={[{ label: "HQ", href: "/hq" }, { label: "Analytics" }]}
      title="Analytics"
      purpose="Exploratory analysis: sales trends, product performance, and outlet comparisons."
      status={{
        label: "No data to analyze",
        detail:
          "Analytics requires historical records; none exist yet. Charts will render honestly from zero rows rather than synthetic series.",
      }}
      nextAction="Once orders flow through POS after backend launch, this becomes the insight layer for decisions."
    >
      <Section eyebrow="Trends" title="Performance" description="Period tabs switch the analysis window — all zeros for now.">
        <Tabs label="Analysis period" items={RANGE_TABS} value={range} onChange={setRange} />
        <div className="mt-4">
          <StatStrip
            items={[
              { label: "Revenue", value: "Rp 0", hint: "No sales in period" },
              { label: "Orders", value: "0", hint: "No orders in period" },
              { label: "Avg ticket", value: "Rp 0", hint: "No tickets in period" },
              { label: "Best seller", value: "—", hint: "No products sold" },
            ]}
          />
        </div>
      </Section>

      <Section eyebrow="Breakdown" title="Product performance" description="Channel filter previews future slicing — no rows invented.">
        <ListToolbar
          label="Filter product performance"
          searchValue={search}
          onSearchChange={setSearch}
          onClearSearch={() => setSearch("")}
          searchPlaceholder="Search products (no sales yet)"
          filters={[
            {
              id: "channel",
              label: "Channel",
              value: channel,
              options: [
                { value: "all", label: "All channels" },
                { value: "dine-in", label: "Dine-in" },
                { value: "take-away", label: "Take-away" },
                { value: "online", label: "Online" },
              ],
              onChange: setChannel,
            },
          ]}
          resultHint="0 rows — filters preview how sales will be sliced once orders exist."
        />
        <div className="mt-4">
          <Table
            caption="Product performance"
            columns={[
              { key: "product", header: "Product", render: () => "—" },
              { key: "qty", header: "Qty sold", align: "right", render: () => "—" },
              { key: "revenue", header: "Revenue", align: "right", render: () => "Rp 0" },
            ]}
            rows={[]}
            rowKey={(r) => r as unknown as string}
            emptyMessage="No sales to analyze yet."
          />
        </div>
      </Section>
    </ModulePage>
  );
}
