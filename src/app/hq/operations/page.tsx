"use client";

import * as React from "react";
import { ModulePage } from "@/components/shared/module-page";
import { Section } from "@/components/ui/section";
import { StatStrip } from "@/components/ui/stat-strip";
import { Tabs } from "@/components/ui/tabs";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { Table } from "@/components/ui/table";
import { Alert } from "@/components/ui/alert";

const QUEUE_TABS = [
  { value: "all", label: "All" },
  { value: "dine-in", label: "Dine-in" },
  { value: "take-away", label: "Take-away" },
  { value: "online", label: "Online" },
];

/**
 * HQ Operations — live-ops watchtower shell (UI sprint).
 * Tabs + toolbar + queue table are structural only: rows stay [] and
 * every metric stays zero until outlets + POS orders exist post-freeze.
 */
export default function HqOperationsPage() {
  const [queue, setQueue] = React.useState("all");
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [outlet, setOutlet] = React.useState("all");

  return (
    <ModulePage
      breadcrumbs={[{ label: "HQ", href: "/hq" }, { label: "Operations" }]}
      title="Operations"
      purpose="Day-to-day outlet supervision: service flow, live order queues, and outlet health in one view."
      status={{
        label: "No active operations",
        detail:
          "No outlets, tables, or orders are configured yet. Live operational views populate once outlets are set up and orders flow through POS.",
      }}
      nextAction="Define outlets and floor structure first, then this page becomes the live operations watchtower during service hours."
    >
      <Section eyebrow="Live" title="Service right now" description="True zeros until the first real order fires.">
        <StatStrip
          items={[
            { label: "Active orders", value: "0", hint: "No tickets in any state" },
            { label: "Dine-in", value: "0", hint: "No seated parties" },
            { label: "Take-away + online", value: "0", hint: "No off-premise orders" },
            { label: "Oldest wait", value: "—", hint: "Queue is empty" },
          ]}
        />
      </Section>

      <Section eyebrow="Queue" title="Order queue" description="Channel tabs + filters narrow the live queue — they never invent rows.">
        <Tabs label="Order channel" items={QUEUE_TABS} value={queue} onChange={setQueue} />
        <div className="mt-4">
          <ListToolbar
            label="Filter live queue"
            searchValue={search}
            onSearchChange={setSearch}
            onClearSearch={() => setSearch("")}
            searchPlaceholder="Search ticket or table (no tickets yet)"
            filters={[
              {
                id: "status",
                label: "Status",
                value: status,
                options: [
                  { value: "all", label: "All states" },
                  { value: "new", label: "New" },
                  { value: "preparing", label: "Preparing" },
                  { value: "ready", label: "Ready" },
                ],
                onChange: setStatus,
              },
              {
                id: "outlet",
                label: "Outlet",
                value: outlet,
                options: [{ value: "all", label: "All outlets" }],
                onChange: setOutlet,
              },
            ]}
            resultHint="0 tickets · channel, search, and filters narrow the live queue but never invent rows."
          />
        </div>
        <div className="mt-4">
          <Table
            caption="Live order queue"
            columns={[
              { key: "ticket", header: "Ticket", render: () => "—" },
              { key: "table", header: "Table", render: () => "—" },
              { key: "channel", header: "Channel", render: () => "—" },
              { key: "state", header: "State", render: () => "—" },
              { key: "age", header: "Age", align: "right", render: () => "—" },
            ]}
            rows={[]}
            rowKey={(r) => r as unknown as string}
            emptyMessage="No active orders — the queue stays empty until POS sends the first real ticket."
          />
        </div>
        <Alert tone="info" title="How this becomes live" className="mt-4">
          Outlets + floor plans (HQ → Settings) feed this board; POS order states (new →
          preparing → ready) stream each ticket here after the backend phase.
        </Alert>
      </Section>
    </ModulePage>
  );
}
