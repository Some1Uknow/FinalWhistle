export default function PrivacyPage() {
  return (
    <main className="page legal-page">
      <span className="tag">Your privacy</span>
      <h1>Privacy Notice</h1>
      <section className="nb-card">
        <h2>What the beta processes</h2>
        <p>FinalWhistle processes the public wallet address you connect, signed request metadata, transaction signatures, market and position records, and the fixture/proof data needed to operate the beta.</p>
        <h2>Public blockchain data</h2>
        <p>Solana devnet transactions and account data are public by design. We cannot make on-chain data private, erase it from the chain, or control independent indexers and explorers.</p>
        <h2>Why we use this data</h2>
        <p>We use it to authenticate requests, prevent replay, index actions users have already performed on-chain, display markets and receipts, operate rate limits, and troubleshoot the beta.</p>
        <h2>Minimize what you share</h2>
        <p>Do not place personal, financial, health, or other sensitive information in public inputs. Use a devnet wallet that is separate from any wallet holding assets of value.</p>
        <h2>Beta retention</h2>
        <p>Beta records may be retained while the service is operated for security, integrity, and debugging. This notice will be replaced with counsel-approved production privacy terms before any non-devnet launch.</p>
      </section>
    </main>
  );
}
