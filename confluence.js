const axios = require("axios");

const MINIMUM_CONFLUENCE = 62;

// ─── BLACKLIST ────────────────────────────────────────────
const BLACKLISTED_SYMBOLS = new Set([
    "USDT","USDC","BUSD","DAI","TUSD","USDP","GUSD","FRAX",
    "LUSD","USDD","CUSD","SUSD","MUSD","HUSD","USDN","USDX",
    "WBTC","WETH","WBNB","WMATIC","WAVAX","WSOL",
    "STETH","RETH","CBETH","WSTETH","SFRXETH",
    "BTCB","HBTC","RENBTC","TBTC",
    "PAX","PAXG","XAUT","UST","USTC"
]);

const BLACKLISTED_PATTERNS = [
    "usd","wrapped","staked","bridged","synthetic",
    "pegged","vault","receipt","liquid staking"
];

function isBlacklisted(symbol, name = "") {
    if (BLACKLISTED_SYMBOLS.has(symbol.toUpperCase())) return true;
    const nameLower = name.toLowerCase();
    return BLACKLISTED_PATTERNS.some(p => nameLower.includes(p));
}

// ─── SETUP RANKING ───────────────────────────────────────
function rankSetup(confluenceScore, rrRatio, hasDiv, isParabolic) {
    if (confluenceScore < MINIMUM_CONFLUENCE) return "REJECT";
    if (confluenceScore >= 80 && rrRatio >= 2.5 && (hasDiv || isParabolic)) return "A+";
    if (confluenceScore >= 68 && rrRatio >= 2.0) return "A";
    if (confluenceScore >= MINIMUM_CONFLUENCE && rrRatio >= 1.8) return "B";
    return "REJECT";
}

// ─── BTC MACRO ───────────────────────────────────────────
// Used as background context only — never penalizes alt setups heavily
async function getBTCMacro() {
    try {
        const response = await axios.get(
            "https://api.coingecko.com/api/v3/coins/bitcoin",
            {
                params: { localization: false, tickers: false, market_data: true,
                          community_data: false, developer_data: false },
                timeout: 8000
            }
        );
        const data      = response.data.market_data;
        const price     = data.current_price.usd;
        const change24h = data.price_change_percentage_24h || 0;
        const change7d  = data.price_change_percentage_7d  || 0;

        let trend = "NEUTRAL", trendScore = 0;
        if (change24h > 3  && change7d > 0)      { trend = "BULLISH";      trendScore = 10; }
        else if (change24h > 0 && change7d > -5)  { trend = "MILD_BULLISH"; trendScore = 5;  }
        else if (change24h < -3 && change7d < 0)  { trend = "BEARISH";      trendScore = -10;}
        else if (change24h < -1)                  { trend = "MILD_BEARISH"; trendScore = -5; }

        return { price, change24h, change7d, trend, trendScore };
    } catch (err) {
        return { price: 0, change24h: 0, change7d: 0, trend: "UNKNOWN", trendScore: 0 };
    }
}

// ─── CONFLUENCE SCORER ───────────────────────────────────
// Rebalanced for altcoin focus:
// RSI + Volume = 50pts (coin-specific truth)
// Narrative/News = 20pts
// Sentiment = 10pts
// BTC context = 10pts (context only, never a hard blocker)
// Setup quality = 10pts

function scoreConfluence({
    direction, rsi, volumeRatio, priceChange,
    isNarrativeTrending, marketCap, fgValue,
    btcTrendScore, setupType, hasNewsCatalyst
}) {
    let score = 0, breakdown = {};

    // ── 1. RSI Momentum — 25pts ───────────────────────────
    let m = 0;
    if (direction === "LONG") {
        if (rsi < 28)       m = 25;
        else if (rsi < 35)  m = 20;
        else if (rsi < 45)  m = 15;
        else if (rsi < 55)  m = 10;
        else if (rsi < 65)  m = 6;
    } else {
        if (rsi > 78)       m = 25;
        else if (rsi > 70)  m = 20;
        else if (rsi > 62)  m = 14;
        else if (rsi > 55)  m = 8;
    }
    breakdown.momentum = m; score += m;

    // ── 2. Volume Expansion — 25pts ───────────────────────
    let v = 0;
    if (volumeRatio >= 5.0)      v = 25;
    else if (volumeRatio >= 3.0) v = 20;
    else if (volumeRatio >= 2.0) v = 15;
    else if (volumeRatio >= 1.2) v = 10;
    else if (volumeRatio >= 0.5) v = 5;
    breakdown.volume = v; score += v;

    // ── 3. Narrative + News Catalyst — 20pts ─────────────
    let n = 0;
    if (isNarrativeTrending && hasNewsCatalyst) n = 20;
    else if (hasNewsCatalyst)                   n = 15;
    else if (isNarrativeTrending)               n = 10;
    breakdown.narrative = n; score += n;

    // ── 4. Market Sentiment (F&G) — 10pts ────────────────
    let s = 0;
    if (direction === "LONG") {
        if (fgValue <= 25)      s = 10;
        else if (fgValue <= 45) s = 7;
        else if (fgValue <= 60) s = 4;
        else if (fgValue >= 80) s = 0;
        else                    s = 2;
    } else {
        if (fgValue >= 75)      s = 10;
        else if (fgValue >= 60) s = 7;
        else if (fgValue <= 25) s = 0;
        else                    s = 4;
    }
    breakdown.sentiment = s; score += s;

    // ── 5. BTC Context — 10pts ────────────────────────────
    // Always gives minimum 2pts — alts can decouple from BTC
    let mac = 5; // neutral baseline
    if (direction === "LONG"  && btcTrendScore > 0) mac = 10;
    if (direction === "SHORT" && btcTrendScore < 0) mac = 10;
    if (direction === "LONG"  && btcTrendScore < 0) mac = 2; // bearish BTC = small penalty only
    if (direction === "SHORT" && btcTrendScore > 0) mac = 2;
    breakdown.macro = mac; score += mac;

    // ── 6. Setup Quality — 10pts ──────────────────────────
    let q = 0;
    if (setupType?.includes("PARABOLIC"))         q = 10;
    else if (setupType?.includes("DIVERGENCE"))   q = 10;
    else if (setupType?.includes("DISTRIBUTION")) q = 9;
    else if (setupType?.includes("LIQUIDITY"))    q = 9;
    else if (setupType?.includes("OVERSOLD"))     q = 8;
    else if (setupType?.includes("BREAKDOWN"))    q = 8;
    else if (setupType?.includes("BREAKOUT"))     q = 7;
    else if (setupType?.includes("ACCUMULATION")) q = 7;
    else q = 5;
    breakdown.setup = q; score += q;

    return { total: Math.min(score, 100), breakdown, passes: score >= MINIMUM_CONFLUENCE };
}

function calcPositionSize({ capital = 25, entry, stopLoss, confluenceScore }) {
    const riskPct = Math.abs((entry - stopLoss) / entry);
    if (riskPct === 0) return null;
    let adjustedRiskPct = 0.08;
    if (confluenceScore >= 85)      adjustedRiskPct = 0.12;
    else if (confluenceScore >= 75) adjustedRiskPct = 0.10;
    const maxLoss      = capital * adjustedRiskPct;
    const positionSize = maxLoss / riskPct;
    const leverage     = Math.max(2, Math.min(Math.ceil(positionSize / capital), 15));
    return { positionSize: parseFloat(positionSize.toFixed(2)), leverage,
             maxLoss: parseFloat(maxLoss.toFixed(2)), capital };
}

module.exports = {
    scoreConfluence, calcPositionSize, getBTCMacro,
    MINIMUM_CONFLUENCE, isBlacklisted, rankSetup
};