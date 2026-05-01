 const cron                   = require("node-cron");
const { sendAlert }          = require("./telegram");
const { runMasterEngine }    = require("./masterEngine");
const { checkForNews }       = require("./newsIntelligence");
const { getWalletSignals }   = require("./walletSignals");
const { getNFTSignals }      = require("./nftSignals");
const { getNewsSignals }     = require("./newsSignals");
const { analyzeSignals }     = require("./analyzeSignals");
const { MINIMUM_CONFLUENCE } = require("./confluence");
const {
    initializeSchema,
    checkPendingOutcomes,
    getPerformanceSummary,
    formatPerformanceReport
}                            = require("./tradeJournal");

let isRunning = false;

function fmt(p) {
    if (!p) return "N/A";
    if (p < 0.0001) return p.toExponential(4);
    if (p < 1)      return p.toFixed(8);
    if (p < 100)    return p.toFixed(4);
    return p.toFixed(2);
}

function fgEmoji(v) {
    if (v <= 20) return "😱"; if (v <= 40) return "😨";
    if (v <= 60) return "😐"; if (v <= 80) return "😏";
    return "🤑";
}

function regimeEmoji(label) {
    const map = { "RISK-ON": "🟢", "FEAR": "😨", "EXTREME_FEAR": "😱", "GREED": "😏", "EXTREME_GREED": "🤑", "BEAR_TREND": "🔴", "NEUTRAL": "⚪" };
    return map[label] || "⚪";
}

async function runAgent() {

    if (isRunning) { console.log("Already running — skipped."); return; }
    isRunning = true;

    try {

        console.log(`\n[${new Date().toISOString()}] ═══ MASTER ALPHA ENGINE ═══`);

        // Run all 3 divisions through master engine
        const decision = await runMasterEngine();

        // Fetch supplementary data in parallel
        const [walletSignals, nftSignals, newsSignals] = await Promise.allSettled([
            getWalletSignals(),
            getNFTSignals(),
            getNewsSignals()
        ]).then(r => r.map(x => x.status === "fulfilled" ? x.value : []));

        // ─── BUILD MASTER REPORT ─────────────────────────

        let msg = ``;

        // ── HEADER ────────────────────────────────────────
        msg += `📡 *MASTER ALPHA ENGINE*\n`;
        msg += `🕐 ${new Date().toUTCString()}\n\n`;

        // ── MARKET REGIME ─────────────────────────────────
        const re = decision.regime;
        msg += `${regimeEmoji(re.label)} *Regime: ${re.label}*\n`;
        msg += `${fgEmoji(decision.fgData.value)} Fear & Greed: ${decision.fgData.value}/100 (${decision.fgData.label})\n`;
        msg += `₿ BTC: $${decision.btcMacro.price?.toLocaleString()} | ${decision.btcMacro.change24h?.toFixed(2)}% | ${decision.btcMacro.trend}\n`;
        msg += `📌 ${re.description}\n\n`;

        // ── CROSS-SIGNAL ALERTS ───────────────────────────
        if (decision.correlations.length > 0) {
            msg += `🔗 *MULTI-DIVISION CONFLUENCE*\n`;
            decision.correlations.forEach(c => {
                msg += `${c.symbol}: ${c.detail}\n`;
            });
            msg += `\n`;
        }

        // ════════════════════════════════════════════════
        // DIVISION 1 — NEWS INTELLIGENCE
        // ════════════════════════════════════════════════

        const hasNewsSignals = decision.tradeNews.length > 0 || decision.betNews.length > 0 || decision.watchNews.length > 0;

        if (hasNewsSignals) {
            msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
            msg += `📰 *DIVISION 1 — NEWS INTEL*\n\n`;

            // TRADE THIS
            if (decision.tradeNews.length > 0) {
                decision.tradeNews.forEach(n => {
                    msg += `⚡ *TRADE THIS* — ${n.asset} ${n.direction}\n`;
                    msg += `${n.title}\n`;
                    if (n.decision) msg += `→ ${n.decision}\n`;
                    if (n.url) msg += `🔗 ${n.url}\n`;
                    msg += `\n`;
                });
            }

            // BET THIS
            if (decision.betNews.length > 0) {
                decision.betNews.forEach(n => {
                    msg += `🎯 *BET THIS*\n`;
                    msg += `${n.title}\n`;
                    if (n.decision) msg += `→ ${n.decision}\n`;
                    if (n.url) msg += `🔗 ${n.url}\n`;
                    msg += `\n`;
                });
            }

            // WATCH THIS (max 2, condensed)
            if (decision.watchNews.length > 0) {
                msg += `👁 *WATCH*\n`;
                decision.watchNews.slice(0, 2).forEach(n => {
                    msg += `${n.title} — ${n.source}\n`;
                });
                msg += `\n`;
            }
        }

        // ════════════════════════════════════════════════
        // DIVISION 2 — PERPS EXECUTION
        // ════════════════════════════════════════════════

        msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `📊 *DIVISION 2 — PERPS*\n\n`;

        if (decision.noTradeToday) {
            msg += `🛑 *NO TRADE*\n`;
            msg += `No setups passed ${MINIMUM_CONFLUENCE}/100 confluence (A/A+ required).\n`;
            msg += `Regime bias: ${re.bias}. Monitor for next session.\n\n`;
        } else {

            const aPlus = decision.executableTrades.filter(s => s.rank === "A+");
            const aRank = decision.executableTrades.filter(s => s.rank === "A");

            if (aPlus.length > 0) {
                msg += `🏆 *A+ EXECUTE IMMEDIATELY*\n\n`;
                aPlus.forEach(coin => {
                    const dir = coin.direction === "LONG" ? "🟢 LONG" : "🔴 SHORT";
                    const div = coin.divergence ? `⚡ ${coin.divergence}\n` : "";
                    const cor = decision.correlations.find(c => c.symbol === coin.symbol);

                    msg += `*${coin.name} (${coin.symbol})*\n`;
                    if (cor) msg += `🔗 News confirms this setup\n`;
                    if (coin.feedbackNote) msg += `${coin.feedbackNote}\n`;
                    msg += `${dir} | ${coin.setupType}\n`;
                    msg += `${div}`;
                    msg += `Confluence: ${coin.confluenceScore}/100\n\n`;
                    msg += `Entry:       $${fmt(coin.entry)}\n`;
                    msg += `Stop Loss:   $${fmt(coin.stopLoss)}\n`;
                    msg += `Take Profit: $${fmt(coin.takeProfit)}\n`;
                    msg += `Invalidation: ${coin.invalidation}\n\n`;
                    msg += `R:R 1:${coin.rrRatio} | ${coin.leverage}x\n`;
                    msg += `✅ +$${coin.profitAtTP} | ❌ -$${coin.lossAtSL}\n`;
                    msg += `Timeframe: ${coin.timeframe}\n`;
                    msg += `RSI: ${coin.rsi} | Vol: ${coin.volumeRatio}x\n`;
                    msg += `💬 ${coin.reasoning}\n\n`;
                });
            }

            if (aRank.length > 0) {
                msg += `✅ *A SETUPS*\n\n`;
                aRank.forEach((coin, i) => {
                    const dir = coin.direction === "LONG" ? "🟢 LONG" : "🔴 SHORT";
                    const div = coin.divergence ? `⚡ ${coin.divergence}\n` : "";
                    msg += `*${i+1}. ${coin.name} (${coin.symbol})*\n`;
                    msg += `${dir} | ${coin.setupType}\n`;
                    msg += `${div}`;
                    msg += `Confluence: ${coin.confluenceScore}/100 | BTC: ${coin.btcTrend}\n\n`;
                    msg += `Entry: $${fmt(coin.entry)} | SL: $${fmt(coin.stopLoss)} | TP: $${fmt(coin.takeProfit)}\n`;
                    msg += `Invalidation: ${coin.invalidation}\n`;
                    msg += `R:R 1:${coin.rrRatio} | ${coin.leverage}x | ✅ +$${coin.profitAtTP} | ❌ -$${coin.lossAtSL}\n`;
                    msg += `Timeframe: ${coin.timeframe}\n`;
                    msg += `💬 ${coin.reasoning}\n\n`;
                });
            }
        }

        // ════════════════════════════════════════════════
        // DIVISION 3 — PREDICTION MARKETS
        // ════════════════════════════════════════════════

        msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `🎯 *DIVISION 3 — PREDICTIONS*\n\n`;

        if (decision.noBetsToday) {
            msg += `🛑 *NO EDGE* — No pricing inefficiencies found.\n\n`;
        } else {
            const catEmoji = { CRYPTO: "🪙", POLITICS: "🏛", TECH: "💻", SPORTS: "🏆", OTHER: "🔮" };

            decision.executableBets.forEach(m => {
                const cat = catEmoji[m.category] || "🔮";
                msg += `${cat} *${m.question}*\n\n`;
                msg += `BET ${m.betSide}\n`;
                msg += `Current: ${m.marketPrice}¢ | Fair Value: ${m.fairValue}% | Edge: +${m.edge}%\n`;
                msg += `Confidence: ${m.confidence}/10\n`;
                msg += `$5 → $${m.payout5} | $10 → $${m.payout10}\n`;
                if (m.bookmakerProb) msg += `Sportsbook: ${m.bookmakerProb}%\n`;
                msg += `💬 ${m.reasoning}\n`;
                msg += `🔗 ${m.url}\n\n`;
            });
        }

        // ── SMART MONEY ───────────────────────────────────
        if (walletSignals.length > 0) {
            msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
            msg += `🐋 *Smart Money*\n`;
            walletSignals.forEach(w => msg += `${w.label}: ${w.ethBalance}\n`);
            msg += `\n`;
        }

        // ── TRENDING ──────────────────────────────────────
        if (decision.narrativeSignals?.length > 0) {
            msg += `🔥 *Trending:* `;
            decision.narrativeSignals.slice(0, 5).forEach(c => msg += `${c.symbol} `);
            msg += `\n\n`;
        }

        // ── AI MASTER BRIEF ───────────────────────────────
        console.log(`[${new Date().toISOString()}] AI Master Brief...`);

        const aiAnalysis = await analyzeSignals({
            decision,
            walletSignals,
            newsSignals
        });

        if (aiAnalysis) {
            msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n${aiAnalysis}`;
        }

        await sendAlert(msg);
        console.log(`[${new Date().toISOString()}] ═══ Report sent. Mode: ${decision.mode} ═══\n`);

    } finally {
        isRunning = false;
    }
}

// ─── SCHEDULES ───────────────────────────────────────────

cron.schedule("0 */4 * * *", () => {
    console.log(`[${new Date().toISOString()}] Scheduled engine run...`);
    runAgent();
});

cron.schedule("*/15 * * * *", () => { checkForNews(); });

// Weekly performance report — every Sunday at 9AM UTC
cron.schedule("0 9 * * 0", async () => {
    console.log(`[${new Date().toISOString()}] Generating weekly performance report...`);
    try {
        const summary = await getPerformanceSummary("weekly");
        const report  = formatPerformanceReport(summary);
        await sendAlert(report);
    } catch (err) {
        console.error("Performance report error:", err.message);
    }
});

// Outcome check — every 4 hours independently
cron.schedule("0 2,6,10,14,18,22 * * *", () => {
    checkPendingOutcomes().catch(err => console.error("Outcome check error:", err.message));
});

// ─── STARTUP ─────────────────────────────────────────────

// Initialize journal schema
initializeSchema().catch(err => console.error("Journal init error:", err.message));

setTimeout(() => { runAgent(); }, 5000);
buildNewsBaseline().then(() => console.log("Intel baseline established."));

console.log("\n╔══════════════════════════════════╗");
console.log("║   MASTER ALPHA ENGINE ONLINE     ║");
console.log(`║   Threshold: ${MINIMUM_CONFLUENCE}/100 | Min: A      ║`);
console.log("║   Reports: every 4 hours          ║");
console.log("║   Alerts: every 15 minutes        ║");
console.log("╚══════════════════════════════════╝\n");