const { registry } = require("./walletRegistry");

// Add some sample wallets
registry.upsertWallet("0xAAA", {
  label: "smart trader 1",
  category: "perps",
  winRate: 0.78,
  avgReturn: 0.42,
  accuracy: 0.81,
  style: "trend follower",
  lastAction: "accumulating BTC"
});

registry.upsertWallet("0xBBB", {
  label: "alpha sniper",
  category: "swing",
  winRate: 0.85,
  avgReturn: 0.63,
  accuracy: 0.88,
  style: "early rotation",
  lastAction: "buying ETH"
});

registry.upsertWallet("0xCCC", {
  label: "random whale",
  category: "unknown",
  winRate: 0.45,
  avgReturn: 0.1,
  accuracy: 0.4,
  style: "random",
  lastAction: "large transfer"
});

// Print smart wallets
console.log("\nSMART WALLETS:\n");
console.log(registry.getSmartWallets());

// Score one wallet
console.log("\nSCORE 0xBBB:", registry.scoreWallet("0xBBB"));z