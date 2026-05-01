// ─── TRADE JOURNAL ENGINE ────────────────────────────────
// Logs every signal automatically.
// Checks outcomes after timeframe elapses.
// Feeds performance back into the engine.
// No Supabase yet? Falls back to in-memory with Telegram summaries.

const axios = require("axios");
require("dotenv").config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const hasSupabase = !!(SUPABASE_URL && SUPABASE_KEY);

// In-memory fallback when Supabase not configured
const memoryJournal = { trades: [], bets: [], outcomes: [] };

// ─── SUPABASE HELPERS ─────────────────────────────────────

async function supabaseInsert(table, data) {
    if (!hasSupabase) return null;
    try {
        const res = await axios.post(
            `${SUPABASE_URL}/rest/v1/${table}`,
            data,
            {
                headers: {
                    "apikey":        SUPABASE_KEY,
                    "Authorization": `Bearer ${SUPABASE_KEY}`,
                    "Content-Type":  "application/json",
                    "Prefer":        "return=representation"
                },
                timeout: 8000
            }
        );
        return res.data;
    } catch (err) {
        console.error(`[Journal] Supabase insert error (${table}):`, err.message);
        return null;
    }
}

async function supabaseSelect(table, filters = "", limit = 100) {
    if (!hasSupabase) return null;
    try {
        const res = await axios.get(
            `${SUPABASE_URL}/rest/v1/${table}?${filters}&limit=${limit}&order=created_at.desc`,
            {
                headers: {
                    "apikey":        SUPABASE_KEY,
                    "Authorization": `Bearer ${SUPABASE_KEY}`
                },
                timeout: 8000
            }
        );
        return res.data;
    } catch (err) {
        console.error(`[Journal] Supabase select error (${table}):`, err.message);
        return null;
    }
}

async function supabaseUpdate(table, id, data) {
    if (!hasSupabase) return null;
    try {
        await axios.patch(
            `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`,
            data,
            {
                headers: {
                    "apikey":        SUPABASE_KEY,
                    "Authorization": `Bearer ${SUPABASE_KEY}`,
                    "Content-Type":  "application/json"
                },
                timeout: 8000
            }
        );
        return true;
    } catch (err) {
        console.error(`[Journal] Supabase update error:`, err.message);
        return null;
    }
}

// ─── SCHEMA INITIALIZER ───────────────────────────────────
// Creates tables if they don't exist
// Run once on startup

async function initializeSchema() {
    if (!hasSupabase) {
        console.log("[Journal] No Supabase configured — using in-memory storage.");
        return;
    }

    // We can't run raw SQL via REST API, so we use upsert
    // Tables must be created manually in Supabase dashboard
    // SQL to run in Supabase SQL editor:
    console.log("[Journal] Supabase connected. Tables required:");
    console.log(`
-- Run this in your Supabase SQL editor once:
CREATE TABLE IF NOT EXISTS trade_signals (
    id          BIGSERIAL PRIMARY KEY,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    symbol      TEXT NOT NULL,
    name        TEXT,
    direction   TEXT NOT NULL,
    setup_type  TEXT,
    rank        TEXT,
    entry       NUMERIC,
    stop_loss   NUMERIC,
    take_profit NUMERIC,
    leverage    INTEGER,
    rr_ratio    NUMERIC,
    confluence  INTEGER,
    timeframe   TEXT,
    reasoning   TEXT,
    btc_trend   TEXT,
    fg_value    INTEGER,
    outcome     TEXT,       -- WIN / LOSS / PARTIAL / PENDING
    exit_price  NUMERIC,
    pnl_pct     NUMERIC,
    checked_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS prediction_bets (
    id            BIGSERIAL PRIMARY KEY,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    question      TEXT NOT NULL,
    category      TEXT,
    bet_side      TEXT,
    market_price  NUMERIC,
    fair_value    NUMERIC,
    edge          NUMERIC,
    confidence    INTEGER,
    payout10      NUMERIC,
    url           TEXT,
    reasoning     TEXT,
    outcome       TEXT,     -- WIN / LOSS / PENDING / EXPIRED
    resolved_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS engine_performance (
    id          BIGSERIAL PRIMARY KEY,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    period      TEXT,       -- weekly / monthly
    total_trades INTEGER,
    wins        INTEGER,
    losses      INTEGER,
    win_rate    NUMERIC,
    avg_rr      NUMERIC,
    best_setup  TEXT,
    worst_setup TEXT,
    notes       TEXT
);
    `);
}

// ─── LOG TRADE SIGNAL ────────────────────────────────────

async function logTradeSignal(signal, fgValue) {
    const entry = {
        symbol:     signal.symbol,
        name:       signal.name,
        direction:  signal.direction,
        setup_type: signal.setupType,
        rank:       signal.rank,
        entry:      signal.entry,
        stop_loss:  signal.stopLoss,
        take_profit: signal.takeProfit,
        leverage:   signal.leverage,
        rr_ratio:   signal.rrRatio,
        confluence: signal.confluenceScore,
        timeframe:  signal.timeframe,
        reasoning:  signal.reasoning,
        btc_trend:  signal.btcTrend,
        fg_value:   fgValue,
        outcome:    "PENDING"
    };

    if (hasSupabase) {
        const result = await supabaseInsert("trade_signals", entry);
        if (result?.[0]?.id) {
            console.log(`[Journal] Logged trade: ${signal.symbol} ${signal.direction} (ID: ${result[0].id})`);
            return result[0].id;
        }
    } else {
        const id = Date.now();
        memoryJournal.trades.push({ id, ...entry, created_at: new Date().toISOString() });
        console.log(`[Journal] Memory logged: ${signal.symbol} ${signal.direction}`);
        return id;
    }

    return null;
}

// ─── LOG PREDICTION BET ───────────────────────────────────

async function logPredictionBet(bet) {
    const entry = {
        question:     bet.question,
        category:     bet.category,
        bet_side:     bet.betSide,
        market_price: bet.marketPrice,
        fair_value:   bet.fairValue,
        edge:         bet.edge,
        confidence:   bet.confidence,
        payout10:     bet.payout10,
        url:          bet.url,
        reasoning:    bet.reasoning,
        outcome:      "PENDING"
    };

    if (hasSupabase) {
        const result = await supabaseInsert("prediction_bets", entry);
        if (result?.[0]?.id) {
            console.log(`[Journal] Logged bet: ${bet.question.slice(0, 40)}... (ID: ${result[0].id})`);
            return result[0].id;
        }
    } else {
        const id = Date.now();
        memoryJournal.bets.push({ id, ...entry, created_at: new Date().toISOString() });
        return id;
    }

    return null;
}

// ─── CHECK OUTCOMES ───────────────────────────────────────
// Runs every 4 hours to check if pending trades hit TP or SL

async function checkPendingOutcomes() {
    console.log("[Journal] Checking pending trade outcomes...");

    let pendingTrades = [];

    if (hasSupabase) {
        pendingTrades = await supabaseSelect("trade_signals", "outcome=eq.PENDING", 20) || [];
    } else {
        pendingTrades = memoryJournal.trades.filter(t => t.outcome === "PENDING");
    }

    if (pendingTrades.length === 0) return;

    for (const trade of pendingTrades) {
        try {
            // Fetch current price from CoinGecko
            const searchRes = await axios.get(
                "https://api.coingecko.com/api/v3/search",
                { params: { query: trade.symbol }, timeout: 8000 }
            );

            const coin = searchRes.data.coins?.[0];
            if (!coin) continue;

            const priceRes = await axios.get(
                `https://api.coingecko.com/api/v3/simple/price`,
                { params: { ids: coin.id, vs_currencies: "usd" }, timeout: 8000 }
            );

            const currentPrice = priceRes.data[coin.id]?.usd;
            if (!currentPrice) continue;

            const entry      = parseFloat(trade.entry);
            const tp         = parseFloat(trade.take_profit);
            const sl         = parseFloat(trade.stop_loss);
            const isLong     = trade.direction === "LONG";

            let outcome   = "PENDING";
            let pnlPct    = null;

            if (isLong) {
                if (currentPrice >= tp)   { outcome = "WIN";  pnlPct = ((tp - entry) / entry * 100).toFixed(2); }
                else if (currentPrice <= sl) { outcome = "LOSS"; pnlPct = ((sl - entry) / entry * 100).toFixed(2); }
            } else {
                if (currentPrice <= tp)   { outcome = "WIN";  pnlPct = ((entry - tp) / entry * 100).toFixed(2); }
                else if (currentPrice >= sl) { outcome = "LOSS"; pnlPct = ((entry - sl) / entry * 100).toFixed(2); }
            }

            if (outcome !== "PENDING") {
                if (hasSupabase) {
                    await supabaseUpdate("trade_signals", trade.id, {
                        outcome,
                        exit_price: currentPrice,
                        pnl_pct:    pnlPct,
                        checked_at: new Date().toISOString()
                    });
                } else {
                    const idx = memoryJournal.trades.findIndex(t => t.id === trade.id);
                    if (idx !== -1) {
                        memoryJournal.trades[idx].outcome    = outcome;
                        memoryJournal.trades[idx].exit_price = currentPrice;
                        memoryJournal.trades[idx].pnl_pct    = pnlPct;
                    }
                }

                console.log(`[Journal] ${trade.symbol} ${trade.direction}: ${outcome} (${pnlPct}%)`);
            }

            await new Promise(r => setTimeout(r, 500));

        } catch (err) {}
    }
}

// ─── PERFORMANCE SUMMARY ──────────────────────────────────

async function getPerformanceSummary(period = "weekly") {
    let trades = [];
    let bets   = [];

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (period === "weekly" ? 7 : 30));
    const cutoffStr = cutoff.toISOString();

    if (hasSupabase) {
        trades = await supabaseSelect("trade_signals", `created_at=gte.${cutoffStr}&outcome=neq.PENDING`, 200) || [];
        bets   = await supabaseSelect("prediction_bets", `created_at=gte.${cutoffStr}&outcome=neq.PENDING`, 200) || [];
    } else {
        trades = memoryJournal.trades.filter(t =>
            t.outcome !== "PENDING" && new Date(t.created_at) > cutoff
        );
        bets = memoryJournal.bets.filter(b =>
            b.outcome !== "PENDING" && new Date(b.created_at) > cutoff
        );
    }

    // Trade stats
    const tradeWins   = trades.filter(t => t.outcome === "WIN").length;
    const tradeLosses = trades.filter(t => t.outcome === "LOSS").length;
    const tradeTotal  = tradeWins + tradeLosses;
    const tradeWinRate = tradeTotal > 0 ? ((tradeWins / tradeTotal) * 100).toFixed(1) : "N/A";

    // Best/worst setup types
    const setupStats = {};
    trades.forEach(t => {
        if (!setupStats[t.setup_type]) setupStats[t.setup_type] = { wins: 0, total: 0 };
        setupStats[t.setup_type].total++;
        if (t.outcome === "WIN") setupStats[t.setup_type].wins++;
    });

    const setupWinRates = Object.entries(setupStats)
        .map(([type, stats]) => ({ type, winRate: (stats.wins / stats.total * 100).toFixed(0), total: stats.total }))
        .sort((a, b) => b.winRate - a.winRate);

    const bestSetup  = setupWinRates[0];
    const worstSetup = setupWinRates[setupWinRates.length - 1];

    // Avg R:R achieved
    const completedTrades = trades.filter(t => t.pnl_pct !== null);
    const avgPnl = completedTrades.length > 0
        ? (completedTrades.reduce((s, t) => s + parseFloat(t.pnl_pct || 0), 0) / completedTrades.length).toFixed(2)
        : "N/A";

    // Bet stats
    const betWins    = bets.filter(b => b.outcome === "WIN").length;
    const betTotal   = bets.filter(b => b.outcome !== "PENDING").length;
    const betWinRate = betTotal > 0 ? ((betWins / betTotal) * 100).toFixed(1) : "N/A";

    return {
        period,
        trades: {
            total:    tradeTotal,
            wins:     tradeWins,
            losses:   tradeLosses,
            winRate:  tradeWinRate,
            avgPnl,
            bestSetup,
            worstSetup,
            setupStats: setupWinRates
        },
        bets: {
            total:   betTotal,
            wins:    betWins,
            winRate: betWinRate
        },
        pending: {
            trades: (hasSupabase ? 0 : memoryJournal.trades.filter(t => t.outcome === "PENDING").length),
            bets:   (hasSupabase ? 0 : memoryJournal.bets.filter(b => b.outcome === "PENDING").length)
        }
    };
}

// ─── FORMAT PERFORMANCE REPORT ────────────────────────────

function formatPerformanceReport(summary) {
    const { period, trades, bets, pending } = summary;
    const periodLabel = period === "weekly" ? "7-DAY" : "30-DAY";

    let msg = `📊 *ENGINE PERFORMANCE — ${periodLabel} REPORT*\n\n`;

    msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📈 *PERPS DIVISION*\n`;
    msg += `Total trades: ${trades.total}\n`;
    msg += `Wins: ${trades.wins} | Losses: ${trades.losses}\n`;
    msg += `Win Rate: ${trades.winRate}%\n`;
    msg += `Avg P&L: ${trades.avgPnl}%\n\n`;

    if (trades.bestSetup) {
        msg += `Best setup: ${trades.bestSetup.type} (${trades.bestSetup.winRate}% win rate)\n`;
    }
    if (trades.worstSetup && trades.worstSetup !== trades.bestSetup) {
        msg += `Weakest: ${trades.worstSetup.type} (${trades.worstSetup.winRate}% win rate)\n`;
    }

    if (trades.setupStats.length > 0) {
        msg += `\nSetup breakdown:\n`;
        trades.setupStats.forEach(s => {
            const bar = s.winRate >= 60 ? "🟢" : s.winRate >= 40 ? "🟡" : "🔴";
            msg += `${bar} ${s.type}: ${s.winRate}% (${s.total} trades)\n`;
        });
    }

    msg += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `🎯 *PREDICTION DIVISION*\n`;
    msg += `Total bets: ${bets.total}\n`;
    msg += `Wins: ${bets.wins}\n`;
    msg += `Win Rate: ${bets.winRate}%\n\n`;

    if (pending.trades > 0 || pending.bets > 0) {
        msg += `⏳ Pending: ${pending.trades} trades | ${pending.bets} bets\n\n`;
    }

    msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;

    // Engine health assessment
    const tradeWR = parseFloat(trades.winRate);
    if (!isNaN(tradeWR)) {
        if (tradeWR >= 65) {
            msg += `✅ *Engine performing well.* Maintain current thresholds.\n`;
        } else if (tradeWR >= 50) {
            msg += `🟡 *Engine performing adequately.* Monitor for improvement.\n`;
        } else if (trades.total >= 5) {
            msg += `🔴 *Engine underperforming.* Consider raising confluence threshold.\n`;
        }
    }

    return msg;
}

// ─── ADAPTIVE FEEDBACK ────────────────────────────────────
// Returns setup type performance to adjust confluence weighting

async function getSetupPerformanceFeedback() {
    const summary = await getPerformanceSummary("weekly");
    const feedback = {};

    if (summary.trades.setupStats.length > 0) {
        summary.trades.setupStats.forEach(s => {
            const wr = parseFloat(s.winRate);
            if (s.total >= 3) { // Minimum 3 trades before adjusting
                if (wr >= 70)      feedback[s.type] = "STRONG";   // Boost
                else if (wr >= 50) feedback[s.type] = "NORMAL";   // No change
                else               feedback[s.type] = "WEAK";     // Reduce confidence
            }
        });
    }

    return feedback;
}

module.exports = {
    logTradeSignal,
    logPredictionBet,
    checkPendingOutcomes,
    getPerformanceSummary,
    formatPerformanceReport,
    getSetupPerformanceFeedback,
    initializeSchema
};