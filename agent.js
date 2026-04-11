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

async function runAgent() {

    console.log(`[${new Date().toISOString()}] Running Alpha Agent...`);

    const [volumeSignals, walletSignals, narrativeSignals,
           nftSignals, predictionSignals, newsSignals] = await Promise.allSettled([
        getVolumeSignals(),
        getWalletSignals(),
        getNarrativeSignals(),
        getNFTSignals(),
        getPredictionSignals(),
        getNewsSignals()
    ]).then(results => results.map(r => r.status === "fulfilled" ? r.value : []));

    let message = "🚨 Alpha Agent Intelligence Report\n";
    message += `🕐 ${new Date().toUTCString()}\n\n`;

    if (volumeSignals.length > 0) {
        message += "📈 *Momentum Signals*\n\n";
        volumeSignals.forEach(coin => {
            message += `${coin.name} (${coin.symbol})\n`;
            message += `Price: $${coin.price}\n`;
            message += `24h Change: ${coin.change.toFixed(2)}%\n\n`;
        });
    }

    if (narrativeSignals.length > 0) {
        message += "🔥 *Narrative Signals*\n\n";
        narrativeSignals.forEach(coin => {
            message += `${coin.name} (${coin.symbol})\n`;
            message += `Trend Score: ${coin.score}\n\n`;
        });
    }

    if (nftSignals.length > 0) {
        message += "🖼 *NFT Signals*\n\n";
        nftSignals.forEach(nft => {
            message += `${nft.name} (${nft.symbol})\n`;
            message += `Price: $${nft.price} | 24h: ${nft.change24h}\n`;
            message += `Volume: ${nft.volume24h}\n\n`;
        });
    }

    if (walletSignals.length > 0) {
        message += "🐋 *Wallet Tracker*\n\n";
        walletSignals.forEach(w => {
            message += `${w.label} (${w.address})\n`;
            message += `Balance: ${w.ethBalance}\n`;
            message += `Total Txns: ${w.txCount}\n\n`;
        });
    }

    if (predictionSignals.length > 0) {
        message += "🔮 *Prediction Market Signals*\n\n";
        predictionSignals.forEach(market => {

            let confidenceEmoji = "🟡";
            if (market.confidence >= 8)      confidenceEmoji = "🟢";
            else if (market.confidence <= 4) confidenceEmoji = "🔴";

            message += `${market.question}\n`;
            message += `Bet: ${market.betSide} @ ${market.betPrice}¢\n`;
            message += `$5 pays $${market.payout5} | $10 pays $${market.payout10}\n`;
            message += `${confidenceEmoji} Confidence: ${market.confidence}/10 | ${market.verdict}\n`;

            // Show bookmaker edge if available
            if (market.bookmakerProb !== null && market.edge !== null) {
                const edgeNum = parseFloat(market.edge);
                const edgeEmoji = edgeNum > 0 ? "📈" : "📉";
                message += `${edgeEmoji} Bookmaker prob: ${market.bookmakerProb}% vs Polymarket: ${market.betPrice}% | Edge: ${edgeNum > 0 ? "+" : ""}${market.edge}%\n`;
            }

            if (market.reasoning) message += `💬 ${market.reasoning}\n`;
            message += `24hr Vol: $${market.volume24hr} | Liquidity: $${market.liquidity}\n`;
            message += `🔗 ${market.url}\n\n`;
        });
    }

    if (newsSignals.length > 0) {
        message += "📰 *Breaking News*\n\n";
        newsSignals.forEach(article => {
            message += `${article.title}\n`;
            message += `Source: ${article.source}\n\n`;
        });
    }

    console.log(`[${new Date().toISOString()}] Running AI analysis...`);

    const aiAnalysis = await analyzeSignals({
        volumeSignals,
        narrativeSignals,
        nftSignals,
        walletSignals,
        predictionSignals,
        newsSignals
    });

    if (aiAnalysis) {
        message += "─────────────────────\n\n";
        message += aiAnalysis;
    }

    await sendAlert(message);
    console.log(`[${new Date().toISOString()}] Report sent.`);
}

// ─── SCHEDULES ───────────────────────────────────────────

// Full intelligence report — every 6 hours
cron.schedule("0 */6 * * *", () => {
    console.log(`[${new Date().toISOString()}] Running scheduled report...`);
    runAgent();
});

// Breaking news monitor — every 15 minutes
cron.schedule("*/15 * * * *", () => {
    checkForNews();
});

// ─── STARTUP ─────────────────────────────────────────────

runAgent();

checkForNews().then(() => {
    console.log("News baseline established. Future new stories will trigger alerts.");
});

console.log("Alpha Agent running.");
console.log("📊 Full report: every 6 hours");
console.log("🔴 News monitor: every 15 minutes");