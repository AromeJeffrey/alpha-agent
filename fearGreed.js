// ================================
// SENTIMENT SIGNALS MODULE
// ================================

async function getSentimentSignals() {
  return [
    {
      type: "sentiment",
      strength: 0.55,
      label: "fear & greed neutral zone"
    }
  ];
}

module.exports = { getSentimentSignals };