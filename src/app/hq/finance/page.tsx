import Link from "next/link";
import { ModulePage } from "@/components/shared/module-page";
import { Section } from "@/components/ui/section";
import { StatStrip } from "@/components/ui/stat-strip";
import { Alert } from "@/components/ui/alert";

/**
 * HQ Finance — management entry point (owner role).
 * Consolidated lens only: summary strips + directory links to the
 * canonical Finance workspace. Never duplicates ledger tables —
 * detail lives once in /finance/*. Dev-role gates mean owner links
 * to /finance/* show wrong-role until post-backend RBAC lands.
 */
export default function HqFinancePage() {
  return (
    <ModulePage
      breadcrumbs={[{ label: "HQ", href: "/hq" }, { label: "Finance" }]}
      title="Finance"
      purpose="HQ-level financial lens: summarized revenue, expenses, and cash position across outlets."
      status={{
        label: "Rp 0 · no postings",
        detail:
          "No financial postings exist. All amounts show Rp 0 — no estimates or projections are fabricated (§4).",
      }}
      nextAction="Detailed ledgers live in the Finance workspace; here you will later review consolidated HQ figures."
    >
      <Section eyebrow="Money" title="Consolidated today" description="True zeros — detail lives in the Finance workspace.">
        <StatStrip
          items={[
            { label: "Net revenue", value: "Rp 0", hint: "No postings" },
            { label: "Settlement", value: "Rp 0", hint: "Nothing reconciled" },
            { label: "Discrepancy", value: "Rp 0", hint: "Nothing to reconcile" },
            { label: "Pending refunds", value: "0", hint: "None requested" },
          ]}
        />
      </Section>

      <Section eyebrow="Directory" title="Finance workspace" description="Canonical detail — one implementation per concept, no HQ duplicates.">
        <ul className="grid gap-px overflow-hidden rounded-sm border border-hansan-line bg-hansan-line sm:grid-cols-2">
          {[
            { href: "/finance/transactions", title: "Transactions", hint: "Ledger of every posting" },
            { href: "/finance/settlement", title: "Settlement", hint: "Daily close + approval" },
            { href: "/finance/refunds", title: "Refunds", hint: "Approval queue" },
            { href: "/finance/reports", title: "Reports", hint: "Exports + audit packs" },
          ].map((item) => (
            <li key={item.href} className="bg-hansan-surface-raised">
              <Link href={item.href} className="group block px-5 py-4 transition hover:bg-hansan-surface-soft">
                <span className="block text-sm font-bold text-hansan-ink group-hover:underline group-hover:decoration-hansan-orange group-hover:underline-offset-4">
                  {item.title} →
                </span>
                <span className="mt-0.5 block text-xs text-hansan-ink-muted">{item.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Alert tone="info" title="Dev-role note" className="mt-4">
          Owner links to the Finance workspace show a wrong-role gate during
          the UI sprint (finance role only). Post-backend RBAC grants owners
          read access — no duplicated HQ ledger needed.
        </Alert>
      </Section>
    </ModulePage>
  );
}
