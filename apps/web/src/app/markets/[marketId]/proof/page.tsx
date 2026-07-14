import { ProofReceipt, SectionTag } from "@/components/nb";
import { getMarket } from "@/server/db";
import { notFound } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ProofPage({ params }: { params: Promise<{ marketId: string }> }) {
  const { marketId } = await params;
  const market = await getMarket(marketId);
  if (!market) notFound();
  const receipt = {
    fixtureId: market.fixtureId,
    template: market.template,
    predicate: market.predicate,
    status: market.status,
    winningSide: market.winningSide,
    txlineSeq: market.txlineSeq,
    proofHash: market.proofHash,
    settlementMode: "Recorded with a verified result proof"
  };

  return (
    <main className="page">
      <section className="section-head">
        <div>
          <SectionTag>Match result</SectionTag>
          <h1>The final word</h1>
        </div>
      </section>
      <ProofReceipt receipt={receipt} />
    </main>
  );
}
