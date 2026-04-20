const axios = require("axios");
const { scoreConfluence, getBTCMacro, MINIMUM_CONFLUENCE } = require("./confluence");

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
    for (let i = period; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }
    return parseFloat(ema.toFixed(8));
}

function calculateMACD(prices) {
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    if (!ema12 || !ema26) return null;
    return parseFloat((ema12 - ema26).toFixed(8));
}

function getSupportResistance(prices) {
    const sorted     = [...prices].sort((a, b) => a - b);
    const support    = sorted[Math.floor(sorted.length * 0.15)];
    const resistance = sorted[Math.floor(sorted.length * 0.85)];
    return { support, resistance };
}

function getATR(ohlc) {
    if (!ohlc || ohlc.length < 2) return null;
    let trs = [];
    for (let i = 1; i < ohlc.length; i++) {
        const high  = ohlc[i][2];
        const low   = ohlc[i][3];
        const close = ohlc[i - 1][4];
        trs.push(Math.max(high - low, Math.abs(high - close), Math.abs(low - close)));
    }
    return trs.reduce((a, b) => a + b, 0) / trs.length;
}

// ─── BEARISH DIVERGENCE DETECTOR ─────────────────────────
// Price makes higher high BUT RSI makes lower high = hidden weakness
// This is the strongest short signal in TA

function detectBearishDivergence(closes, ohlc) {
    if (closes.length < 20) return { detected: false };

    // Split into two halves to compare recent vs earlier
    const mid        = Math.floor(closes.length / 2);
    const firstHalf  = closes.slice(0, mid);
    const secondHalf = closes.slice(mid);

    const firstRSI  = calculateRSI(firstHalf);
    const secondRSI = calculateRSI(secondHalf);

    if (!firstRSI || !secondRSI) return { detected: false };

    const firstHigh  = Math.max(...firstHalf);
    const secondHigh = Math.max(...secondHalf);

    // Bearish divergence: price higher high + RSI lower high
    const priceHigherHigh = secondHigh > firstHigh * 1.02; // Price up 2%+
    const rsiLowerHigh    = secondRSI < firstRSI - 5;      // RSI down 5+ points

    const detected = priceHigherHigh && rsiLowerHigh;

    return {
        detected,
        firstHigh:  parseFloat(firstHigh.toFixed(8)),
        secondHigh: parseFloat(secondHigh.toFixed(8)),
        firstRSI:   parseFloat(firstRSI.toFixed(2)),
        secondRSI:  parseFloat(secondRSI.toFixed(2)),
        divergenceStrength: detected
            ? parseFloat((firstRSI - secondRSI).toFixed(2))
            : 0
    };
}

// ─── BULLISH DIVERGENCE DETECTOR ─────────────────────────
// Price makes lower low BUT RSI makes higher low = hidden strength
// Strongest confirmation for long reversals

function detectBullishDivergence(closes) {
    if (closes.length < 20) return { detected: false };

    const mid        = Math.floor(closes.length / 2);
    const firstHalf  = closes.slice(0, mid);
    const secondHalf = closes.slice(mid);

    const firstRSI  = calculateRSI(firstHalf);
    const secondRSI = calculateRSI(secondHalf);

    if (!firstRSI || !secondRSI) return { detected: false };

    const firstLow  = Math.min(...firstHalf);
    const secondLow = Math.min(...secondHalf);

    // Bullish divergence: price lower low + RSI higher low
    const priceLowerLow  = secondLow < firstLow * 0.98;
    const rsiHigherLow   = secondRSI > firstRSI + 5;

    const detected = priceLowerLow && rsiHigherLow;

    return {
        detected,
        firstLow:   parseFloat(firstLow.toFixed(8)),
        secondLow:  parseFloat(secondLow.toFixed(8)),
        firstRSI:   parseFloat(firstRSI.toFixed(2)),
        secondRSI:  parseFloat(secondRSI.toFixed(2)),
        divergenceStrength: detected
            ? parseFloat((secondRSI - firstRSI).toFixed(2))
            : 0
    };
}

// ─── DISTRIBUTION DETECTOR ───────────────────────────────
// High volume on red candles after uptrend = institutions selling
// Mirror of the accumulation (ENJ) pattern — but for shorts

function detectDistribution(ohlc, volumeRatio) {
    if (!ohlc || ohlc.length < 10) return false;

    const recent = ohlc.slice(-10);
    let redVolumeCandles  = 0;
    let totalVolumeWeight = 0;

    for (const candle of recent) {
        const open   = candle[1];
        const close  = candle[4];
        const isRed  = close < open;
        if (isRed) redVolumeCandles++;
    }

    // Distribution: majority red candles + above average volume
    return redVolumeCandles >= 6 && volumeRatio > 2.0;
}

// ─── LIQUIDITY GRAB DETECTOR ─────────────────────────────
// Price spikes above key resistance to stop hunt then fails
// Classic whale trap — very high probability short entry

function detectLiquidityGrab(closes, resistance) {
    if (closes.length < 5) return false;

    const recent    = closes.slice(-5);
    const lastClose = recent[recent.length - 1];
    const spike     = Math.max(...recent);

    // Spike above resistance then close back below it
    const spikedAbove   = spike > resistance * 1.01;
    const closedBelow   = lastClose < resistance * 0.99;

    return spikedAbove && closedBelow;
}

// ─── SETUP DETECTOR ──────────────────────────────────────

function detectSetup(coin, closes, ohlcData, trendingSymbols, fgValue, btcTrendScore) {

    const price                   = coin.current_price;
    const rsi                     = calculateRSI(closes);
    const ema21                   = calculateEMA(closes, 21);
    const macd                    = calculateMACD(closes);
    const { support, resistance } = getSupportResistance(closes);
    const atr                     = getATR(ohlcData) || price * 0.03;
    const change                  = coin.price_change_percentage_24h || 0;
    const volumeRatio             = coin.volumeRatio;
    const marketCap               = coin.market_cap || 0;
    const isTrending              = trendingSymbols.includes(coin.symbol.toUpperCase());

    if (!rsi || !ema21) return null;

    // Run divergence and pattern detectors
    const bearDiv   = detectBearishDivergence(closes, ohlcData);
    const bullDiv   = detectBullishDivergence(closes);
    const distrib   = detectDistribution(ohlcData, volumeRatio);
    const liqGrab   = detectLiquidityGrab(closes, resistance);

    let direction    = null;
    let setupType    = null;
    let entry        = price;
    let stopLoss     = null;
    let takeProfit   = null;
    let invalidation = null;
    let timeframe    = null;
    let reasoning    = "";
    let bonusScore   = 0; // Extra confluence from advanced patterns

    // ════════════════════════════════════════════════════════
    // LONG SETUPS
    // ════════════════════════════════════════════════════════

    // ── PARABOLIC CANDIDATE ───────────────────────────────
    if (marketCap < 500_000_000 && volumeRatio > 3.0 &&
        change > -20 && change < 8 && rsi > 30 && rsi < 58) {
        direction    = "LONG";
        setupType    = "PARABOLIC CANDIDATE 🚀";
        timeframe    = "3-8 hours";
        entry        = price;
        stopLoss     = parseFloat((support * 0.95).toFixed(8));
        takeProfit   = parseFloat((price * 1.40).toFixed(8));
        invalidation = `4h close below $${(support * 0.93).toFixed(8)}`;
        reasoning    = `${volumeRatio.toFixed(1)}x volume on sub-$500M cap with flat price — institutional accumulation pattern. RSI ${rsi} = room to run.`;
        if (bullDiv.detected) {
            bonusScore  = 10;
            reasoning  += ` Bullish RSI divergence confirms (RSI ${bullDiv.firstRSI} → ${bullDiv.secondRSI} while price made lower low).`;
        }
    }

    // ── BULLISH DIVERGENCE REVERSAL ───────────────────────
    else if (bullDiv.detected && rsi < 45 && volumeRatio > 1.5) {
        direction    = "LONG";
        setupType    = "BULLISH DIVERGENCE 📈";
        timeframe    = "6-20 hours";
        entry        = price;
        stopLoss     = parseFloat((bullDiv.secondLow * 0.97).toFixed(8));
        takeProfit   = parseFloat((price + atr * 4).toFixed(8));
        invalidation = `New lower low below $${bullDiv.secondLow.toFixed(8)}`;
        reasoning    = `Classic bullish RSI divergence — price made lower low ($${bullDiv.firstLow.toFixed(6)} → $${bullDiv.secondLow.toFixed(6)}) but RSI made higher low (${bullDiv.firstRSI} → ${bullDiv.secondRSI}). Hidden strength. High probability reversal.`;
        bonusScore   = 12;
    }

    // ── OVERSOLD REVERSAL ─────────────────────────────────
    else if (rsi < 32 && price <= support * 1.06 && volumeRatio > 1.5) {
        direction    = "LONG";
        setupType    = "OVERSOLD REVERSAL";
        timeframe    = "4-16 hours";
        entry        = price;
        stopLoss     = parseFloat((support * 0.95).toFixed(8));
        takeProfit   = parseFloat((price + atr * 3.5).toFixed(8));
        invalidation = `New local low below $${(support * 0.93).toFixed(8)}`;
        reasoning    = `RSI ${rsi} deeply oversold at key support $${support.toFixed(6)}. Volume ${volumeRatio}x = accumulation not distribution.`;
        if (bullDiv.detected) { bonusScore = 8; reasoning += ` Backed by bullish RSI divergence.`; }
    }

    // ── EMA BREAKOUT ──────────────────────────────────────
    else if (price > ema21 && rsi > 52 && rsi < 68 &&
             volumeRatio > 2.0 && change > 3 && change < 20) {
        direction    = "LONG";
        setupType    = "EMA BREAKOUT";
        timeframe    = "6-18 hours";
        entry        = price;
        stopLoss     = parseFloat((ema21 * 0.97).toFixed(8));
        takeProfit   = parseFloat((price + atr * 4).toFixed(8));
        invalidation = `4h close back below EMA21 ($${ema21.toFixed(6)})`;
        reasoning    = `Clean EMA21 break with ${volumeRatio}x volume. RSI ${rsi} in momentum zone — not overbought. Trend continuation setup.`;
    }

    // ── ACCUMULATION PRE-PUMP ─────────────────────────────
    else if (volumeRatio > 2.5 && Math.abs(change) < 5 &&
             rsi > 38 && rsi < 52 && marketCap < 1_000_000_000) {
        direction    = "LONG";
        setupType    = "ACCUMULATION PRE-PUMP";
        timeframe    = "8-24 hours";
        entry        = price;
        stopLoss     = parseFloat((support * 0.96).toFixed(8));
        takeProfit   = parseFloat((price * 1.35).toFixed(8));
        invalidation = `Volume drops below 1.5x average`;
        reasoning    = `${volumeRatio.toFixed(1)}x volume with flat price = smart money loading quietly. RSI ${rsi} neutral.`;
    }

    // ════════════════════════════════════════════════════════
    // SHORT SETUPS — Equal quality to longs
    // ════════════════════════════════════════════════════════

    // ── BEARISH DIVERGENCE (HIGHEST QUALITY SHORT) ────────
    else if (bearDiv.detected && rsi > 55 && volumeRatio > 1.5) {
        direction    = "SHORT";
        setupType    = "BEARISH DIVERGENCE 📉";
        timeframe    = "6-20 hours";
        entry        = price;
        stopLoss     = parseFloat((bearDiv.secondHigh * 1.03).toFixed(8));
        takeProfit   = parseFloat((price - atr * 4).toFixed(8));
        invalidation = `New higher high above $${(bearDiv.secondHigh * 1.02).toFixed(8)}`;
        reasoning    = `Textbook bearish RSI divergence — price made higher high ($${bearDiv.firstHigh.toFixed(6)} → $${bearDiv.secondHigh.toFixed(6)}) but RSI made lower high (${bearDiv.firstRSI} → ${bearDiv.secondRSI}). Divergence strength: ${bearDiv.divergenceStrength} points. Hidden weakness — high probability reversal.`;
        bonusScore   = 12;
    }

    // ── DISTRIBUTION PATTERN (INSTITUTIONAL SELLING) ─────
    else if (distrib && rsi > 60 && change > 10) {
        direction    = "SHORT";
        setupType    = "DISTRIBUTION PATTERN 📉";
        timeframe    = "8-24 hours";
        entry        = price;
        stopLoss     = parseFloat((resistance * 1.04).toFixed(8));
        takeProfit   = parseFloat((price * 0.78).toFixed(8));
        invalidation = `Price holds above $${resistance.toFixed(8)} on next 4h close`;
        reasoning    = `High volume on majority red candles after ${change.toFixed(1)}% move — institutional distribution pattern. Mirror of accumulation setup. Smart money is selling into retail buying.`;
        bonusScore   = 10;
    }

    // ── LIQUIDITY GRAB SHORT ──────────────────────────────
    else if (liqGrab && rsi > 65 && volumeRatio > 2.0) {
        direction    = "SHORT";
        setupType    = "LIQUIDITY GRAB 🪤";
        timeframe    = "4-12 hours";
        entry        = price;
        stopLoss     = parseFloat((resistance * 1.03).toFixed(8));
        takeProfit   = parseFloat((support * 1.05).toFixed(8));
        invalidation = `Price reclaims resistance $${resistance.toFixed(8)} with volume`;
        reasoning    = `Stop hunt detected — price spiked above resistance ($${resistance.toFixed(6)}) to trigger stops then rejected. Whales grabbed liquidity. High probability reversal short.`;
        bonusScore   = 8;
    }

    // ── OVERBOUGHT REJECTION ──────────────────────────────
    else if (rsi > 76 && price >= resistance * 0.97 &&
             volumeRatio < 1.5 && macd !== null && macd < 0) {
        direction    = "SHORT";
        setupType    = "OVERBOUGHT REJECTION";
        timeframe    = "4-12 hours";
        entry        = price;
        stopLoss     = parseFloat((resistance * 1.04).toFixed(8));
        takeProfit   = parseFloat((price - atr * 3).toFixed(8));
        invalidation = `RSI drops below 70 and price holds above resistance`;
        reasoning    = `RSI ${rsi} overbought at resistance $${resistance.toFixed(6)}. MACD turning negative. Low volume on push = no conviction. Classic rejection setup.`;
        if (bearDiv.detected) { bonusScore = 8; reasoning += ` Bearish divergence confirms weakness.`; }
    }

    // ── EMA BREAKDOWN SHORT ───────────────────────────────
    else if (price < ema21 && rsi > 35 && rsi < 55 &&
             volumeRatio > 2.0 && change < -3 && change > -25) {
        direction    = "SHORT";
        setupType    = "EMA BREAKDOWN SHORT";
        timeframe    = "6-18 hours";
        entry        = price;
        stopLoss     = parseFloat((ema21 * 1.03).toFixed(8));
        takeProfit   = parseFloat((price - atr * 3.5).toFixed(8));
        invalidation = `4h close back above EMA21 ($${ema21.toFixed(6)})`;
        reasoning    = `Price broke below EMA21 with ${volumeRatio}x volume confirmation. RSI ${rsi} = not oversold yet, room to fall. Downtrend continuation.`;
        if (bearDiv.detected) { bonusScore = 8; reasoning += ` Bearish divergence adds conviction.`; }
    }

    if (!direction || !stopLoss || !takeProfit) return null;

    // ── R:R CHECK ─────────────────────────────────────────
    const riskAmt   = Math.abs(entry - stopLoss);
    const rewardAmt = Math.abs(takeProfit - entry);
    if (riskAmt === 0) return null;
    const rrRatio   = parseFloat((rewardAmt / riskAmt).toFixed(2));
    if (rrRatio < 2.0) return null;

    // ── CONFLUENCE SCORE + BONUS ──────────────────────────
    const confluence = scoreConfluence({
        direction,
        rsi,
        volumeRatio,
        priceChange:         change,
        isNarrativeTrending: isTrending,
        marketCap,
        fgValue,
        btcTrendScore,
        setupType
    });

    const finalScore = Math.min(confluence.total + bonusScore, 100);

    if (finalScore < MINIMUM_CONFLUENCE) return null;

    // ── POSITION SIZING ───────────────────────────────────
    const capital    = 25;
    const riskPct    = riskAmt / entry;
    const maxRisk    = finalScore >= 80 ? capital * 0.12 : capital * 0.08;
    const posVal     = maxRisk / riskPct;
    const leverage   = Math.max(2, Math.min(Math.ceil(posVal / capital), 15));
    const actualVal  = capital * leverage;
    const profitAtTP = parseFloat((actualVal * (rewardAmt / entry)).toFixed(2));
    const lossAtSL   = parseFloat((actualVal * riskPct).toFixed(2));

    return {
        name:            coin.name,
        symbol:          coin.symbol.toUpperCase(),
        price,
        change,
        volumeRatio:     volumeRatio.toFixed(1),
        rsi,
        macd,
        direction,
        setupType,
        isParabolic:     setupType.includes("PARABOLIC"),
        isDoubleSignal:  isTrending && setupType.includes("PARABOLIC"),
        entry:           parseFloat(entry.toFixed(8)),
        stopLoss:        parseFloat(stopLoss.toFixed(8)),
        takeProfit:      parseFloat(takeProfit.toFixed(8)),
        invalidation,
        rrRatio,
        leverage,
        positionSize:    capital,
        profitAtTP,
        lossAtSL,
        timeframe,
        reasoning,
        confluenceScore: finalScore,
        divergence:      bearDiv.detected ? `Bearish div (strength: ${bearDiv.divergenceStrength})` :
                         bullDiv.detected ? `Bullish div (strength: ${bullDiv.divergenceStrength})` : null,
        exchange:        "Bybit / MEXC",
        marketCap
    };
}

// ─── MAIN ─────────────────────────────────────────────────

async function getVolumeSignals(trendingSymbols = [], fgData = null) {

    try {

        const btcMacro      = await getBTCMacro();
        const fgValue       = fgData?.value || 50;
        const btcTrendScore = btcMacro.trendScore;

        console.log(`[Signals] BTC: $${btcMacro.price} (${btcMacro.trend}) | F&G: ${fgValue}`);

        const response = await axios.get(
            "https://api.coingecko.com/api/v3/coins/markets",
            {
                params: {
                    vs_currency:             "usd",
                    order:                   "market_cap_desc",
                    per_page:                200,
                    page:                    1,
                    sparkline:               false,
                    price_change_percentage: "24h"
                },
                timeout: 10000
            }
        );

        const coins     = response.data;
        const avgVolume = coins.reduce((s, c) => s + (c.total_volume || 0), 0) / coins.length;

        const candidates = coins
            .filter(coin => {
                const change      = coin.price_change_percentage_24h || 0;
                const volumeRatio = (coin.total_volume || 0) / avgVolume;
                const marketCap   = coin.market_cap || 0;
                if (Math.abs(change) > 40)        return false;
                if (marketCap > 50_000_000_000)   return false;
                return volumeRatio > 1.5;
            })
            .map(coin => ({
                ...coin,
                volumeRatio: (coin.total_volume || 0) / avgVolume
            }))
            .sort((a, b) => b.volumeRatio - a.volumeRatio)
            .slice(0, 20);

        const signals = [];

        for (const coin of candidates) {
            try {
                // Get 30 days of OHLC for better divergence detection
                const ohlcRes = await axios.get(
                    `https://api.coingecko.com/api/v3/coins/${coin.id}/ohlc`,
                    { params: { vs_currency: "usd", days: 30 }, timeout: 8000 }
                );

                const ohlcData = ohlcRes.data;
                const closes   = ohlcData.map(c => c[4]);

                await new Promise(r => setTimeout(r, 700));

                const signal = detectSetup(coin, closes, ohlcData, trendingSymbols, fgValue, btcTrendScore);
                if (signal) signals.push({ ...signal, btcTrend: btcMacro.trend });

            } catch (err) {}
        }

        // Sort: divergence setups first, then by confluence score
        signals.sort((a, b) => {
            // Prioritize divergence signals — most reliable
            const aDiv = a.divergence ? 1 : 0;
            const bDiv = b.divergence ? 1 : 0;
            if (aDiv !== bDiv) return bDiv - aDiv;
            // Then by confluence score
            return b.confluenceScore - a.confluenceScore;
        });

        // Hard cap 3 signals — quality over quantity
        const top = signals.slice(0, 3);

        if (top.length === 0) {
            console.log(`[Signals] No trades passed confluence (${MINIMUM_CONFLUENCE}/100). NO TRADE TODAY.`);
        } else {
            const dirs = top.map(s => s.direction).join(", ");
            console.log(`[Signals] ${top.length} signals passed. Directions: ${dirs}. Top score: ${top[0].confluenceScore}/100`);
        }

        return top;

    } catch (error) {
        console.error("Error fetching signals:", error.message);
        return [];
    }
}

module.exports = { getVolumeSignals };