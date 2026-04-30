// ================================
// DECISION GATE (NO NOISE TRADING)
// ================================

function decisionGate({ score, signals }) {

  const hasWalletActivity = signals.some(s => s.type === "wallet");
  const hasMarketStructure = signals.some(s => s.type === "market");
  const hasNews = signals.some(s => s.type === "news");

  // RULE 1: must have structure + at least 2 signal types
  const signalDiversity =
    [hasWalletActivity, hasMarketStructure, hasNews]
      .filter(Boolean).length;

  // RULE 2: minimum edge requirement
  if (score < 0.62) {
    return {
      allowTrade: false,
      reason: "low edge"
    };
  }

  // RULE 3: no single-source trades
  if (signalDiversity < 2) {
    return {
      allowTrade: false,
      reason: "weak confluence"
    };
  }

  return {
    allowTrade: true,
    reason: "valid edge"
  };
}

module.exports = { decisionGate };