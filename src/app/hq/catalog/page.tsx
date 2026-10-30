"use client";

import * as React from "react";
import { ModulePage } from "@/components/shared/module-page";
import { Section } from "@/components/ui/section";
import { Tabs } from "@/components/ui/tabs";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { Table } from "@/components/ui/table";
import { Alert } from "@/components/ui/alert";

const CATALOG_TABS = [
  { value: "products", label: "Products" },
  { value: "categories", label: "Categories" },
  { value: "modifiers", label: "Modifiers" },
];

/**
 * HQ Catalog — product-master shell (UI sprint).
 * Tab + toolbar + table structure only: rows stay [] until the backend
 * phase persists categories → products → modifiers.
 */
export default function HqCatalogPage() {
  const [tab, setTab] = React.useState("products");
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [category, setCategory] = React.useState("all");

  return (
    <ModulePage
      breadcrumbs={[{ label: "HQ", href: "/hq" }, { label: "Catalog" }]}
      title="Catalog"
      purpose="Product master: categories, products, modifiers, pricing, and availability that feed POS and KDS."
      status={{
        label: "0 products",
        detail:
          "The catalog is empty — no categories or products exist yet. POS menu and KDS tickets will read from this catalog once it is populated (post-freeze backend).",
      }}
      nextAction="Design the category → product → modifier hierarchy here first; every other workspace depends on this catalog."
    >
      <Section eyebrow="Master" title="Catalog structure" description="Tabs switch the structure being reviewed — all counts stay zero for now.">
        <Tabs label="Catalog view" items={CATALOG_TABS} value={tab} onChange={setTab} />
        <div className="mt-4">
          <ListToolbar
            label="Filter catalog"
            searchValue={search}
            onSearchChange={setSearch}
            onClearSearch={() => setSearch("")}
            searchPlaceholder="Search products (catalog is empty)"
            filters={[
              {
                id: "category",
                label: "Category",
                value: category,
                options: [{ value: "all", label: "All categories" }],
                onChange: setCategory,
              },
              {
                id: "status",
                label: "Status",
                value: status,
                options: [
                  { value: "all", label: "All statuses" },
                  { value: "active", label: "Active" },
                  { value: "hidden", label: "Hidden" },
                  { value: "archived", label: "Archived" },
                ],
                onChange: setStatus,
              },
            ]}
            resultHint="0 products · 0 categories · 0 modifiers — filters narrow future records, they never create them."
          />
        </div>
        <div className="mt-4">
          <Table
            caption="Catalog records"
            columns={[
              { key: "name", header: "Name", render: () => "—" },
              { key: "category", header: "Category", render: () => "—" },
              { key: "price", header: "Price", align: "right", render: () => "Rp 0" },
              { key: "status", header: "Status", render: () => "—" },
            ]}
            rows={[]}
            rowKey={(r) => r as unknown as string}
            emptyMessage="Catalog is empty — no categories or products exist yet."
          />
        </div>
        <Alert tone="info" title="Dependency order" className="mt-4">
          Catalog first: POS menu, KDS routing, and inventory recipes all read from
          this master once records are persisted after the backend phase.
        </Alert>
      </Section>
    </ModulePage>
  );
}
