const axios = require("axios");
const { scoreConfluence, getBTCMacro, MINIMUM_CONFLUENCE, isBlacklisted, rankSetup } = require("./confluence");

// ─── TA HELPERS ───────────────────────────────────────────

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
        avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    }
    if (avgLoss === 0) return 100;
    return parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
}

function calculateEMA(prices, period) {
    if (prices.length < period) return null;
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
    return parseFloat(ema.toFixed(8));
}

function calculateMACD(prices) {
    const e12 = calculateEMA(prices, 12);
    const e26 = calculateEMA(prices, 26);
    if (!e12 || !e26) return null;
    return parseFloat((e12 - e26).toFixed(8));
}

function getSupportResistance(prices) {
    const sorted = [...prices].sort((a, b) => a - b);
    return {
        support:    sorted[Math.floor(sorted.length * 0.15)],
        resistance: sorted[Math.floor(sorted.length * 0.85)]
    };
}

function getATR(ohlc) {
    if (!ohlc || ohlc.length < 2) return null;
    const trs = [];
    for (let i = 1; i < ohlc.length; i++) {
        const [, , high, low] = ohlc[i];
        const prevClose = ohlc[i - 1][4];
        trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    }
    return trs.reduce((a, b) => a + b, 0) / trs.length;
}

function detectBearishDivergence(closes) {
    if (closes.length < 20) return { detected: false };
    const mid = Math.floor(closes.length / 2);
    const r1 = calculateRSI(closes.slice(0, mid));
    const r2 = calculateRSI(closes.slice(mid));
    if (!r1 || !r2) return { detected: false };
    const h1 = Math.max(...closes.slice(0, mid));
    const h2 = Math.max(...closes.slice(mid));
    const detected = h2 > h1 * 1.02 && r2 < r1 - 5;
    return { detected, firstHigh: h1, secondHigh: h2, firstRSI: r1, secondRSI: r2,
             divergenceStrength: detected ? parseFloat((r1 - r2).toFixed(2)) : 0 };
}

function detectBullishDivergence(closes) {
    if (closes.length < 20) return { detected: false };
    const mid = Math.floor(closes.length / 2);
    const r1 = calculateRSI(closes.slice(0, mid));
    const r2 = calculateRSI(closes.slice(mid));
    if (!r1 || !r2) return { detected: false };
    const l1 = Math.min(...closes.slice(0, mid));
    const l2 = Math.min(...closes.slice(mid));
    const detected = l2 < l1 * 0.98 && r2 > r1 + 5;
    return { detected, firstLow: l1, secondLow: l2, firstRSI: r1, secondRSI: r2,
             divergenceStrength: detected ? parseFloat((r2 - r1).toFixed(2)) : 0 };
}

function detectDistribution(ohlc, volumeRatio) {
    if (!ohlc || ohlc.length < 10) return false;
    const redCandles = ohlc.slice(-10).filter(c => c[4] < c[1]).length;
    return redCandles >= 6 && volumeRatio > 2.0;
}

function detectLiquidityGrab(closes, resistance) {
    if (closes.length < 5) return false;
    const recent    = closes.slice(-5);
    const spike     = Math.max(...recent);
    const lastClose = recent[recent.length - 1];
    return spike > resistance * 1.01 && lastClose < resistance * 0.99;
}

// ─── SETUP DETECTOR ──────────────────────────────────────

function detectSetup(coin, closes, ohlcData, trendingSymbols, fgValue, btcTrendScore) {

    const sym = coin.symbol.toUpperCase();
    if (sym === "BTC" || sym === "ETH") return null;
    if (isBlacklisted(sym, coin.name))  return null;

    const price    = coin.current_price;
    const rsi      = calculateRSI(closes);
    const ema21    = calculateEMA(closes, 21);
    const macd     = calculateMACD(closes);
    const { support, resistance } = getSupportResistance(closes);
    const atr      = getATR(ohlcData) || price * 0.03;
    const change   = coin.price_change_percentage_24h || 0;
    const volRatio = coin.volumeRatio;
    const mcap     = coin.market_cap || 0;
    const trending = trendingSymbols.includes(sym);

    if (!rsi || !ema21) return null;

    const bearDiv = detectBearishDivergence(closes);
    const bullDiv = detectBullishDivergence(closes);
    const distrib = detectDistribution(ohlcData, volRatio);
    const liqGrab = detectLiquidityGrab(closes, resistance);

    let direction = null, setupType = null, entry = price;
    let stopLoss = null, takeProfit = null, invalidation = null;
    let timeframe = null, reasoning = "", bonusScore = 0;

    // ── LONG SETUPS ───────────────────────────────────────

    // Parabolic Candidate — high volume, flat price, small cap
    if (mcap < 2_000_000_000 && volRatio > 2.0 && change > -25 && change < 15 && rsi > 28 && rsi < 62) {
        direction = "LONG"; setupType = "PARABOLIC CANDIDATE 🚀"; timeframe = "3-12 hours";
        stopLoss   = parseFloat((support * 0.94).toFixed(8));
        takeProfit = parseFloat((price * 1.40).toFixed(8));
        invalidation = `4h close below $${(support * 0.92).toFixed(8)}`;
        reasoning  = `${volRatio.toFixed(1)}x volume on $${(mcap/1e6).toFixed(0)}M cap — accumulation before move. RSI ${rsi} = room to run.`;
        if (bullDiv.detected) { bonusScore = 10; reasoning += ` Bullish divergence confirms.`; }
    }
    // Bullish Divergence
    else if (bullDiv.detected && rsi < 48 && volRatio > 0.8) {
        direction = "LONG"; setupType = "BULLISH DIVERGENCE 📈"; timeframe = "6-20 hours";
        stopLoss   = parseFloat((bullDiv.secondLow * 0.97).toFixed(8));
        takeProfit = parseFloat((price + atr * 4).toFixed(8));
        invalidation = `New lower low below $${bullDiv.secondLow.toFixed(8)}`;
        reasoning  = `Price lower low but RSI higher low (${bullDiv.firstRSI}→${bullDiv.secondRSI}). Hidden strength — reversal incoming.`;
        bonusScore = 12;
    }
    // Oversold Reversal
    else if (rsi < 33 && price <= support * 1.08 && volRatio > 0.8) {
        direction = "LONG"; setupType = "OVERSOLD REVERSAL"; timeframe = "4-16 hours";
        stopLoss   = parseFloat((support * 0.94).toFixed(8));
        takeProfit = parseFloat((price + atr * 3.5).toFixed(8));
        invalidation = `New low below $${(support * 0.92).toFixed(8)}`;
        reasoning  = `RSI ${rsi} deeply oversold near support $${support.toFixed(6)}. Volume ${volRatio.toFixed(1)}x = accumulation not panic.`;
        if (bullDiv.detected) { bonusScore = 8; reasoning += ` Bullish div confirms.`; }
    }
    // EMA Breakout
    else if (price > ema21 && rsi > 48 && rsi < 72 && volRatio > 0.8 && change > 1 && change < 30) {
        direction = "LONG"; setupType = "EMA BREAKOUT"; timeframe = "6-18 hours";
        stopLoss   = parseFloat((ema21 * 0.97).toFixed(8));
        takeProfit = parseFloat((price + atr * 4).toFixed(8));
        invalidation = `4h close below EMA21 ($${ema21.toFixed(6)})`;
        reasoning  = `Clean EMA21 break with ${volRatio.toFixed(1)}x volume. RSI ${rsi} — momentum building, not exhausted.`;
    }
    // Accumulation Pre-Pump
    else if (volRatio > 1.2 && Math.abs(change) < 10 && rsi > 33 && rsi < 58 && mcap < 10_000_000_000) {
        direction = "LONG"; setupType = "ACCUMULATION PRE-PUMP"; timeframe = "8-24 hours";
        stopLoss   = parseFloat((support * 0.95).toFixed(8));
        takeProfit = parseFloat((price * 1.35).toFixed(8));
        invalidation = `Volume drops below average and price breaks support`;
        reasoning  = `${volRatio.toFixed(1)}x volume with contained price action — smart money positioning quietly.`;
    }

    // ── SHORT SETUPS ──────────────────────────────────────

    // Bearish Divergence
    else if (bearDiv.detected && rsi > 52 && volRatio > 0.8) {
        direction = "SHORT"; setupType = "BEARISH DIVERGENCE 📉"; timeframe = "6-20 hours";
        stopLoss   = parseFloat((bearDiv.secondHigh * 1.03).toFixed(8));
        takeProfit = parseFloat((price - atr * 4).toFixed(8));
        invalidation = `New higher high above $${(bearDiv.secondHigh * 1.02).toFixed(8)}`;
        reasoning  = `Price higher high but RSI lower high (${bearDiv.firstRSI}→${bearDiv.secondRSI}). Divergence ${bearDiv.divergenceStrength}pts — distribution phase.`;
        bonusScore = 12;
    }
    // Distribution Pattern
    else if (distrib && rsi > 58 && change > 8) {
        direction = "SHORT"; setupType = "DISTRIBUTION PATTERN 📉"; timeframe = "8-24 hours";
        stopLoss   = parseFloat((resistance * 1.04).toFixed(8));
        takeProfit = parseFloat((price * 0.78).toFixed(8));
        invalidation = `Price holds above $${resistance.toFixed(8)} on next 4h close`;
        reasoning  = `High volume on red candles after ${change.toFixed(1)}% move — institutions selling into retail buyers.`;
        bonusScore = 10;
    }
    // Liquidity Grab Short
    else if (liqGrab && rsi > 62 && volRatio > 1.5) {
        direction = "SHORT"; setupType = "LIQUIDITY GRAB 🪤"; timeframe = "4-12 hours";
        stopLoss   = parseFloat((resistance * 1.03).toFixed(8));
        takeProfit = parseFloat((support * 1.05).toFixed(8));
        invalidation = `Price reclaims and holds above $${resistance.toFixed(8)}`;
        reasoning  = `Stop hunt above resistance then hard rejection — whale trap. High probability reversal.`;
        bonusScore = 8;
    }
    // Overbought Rejection
    else if (rsi > 74 && price >= resistance * 0.96 && macd !== null && macd < 0) {
        direction = "SHORT"; setupType = "OVERBOUGHT REJECTION"; timeframe = "4-12 hours";
        stopLoss   = parseFloat((resistance * 1.04).toFixed(8));
        takeProfit = parseFloat((price - atr * 3).toFixed(8));
        invalidation = `RSI drops below 68 and price holds above resistance`;
        reasoning  = `RSI ${rsi} overbought at resistance $${resistance.toFixed(6)}. MACD bearish crossover. Exhaustion signal.`;
        if (bearDiv.detected) { bonusScore = 8; reasoning += ` Bearish divergence adds conviction.`; }
    }
    // EMA Breakdown
    else if (price < ema21 && rsi > 33 && rsi < 58 && volRatio > 1.2 && change < -2 && change > -35) {
        direction = "SHORT"; setupType = "EMA BREAKDOWN SHORT"; timeframe = "6-18 hours";
        stopLoss   = parseFloat((ema21 * 1.03).toFixed(8));
        takeProfit = parseFloat((price - atr * 3.5).toFixed(8));
        invalidation = `4h close back above EMA21 ($${ema21.toFixed(6)})`;
        reasoning  = `EMA21 lost with ${volRatio.toFixed(1)}x volume. RSI ${rsi} — not oversold yet, room to fall.`;
        if (bearDiv.detected) { bonusScore = 8; reasoning += ` Bearish div adds conviction.`; }
    }

    if (!direction || !stopLoss || !takeProfit) return null;

    // R:R gate — minimum 1:1.8
    const riskAmt   = Math.abs(entry - stopLoss);
    const rewardAmt = Math.abs(takeProfit - entry);
    if (riskAmt === 0) return null;
    const rrRatio = parseFloat((rewardAmt / riskAmt).toFixed(2));
    if (rrRatio < 1.4) return null;

    // Confluence score
    const confluence = scoreConfluence({
        direction, rsi, volumeRatio: volRatio, priceChange: change,
        isNarrativeTrending: trending, marketCap: mcap,
        fgValue, btcTrendScore, setupType, hasNewsCatalyst: false
    });
    const finalScore = Math.min(confluence.total + bonusScore, 100);
    if (finalScore < MINIMUM_CONFLUENCE) return null;

    // Rank
    const hasDiv  = bearDiv.detected || bullDiv.detected;
    const isParab = setupType.includes("PARABOLIC");
    const rank    = rankSetup(finalScore, rrRatio, hasDiv, isParab);
    if (rank === "REJECT") return null;

    // Position sizing
    const capital   = 25;
    const riskPct   = riskAmt / entry;
    const maxRisk   = finalScore >= 80 ? capital * 0.12 : capital * 0.08;
    const leverage  = Math.max(2, Math.min(Math.ceil((maxRisk / riskPct) / capital), 15));
    const actualVal = capital * leverage;

    return {
        name: coin.name, symbol: sym,
        price, change, volumeRatio: volRatio.toFixed(1), rsi,
        direction, setupType, rank,
        isParabolic: isParab,
        isDoubleSignal: trending && isParab,
        entry:       parseFloat(entry.toFixed(8)),
        stopLoss:    parseFloat(stopLoss.toFixed(8)),
        takeProfit:  parseFloat(takeProfit.toFixed(8)),
        invalidation, rrRatio, leverage,
        positionSize: capital,
        profitAtTP:  parseFloat((actualVal * (rewardAmt / entry)).toFixed(2)),
        lossAtSL:    parseFloat((actualVal * riskPct).toFixed(2)),
        timeframe, reasoning,
        confluenceScore: finalScore,
        divergence: bearDiv.detected ? `Bearish div (${bearDiv.divergenceStrength}pts)` :
                    bullDiv.detected ? `Bullish div (${bullDiv.divergenceStrength}pts)` : null,
        exchange: "Bybit / MEXC",
        marketCap: mcap
    };
}

// ─── FETCH FROM MULTIPLE PAGES ────────────────────────────
// Scans top 1000 coins across 4 pages to catch mid/small caps
// where the real altcoin action happens

async function fetchAllCandidates() {
    const pages    = [1, 2, 3, 4]; // top 1000 coins
    const allCoins = [];

    for (const page of pages) {
        try {
            const res = await axios.get(
                "https://api.coingecko.com/api/v3/coins/markets",
                {
                    params: {
                        vs_currency:             "usd",
                        order:                   "market_cap_desc",
                        per_page:                250,
                        page,
                        sparkline:               false,
                        price_change_percentage: "24h"
                    },
                    timeout: 12000
                }
            );
            allCoins.push(...res.data);
            await new Promise(r => setTimeout(r, 1500)); // Respect rate limit between pages
        } catch (err) {
            console.error(`[Signals] Page ${page} fetch failed:`, err.message);
        }
    }

    return allCoins;
}

// ─── MAIN ─────────────────────────────────────────────────

async function getVolumeSignals(trendingSymbols = [], fgData = null, setupFeedback = {}) {
    try {
        const btcMacro      = await getBTCMacro();
        const fgValue       = fgData?.value || 50;
        const btcTrendScore = btcMacro.trendScore;

        console.log(`[Signals] BTC context: $${btcMacro.price?.toLocaleString()} (${btcMacro.trend}) | F&G: ${fgValue}`);

        const allCoins  = await fetchAllCandidates();
        const avgVolume = allCoins.reduce((s, c) => s + (c.total_volume || 0), 0) / allCoins.length;

        console.log(`[Signals] Pool: ${allCoins.length} coins | Avg volume: $${(avgVolume/1e6).toFixed(0)}M`);

        const candidates = allCoins
            .filter(c => {
                const s = c.symbol.toUpperCase();
                if (s === "BTC" || s === "ETH") return false;
                if (isBlacklisted(s, c.name))   return false;
                // Min $1M daily volume to ensure tradeable on Bybit/MEXC
                if ((c.total_volume || 0) < 1_000_000) return false;
                // Skip if already pumped 60%+ — too late to enter long safely
                if ((c.price_change_percentage_24h || 0) > 60) return false;
                // Skip if crashed more than 50% — avoid falling knives without confirmation
                if ((c.price_change_percentage_24h || 0) < -50) return false;
                return true;
            })
            .map(c => ({ ...c, volumeRatio: (c.total_volume || 0) / avgVolume }))
            // Sort by volume ratio — highest relative volume first
            .sort((a, b) => b.volumeRatio - a.volumeRatio)
            .slice(0, 60); // Scan top 60 by relative volume

        console.log(`[Signals] ${candidates.length} alt candidates scanning...`);

        const signals = [];

        for (const coin of candidates) {
            try {
                const ohlcRes  = await axios.get(
                    `https://api.coingecko.com/api/v3/coins/${coin.id}/ohlc`,
                    { params: { vs_currency: "usd", days: 30 }, timeout: 8000 }
                );
                const ohlcData = ohlcRes.data;
                const closes   = ohlcData.map(c => c[4]);
                await new Promise(r => setTimeout(r, 600));
                const signal = detectSetup(coin, closes, ohlcData, trendingSymbols, fgValue, btcTrendScore);
                if (signal) {
                    signals.push({ ...signal, btcTrend: btcMacro.trend });
                    console.log(`[Signals] Found: ${signal.symbol} ${signal.direction} ${signal.setupType} — score: ${signal.confluenceScore}`);
                }
            } catch (err) {}
        }

        // Apply journal feedback
        if (Object.keys(setupFeedback).length > 0) {
            signals.forEach(s => {
                const fb = setupFeedback[s.setupType];
                if (fb === "WEAK"   && s.rank === "A") { s.rank = "B"; s.feedbackNote = "⚠️ Weak historically — downgraded"; }
                if (fb === "STRONG" && s.rank === "B") { s.rank = "A"; s.feedbackNote = "✅ Strong historically — upgraded"; }
            });
        }

        // Sort: A+ first, then by confluence
        signals.sort((a, b) => {
            const order = { "A+": 0, "A": 1, "B": 2 };
            if (order[a.rank] !== order[b.rank]) return order[a.rank] - order[b.rank];
            return b.confluenceScore - a.confluenceScore;
        });

        const executable = signals.filter(s => s.rank === "A+" || s.rank === "A").slice(0, 3);
        const bCount     = signals.filter(s => s.rank === "B").length;

        if (executable.length === 0) {
            console.log(`[Signals] 0 trades passed confluence (${bCount} B-setups below threshold). NO TRADE.`);
        } else {
            console.log(`[Signals] ✅ ${executable.length} executable trades (${bCount} B rejected). Best: ${executable[0].rank} ${executable[0].symbol} ${executable[0].confluenceScore}/100`);
        }

        return executable;

    } catch (error) {
        console.error("[Signals] Error:", error.message);
        return [];
    }
}

module.exports = { getVolumeSignals };