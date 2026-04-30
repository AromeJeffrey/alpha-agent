const axios = require("axios");

// ================================
// BINANCE FUTURES DATA (REAL)
// ================================

async function getBinanceFutures(symbol = "BTCUSDT") {
  try {
    const url = `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`;
    const res = await axios.get(url);

    return {
      symbol,
      price: parseFloat(res.data.lastPrice),
      change24h: parseFloat(res.data.priceChangePercent),
      volume: parseFloat(res.data.volume),
    };
  } catch (e) {
    console.log("Binance error:", e.message);
    return null;
  }
}

// ================================
// FUNDING RATE (VERY IMPORTANT FOR PERPS)
// ================================

async function getFundingRate(symbol = "BTCUSDT") {
  try {
    const url = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`;
    const res = await axios.get(url);

    return {
      fundingRate: parseFloat(res.data.lastFundingRate),
      markPrice: parseFloat(res.data.markPrice),
    };
  } catch (e) {
    console.log("Funding error:", e.message);
    return null;
  }
}

// ================================
// COMBINED MARKET SNAPSHOT
// ================================

async function getMarketSnapshot(symbol = "BTCUSDT") {
  const [ticker, funding] = await Promise.all([
    getBinanceFutures(symbol),
    getFundingRate(symbol),
  ]);

  return {
    ticker,
    funding,
  };
}

module.exports = {
  getMarketSnapshot,
};