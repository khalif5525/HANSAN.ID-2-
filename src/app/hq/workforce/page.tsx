"use client";

import * as React from "react";
import { ModulePage } from "@/components/shared/module-page";
import { Section } from "@/components/ui/section";
import { Tabs } from "@/components/ui/tabs";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { Table } from "@/components/ui/table";

const STAFF_TABS = [
  { value: "staff", label: "Staff" },
  { value: "attendance", label: "Attendance" },
  { value: "performance", label: "Performance" },
];

/**
 * HQ Workforce — staff shell (UI sprint).
 * Tabs + toolbar + table are structural only; dev sign-in accounts
 * are UI identities, never staff records. Rows stay [].
 */
export default function HqWorkforcePage() {
  const [tab, setTab] = React.useState("staff");
  const [search, setSearch] = React.useState("");
  const [role, setRole] = React.useState("all");

  return (
    <ModulePage
      breadcrumbs={[{ label: "HQ", href: "/hq" }, { label: "Workforce" }]}
      title="Workforce"
      purpose="Staff management: employee records, roles, shifts, and attendance per outlet."
      status={{
        label: "0 employees",
        detail:
          "No employee records exist. The five development sign-in accounts are UI identities only and are not staff records.",
      }}
      nextAction="After backend launch, import employees and assign POS/KDS shifts to activate scheduling."
    >
      <Section eyebrow="Team" title="Staff directory" description="Role filter previews future narrowing — zero records for now.">
        <Tabs label="Workforce view" items={STAFF_TABS} value={tab} onChange={setTab} />
        <div className="mt-4">
          <ListToolbar
            label="Filter staff"
            searchValue={search}
            onSearchChange={setSearch}
            onClearSearch={() => setSearch("")}
            searchPlaceholder="Search staff (no records yet)"
            filters={[
              {
                id: "role",
                label: "Role",
                value: role,
                options: [
                  { value: "all", label: "All roles" },
                  { value: "manager", label: "Manager" },
                  { value: "cashier", label: "Cashier" },
                  { value: "kitchen", label: "Kitchen" },
                  { value: "bar", label: "Bar" },
                ],
                onChange: setRole,
              },
            ]}
            resultHint="0 employees · 0 attendance records — filters narrow future records only."
          />
        </div>
        <div className="mt-4">
          <Table
            caption="Staff"
            columns={[
              { key: "name", header: "Staff", render: () => "—" },
              { key: "role", header: "Role", render: () => "—" },
              { key: "outlet", header: "Outlet", render: () => "—" },
              { key: "status", header: "Status", render: () => "—" },
            ]}
            rows={[]}
            rowKey={(r) => r as unknown as string}
            emptyMessage="No employee records exist yet."
          />
        </div>
      </Section>
    </ModulePage>
  );
}
