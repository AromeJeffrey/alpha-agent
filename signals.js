const axios = require("axios");

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
    const support    = sorted[Math.floor(sorted.length * 0.1)];
    const resistance = sorted[Math.floor(sorted.length * 0.9)];
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

// ─── POSITION SIZING ──────────────────────────────────────

function calcPosition(confidence, sizeMultiplier = 1.0, baseCapital = 25) {
    let base = 0;
    if (confidence >= 90)      base = baseCapital;
    else if (confidence >= 80) base = baseCapital * 0.80;
    else if (confidence >= 70) base = baseCapital * 0.60;
    else                       return null;
    return Math.min(parseFloat((base * sizeMultiplier).toFixed(2)), 35);
}

function calcLeverage(currentPrice, stopLoss, takeProfit, capital) {
    const riskPct   = Math.abs((currentPrice - stopLoss) / currentPrice);
    const rewardPct = Math.abs((takeProfit - currentPrice) / currentPrice);
    if (riskPct === 0) return null;
    const rrRatio = rewardPct / riskPct;
    if (rrRatio < 2) return null;
    let leverage = Math.ceil(0.50 / rewardPct);
    leverage     = Math.max(3, Math.min(leverage, 20));
    return {
        leverage,
        profitAtTP: parseFloat((capital * leverage * rewardPct).toFixed(2)),
        lossAtSL:   parseFloat((capital * leverage * riskPct).toFixed(2)),
        rrRatio:    parseFloat(rrRatio.toFixed(2))
    };
}

// ─── SIGNAL GENERATOR ────────────────────────────────────

function generateSignal(coin, closes, ohlcData, trendingSymbols = [], fgData = null) {

    const currentPrice            = coin.current_price;
    const rsi                     = calculateRSI(closes);
    const macd                    = calculateMACD(closes);
    const ema21                   = calculateEMA(closes, 21);
    const { support, resistance } = getSupportResistance(closes);
    const atr                     = getATR(ohlcData);
    const priceChange             = coin.price_change_percentage_24h || 0;
    const volumeRatio             = coin.volumeRatio;
    const marketCap               = coin.market_cap || 0;
    const isNarrativeTrending     = trendingSymbols.includes(coin.symbol.toUpperCase());
    const fgValue                 = fgData?.value || 50;
    const sizeMultiplier          = fgData?.sizeMultiplier || 1.0;

    if (!rsi || !ema21) return null;

    const atrMultiplier = atr ? atr : currentPrice * 0.03;

    // Adjust confidence based on Fear & Greed alignment
    // Long setups are stronger in fear, short setups stronger in greed
    function adjustConfidence(base, direction) {
        if (direction === "LONG"  && fgValue <= 30) return Math.min(base + 8,  95);
        if (direction === "LONG"  && fgValue >= 75) return Math.max(base - 8,  50);
        if (direction === "SHORT" && fgValue >= 75) return Math.min(base + 8,  95);
        if (direction === "SHORT" && fgValue <= 30) return Math.max(base - 8,  50);
        return base;
    }

    let direction   = null;
    let setupType   = null;
    let confidence  = 0;
    let isParabolic = false;
    let reasoning   = "";
    let entry       = currentPrice;
    let stopLoss    = null;
    let takeProfit  = null;
    let timeframe   = "4-12 hours";

    // ── PARABOLIC CANDIDATE ───────────────────────────────
    if (
        marketCap < 500_000_000 &&
        volumeRatio > 3.0 &&
        priceChange > -20 &&
        priceChange < 10 &&
        rsi > 30 && rsi < 58
    ) {
        direction   = "LONG";
        setupType   = "PARABOLIC CANDIDATE 🚀";
        confidence  = adjustConfidence(isNarrativeTrending ? 92 : 82, "LONG");
        isParabolic = true;
        timeframe   = "3-8 hours";
        reasoning   = `${volumeRatio.toFixed(1)}x volume on ${priceChange.toFixed(1)}% — accumulation before explosive move. MCap $${(marketCap/1e6).toFixed(0)}M = high upside.`;
        entry       = currentPrice;
        stopLoss    = parseFloat((support * 0.95).toFixed(8));
        takeProfit  = parseFloat((currentPrice * 1.40).toFixed(8));
    }

    // ── OVERSOLD REVERSAL ─────────────────────────────────
    else if (rsi < 32 && currentPrice <= support * 1.08 && volumeRatio > 1.3) {
        direction  = "LONG";
        setupType  = "OVERSOLD REVERSAL";
        confidence = adjustConfidence(isNarrativeTrending ? 88 : 82, "LONG");
        timeframe  = "4-12 hours";
        reasoning  = `RSI ${rsi} deeply oversold near support. Volume ${volumeRatio}x avg confirms accumulation.`;
        entry      = currentPrice;
        stopLoss   = parseFloat((support * 0.96).toFixed(8));
        takeProfit = parseFloat((currentPrice + atrMultiplier * 3).toFixed(8));
    }

    // ── EMA BREAKOUT ──────────────────────────────────────
    else if (currentPrice > ema21 && rsi > 50 && rsi < 68 && volumeRatio > 2.0 && priceChange > 3 && priceChange < 25) {
        direction  = "LONG";
        setupType  = "EMA BREAKOUT";
        confidence = adjustConfidence(isNarrativeTrending ? 85 : 78, "LONG");
        timeframe  = "4-16 hours";
        reasoning  = `Price broke above EMA21 with ${volumeRatio}x volume. RSI ${rsi} in momentum zone.`;
        entry      = currentPrice;
        stopLoss   = parseFloat((ema21 * 0.97).toFixed(8));
        takeProfit = parseFloat((currentPrice + atrMultiplier * 4).toFixed(8));
    }

    // ── ACCUMULATION PRE-PUMP ─────────────────────────────
    else if (volumeRatio > 2.5 && Math.abs(priceChange) < 6 && rsi > 35 && rsi < 55) {
        direction  = "LONG";
        setupType  = "ACCUMULATION PRE-PUMP";
        confidence = adjustConfidence(isNarrativeTrending ? 85 : 74, "LONG");
        timeframe  = "6-24 hours";
        reasoning  = `Volume ${volumeRatio.toFixed(1)}x average with flat price — smart money loading. RSI neutral ${rsi}.`;
        entry      = currentPrice;
        stopLoss   = parseFloat((support * 0.97).toFixed(8));
        takeProfit = parseFloat((currentPrice * 1.35).toFixed(8));
    }

    // ── OVERBOUGHT REJECTION (SHORT) ──────────────────────
    else if (rsi > 78 && currentPrice >= resistance * 0.96 && macd && macd < 0) {
        direction  = "SHORT";
        setupType  = "OVERBOUGHT REJECTION";
        confidence = adjustConfidence(80, "SHORT");
        timeframe  = "4-12 hours";
        reasoning  = `RSI ${rsi} overbought at resistance. MACD turning negative — momentum fading.`;
        entry      = currentPrice;
        stopLoss   = parseFloat((resistance * 1.04).toFixed(8));
        takeProfit = parseFloat((currentPrice - atrMultiplier * 3).toFixed(8));
    }

    // ── FAKEOUT SHORT ─────────────────────────────────────
    else if (priceChange > 25 && rsi > 72 && volumeRatio < 1.5) {
        direction  = "SHORT";
        setupType  = "FAKEOUT — WAIT FOR ENTRY";
        confidence = adjustConfidence(70, "SHORT");
        timeframe  = "2-8 hours";
        reasoning  = `${priceChange.toFixed(0)}% pump on weak volume — likely fakeout. Wait for RSI below 65 then short.`;
        entry      = currentPrice;
        stopLoss   = parseFloat((currentPrice * 1.05).toFixed(8));
        takeProfit = parseFloat((currentPrice * 0.80).toFixed(8));
    }

    if (!direction) return null;

    // Position size adjusted by confidence + Fear & Greed
    const positionSize = calcPosition(confidence, sizeMultiplier);
    if (!positionSize) return null;

    const levCalc = calcLeverage(entry, stopLoss, takeProfit, positionSize);
    if (!levCalc) return null;

    return {
        name:           coin.name,
        symbol:         coin.symbol.toUpperCase(),
        price:          currentPrice,
        change:         priceChange,
        volumeRatio:    volumeRatio.toFixed(1),
        rsi,
        direction,
        setupType,
        confidence,
        isParabolic,
        isDoubleSignal: isNarrativeTrending && isParabolic,
        reasoning,
        entry:          parseFloat(entry.toFixed(8)),
        stopLoss:       parseFloat(stopLoss.toFixed(8)),
        takeProfit:     parseFloat(takeProfit.toFixed(8)),
        positionSize,
        leverage:       levCalc.leverage,
        profitAtTP:     levCalc.profitAtTP,
        lossAtSL:       levCalc.lossAtSL,
        rrRatio:        levCalc.rrRatio,
        timeframe,
        exchange:       "Bybit / MEXC",
        marketCap
    };
}

// ─── MAIN ─────────────────────────────────────────────────

async function getVolumeSignals(trendingSymbols = [], fgData = null) {

    try {

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
        const avgVolume = coins.reduce((sum, c) => sum + (c.total_volume || 0), 0) / coins.length;

        const candidates = coins
            .filter(coin => {
                const change      = coin.price_change_percentage_24h || 0;
                const volumeRatio = (coin.total_volume || 0) / avgVolume;
                const marketCap   = coin.market_cap || 0;
                if (change > 30)                return false;
                if (marketCap > 50_000_000_000) return false;
                return volumeRatio > 1.5 || (Math.abs(change) > 2 && Math.abs(change) < 30);
            })
            .map(coin => ({
                ...coin,
                volumeRatio: (coin.total_volume || 0) / avgVolume
            }))
            .sort((a, b) => {
                const aScore = (a.volumeRatio * 2) + (a.market_cap < 500_000_000 ? 5 : 0);
                const bScore = (b.volumeRatio * 2) + (b.market_cap < 500_000_000 ? 5 : 0);
                return bScore - aScore;
            })
            .slice(0, 15);

        const signals = [];

        for (const coin of candidates) {
            try {
                const ohlcRes = await axios.get(
                    `https://api.coingecko.com/api/v3/coins/${coin.id}/ohlc`,
                    { params: { vs_currency: "usd", days: 14 }, timeout: 8000 }
                );
                const ohlcData = ohlcRes.data;
                const closes   = ohlcData.map(c => c[4]);
                await new Promise(r => setTimeout(r, 700));
                const signal = generateSignal(coin, closes, ohlcData, trendingSymbols, fgData);
                if (signal) signals.push(signal);
            } catch (err) {}
        }

        signals.sort((a, b) => {
            if (a.isDoubleSignal !== b.isDoubleSignal) return b.isDoubleSignal - a.isDoubleSignal;
            if (a.isParabolic    !== b.isParabolic)    return b.isParabolic    - a.isParabolic;
            return b.confidence - a.confidence;
        });

        return signals.slice(0, 6);

    } catch (error) {
        console.error("Error fetching signals:", error.message);
        return [];
    }
}

module.exports = { getVolumeSignals };