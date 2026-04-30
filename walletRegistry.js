// walletRegistry.js

/*
  Wallet Registry System
  ----------------------
  Tracks smart wallets and their behavioral profiles.

  This is NOT live blockchain tracking yet.
  It is the structure we will feed data into later.
*/

class WalletRegistry {
  constructor() {
    this.wallets = new Map();
  }

  // Add or update a wallet
  upsertWallet(address, data = {}) {
    const existing = this.wallets.get(address);

    const updated = {
      address,

      label: data.label || existing?.label || "unknown",
      category: data.category || existing?.category || "unclassified",

      // performance metrics
      winRate: data.winRate ?? existing?.winRate ?? 0.5,
      avgReturn: data.avgReturn ?? existing?.avgReturn ?? 0,
      accuracy: data.accuracy ?? existing?.accuracy ?? 0.5,

      // behavior traits
      style: data.style || existing?.style || "neutral", 
      typicalHold: data.typicalHold || existing?.typicalHold || "unknown",

      // latest activity
      lastAction: data.lastAction || existing?.lastAction || null,
      lastUpdated: Date.now()
    };

    this.wallets.set(address, updated);
    return updated;
  }

  // Get a wallet
  getWallet(address) {
    return this.wallets.get(address) || null;
  }

  // Score a wallet (core alpha metric)
  scoreWallet(address) {
    const w = this.wallets.get(address);
    if (!w) return 0;

    const score =
      (w.winRate * 0.4) +
      (w.accuracy * 0.4) +
      (Math.min(w.avgReturn, 1) * 0.2);

    return Number(score.toFixed(3));
  }

  // Get all high quality wallets
  getSmartWallets(threshold = 0.65) {
    const result = [];

    for (const [address, wallet] of this.wallets.entries()) {
      const score = this.scoreWallet(address);

      if (score >= threshold) {
        result.push({
          ...wallet,
          score
        });
      }
    }

    return result.sort((a, b) => b.score - a.score);
  }
}

// singleton instance (important)
const registry = new WalletRegistry();

module.exports = {
  registry
};