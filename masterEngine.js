// ─── MASTER ALPHA ENGINE ─────────────────────────────────
// Division 1: Perps Execution
// Division 2: Prediction Markets
// + Trade Journal integration

const { getVolumeSignals }     = require("./signals");
const { getPredictionSignals } = require("./predictionSignals");
const { getFearAndGreed }      = require("./fearGreed");
const { getBTCMacro }          = require("./confluence");
const { getNarrativeSignals }  = require("./narrativeSignals");
const {
    logTradeSignal,
    logPredictionBet,
    checkPendingOutcomes,
    getSetupPerformanceFeedback
} = require("./tradeJournal");

async function runMasterEngine() {

    console.log(`[Master Engine] Starting scan...`);
    const start = Date.now();

    // ── MARKET CONTEXT ───────────────────────────────────
    const [fgData, btcMacro, narrativeSignals] = await Promise.all([
        getFearAndGreed(),
        getBTCMacro(),
        getNarrativeSignals().catch(() => [])
    ]);

    const trendingSymbols = narrativeSignals.map(c => c.symbol?.toUpperCase());
    const regime          = determineRegime(fgData, btcMacro);

    console.log(`[Engine] Regime: ${regime.label} | BTC: ${btcMacro.trend} (${(btcMacro.change24h||0).toFixed(2)}%) | F&G: ${fgData.value}`);

    // Background outcome check
    checkPendingOutcomes().catch(err =>
        console.error("[Journal] Outcome check failed:", err.message)
    );

    // Journal feedback — adjust ranks based on historical win rates
    const setupFeedback = await getSetupPerformanceFeedback().catch(() => ({}));

    // ── RUN BOTH ENGINES ─────────────────────────────────
    const [perpsResult, predResult] = await Promise.allSettled([
        getVolumeSignals(trendingSymbols, fgData, setupFeedback),
        getPredictionSignals()
    ]);

    const perpsSignals = perpsResult.status === "fulfilled" ? perpsResult.value : [];
    const predSignals  = predResult.status  === "fulfilled" ? predResult.value  : [];

    // ── AUTO-LOG ALL SIGNALS ─────────────────────────────
    const logs = [];

    perpsSignals.forEach(signal => {
        if (signal.rank === "A+" || signal.rank === "A") {
            logs.push(logTradeSignal(signal, fgData.value).catch(() => {}));
        }
    });

    predSignals.forEach(bet => {
        if (bet.verdict === "BET THIS" && bet.confidence >= 7) {
            logs.push(logPredictionBet(bet).catch(() => {}));
        }
    });

    Promise.allSettled(logs).then(results => {
        const logged = results.filter(r => r.status === "fulfilled").length;
        if (logged > 0) console.log(`[Journal] ${logged} signals logged.`);
    });

    // ── DECISION OUTPUT ───────────────────────────────────
    const executableTrades = perpsSignals.filter(s => s.rank === "A+" || s.rank === "A");
    const executableBets   = predSignals.filter(p => p.verdict === "BET THIS" && p.confidence >= 7);

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const mode    = executableTrades.length > 0 ? "EXECUTE" :
                    executableBets.length  > 0  ? "BET_ONLY" : "STANDBY";

    console.log(`[Engine] ${elapsed}s | Mode: ${mode} | Trades: ${executableTrades.length} | Bets: ${executableBets.length}`);

    return {
        regime,
        fgData,
        btcMacro,
        narrativeSignals,
        executableTrades,
        executableBets,
        // News fields — empty since we stripped news division
        tradeNews:    [],
        betNews:      [],
        watchNews:    [],
        correlations: [],
        setupFeedback,
        noTradeToday: executableTrades.length === 0,
        noBetsToday:  executableBets.length  === 0,
        fullyQuiet:   executableTrades.length === 0 && executableBets.length === 0,
        mode
    };
}

// ─── REGIME DETECTION ────────────────────────────────────

function determineRegime(fgData, btcMacro) {
    const fg  = fgData.value;
    const d24 = btcMacro.change24h || 0;
    const d7  = btcMacro.change7d  || 0;

    if (fg < 20)                        return { label: "EXTREME_FEAR",  bias: "LONG",    description: "Capitulation zone — hunt reversals" };
    if (fg < 30 && d24 < 0)             return { label: "FEAR",          bias: "LONG",    description: "Fear creates long opportunities" };
    if (fg > 85)                        return { label: "EXTREME_GREED", bias: "SHORT",   description: "Extreme greed — short on rejections" };
    if (fg > 75 && d24 > 3)             return { label: "GREED",         bias: "SHORT",   description: "Elevated greed — caution on longs" };
    if (d7 < -10 && d24 < -2)           return { label: "BEAR_TREND",    bias: "SHORT",   description: "Downtrend — short bounces, tight stops" };
    if (fg > 55 && d24 > 1 && d7 > 0)  return { label: "RISK-ON",       bias: "LONG",    description: "Expansion — favor longs on pullbacks" };
    return                                     { label: "NEUTRAL",        bias: "NEUTRAL", description: "No regime bias — trade on merit" };
}

module.exports = { runMasterEngine };