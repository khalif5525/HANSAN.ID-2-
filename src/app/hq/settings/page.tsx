"use client";

import * as React from "react";
import { ModulePage } from "@/components/shared/module-page";
import { Section } from "@/components/ui/section";
import { StatStrip } from "@/components/ui/stat-strip";
import { Tabs } from "@/components/ui/tabs";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { Table } from "@/components/ui/table";

const SETTINGS_TABS = [
  { value: "outlets", label: "Outlets" },
  { value: "tax", label: "Tax & charges" },
  { value: "receipt", label: "Receipt" },
  { value: "roles", label: "Roles" },
];

/**
 * HQ Settings — configuration shell (UI sprint).
 * Section tabs frame outlets/tax/receipt/roles; every list stays
 * rows={[]} on scaffold defaults until the backend phase.
 */
export default function HqSettingsPage() {
  const [tab, setTab] = React.useState("outlets");
  const [search, setSearch] = React.useState("");

  return (
    <ModulePage
      breadcrumbs={[{ label: "HQ", href: "/hq" }, { label: "Settings" }]}
      title="Settings"
      purpose="Workspace configuration: outlets, tax rules, receipt templates, roles, and preferences."
      status={{
        label: "Defaults only",
        detail:
          "Running on scaffold defaults. No outlets, tax profiles, or branded receipts are configured yet.",
      }}
      nextAction="Configure outlets and tax rules here first — most other modules inherit these settings."
    >
      <Section eyebrow="Configure" title="Workspace setup" description="Tabs separate each settings family — all on defaults for now.">
        <Tabs label="Settings section" items={SETTINGS_TABS} value={tab} onChange={setTab} />
        <div className="mt-4">
          <StatStrip
            items={[
              { label: "Outlets", value: "0", hint: "None configured" },
              { label: "Tax rules", value: "0", hint: "No profiles" },
              { label: "Receipts", value: "0", hint: "Default template" },
              { label: "Roles", value: "5", hint: "Dev identities only" },
            ]}
          />
        </div>
      </Section>

      <Section eyebrow="Records" title="Configuration records" description="Search previews future filtering — nothing persisted yet.">
        <ListToolbar
          label="Filter configuration records"
          searchValue={search}
          onSearchChange={setSearch}
          onClearSearch={() => setSearch("")}
          searchPlaceholder="Search settings (defaults only)"
          resultHint="0 configured records — the workspace runs on scaffold defaults."
        />
        <div className="mt-4">
          <Table
            caption="Configuration records"
            columns={[
              { key: "item", header: "Setting", render: () => "—" },
              { key: "scope", header: "Scope", render: () => "—" },
              { key: "value", header: "Value", render: () => "—" },
            ]}
            rows={[]}
            rowKey={(r) => r as unknown as string}
            emptyMessage="No configured records — defaults apply everywhere."
          />
        </div>
      </Section>
    </ModulePage>
  );
}
