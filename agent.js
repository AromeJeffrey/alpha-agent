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
const { MINIMUM_CONFLUENCE }    = require("./confluence");

const CATEGORY_EMOJI = { CRYPTO: "🪙", POLITICS: "🏛", TECH: "💻", SPORTS: "🏆", OTHER: "🔮" };

let isRunning = false;

function getFGEmoji(value) {
    if (value <= 20) return "😱";
    if (value <= 40) return "😨";
    if (value <= 60) return "😐";
    if (value <= 80) return "😏";
    return "🤑";
}

function formatPrice(price) {
    if (price < 0.0001) return price.toExponential(4);
    if (price < 1)      return price.toFixed(8);
    if (price < 100)    return price.toFixed(4);
    return price.toFixed(2);
}

async function runAgent() {

    if (isRunning) {
        console.log("Agent already running — skipping.");
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

        const [volumeSignals, walletSignals, nftSignals,
               predictionSignals, newsSignals] = await Promise.allSettled([
            getVolumeSignals(trendingSymbols, fgData),
            getWalletSignals(),
            getNFTSignals(),
            getPredictionSignals(),
            getNewsSignals()
        ]).then(results => results.map(r => r.status === "fulfilled" ? r.value : []));

        const hasTradeSignals      = volumeSignals.length > 0;
        const hasPredictionSignals = predictionSignals.length > 0;
        const noTradeToday         = !hasTradeSignals && !hasPredictionSignals;

        let message = "📡 *Alpha Decision Engine*\n";
        message += `🕐 ${new Date().toUTCString()}\n\n`;

        // ── MARKET CONTEXT ────────────────────────────────
        const fgEmoji = getFGEmoji(fgData.value);
        message += `${fgEmoji} *Sentiment: ${fgData.label} (${fgData.value}/100)*\n`;
        message += `📌 ${fgData.bias}\n\n`;

        // ── NO TRADE MODE ─────────────────────────────────
        if (noTradeToday) {
            message += "🛑 *NO TRADE TODAY*\n\n";
            message += `No setups passed the ${MINIMUM_CONFLUENCE}/100 confluence threshold.\n`;
            message += `Capital is protected. Wait for better conditions.\n\n`;
            message += `Confluence requires: momentum + volume + narrative + sentiment + BTC macro alignment.\n\n`;
        }

        // ── TRADE SIGNALS ─────────────────────────────────
        if (hasTradeSignals) {

            const parabolic = volumeSignals.filter(c => c.isParabolic);
            const regular   = volumeSignals.filter(c => !c.isParabolic);

            if (parabolic.length > 0) {
                message += "🚀 *HIGH CONVICTION — PARABOLIC SETUPS*\n\n";

                parabolic.forEach(coin => {
                    message += `*${coin.name} (${coin.symbol})*\n`;
                    if (coin.isDoubleSignal) message += `🔥 DOUBLE SIGNAL: Trending + Volume\n`;
                    message += `\n`;
                    message += `Direction: 🟢 ${coin.direction}\n`;
                    message += `Setup: ${coin.setupType}\n`;
                    message += `Confluence: ${coin.confluenceScore}/100\n`;
                    message += `BTC Macro: ${coin.btcTrend}\n\n`;
                    message += `Entry Zone: $${formatPrice(coin.entry)}\n`;
                    message += `Stop Loss:  $${formatPrice(coin.stopLoss)}\n`;
                    message += `Take Profit: $${formatPrice(coin.takeProfit)}\n`;
                    message += `Invalidation: ${coin.invalidation}\n\n`;
                    message += `R:R Ratio: 1:${coin.rrRatio}\n`;
                    message += `Leverage: ${coin.leverage}x\n`;
                    message += `Capital: $${coin.positionSize}\n`;
                    message += `✅ Profit at TP: +$${coin.profitAtTP}\n`;
                    message += `❌ Max Loss at SL: -$${coin.lossAtSL}\n\n`;
                    message += `Timeframe: ${coin.timeframe}\n`;
                    message += `RSI: ${coin.rsi} | Volume: ${coin.volumeRatio}x avg\n`;
                    message += `💬 ${coin.reasoning}\n\n`;
                });
            }

            if (regular.length > 0) {
                message += "📊 *TRADE SIGNALS*\n\n";

                regular.forEach((coin, i) => {
                    const dir      = coin.direction === "LONG" ? "🟢 LONG" : "🔴 SHORT";
                    const divBadge = coin.divergence ? `\n⚡ ${coin.divergence}` : "";
                    message += `*${i + 1}. ${coin.name} (${coin.symbol})*\n`;
                    message += `${dir} | ${coin.setupType}${divBadge}\n`;
                    message += `Confluence: ${coin.confluenceScore}/100 | BTC: ${coin.btcTrend}\n\n`;
                    message += `Entry Zone: $${formatPrice(coin.entry)}\n`;
                    message += `Stop Loss:  $${formatPrice(coin.stopLoss)}\n`;
                    message += `Take Profit: $${formatPrice(coin.takeProfit)}\n`;
                    message += `Invalidation: ${coin.invalidation}\n\n`;
                    message += `R:R: 1:${coin.rrRatio} | Leverage: ${coin.leverage}x\n`;
                    message += `✅ +$${coin.profitAtTP} | ❌ -$${coin.lossAtSL}\n`;
                    message += `Timeframe: ${coin.timeframe}\n`;
                    message += `RSI: ${coin.rsi} | Vol: ${coin.volumeRatio}x\n`;
                    message += `💬 ${coin.reasoning}\n\n`;
                });
            }
        }

        // ── PREDICTION MARKETS ────────────────────────────
        if (hasPredictionSignals) {
            message += "🎯 *PREDICTION MARKET EDGES*\n\n";

            predictionSignals.forEach(market => {
                const catEmoji = CATEGORY_EMOJI[market.category] || "🔮";
                message += `${catEmoji} *${market.question}*\n\n`;
                message += `BET: ${market.betSide}\n`;
                message += `Current Price: ${market.marketPrice}¢\n`;
                message += `Fair Value: ${market.fairValue}%\n`;
                message += `Edge: +${market.edge}%\n`;
                message += `Confidence: ${market.confidence}/10\n\n`;
                message += `$5 wager pays $${market.payout5}\n`;
                message += `$10 wager pays $${market.payout10}\n\n`;
                if (market.bookmakerProb) {
                    message += `Bookmaker consensus: ${market.bookmakerProb}%\n`;
                }
                message += `💬 ${market.reasoning}\n`;
                message += `🔗 ${market.url}\n\n`;
            });
        }

        // ── TRENDING NARRATIVES ───────────────────────────
        if (narrativeSignals.length > 0) {
            message += "🔥 *Trending Narratives*\n";
            narrativeSignals.slice(0, 5).forEach(c => {
                message += `${c.name} (${c.symbol})\n`;
            });
            message += "\n";
        }

        // ── SMART MONEY ───────────────────────────────────
        if (walletSignals.length > 0) {
            message += "🐋 *Smart Money*\n";
            walletSignals.forEach(w => {
                message += `${w.label}: ${w.ethBalance}\n`;
            });
            message += "\n";
        }

        // ── NEWS ──────────────────────────────────────────
        if (newsSignals.length > 0) {
            message += "📰 *News*\n";
            newsSignals.slice(0, 3).forEach(n => {
                message += `${n.title} — ${n.source}\n`;
            });
            message += "\n";
        }

        // ── AI DECISION BRIEF ─────────────────────────────
        console.log(`[${new Date().toISOString()}] Running AI analysis...`);

        const aiAnalysis = await analyzeSignals({
            volumeSignals,
            narrativeSignals,
            nftSignals,
            walletSignals,
            predictionSignals,
            newsSignals,
            fgData,
            noTradeToday
        });

        if (aiAnalysis) {
            message += "─────────────────────\n\n";
            message += aiAnalysis;
        }

        await sendAlert(message);
        console.log(`[${new Date().toISOString()}] Report sent. Trades: ${volumeSignals.length} | Predictions: ${predictionSignals.length}`);

    } finally {
        isRunning = false;
    }
}

// ─── SCHEDULES ───────────────────────────────────────────

cron.schedule("0 */4 * * *", () => {
    console.log(`[${new Date().toISOString()}] Scheduled report...`);
    runAgent();
});

cron.schedule("*/15 * * * *", () => {
    checkForNews();
});

// ─── STARTUP ─────────────────────────────────────────────

setTimeout(() => { runAgent(); }, 5000);

checkForNews().then(() => {
    console.log("News baseline established.");
});

console.log("Alpha Decision Engine running.");
console.log(`📊 Reports: every 4 hours | Confluence threshold: ${MINIMUM_CONFLUENCE}/100`);
console.log("🔴 Alerts: every 15 minutes");