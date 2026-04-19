const cron                        = require("node-cron");
const { sendAlert }               = require("./telegram");
const { getVolumeSignals }        = require("./signals");
const { getWalletSignals }        = require("./walletSignals");
const { getNarrativeSignals }     = require("./narrativeSignals");
const { getNFTSignals }           = require("./nftSignals");
const { getPredictionSignals }    = require("./predictionSignals");
const { getNewsSignals }          = require("./newsSignals");
const { analyzeSignals }          = require("./analyzeSignals");
const { checkForNews }            = require("./newsMonitor");
const { getFearAndGreed }         = require("./fearGreed");

const CATEGORY_EMOJI = {
    CRYPTO:   "🪙",
    POLITICS: "🏛",
    TECH:     "💻",
    SPORTS:   "🏆",
    OTHER:    "🔮"
};

function getFGEmoji(value) {
    if (value <= 20) return "😱";
    if (value <= 40) return "😨";
    if (value <= 60) return "😐";
    if (value <= 80) return "😏";
    return "🤑";
}

async function runAgent() {

    console.log(`[${new Date().toISOString()}] Running Alpha Agent...`);

    // ── Fetch Fear & Greed + Narratives first ─────────────
    const [fgData, narrativeSignals] = await Promise.all([
        getFearAndGreed(),
        getNarrativeSignals().catch(() => [])
    ]);

    const trendingSymbols = narrativeSignals.map(c => c.symbol?.toUpperCase());

    // ── Fetch all other signals ───────────────────────────
    const [volumeSignals, walletSignals,
           nftSignals, predictionSignals, newsSignals] = await Promise.allSettled([
        getVolumeSignals(trendingSymbols, fgData),
        getWalletSignals(),
        getNFTSignals(),
        getPredictionSignals(),
        getNewsSignals()
    ]).then(results => results.map(r => r.status === "fulfilled" ? r.value : []));

    let message = "🚨 Alpha Agent Intelligence Report\n";
    message += `🕐 ${new Date().toUTCString()}\n\n`;

    // ── FEAR & GREED ──────────────────────────────────────
    const fgEmoji = getFGEmoji(fgData.value);
    message += `${fgEmoji} *Market Sentiment: ${fgData.label} (${fgData.value}/100)*\n`;
    message += `📌 ${fgData.bias}\n\n`;

    // ── PARABOLIC CANDIDATES ──────────────────────────────
    const parabolicSignals = volumeSignals.filter(c => c.isParabolic);
    if (parabolicSignals.length > 0) {
        message += "🚀 *PARABOLIC CANDIDATES — ACT FAST*\n";
        message += `_(High volume + accumulation — ENJ-type setups)_\n\n`;

        parabolicSignals.forEach(coin => {
            message += `*${coin.name} (${coin.symbol})*\n`;
            if (coin.isDoubleSignal) message += `🔥 DOUBLE SIGNAL — Trending + Volume\n`;
            message += `🟢 LONG | ${coin.setupType}\n`;
            message += `Confidence: ${coin.confidence}%\n`;
            message += `Market Cap: $${(coin.marketCap/1e6).toFixed(0)}M\n\n`;
            message += `Entry: $${coin.entry}\n`;
            message += `Stop Loss: $${coin.stopLoss}\n`;
            message += `Take Profit: $${coin.takeProfit} (+40%)\n`;
            message += `Timeframe: ${coin.timeframe}\n\n`;
            message += `💰 Position Size: $${coin.positionSize}\n`;
            message += `Leverage: ${coin.leverage}x\n`;
            message += `  ✅ Profit at TP: +$${coin.profitAtTP}\n`;
            message += `  ❌ Loss at SL: -$${coin.lossAtSL}\n`;
            message += `  R/R: 1:${coin.rrRatio}\n\n`;
            message += `RSI: ${coin.rsi} | Vol: ${coin.volumeRatio}x avg\n`;
            message += `💬 ${coin.reasoning}\n\n`;
        });
    }

    // ── REGULAR TRADE SIGNALS ─────────────────────────────
    const regularSignals = volumeSignals.filter(c => !c.isParabolic);
    if (regularSignals.length > 0) {
        message += "📊 *Perps Trade Signals*\n";
        message += `_(Bybit / MEXC)_\n\n`;

        regularSignals.forEach((coin, i) => {
            const dirEmoji = coin.direction === "LONG" ? "🟢 LONG" : "🔴 SHORT";
            message += `*${i + 1}. ${coin.name} (${coin.symbol})*\n`;
            message += `${dirEmoji} | ${coin.setupType}\n`;
            message += `Confidence: ${coin.confidence}%\n\n`;
            message += `Entry: $${coin.entry}\n`;
            message += `Stop Loss: $${coin.stopLoss}\n`;
            message += `Take Profit: $${coin.takeProfit}\n`;
            message += `Timeframe: ${coin.timeframe}\n\n`;
            message += `💰 Position Size: $${coin.positionSize}\n`;
            message += `Leverage: ${coin.leverage}x | R/R: 1:${coin.rrRatio}\n`;
            message += `  ✅ Profit at TP: +$${coin.profitAtTP}\n`;
            message += `  ❌ Loss at SL: -$${coin.lossAtSL}\n\n`;
            message += `RSI: ${coin.rsi} | Vol: ${coin.volumeRatio}x avg\n`;
            message += `💬 ${coin.reasoning}\n\n`;
        });
    }

    // ── NARRATIVE SIGNALS ──────────────────────────────────
    if (narrativeSignals.length > 0) {
        message += "🔥 *Narrative Signals*\n\n";
        narrativeSignals.forEach(coin => {
            message += `${coin.name} (${coin.symbol}) — Score: ${coin.score}\n`;
        });
        message += "\n";
    }

    // ── NFT SIGNALS ────────────────────────────────────────
    if (nftSignals.length > 0) {
        message += "🖼 *NFT Signals*\n\n";
        nftSignals.forEach(nft => {
            message += `${nft.name} (${nft.symbol})\n`;
            message += `Price: $${nft.price} | 24h: ${nft.change24h} | Vol: ${nft.volume24h}\n\n`;
        });
    }

    // ── WALLET TRACKER ─────────────────────────────────────
    if (walletSignals.length > 0) {
        message += "🐋 *Wallet Tracker*\n\n";
        walletSignals.forEach(w => {
            message += `${w.label} (${w.address})\n`;
            message += `Balance: ${w.ethBalance} | Txns: ${w.txCount}\n\n`;
        });
    }

    // ── PREDICTION MARKETS ─────────────────────────────────
    if (predictionSignals.length > 0) {
        message += "🔮 *Prediction Market Signals*\n\n";
        predictionSignals.forEach(market => {
            const catEmoji      = CATEGORY_EMOJI[market.category] || "🔮";
            let confidenceEmoji = "🟡";
            if (market.confidence >= 8)      confidenceEmoji = "🟢";
            else if (market.confidence <= 4) confidenceEmoji = "🔴";

            message += `${catEmoji} ${market.category}\n`;
            message += `${market.question}\n`;
            message += `Bet: ${market.betSide} @ ${market.betPrice}¢\n`;
            message += `$5 pays $${market.payout5} | $10 pays $${market.payout10}\n`;
            message += `${confidenceEmoji} Confidence: ${market.confidence}/10 | ${market.verdict}\n`;

            if (market.bookmakerProb !== null && market.edge !== null) {
                const edgeNum   = parseFloat(market.edge);
                const edgeEmoji = edgeNum > 0 ? "📈" : "📉";
                message += `${edgeEmoji} Bookmaker: ${market.bookmakerProb}% vs Polymarket: ${market.betPrice}% | Edge: ${edgeNum > 0 ? "+" : ""}${market.edge}%\n`;
            }

            if (market.reasoning) message += `💬 ${market.reasoning}\n`;
            message += `Vol: $${market.volume24hr} | Liq: $${market.liquidity}\n`;
            message += `🔗 ${market.url}\n\n`;
        });
    }

    // ── NEWS ───────────────────────────────────────────────
    if (newsSignals.length > 0) {
        message += "📰 *Breaking News*\n\n";
        newsSignals.forEach(article => {
            message += `${article.title}\n`;
            message += `Source: ${article.source}\n\n`;
        });
    }

    // ── AI BRIEF ───────────────────────────────────────────
    console.log(`[${new Date().toISOString()}] Running AI analysis...`);

    const aiAnalysis = await analyzeSignals({
        volumeSignals,
        narrativeSignals,
        nftSignals,
        walletSignals,
        predictionSignals,
        newsSignals,
        fgData
    });

    if (aiAnalysis) {
        message += "─────────────────────\n\n";
        message += aiAnalysis;
    }

    await sendAlert(message);
    console.log(`[${new Date().toISOString()}] Report sent.`);
}

// ─── SCHEDULES ───────────────────────────────────────────

cron.schedule("0 */4 * * *", () => {
    console.log(`[${new Date().toISOString()}] Running scheduled report...`);
    runAgent();
});

cron.schedule("*/15 * * * *", () => {
    checkForNews();
});

// ─── STARTUP ─────────────────────────────────────────────

runAgent();

checkForNews().then(() => {
    console.log("News baseline established. Whale alerts active.");
});

console.log("Alpha Agent running.");
console.log("📊 Full report: every 4 hours (6x daily)");
console.log("🔴 News + Whale monitor: every 15 minutes");