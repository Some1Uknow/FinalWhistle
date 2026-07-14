import { SectionTag } from "@/components/nb";
import { PortfolioClient, WalletPanel } from "@/components/beta-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function PortfolioPage() {
  return (
    <main className="page">
      <section className="section-head">
        <div>
          <SectionTag>Account</SectionTag>
          <h1>Your picks</h1>
        </div>
      </section>
      <div className="two-col">
        <PortfolioClient />
        <WalletPanel />
      </div>
    </main>
  );
}
