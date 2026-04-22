// ─── MASTER ALPHA ENGINE ─────────────────────────────────
// Coordinates all 3 profit divisions + Trade Journal
// Division 1: News Intelligence
// Division 2: Perps Execution (journal-calibrated)
// Division 3: Prediction Markets (journal-calibrated)

const { fetchAndClassifyNews }        = require("./newsIntelligence");
const { getVolumeSignals }            = require("./signals");
const { getPredictionSignals }        = require("./predictionSignals");
const { getFearAndGreed }             = require("./fearGreed");
const { getBTCMacro }                 = require("./confluence");
const { getNarrativeSignals }         = require("./narrativeSignals");
const {
    logTradeSignal,
    logPredictionBet,
    checkPendingOutcomes,
    getSetupPerformanceFeedback
} = require("./tradeJournal");

async function runMasterEngine() {

    console.log(`[Master Engine] Starting full scan...`);
    const startTime = Date.now();

    // ── PHASE 1: Market Context ───────────────────────────
    const [fgData, btcMacro, narrativeSignals] = await Promise.all([
        getFearAndGreed(),
        getBTCMacro(),
        getNarrativeSignals().catch(() => [])
    ]);

    const trendingSymbols = narrativeSignals.map(c => c.symbol?.toUpperCase());
    const regime          = determineMarketRegime(fgData, btcMacro);

    console.log(`[Master Engine] Regime: ${regime.label} | BTC: ${btcMacro.trend} | F&G: ${fgData.value}`);

    // ── PHASE 2: Check pending outcomes (background) ──────
    // Don't await — runs in background while we fetch signals
    checkPendingOutcomes().catch(err =>
        console.error("[Journal] Outcome check error:", err.message)
    );

    // ── PHASE 3: Get journal feedback ─────────────────────
    // Adjust signal confidence based on historical performance
    const setupFeedback = await getSetupPerformanceFeedback().catch(() => ({}));

    if (Object.keys(setupFeedback).length > 0) {
        console.log(`[Master Engine] Setup feedback loaded:`, setupFeedback);
    }

    // ── PHASE 4: Run All 3 Divisions in Parallel ─────────
    const [newsIntel, tradeSignals, predictionSignals] = await Promise.allSettled([
        fetchAndClassifyNews(),
        getVolumeSignals(trendingSymbols, fgData, setupFeedback),
        getPredictionSignals()
    ]).then(results => results.map(r => r.status === "fulfilled" ? r.value : (r.value || {})));

    // ── PHASE 5: Auto-Log All Signals ────────────────────
    // Every signal is logged immediately — no manual logging
    const logPromises = [];

    if (Array.isArray(tradeSignals)) {
        for (const signal of tradeSignals) {
            if (signal.rank === "A+" || signal.rank === "A") {
                logPromises.push(
                    logTradeSignal(signal, fgData.value).catch(err =>
                        console.error(`[Journal] Failed to log ${signal.symbol}:`, err.message)
                    )
                );
            }
        }
    }

    if (Array.isArray(predictionSignals)) {
        for (const bet of predictionSignals) {
            if (bet.verdict === "BET THIS" && bet.confidence >= 7) {
                logPromises.push(
                    logPredictionBet(bet).catch(err =>
                        console.error(`[Journal] Failed to log bet:`, err.message)
                    )
                );
            }
        }
    }

    // Fire logging in background
    Promise.allSettled(logPromises).then(results => {
        const logged = results.filter(r => r.status === "fulfilled").length;
        if (logged > 0) console.log(`[Journal] ${logged} signals logged.`);
    });

    // ── PHASE 6: Cross-Division Correlation ──────────────
    const correlations = findCrossSignals(newsIntel, tradeSignals, predictionSignals);

    // ── PHASE 7: Final Decision ───────────────────────────
    const decision = buildDecision({
        regime, fgData, btcMacro, narrativeSignals,
        newsIntel, tradeSignals, predictionSignals,
        correlations, setupFeedback
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Master Engine] Complete in ${elapsed}s — Mode: ${decision.mode} | Trades: ${decision.executableTrades.length} | Bets: ${decision.executableBets.length}`);

    return decision;
}

// ─── MARKET REGIME ───────────────────────────────────────

function determineMarketRegime(fgData, btcMacro) {
    const fg  = fgData.value;
    const d24 = btcMacro.change24h;
    const d7  = btcMacro.change7d;

    if (fg < 20)                        return { label: "EXTREME_FEAR",  bias: "LONG",    multiplier: 1.2, description: "Capitulation zone. Highest probability reversal setups." };
    if (fg < 30 && d24 < 0)             return { label: "FEAR",          bias: "LONG",    multiplier: 1.0, description: "Fear creates long opportunities. Accumulate quality." };
    if (fg > 85)                        return { label: "EXTREME_GREED", bias: "SHORT",   multiplier: 1.1, description: "Extreme greed. Favor shorts on rejections." };
    if (fg > 75 && d24 > 3)             return { label: "GREED",         bias: "SHORT",   multiplier: 0.9, description: "Elevated greed. Caution on longs. Watch for reversals." };
    if (d7 < -10 && d24 < -2)           return { label: "BEAR_TREND",    bias: "SHORT",   multiplier: 1.0, description: "Downtrend active. Shorts on bounces, tight stops on longs." };
    if (fg > 55 && d24 > 1 && d7 > 0)  return { label: "RISK-ON",       bias: "LONG",    multiplier: 1.1, description: "Market expanding. Favor longs on pullbacks." };
    return                                     { label: "NEUTRAL",        bias: "NEUTRAL", multiplier: 1.0, description: "No strong regime. Trade setups on individual merit." };
}

// ─── CROSS-SIGNAL CORRELATION ─────────────────────────────

function findCrossSignals(newsIntel, tradeSignals, predictionSignals) {
    const correlations = [];
    if (!Array.isArray(tradeSignals)) return correlations;

    for (const trade of tradeSignals) {
        const sym = trade.symbol?.toUpperCase();
        if (!sym) continue;

        const relatedNews = [
            ...(newsIntel?.TRADE || []),
            ...(newsIntel?.WATCH || [])
        ].filter(n => n.asset === sym || n.title?.toLowerCase().includes(sym.toLowerCase()));

        if (relatedNews.length > 0) {
            correlations.push({
                symbol:    sym,
                type:      "NEWS_CONFIRMS_TRADE",
                detail:    `${sym} has both a trade setup AND a news catalyst`,
                direction: trade.direction,
                newsTitle: relatedNews[0].title,
                tradeRank: trade.rank
            });
        }
    }

    return correlations;
}

// ─── DECISION BUILDER ────────────────────────────────────

function buildDecision({ regime, fgData, btcMacro, narrativeSignals, newsIntel, tradeSignals, predictionSignals, correlations, setupFeedback }) {

    const executableTrades = Array.isArray(tradeSignals)
        ? tradeSignals.filter(s => s.rank === "A+" || s.rank === "A")
        : [];

    const executableBets = Array.isArray(predictionSignals)
        ? predictionSignals.filter(p => p.verdict === "BET THIS" && p.confidence >= 7)
        : [];

    const noTradeToday = executableTrades.length === 0;
    const noBetsToday  = executableBets.length === 0;

    return {
        regime, fgData, btcMacro, narrativeSignals,
        executableTrades, executableBets,
        tradeNews: newsIntel?.TRADE || [],
        betNews:   newsIntel?.BET   || [],
        watchNews: newsIntel?.WATCH || [],
        correlations,
        setupFeedback,
        noTradeToday, noBetsToday,
        fullyQuiet: noTradeToday && noBetsToday,
        mode: executableTrades.length > 0 ? "EXECUTE" :
              executableBets.length > 0   ? "BET_ONLY" : "STANDBY"
    };
}

module.exports = { runMasterEngine };