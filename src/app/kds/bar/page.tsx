import { ModulePage } from "@/components/shared/module-page";
import { Section } from "@/components/ui/section";
import { StatStrip } from "@/components/ui/stat-strip";
import { StationTicketBoard } from "@/components/modules/kds/ticket-board";

/**
 * KDS — Bar view. Station board renders Bar tickets only (pre-split
 * by buildTickets); with no backend orders it shows the honest empty
 * state. Kitchen items never appear here.
 */
export default function KdsBarPage() {
  return (
    <ModulePage
      breadcrumbs={[{ label: "KDS", href: "/kds" }, { label: "Bar" }]}
      title="Bar"
      purpose="Bar ticket board: beverage and barista orders, separated from the kitchen queue."
      status={{
        label: "No active orders",
        detail:
          "No bar tickets are queued. The board reads only from real POS orders — nothing is simulated.",
      }}
      nextAction="Bar items tagged in the catalog route here once POS → KDS wiring is live (post-freeze backend)."
      actionLabel="Back to kitchen"
      actionHref="/kds"
    >
      <Section eyebrow="Board" title="Live queue" description="Drink counts stay at zero until the first real ticket lands.">
        <StatStrip
          items={[
            { label: "New", value: "0", hint: "Awaiting prep" },
            { label: "Preparing", value: "0", hint: "On the bar" },
            { label: "Ready", value: "0", hint: "Awaiting pickup" },
            { label: "Oldest wait", value: "—", hint: "No tickets queued" },
          ]}
        />
      </Section>

      <Section eyebrow="Bar" title="Bar tickets" description="Beverages only — food items route to the Kitchen board.">
        <StationTicketBoard
          station="bar"
          tickets={[]}
          emptyTitle="Bar queue is empty"
          emptyDescription="Drink tickets from real POS orders will fire here — item, size, ice/sugar, milk, and add-ons included. Nothing is simulated."
        />
      </Section>
    </ModulePage>
  );
}
