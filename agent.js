const cron                   = require("node-cron");
const { sendAlert }          = require("./telegram");
const { runMasterEngine }    = require("./masterEngine");
const { getVolumeSignals }   = require("./signals");
const { getFearAndGreed }    = require("./fearGreed");
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
} = require("./tradeJournal");

let isRunning      = false;
let alertIsRunning = false;

// Track signals already alerted to avoid duplicates
const alertedSignals = new Set();

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
    const map = {
        "RISK-ON": "🟢", "FEAR": "😨", "EXTREME_FEAR": "😱",
        "GREED": "😏", "EXTREME_GREED": "🤑", "BEAR_TREND": "🔴", "NEUTRAL": "⚪"
    };
    return map[label] || "⚪";
}

// ─── 15-MINUTE QUICK SIGNAL SCAN ─────────────────────────
// Pure TA scan — no news, no noise
// Only fires a Telegram alert if it finds an A or A+ setup
// Catches MEGA-type moves, parabolic setups, and shorts early

async function runQuickScan() {
    if (alertIsRunning) return;
    alertIsRunning = true;

    try {
        const fgData  = await getFearAndGreed().catch(() => ({ value: 50, label: "Neutral" }));
        const signals = await getVolumeSignals([], fgData, {});

        if (!signals || signals.length === 0) return;

        for (const signal of signals) {
            // Build unique key — symbol + direction + setup
            const key = `${signal.symbol}_${signal.direction}_${signal.setupType}`;
            if (alertedSignals.has(key)) continue;

            // Only alert A and A+
            if (signal.rank !== "A+" && signal.rank !== "A") continue;

            alertedSignals.add(key);

            // Auto-clear after 4 hours so same setup can re-alert next cycle
            setTimeout(() => alertedSignals.delete(key), 4 * 60 * 60 * 1000);

            const dir    = signal.direction === "LONG" ? "🟢 LONG" : "🔴 SHORT";
            const badge  = signal.rank === "A+" ? "🏆 A+" : "✅ A";
            const div    = signal.divergence ? `⚡ ${signal.divergence}\n` : "";

            let msg = `⚡ *LIVE SIGNAL — ${badge}*\n\n`;
            msg += `*${signal.name} (${signal.symbol})*\n`;
            msg += `${dir} | ${signal.setupType}\n`;
            msg += `${div}`;
            msg += `Confluence: ${signal.confluenceScore}/100\n\n`;
            msg += `Entry:        $${fmt(signal.entry)}\n`;
            msg += `Stop Loss:    $${fmt(signal.stopLoss)}\n`;
            msg += `Take Profit:  $${fmt(signal.takeProfit)}\n`;
            msg += `Invalidation: ${signal.invalidation}\n\n`;
            msg += `R:R 1:${signal.rrRatio} | ${signal.leverage}x leverage\n`;
            msg += `✅ +$${signal.profitAtTP} | ❌ -$${signal.lossAtSL}\n`;
            msg += `Timeframe: ${signal.timeframe}\n`;
            msg += `RSI: ${signal.rsi} | Vol: ${signal.volumeRatio}x\n\n`;
            msg += `💬 ${signal.reasoning}\n`;
            msg += `📊 Exchange: ${signal.exchange}`;

            await sendAlert(msg);
            console.log(`[Quick Scan] Alert sent: ${signal.symbol} ${signal.direction} ${signal.rank}`);

            await new Promise(r => setTimeout(r, 1000));
        }

    } catch (err) {
        console.error("[Quick Scan] Error:", err.message);
    } finally {
        alertIsRunning = false;
    }
}

// ─── 4-HOUR FULL REPORT ───────────────────────────────────

async function runAgent() {
    if (isRunning) { console.log("Already running — skipped."); return; }
    isRunning = true;

    try {
        console.log(`\n[${new Date().toISOString()}] ═══ MASTER ALPHA ENGINE ═══`);

        const decision = await runMasterEngine();

        const [walletSignals, nftSignals, newsSignals] = await Promise.allSettled([
            getWalletSignals(),
            getNFTSignals(),
            getNewsSignals()
        ]).then(r => r.map(x => x.status === "fulfilled" ? x.value : []));

        let msg = `📡 *MASTER ALPHA ENGINE*\n`;
        msg += `🕐 ${new Date().toUTCString()}\n\n`;

        // Market regime
        const re = decision.regime;
        msg += `${regimeEmoji(re.label)} *Regime: ${re.label}*\n`;
        msg += `${fgEmoji(decision.fgData.value)} Fear & Greed: ${decision.fgData.value}/100 (${decision.fgData.label})\n`;
        msg += `₿ BTC: $${decision.btcMacro.price?.toLocaleString()} | ${decision.btcMacro.change24h?.toFixed(2)}% | ${decision.btcMacro.trend}\n`;
        msg += `📌 ${re.description}\n\n`;

        // Cross-signal confluence
        if (decision.correlations?.length > 0) {
            msg += `🔗 *MULTI-DIVISION CONFLUENCE*\n`;
            decision.correlations.forEach(c => msg += `${c.symbol}: ${c.detail}\n`);
            msg += `\n`;
        }

        // ── PERPS ─────────────────────────────────────────
        msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `📊 *PERPS DIVISION*\n\n`;

        if (decision.noTradeToday) {
            msg += `🛑 *NO TRADE*\n`;
            msg += `No setups passed ${MINIMUM_CONFLUENCE}/100 confluence.\n`;
            msg += `Regime bias: ${re.bias}. Monitor for next session.\n\n`;
        } else {
            const aPlus = decision.executableTrades.filter(s => s.rank === "A+");
            const aRank = decision.executableTrades.filter(s => s.rank === "A");

            if (aPlus.length > 0) {
                msg += `🏆 *A+ EXECUTE NOW*\n\n`;
                aPlus.forEach(coin => {
                    const dir = coin.direction === "LONG" ? "🟢 LONG" : "🔴 SHORT";
                    const div = coin.divergence ? `⚡ ${coin.divergence}\n` : "";
                    msg += `*${coin.name} (${coin.symbol})*\n`;
                    if (coin.feedbackNote) msg += `${coin.feedbackNote}\n`;
                    msg += `${dir} | ${coin.setupType}\n${div}`;
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
                    msg += `${dir} | ${coin.setupType}\n${div}`;
                    msg += `Confluence: ${coin.confluenceScore}/100 | BTC: ${coin.btcTrend}\n\n`;
                    msg += `Entry: $${fmt(coin.entry)} | SL: $${fmt(coin.stopLoss)} | TP: $${fmt(coin.takeProfit)}\n`;
                    msg += `Invalidation: ${coin.invalidation}\n`;
                    msg += `R:R 1:${coin.rrRatio} | ${coin.leverage}x | ✅ +$${coin.profitAtTP} | ❌ -$${coin.lossAtSL}\n`;
                    msg += `Timeframe: ${coin.timeframe}\n`;
                    msg += `💬 ${coin.reasoning}\n\n`;
                });
            }
        }

        // ── PREDICTIONS ───────────────────────────────────
        msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `🎯 *PREDICTION MARKETS*\n\n`;

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

        // ── AI BRIEF ──────────────────────────────────────
        console.log(`[${new Date().toISOString()}] AI Master Brief...`);
        const aiAnalysis = await analyzeSignals({ decision, walletSignals, newsSignals });
        if (aiAnalysis) msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n${aiAnalysis}`;

        await sendAlert(msg);
        console.log(`[${new Date().toISOString()}] ═══ Report sent. Mode: ${decision.mode} ═══\n`);

    } finally {
        isRunning = false;
    }
}

// ─── SCHEDULES ───────────────────────────────────────────

// Full 4-hour report
cron.schedule("0 */4 * * *", () => {
    console.log(`[${new Date().toISOString()}] Scheduled full report...`);
    runAgent();
});

// 15-minute quick signal scan — pure TA, no news
cron.schedule("*/15 * * * *", () => {
    runQuickScan();
});

// Weekly performance report — Sundays 9AM UTC
cron.schedule("0 9 * * 0", async () => {
    try {
        const summary = await getPerformanceSummary("weekly");
        const report  = formatPerformanceReport(summary);
        await sendAlert(report);
    } catch (err) {
        console.error("Performance report error:", err.message);
    }
});

// Outcome check — every 4 hours offset
cron.schedule("0 2,6,10,14,18,22 * * *", () => {
    checkPendingOutcomes().catch(err => console.error("Outcome check error:", err.message));
});

// ─── STARTUP ─────────────────────────────────────────────

initializeSchema().catch(err => console.error("Journal init error:", err.message));

setTimeout(() => { runAgent(); }, 30000);

console.log("\n╔══════════════════════════════════╗");
console.log("║   MASTER ALPHA ENGINE ONLINE     ║");
console.log(`║   Threshold: ${MINIMUM_CONFLUENCE}/100 | Min: A      ║`);
console.log("║   Full report: every 4 hours      ║");
console.log("║   Signal scan: every 15 minutes   ║");
console.log("╚══════════════════════════════════╝\n");