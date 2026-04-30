function createSignal(data) {
  return {
    asset: data.asset || "UNKNOWN",
    bias: data.bias || "neutral", // bullish | bearish | neutral
    confidence: Math.max(0, Math.min(1, data.confidence || 0.5)),
    signals: data.signals || []
  };
}

module.exports = {
  createSignal
};