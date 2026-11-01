"use client";

import * as React from "react";
import { ModulePage } from "@/components/shared/module-page";
import { Section } from "@/components/ui/section";
import { Tabs } from "@/components/ui/tabs";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { Table } from "@/components/ui/table";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const REPORT_TABS = [
  { value: "sales", label: "Sales" },
  { value: "products", label: "Products" },
  { value: "payments", label: "Payments" },
  { value: "staff", label: "Staff" },
];

/**
 * HQ Reports — export shell (UI sprint).
 * Template tabs + toolbar frame future generation; export buttons
 * stay disabled with honest alerts until real data exists.
 */
export default function HqReportsPage() {
  const [tab, setTab] = React.useState("sales");
  const [search, setSearch] = React.useState("");
  const [period, setPeriod] = React.useState("today");

  return (
    <ModulePage
      breadcrumbs={[{ label: "HQ", href: "/hq" }, { label: "Reports" }]}
      title="Reports"
      purpose="Scheduled and on-demand report generation: sales, inventory, labor, and financial exports."
      status={{
        label: "No reports generated",
        detail:
          "No report jobs or exports exist. Report definitions will be listed here once reporting runs on real data.",
      }}
      nextAction="Pick a report template after data exists; exports (PDF/CSV) will download from this page."
    >
      <Section eyebrow="Templates" title="Report library" description="Tabs switch the report family — every template is empty for now.">
        <Tabs label="Report family" items={REPORT_TABS} value={tab} onChange={setTab} />
        <div className="mt-4">
          <ListToolbar
            label="Filter report templates"
            searchValue={search}
            onSearchChange={setSearch}
            onClearSearch={() => setSearch("")}
            searchPlaceholder="Search templates (no reports yet)"
            filters={[
              {
                id: "period",
                label: "Period",
                value: period,
                options: [
                  { value: "today", label: "Today" },
                  { value: "week", label: "Last 7 days" },
                  { value: "month", label: "Last 30 days" },
                ],
                onChange: setPeriod,
              },
            ]}
            actions={
              <>
                <Button variant="secondary" disabled>Export PDF</Button>
                <Button variant="secondary" disabled>Export CSV</Button>
              </>
            }
            resultHint="0 reports — exports activate once real data exists."
          />
        </div>
        <div className="mt-4">
          <Table
            caption="Generated reports"
            columns={[
              { key: "name", header: "Report", render: () => "—" },
              { key: "period", header: "Period", render: () => "—" },
              { key: "created", header: "Generated", render: () => "—" },
              { key: "format", header: "Format", render: () => "—" },
            ]}
            rows={[]}
            rowKey={(r) => r as unknown as string}
            emptyMessage="No reports generated yet."
          />
        </div>
        <Alert tone="info" title="Why are exports disabled?" className="mt-4">
          PDF/CSV generation requires posted data. Buttons activate after the
          backend phase — nothing exports from an empty dataset.
        </Alert>
      </Section>
    </ModulePage>
  );
}
