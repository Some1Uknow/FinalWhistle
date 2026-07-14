"use client";

import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export function AppWalletButton() {
  return (
    <div className="app-wallet-control">
      <WalletMultiButton />
    </div>
  );
}
