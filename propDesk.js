// ================================
// PROP DESK RISK ENGINE
// ================================

function detectRegime(signals = []) {
  const market = signals.filter(s => s.type === "market").length;
  const news = signals.filter(s => s.type === "news").length;
  const wallet = signals.filter(s => s.type === "wallet").length;

  const total = signals.length || 1;

  const marketRatio = market / total;

  // simple regime logic (upgrade later with real volatility)
  if (marketRatio > 0.6) return "TRENDING";
  if (news > wallet) return "NEWS_DRIVEN";
  return "CHOP";
}

function propDeskGate({ score, signals }) {

  const regime = detectRegime(signals);

  // 🚫 NO TRADE ENVIRONMENTS
  if (regime === "CHOP") {
    return {
      allowTrade: false,
      reason: "choppy market"
    };
  }

  // 🚫 LOW EDGE FILTER
  if (score < 0.68) {
    return {
      allowTrade: false,
      reason: "insufficient edge"
    };
  }

  // 🚫 WEAK CONFLUENCE FILTER
  const types = new Set(signals.map(s => s.type));
  if (types.size < 3) {
    return {
      allowTrade: false,
      reason: "low confluence"
    };
  }

  // ✅ PROP DESK APPROVAL
  return {
    allowTrade: true,
    reason: "A+ setup approved",
    regime
  };
}

module.exports = { propDeskGate };