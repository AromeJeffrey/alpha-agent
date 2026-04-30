// ================================
// MARKET SIGNALS MODULE
// ================================

async function getMarketSignals() {
  return [
    {
      type: "market",
      strength: 0.6,
      label: "btc trending upward structure"
    },
    {
      type: "volume",
      strength: 0.5,
      label: "moderate volume increase"
    },
    {
      type: "funding",
      strength: 0.4,
      label: "neutral funding rate"
    }
  ];
}

module.exports = { getMarketSignals };