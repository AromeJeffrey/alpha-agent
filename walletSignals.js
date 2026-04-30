// ================================
// WALLET SIGNALS MODULE
// ================================

async function getWalletSignals() {
  // Replace later with real on-chain logic
  return [
    {
      type: "wallet",
      action: "buy",
      strength: 0.7,
      label: "whale accumulation detected"
    },
    {
      type: "wallet",
      action: "sell",
      strength: 0.4,
      label: "distribution detected"
    }
  ];
}

module.exports = { getWalletSignals };