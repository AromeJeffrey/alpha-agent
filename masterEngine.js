// ================================
// PROP DESK ENGINE (PERPS + POLYMARKET ONLY)
// ================================

// CORE DATA IMPORTS
const { getMarketSignals } = require("./signals");
const { getNewsSignals } = require("./newsSignals");
const { getMarketSnapshot } = require("./marketData");

// ================================
// 1. MARKET CONTEXT (REAL DATA LAYER)
// ================================

let marketContext = null;

async function loadMarketContext() {
  try {
    marketContext = await getMarketSnapshot("BTCUSDT");
  } catch (e) {
    marketContext = null;
  }
}

// ================================
// 2. COLLECT SIGNALS SAFELY
// ================================

function collectSignals() {
  let marketSignals = [];
  let newsSignals = [];

  try {
    const m = getMarketSignals?.();
    marketSignals = Array.isArray(m) ? m : [];
  } catch {}

  try {
    const n = getNewsSignals?.();
    newsSignals = Array.isArray(n) ? n : [];
  } catch {}

  return [...marketSignals, ...newsSignals];
}

// ================================
// 3. MARKET FLOW SIGNALS (REAL CONTEXT -> SIGNALS)
// ================================

function buildMarketFlowSignals(context) {
  const signals = [];

  if (!context?.ticker) return signals;

  const priceChange = context.ticker.change24h;
  const volume = context.ticker.volume;
  const funding = context.funding?.fundingRate || 0;

  // Trend signal
  signals.push({
    type: "market",
    strength: priceChange > 0 ? 0.7 : 0.3,
    label: `24h ${priceChange}%`
  });

  // Volume signal
  signals.push({
    type: "volume",
    strength: volume > 100000 ? 0.7 : 0.4,
    label: "volume flow"
  });

  // Funding signal (important for perps)
  signals.push({
    type: "funding",
    strength: funding > 0 ? 0.6 : 0.4,
    label: `funding ${funding}`
  });

  return signals;
}

// ================================
// 4. SCORE ENGINE (PROP DESK STYLE)
// ================================

function scoreEngine(signals) {
  if (!signals.length) return 0.5;

  let score = 0;

  for (const s of signals) {
    let weight = 0.2;

    if (s.type === "market") weight = 0.5;
    if (s.type === "volume") weight = 0.3;
    if (s.type === "funding") weight = 0.2;
    if (s.type === "news") weight = 0.1;

    score += weight * (s.strength ?? 0.5);
  }

  return Math.max(0, Math.min(1, score));
}

// ================================
// 5. PROP DESK BIAS
// ================================

function bias(score) {
  if (score >= 0.72) return "STRONG_LONG";
  if (score >= 0.60) return "LONG";
  if (score <= 0.28) return "STRONG_SHORT";
  if (score <= 0.40) return "SHORT";
  return "NO_TRADE";
}

// ================================
// 6. TRADE FILTER
// ================================

function shouldTrade(score) {
  return score >= 0.60 && score <= 0.85;
}

// ================================
// 7. MAIN ENGINE RUN
// ================================

async function runEngine() {
  await loadMarketContext();

  const rawSignals = collectSignals();
  const marketSignals = buildMarketFlowSignals(marketContext);

  const signals = [...rawSignals, ...marketSignals];

  const score = scoreEngine(signals);

  const output = {
    asset: "BTC",
    bias: bias(score),
    confidence: score,
    should_trade: shouldTrade(score),
    price: marketContext?.ticker?.price || null,
    signals: signals.map(s => s.label)
  };

  console.log("\n=== PROP DESK ENGINE ===\n");
  console.log(JSON.stringify(output, null, 2));
  console.log("\n=========================\n");

  return output;
}

// RUN IT
runEngine();