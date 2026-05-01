const axios = require("axios");

const MINIMUM_CONFLUENCE = 65;

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
    if (confluenceScore >= 82 && rrRatio >= 3.0 && (hasDiv || isParabolic)) return "A+";
    if (confluenceScore >= 72 && rrRatio >= 2.5) return "A";
    if (confluenceScore >= MINIMUM_CONFLUENCE && rrRatio >= 2.0) return "B";
    return "REJECT";
}

// ─── BTC MACRO ───────────────────────────────────────────
async function getBTCMacro() {
    try {
        const response = await axios.get(
            "https://api.coingecko.com/api/v3/coins/bitcoin",
            {
                params: { localization: false, tickers: false, market_data: true, community_data: false, developer_data: false },
                timeout: 8000
            }
        );
        const data      = response.data.market_data;
        const price     = data.current_price.usd;
        const change24h = data.price_change_percentage_24h || 0;
        const change7d  = data.price_change_percentage_7d  || 0;

        let trend = "NEUTRAL", trendScore = 0;
        if (change24h > 2  && change7d > 0)      { trend = "BULLISH";      trendScore = 20; }
        else if (change24h > 0 && change7d > -5)  { trend = "MILD_BULLISH"; trendScore = 10; }
        else if (change24h < -3 && change7d < 0)  { trend = "BEARISH";      trendScore = -20; }
        else if (change24h < -1)                  { trend = "MILD_BEARISH"; trendScore = -10; }

        return { price, change24h, change7d, trend, trendScore };
    } catch (err) {
        return { price: 0, change24h: 0, change7d: 0, trend: "UNKNOWN", trendScore: 0 };
    }
}

// ─── CONFLUENCE SCORER ───────────────────────────────────
function scoreConfluence({ direction, rsi, volumeRatio, priceChange, isNarrativeTrending, marketCap, fgValue, btcTrendScore, setupType }) {

    let score = 0, breakdown = {};

    // Momentum — 20pts
    let m = 0;
    if (direction === "LONG") {
        if (rsi < 30) m = 20; else if (rsi < 40) m = 15;
        else if (rsi < 50) m = 10; else if (rsi < 60) m = 8;
        else if (rsi < 70) m = 5;
    } else {
        if (rsi > 75) m = 20; else if (rsi > 65) m = 15;
        else if (rsi > 55) m = 8;
    }
    breakdown.momentum = m; score += m;

    // Volume — 20pts
    let v = 0;
    if (volumeRatio >= 5.0) v = 20; else if (volumeRatio >= 3.0) v = 16;
    else if (volumeRatio >= 2.0) v = 12; else if (volumeRatio >= 1.5) v = 8;
    breakdown.volume = v; score += v;

    // Narrative — 15pts
    const n = isNarrativeTrending ? 15 : 0;
    breakdown.narrative = n; score += n;

    // Sentiment — 15pts
    let s = 0;
    if (direction === "LONG") {
        if (fgValue <= 25) s = 15; else if (fgValue <= 40) s = 10;
        else if (fgValue <= 55) s = 5; else if (fgValue >= 75) s = 0;
        else s = 3;
    } else {
        if (fgValue >= 75) s = 15; else if (fgValue >= 60) s = 10;
        else if (fgValue <= 25) s = 0; else s = 5;
    }
    breakdown.sentiment = s; score += s;

    // BTC Macro — 20pts
    let mac = direction === "LONG"
        ? Math.max(0, 10 + btcTrendScore)
        : Math.max(0, 10 - btcTrendScore);
    mac = Math.min(mac, 20);
    breakdown.macro = mac; score += mac;

    // Setup quality — 10pts
    let q = 0;
    if (setupType?.includes("PARABOLIC"))        q = 10;
    else if (setupType?.includes("DIVERGENCE"))  q = 10;
    else if (setupType?.includes("DISTRIBUTION"))q = 9;
    else if (setupType?.includes("LIQUIDITY"))   q = 9;
    else if (setupType?.includes("OVERSOLD"))    q = 8;
    else if (setupType?.includes("BREAKDOWN"))   q = 8;
    else if (setupType?.includes("BREAKOUT"))    q = 7;
    else if (setupType?.includes("ACCUMULATION"))q = 7;
    else q = 5;
    breakdown.setup = q; score += q;

    return { total: Math.min(score, 100), breakdown, passes: score >= MINIMUM_CONFLUENCE };
}

// ─── POSITION SIZING ─────────────────────────────────────
function calcPositionSize({ capital = 25, entry, stopLoss, confluenceScore }) {
    const riskPct = Math.abs((entry - stopLoss) / entry);
    if (riskPct === 0) return null;
    let adjustedRiskPct = 0.08;
    if (confluenceScore >= 85)      adjustedRiskPct = 0.12;
    else if (confluenceScore >= 75) adjustedRiskPct = 0.10;
    const maxLoss      = capital * adjustedRiskPct;
    const positionSize = maxLoss / riskPct;
    const leverage     = Math.max(2, Math.min(Math.ceil(positionSize / capital), 15));
    return { positionSize: parseFloat(positionSize.toFixed(2)), leverage, maxLoss: parseFloat(maxLoss.toFixed(2)), capital };
}

module.exports = { scoreConfluence, calcPositionSize, getBTCMacro, MINIMUM_CONFLUENCE, isBlacklisted, rankSetup };