const cron                      = require("node-cron");
const { sendAlert }             = require("./telegram");
const { getVolumeSignals }      = require("./signals");
const { getWalletSignals }      = require("./walletSignals");
const { getNarrativeSignals }   = require("./narrativeSignals");
const { getNFTSignals }         = require("./nftSignals");
const { getPredictionSignals }  = require("./predictionSignals");
const { getNewsSignals }        = require("./newsSignals");
const { analyzeSignals }        = require("./analyzeSignals");
const { checkForNews }          = require("./newsMonitor");
const { getFearAndGreed }       = require("./fearGreed");

const CATEGORY_EMOJI = {
    CRYPTO:   "🪙",
    POLITICS: "🏛",
    TECH:     "💻",
    SPORTS:   "🏆",
    OTHER:    "🔮"
};

// Prevent double runs if Railway restarts mid-execution
let isRunning = false;

function getFGEmoji(value) {
    if (value <= 20) return "😱";
    if (value <= 40) return "😨";
    if (value <= 60) return "😐";
    if (value <= 80) return "😏";
    return "🤑";
}

async function runAgent() {

    if (isRunning) {
        console.log("Agent already running — skipping duplicate trigger.");
        return;
    }
    isRunning = true;

    try {

        console.log(`[${new Date().toISOString()}] Running Alpha Agent...`);

        const [fgData, narrativeSignals] = await Promise.all([
            getFearAndGreed(),
            getNarrativeSignals().catch(() => [])
        ]);

        const trendingSymbols = narrativeSignals.map(c => c.symbol?.toUpperCase());

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

        // ── FEAR & GREED ──────────────────────────────────
        const fgEmoji = getFGEmoji(fgData.value);
        message += `${fgEmoji} *Market Sentiment: ${fgData.label} (${fgData.value}/100)*\n`;
        message += `📌 ${fgData.bias}\n\n`;

        // ── PARABOLIC CANDIDATES ──────────────────────────
        const parabolicSignals = volumeSignals.filter(c => c.isParabolic);
        if (parabolicSignals.length > 0) {
            message += "🚀 *PARABOLIC CANDIDATES*\n";
            message += `_(High volume + accumulation — ENJ-type setups)_\n\n`;

            parabolicSignals.forEach(coin => {
                message += `*${coin.name} (${coin.symbol})*\n`;
                if (coin.isDoubleSignal) message += `🔥 DOUBLE SIGNAL\n`;
                message += `🟢 LONG | ${coin.setupType}\n`;
                message += `Confidence: ${coin.confidence}%\n`;
                message += `MCap: $${(coin.marketCap/1e6).toFixed(0)}M\n\n`;
                message += `Entry: $${coin.entry}\n`;
                message += `SL: $${coin.stopLoss} | TP: $${coin.takeProfit}\n`;
                message += `Timeframe: ${coin.timeframe}\n\n`;
                message += `💰 $${coin.positionSize} at ${coin.leverage}x\n`;
                message += `✅ +$${coin.profitAtTP} | ❌ -$${coin.lossAtSL} | R/R 1:${coin.rrRatio}\n\n`;
                message += `RSI: ${coin.rsi} | Vol: ${coin.volumeRatio}x\n`;
                message += `💬 ${coin.reasoning}\n\n`;
            });
        }

        // ── TRADE SIGNALS ─────────────────────────────────
        const regularSignals = volumeSignals.filter(c => !c.isParabolic);
        if (regularSignals.length > 0) {
            message += "📊 *Perps Trade Signals*\n_(Bybit / MEXC)_\n\n";

            regularSignals.forEach((coin, i) => {
                const dirEmoji = coin.direction === "LONG" ? "🟢 LONG" : "🔴 SHORT";
                message += `*${i + 1}. ${coin.name} (${coin.symbol})*\n`;
                message += `${dirEmoji} | ${coin.setupType} | ${coin.confidence}%\n\n`;
                message += `Entry: $${coin.entry}\n`;
                message += `SL: $${coin.stopLoss} | TP: $${coin.takeProfit}\n`;
                message += `Timeframe: ${coin.timeframe}\n\n`;
                message += `💰 $${coin.positionSize} at ${coin.leverage}x | R/R 1:${coin.rrRatio}\n`;
                message += `✅ +$${coin.profitAtTP} | ❌ -$${coin.lossAtSL}\n\n`;
                message += `RSI: ${coin.rsi} | Vol: ${coin.volumeRatio}x\n`;
                message += `💬 ${coin.reasoning}\n\n`;
            });
        }

        // ── NARRATIVE SIGNALS ─────────────────────────────
        if (narrativeSignals.length > 0) {
            message += "🔥 *Trending Narratives*\n\n";
            narrativeSignals.forEach(coin => {
                message += `${coin.name} (${coin.symbol})\n`;
            });
            message += "\n";
        }

        // ── NFT SIGNALS ───────────────────────────────────
        if (nftSignals.length > 0) {
            message += "🖼 *NFT Signals*\n\n";
            nftSignals.forEach(nft => {
                message += `${nft.name} (${nft.symbol})\n`;
                message += `$${nft.price} | 24h: ${nft.change24h} | Vol: ${nft.volume24h}\n\n`;
            });
        }

        // ── WALLET TRACKER ────────────────────────────────
        if (walletSignals.length > 0) {
            message += "🐋 *Wallet Tracker*\n\n";
            walletSignals.forEach(w => {
                message += `${w.label}: ${w.ethBalance}\n`;
            });
            message += "\n";
        }

        // ── PREDICTION MARKETS ────────────────────────────
        // Filter out low-relevance markets for daily report
        const relevantPredictions = predictionSignals.filter(m =>
            ["CRYPTO", "POLITICS", "SPORTS", "TECH"].includes(m.category) &&
            parseFloat(m.liquidity) > 10000 && // Only liquid markets
            m.verdict === "RECOMMEND"
        );

        if (relevantPredictions.length > 0) {
            message += "🔮 *Prediction Markets*\n\n";
            relevantPredictions.forEach(market => {
                const catEmoji      = CATEGORY_EMOJI[market.category] || "🔮";
                let confidenceEmoji = market.confidence >= 8 ? "🟢" : "🟡";

                message += `${catEmoji} ${market.question}\n`;
                message += `${market.betSide} @ ${market.betPrice}¢ | $10 pays $${market.payout10}\n`;
                message += `${confidenceEmoji} ${market.confidence}/10`;

                if (market.bookmakerProb && market.edge) {
                    message += ` | Bookmaker: ${market.bookmakerProb}% | Edge: +${market.edge}%`;
                }

                message += `\n💬 ${market.reasoning}\n`;
                message += `🔗 ${market.url}\n\n`;
            });
        }

        // ── NEWS SUMMARY (top 3 only, no duplicates) ──────
        if (newsSignals.length > 0) {
            message += "📰 *News*\n\n";
            newsSignals.slice(0, 3).forEach(article => {
                message += `${article.title} — ${article.source}\n`;
            });
            message += "\n";
        }

        // ── AI BRIEF ──────────────────────────────────────
        console.log(`[${new Date().toISOString()}] Running AI analysis...`);

        const aiAnalysis = await analyzeSignals({
            volumeSignals,
            narrativeSignals,
            nftSignals,
            walletSignals,
            predictionSignals: relevantPredictions,
            newsSignals,
            fgData
        });

        if (aiAnalysis) {
            message += "─────────────────────\n\n";
            message += aiAnalysis;
        }

        await sendAlert(message);
        console.log(`[${new Date().toISOString()}] Report sent.`);

    } finally {
        isRunning = false;
    }
}

// ─── SCHEDULES ───────────────────────────────────────────

// Full report every 4 hours
cron.schedule("0 */4 * * *", () => {
    console.log(`[${new Date().toISOString()}] Scheduled report starting...`);
    runAgent();
});

// News + whale + narrative monitor every 15 minutes
cron.schedule("*/15 * * * *", () => {
    checkForNews();
});

// ─── STARTUP ─────────────────────────────────────────────

// Small delay on startup to avoid double-fire during Railway deploys
setTimeout(() => {
    runAgent();
}, 5000);

// Seed news baseline immediately
checkForNews().then(() => {
    console.log("News baseline established.");
});

console.log("Alpha Agent running.");
console.log("📊 Full report: every 4 hours");
console.log("🔴 Alerts: every 15 minutes");