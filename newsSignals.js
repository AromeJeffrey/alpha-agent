// ================================
// NEWS SIGNALS MODULE
// ================================

async function getNewsSignals() {
  return [
    {
      type: "news",
      strength: 0.6,
      label: "positive crypto sentiment headline"
    },
    {
      type: "news",
      strength: 0.4,
      label: "regulatory uncertainty headline"
    }
  ];
}

module.exports = { getNewsSignals };