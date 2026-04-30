// ================================
// MARKET FLOW ENGINE (PROP DESK LAYER)
// Converts raw market data → tradeable regime
// ================================

const { getMarketSnapshot } = require("./marketData");

// ================================
// 1. LOAD MARKET CONTEXT
// ================================

async function loadContext(symbol = "BTCUSDT") {
  try {
    return await getMarketSnapshot(symbol);
  } catch (e) {
    return null;
  }
}

// ================================
// 2. REGIME DETECTION
// ================================

function detectRegime(ticker, funding) {
  const change = ticker?.change24h || 0;
  const vol = ticker?.volume || 0;
  const f = funding?.fundingRate || 0;

  // Volatility proxy
  const highVol = Math.abs(change) > 3;

  if (change > 2 && f > 0 && highVol) {
    return "RISK_ON_BULL_TREND";
  }

  if (change < -2 && f < 0 && highVol) {
    return "RISK_OFF_BEAR_TREND";
  }

  if (Math.abs(change) < 1 && Math.abs(f) < 0.01) {
    return "RANGE_LOW_VOL";
  }

  if (f > 0.02) {
    return "OVERLEVERAGED_LONGS";
  }

  if (f < -0.02) {
    return "OVERLEVERAGED_SHORTS";
  }

  return "NEUTRAL";
}

// ================================
// 3. MOMENTUM SCORE
// ================================

function momentumScore(ticker) {
  if (!ticker) return 0.5;

  const change = ticker.change24h || 0;

  if (change > 5) return 0.9;
  if (change > 2) return 0.75;
  if (change > 0) return 0.6;

  if (change < -5) return 0.1;
  if (change < -2) return 0.25;
  if (change < 0) return 0.4;

  return 0.5;
}

// ================================
// 4. LIQUIDITY PRESSURE (SIMPLIFIED)
// ================================

function liquidityPressure(funding) {
  const f = funding?.fundingRate || 0;

  if (f > 0.02) return "LONG_OVERCROWDED";
  if (f < -0.02) return "SHORT_OVERCROWDED";

  return "BALANCED";
}

// ================================
// 5. FINAL MARKET FLOW ENGINE
// ================================

async function getMarketFlow(symbol = "BTCUSDT") {
  const context = await loadContext(symbol);

  if (!context) {
    return {
      regime: "UNKNOWN",
      bias: "NEUTRAL",
      momentum: 0.5,
      liquidity: "UNKNOWN"
    };
  }

  const ticker = context.ticker;
  const funding = context.funding;

  const regime = detectRegime(ticker, funding);
  const momentum = momentumScore(ticker);
  const liquidity = liquidityPressure(funding);

  // ================================
  // 6. PROP DESK BIAS ENGINE
  // ================================

  let bias = "NEUTRAL";

  if (regime === "RISK_ON_BULL_TREND") bias = "LONG";
  if (regime === "RISK_OFF_BEAR_TREND") bias = "SHORT";

  if (regime === "OVERLEVERAGED_LONGS") bias = "SHORT_FADE";
  if (regime === "OVERLEVERAGED_SHORTS") bias = "LONG_FADE";

  if (regime === "RANGE_LOW_VOL") bias = "NO_TRADE";

  return {
    symbol,
    price: ticker?.price,
    regime,
    bias,
    momentum,
    liquidity,
    funding: funding?.fundingRate,
    change24h: ticker?.change24h
  };
}

module.exports = {
  getMarketFlow
};