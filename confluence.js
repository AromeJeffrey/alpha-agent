const axios = require("axios");

// ─── CONFLUENCE SCORING ENGINE ────────────────────────────
// Every trade must score above MINIMUM_CONFLUENCE to be sent
// Below threshold = NO TRADE, capital is protected

const MINIMUM_CONFLUENCE = 65; // Out of 100

// ─── BTC MACRO FETCH ─────────────────────────────────────
// BTC trend confirmation is required for all long setups
// If BTC is in downtrend, long confidence is penalised

async function getBTCMacro() {
    try {
        const response = await axios.get(
            "https://api.coingecko.com/api/v3/coins/bitcoin",
            {
                params: {
                    localization:   false,
                    tickers:        false,
                    market_data:    true,
                    community_data: false,
                    developer_data: false
                },
                timeout: 8000
            }
        );

        const data         = response.data.market_data;
        const price        = data.current_price.usd;
        const change1h     = data.price_change_percentage_1h_in_currency?.usd || 0;
        const change24h    = data.price_change_percentage_24h || 0;
        const change7d     = data.price_change_percentage_7d  || 0;

        // Determine BTC macro trend
        let trend     = "NEUTRAL";
        let trendScore = 0;

        if (change24h > 2 && change7d > 0)      { trend = "BULLISH";      trendScore = 20; }
        else if (change24h > 0 && change7d > -5) { trend = "MILD_BULLISH"; trendScore = 10; }
        else if (change24h < -3 && change7d < 0) { trend = "BEARISH";      trendScore = -20; }
        else if (change24h < -1)                 { trend = "MILD_BEARISH"; trendScore = -10; }

        return { price, change1h, change24h, change7d, trend, trendScore };

    } catch (err) {
        return { price: 0, change24h: 0, change7d: 0, trend: "UNKNOWN", trendScore: 0 };
    }
}

// ─── CONFLUENCE SCORER ────────────────────────────────────
// Scores a trade setup across 6 dimensions
// Returns total score out of 100 and breakdown

function scoreConfluence({
    direction,
    rsi,
    volumeRatio,
    priceChange,
    isNarrativeTrending,
    marketCap,
    fgValue,
    btcTrendScore,
    setupType
}) {

    let score      = 0;
    let breakdown  = {};

    // ── 1. Momentum (RSI) — max 20 points ─────────────────
    let momentumScore = 0;
    if (direction === "LONG") {
        if (rsi < 30)       momentumScore = 20; // Deeply oversold = best entry
        else if (rsi < 40)  momentumScore = 15;
        else if (rsi < 50)  momentumScore = 10;
        else if (rsi < 60)  momentumScore = 8;
        else if (rsi < 70)  momentumScore = 5;
        else                momentumScore = 0;  // Overbought = no long
    } else {
        if (rsi > 75)       momentumScore = 20;
        else if (rsi > 65)  momentumScore = 15;
        else if (rsi > 55)  momentumScore = 8;
        else                momentumScore = 0;
    }
    breakdown.momentum = momentumScore;
    score += momentumScore;

    // ── 2. Volume Expansion — max 20 points ───────────────
    let volumeScore = 0;
    if (volumeRatio >= 5.0)      volumeScore = 20;
    else if (volumeRatio >= 3.0) volumeScore = 16;
    else if (volumeRatio >= 2.0) volumeScore = 12;
    else if (volumeRatio >= 1.5) volumeScore = 8;
    else                         volumeScore = 0; // Below avg = no signal
    breakdown.volume = volumeScore;
    score += volumeScore;

    // ── 3. Narrative Strength — max 15 points ─────────────
    const narrativeScore = isNarrativeTrending ? 15 : 0;
    breakdown.narrative  = narrativeScore;
    score += narrativeScore;

    // ── 4. Market Sentiment (Fear & Greed) — max 15 points
    let sentimentScore = 0;
    if (direction === "LONG") {
        if (fgValue <= 25)      sentimentScore = 15; // Extreme fear = buy
        else if (fgValue <= 40) sentimentScore = 10;
        else if (fgValue <= 55) sentimentScore = 5;
        else if (fgValue >= 75) sentimentScore = 0;  // Extreme greed = avoid long
        else                    sentimentScore = 3;
    } else {
        if (fgValue >= 75)      sentimentScore = 15; // Extreme greed = short
        else if (fgValue >= 60) sentimentScore = 10;
        else if (fgValue <= 25) sentimentScore = 0;  // Extreme fear = avoid short
        else                    sentimentScore = 5;
    }
    breakdown.sentiment = sentimentScore;
    score += sentimentScore;

    // ── 5. BTC Macro Alignment — max 20 points ────────────
    let macroScore = 0;
    if (direction === "LONG") {
        macroScore = Math.max(0, 10 + btcTrendScore); // Bullish BTC = bonus
    } else {
        macroScore = Math.max(0, 10 - btcTrendScore); // Bearish BTC = bonus for shorts
    }
    macroScore = Math.min(macroScore, 20);
    breakdown.macro = macroScore;
    score += macroScore;

    // ── 6. Setup Quality — max 10 points ──────────────────
    let setupScore = 0;
    if (setupType === "PARABOLIC CANDIDATE 🚀") setupScore = 10;
    else if (setupType === "OVERSOLD REVERSAL") setupScore = 9;
    else if (setupType === "EMA BREAKOUT")      setupScore = 8;
    else if (setupType === "ACCUMULATION PRE-PUMP") setupScore = 7;
    else if (setupType === "OVERBOUGHT REJECTION")  setupScore = 8;
    else                                            setupScore = 5;
    breakdown.setup = setupScore;
    score += setupScore;

    return {
        total:    Math.min(score, 100),
        breakdown,
        passes:   score >= MINIMUM_CONFLUENCE
    };
}

// ─── POSITION SIZING ──────────────────────────────────────
// Risk-based sizing: never lose more than maxRiskPct of capital on one trade
// For small accounts ($25), we use 8-12% risk per trade max

function calcPositionSize({
    capital        = 25,
    entry,
    stopLoss,
    confluenceScore,
    maxRiskPct     = 0.10 // 10% of capital max risk
}) {
    const riskPct        = Math.abs((entry - stopLoss) / entry);
    if (riskPct === 0)   return null;

    // Scale risk by confidence — higher confidence = higher risk allowed
    let adjustedRiskPct = maxRiskPct;
    if (confluenceScore >= 85)      adjustedRiskPct = 0.12;
    else if (confluenceScore >= 75) adjustedRiskPct = 0.10;
    else if (confluenceScore >= 65) adjustedRiskPct = 0.08;
    else                            return null; // Below threshold = no trade

    const maxLoss      = capital * adjustedRiskPct;
    const positionSize = maxLoss / riskPct;
    const leverage     = Math.ceil(positionSize / capital);
    const cappedLev    = Math.max(2, Math.min(leverage, 15)); // Cap 2-15x
    const actualPos    = capital * cappedLev;

    return {
        positionSize:  parseFloat(Math.min(positionSize, capital * cappedLev).toFixed(2)),
        leverage:      cappedLev,
        maxLoss:       parseFloat(maxLoss.toFixed(2)),
        profitAtTP:    parseFloat((actualPos * Math.abs((0) / entry)).toFixed(2)), // placeholder
        capital
    };
}

module.exports = { scoreConfluence, calcPositionSize, getBTCMacro, MINIMUM_CONFLUENCE };