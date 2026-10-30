/**
 * HANSAN Route Registry — §15 / Phase 3.
 * Cline owns this file. Copilot MUST NOT independently add top-level
 * routes or restructure workspaces; propose changes to Cline instead.
 *
 * Phase 0: only `/` and `/api/health` exist as real routes.
 * All workspace routes below are DECLARED (contracts for Phase 7+)
 * but NOT YET IMPLEMENTED — Copilot builds them per handoff.
 */

import type { DevRole } from "@/types/roles";

export interface WorkspaceRoute {
  path: string;
  label: string;
  roles: DevRole[];
  /** Implementation phase that owns building this route. */
  phase: string;
  implemented: boolean;
}

export const WORKSPACE_ROUTES: WorkspaceRoute[] = [
  { path: "/", label: "Landing", roles: ["developer", "owner", "pos", "kds", "finance"], phase: "Phase 0", implemented: true },
  { path: "/login", label: "Development Sign-in", roles: ["developer", "owner", "pos", "kds", "finance"], phase: "Phase 7", implemented: true },
  { path: "/hq", label: "HQ / Owner", roles: ["owner"], phase: "Phase 8", implemented: true },
  { path: "/pos", label: "POS", roles: ["pos"], phase: "Phase 9", implemented: true },
  { path: "/kds", label: "KDS", roles: ["kds"], phase: "Phase 10", implemented: true },
  { path: "/finance", label: "Finance", roles: ["finance"], phase: "Phase 11", implemented: true },
  { path: "/developer", label: "Developer", roles: ["developer"], phase: "Phase 12", implemented: true },
];

/**
 * Sub-navigation contract: each workspace's section pages.
 * Sidebar renders these under the active workspace (Phase 8+).
 * The first entry (root path) is the workspace overview/home.
 */
export interface WorkspaceSection {
  path: string;
  label: string;
}

/**
 * Grouped catalog IA (HANSAN-UI-UX-DESIGN-DIRECTION.md § Catalog).
 * Groups are presentation-only: they organize the flat WORKSPACE_SECTIONS
 * contract above into labeled clusters so owners can tell operate /
 * configure / review apart. Paths and labels MUST match WORKSPACE_SECTIONS
 * entries — Sidebar renders from these groups.
 */
export interface WorkspaceSectionGroup {
  id: string;
  label: string;
  hint: string;
  sections: WorkspaceSection[];
}

export const WORKSPACE_SECTION_GROUPS: Record<string, WorkspaceSectionGroup[]> = {
  "/hq": [
    {
      id: "command",
      label: "Command",
      hint: "Daily oversight",
      sections: [
        { path: "/hq", label: "Overview" },
        { path: "/hq/operations", label: "Operations" },
        { path: "/hq/analytics", label: "Analytics" },
        { path: "/hq/reports", label: "Reports" },
      ],
    },
    {
      id: "offer",
      label: "Offer",
      hint: "What guests buy",
      sections: [
        { path: "/hq/catalog", label: "Catalog" },
        { path: "/hq/marketing", label: "Marketing" },
        { path: "/hq/customers", label: "Customers" },
      ],
    },
    {
      id: "supply",
      label: "Supply",
      hint: "What the kitchen consumes",
      sections: [
        { path: "/hq/inventory", label: "Inventory" },
        { path: "/hq/purchasing", label: "Purchasing" },
      ],
    },
    {
      id: "organization",
      label: "Organization",
      hint: "People, money, system",
      sections: [
        { path: "/hq/workforce", label: "Workforce" },
        { path: "/hq/finance", label: "Finance" },
        { path: "/hq/integrations", label: "Integrations" },
        { path: "/hq/settings", label: "Settings" },
      ],
    },
  ],
  "/pos": [
    {
      id: "flow",
      label: "Order flow",
      hint: "Follow in order",
      sections: [
        { path: "/pos", label: "POS Home" },
        { path: "/pos/order-type", label: "Order Type" },
        { path: "/pos/table", label: "Table / Customer" },
        { path: "/pos/menu", label: "Menu" },
        { path: "/pos/cart", label: "Cart" },
        { path: "/pos/payment", label: "Payment" },
        { path: "/pos/receipt", label: "Receipt" },
      ],
    },
    {
      id: "review",
      label: "Review",
      hint: "After the sale",
      sections: [{ path: "/pos/history", label: "History" }],
    },
  ],
  "/kds": [
    {
      id: "stations",
      label: "Stations",
      hint: "Where to cook",
      sections: [
        { path: "/kds", label: "Kitchen" },
        { path: "/kds/bar", label: "Bar" },
        { path: "/kds/all", label: "All Orders" },
      ],
    },
    {
      id: "triage",
      label: "Triage",
      hint: "What needs attention",
      sections: [
        { path: "/kds/priority", label: "Priority" },
        { path: "/kds/completed", label: "Completed" },
      ],
    },
  ],
  "/finance": [
    {
      id: "money",
      label: "Money movement",
      hint: "Verify daily",
      sections: [
        { path: "/finance", label: "Overview" },
        { path: "/finance/transactions", label: "Transactions" },
        { path: "/finance/settlement", label: "Settlement" },
        { path: "/finance/revenue", label: "Revenue" },
        { path: "/finance/expenses", label: "Expenses" },
      ],
    },
    {
      id: "control",
      label: "Control",
      hint: "Approvals + compliance",
      sections: [
        { path: "/finance/refunds", label: "Refunds" },
        { path: "/finance/tax", label: "Tax" },
        { path: "/finance/reports", label: "Reports" },
      ],
    },
  ],
  "/developer": [
    {
      id: "runtime",
      label: "Runtime",
      hint: "Is it healthy",
      sections: [
        { path: "/developer", label: "System Health" },
        { path: "/developer/environment", label: "Environment" },
        { path: "/developer/database", label: "Database" },
        { path: "/developer/api", label: "API" },
      ],
    },
    {
      id: "governance",
      label: "Governance",
      hint: "Change + access",
      sections: [
        { path: "/developer/integrations", label: "Integrations" },
        { path: "/developer/audit", label: "Audit" },
        { path: "/developer/configuration", label: "Configuration" },
      ],
    },
  ],
};

export const WORKSPACE_SECTIONS: Record<string, WorkspaceSection[]> = {
  "/hq": [
    { path: "/hq", label: "Overview" },
    { path: "/hq/operations", label: "Operations" },
    { path: "/hq/catalog", label: "Catalog" },
    { path: "/hq/inventory", label: "Inventory" },
    { path: "/hq/purchasing", label: "Purchasing" },
    { path: "/hq/customers", label: "Customers" },
    { path: "/hq/marketing", label: "Marketing" },
    { path: "/hq/workforce", label: "Workforce" },
    { path: "/hq/finance", label: "Finance" },
    { path: "/hq/analytics", label: "Analytics" },
    { path: "/hq/reports", label: "Reports" },
    { path: "/hq/integrations", label: "Integrations" },
    { path: "/hq/settings", label: "Settings" },
  ],
  "/pos": [
    { path: "/pos", label: "POS Home" },
    { path: "/pos/order-type", label: "Order Type" },
    { path: "/pos/table", label: "Table / Customer" },
    { path: "/pos/menu", label: "Menu" },
    { path: "/pos/cart", label: "Cart" },
    { path: "/pos/payment", label: "Payment" },
    { path: "/pos/receipt", label: "Receipt" },
    { path: "/pos/history", label: "History" },
  ],
  "/kds": [
    { path: "/kds", label: "Kitchen" },
    { path: "/kds/bar", label: "Bar" },
    { path: "/kds/all", label: "All Orders" },
    { path: "/kds/priority", label: "Priority" },
    { path: "/kds/completed", label: "Completed" },
  ],
  "/finance": [
    { path: "/finance", label: "Overview" },
    { path: "/finance/transactions", label: "Transactions" },
    { path: "/finance/settlement", label: "Settlement" },
    { path: "/finance/revenue", label: "Revenue" },
    { path: "/finance/expenses", label: "Expenses" },
    { path: "/finance/refunds", label: "Refunds" },
    { path: "/finance/tax", label: "Tax" },
    { path: "/finance/reports", label: "Reports" },
  ],
  "/developer": [
    { path: "/developer", label: "System Health" },
    { path: "/developer/environment", label: "Environment" },
    { path: "/developer/database", label: "Database" },
    { path: "/developer/api", label: "API" },
    { path: "/developer/integrations", label: "Integrations" },
    { path: "/developer/audit", label: "Audit" },
    { path: "/developer/configuration", label: "Configuration" },
  ],
};

export function homeForRole(role: DevRole): string {
  return WORKSPACE_ROUTES.find((r) => r.roles.includes(role) && r.path !== "/" && r.path !== "/login")?.path ?? "/";
}
