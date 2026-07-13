import { BETA_TERMS_VERSION } from "@/lib/legal";

export default function TermsPage() {
  return (
    <main className="page legal-page">
      <span className="tag">Before you play</span>
      <h1>Beta Terms of Use</h1>
      <p className="muted">Version {BETA_TERMS_VERSION}. These beta terms apply only to FinalWhistle’s devnet test environment.</p>
      <section className="nb-card">
        <h2>Test environment only</h2>
        <p>FinalWhistle is an experimental product. It uses Solana devnet and test tokens only. Test tokens have no cash value and must not be treated as money, an investment, or a promise of a prize.</p>
        <h2>Eligibility and responsible use</h2>
        <p>By connecting a wallet or submitting a transaction, you confirm that you are legally permitted to use this beta, meet the age requirement in the Eligibility Notice, and will not use it where this type of activity is prohibited.</p>
        <h2>No guarantee of availability</h2>
        <p>Match data, proof services, wallets, devnet, and the application can be delayed, unavailable, changed, or reset. Do not rely on the beta for a material decision.</p>
        <h2>On-chain activity is public</h2>
        <p>Wallet addresses, transaction signatures, market state, and token transfers on Solana devnet are public. Do not submit personal or sensitive information in market labels, wallet notes, or transaction metadata.</p>
        <h2>Beta feedback and changes</h2>
        <p>We may change, pause, or end the beta and its eligibility rules at any time. A new terms version requires a fresh acknowledgement before further signed requests.</p>
      </section>
    </main>
  );
}
