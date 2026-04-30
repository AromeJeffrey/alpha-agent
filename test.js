const { createSignal } = require("./core/signalSchema");

const signal = createSignal({
  asset: "BTC",
  bias: "bullish",
  confidence: 0.7,
  timeframe: "short",
  signals: ["funding negative", "volume spike"],
  invalid_if: ["break below support"],
  source: "test"
});

console.log(signal);