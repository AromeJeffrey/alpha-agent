const axios = require("axios");
require("dotenv").config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`;

async function analyzeSignals({ volumeSignals, narrativeSignals, nftSignals, walletSignals, predictionSignals, newsSignals, fgData }) {

    try {

        // Build strict context from verified signals only
        let context = "";

        if (fgData) {
            context += `MARKET SENTIMENT:\n`;
            context += `Fear & Greed: ${fgData.value}/100 (${fgData.label})\n`;
            context += `Bias: ${fgData.bias}\n\n`;
        }

        if (volumeSignals.length > 0) {
            context += "VERIFIED TRADE SIGNALS (use ONLY these, do not invent others):\n";
            volumeSignals.forEach((c, i) => {
                context += `${i + 1}. ${c.name} (${c.symbol})\n`;
                context += `   Current Price: $${c.price}\n`;
                context += `   Direction: ${c.direction} | Setup: ${c.setupType}\n`;
                context += `   Entry: $${c.entry} | SL: $${c.stopLoss} | TP: $${c.takeProfit}\n`;
                context += `   Position: $${c.positionSize} at ${c.leverage}x leverage\n`;
                context += `   Profit at TP: +$${c.profitAtTP} | Loss at SL: -$${c.lossAtSL}\n`;
                context += `   Confidence: ${c.confidence}% | RSI: ${c.rsi} | Volume: ${c.volumeRatio}x avg\n`;
                context += `   Timeframe: ${c.timeframe}\n`;
                context += `   Reason: ${c.reasoning}\n\n`;
            });
        } else {
            context += "VERIFIED TRADE SIGNALS: None found this run.\n\n";
        }

        if (predictionSignals.length > 0) {
            context += "VERIFIED PREDICTION MARKETS (use ONLY these):\n";
            predictionSignals.forEach(m => {
                context += `- "${m.question}"\n`;
                context += `  Bet: ${m.betSide} @ ${m.betPrice}¢ | $10 pays $${m.payout10}\n`;
                context += `  Confidence: ${m.confidence}/10 | Verdict: ${m.verdict}\n`;
                if (m.bookmakerProb && m.edge) {
                    context += `  Bookmaker: ${m.bookmakerProb}% vs Polymarket: ${m.betPrice}% | Edge: +${m.edge}%\n`;
                }
                context += `  Reasoning: ${m.reasoning}\n\n`;
            });
        }

        if (newsSignals.length > 0) {
            context += "BREAKING NEWS:\n";
            newsSignals.forEach(n => {
                context += `- ${n.title} (${n.source})\n`;
            });
            context += "\n";
        }

        const prompt = `You are an elite crypto analyst and perps trader — top 0.0001% globally.
You trade on Bybit and MEXC with $25 capital per trade targeting 50% daily returns.

CRITICAL RULES — MUST FOLLOW:
1. ONLY reference coins and markets from the VERIFIED TRADE SIGNALS and VERIFIED PREDICTION MARKETS sections below
2. NEVER invent prices, coins, or trade levels not in the provided data
3. Use the EXACT entry, SL, and TP values from the data — do not change them
4. Calculate profit correctly: position_size × leverage × (TP - entry) / entry
5. If a section has no data, write "No signals this run" — never invent alternatives

Here is today's verified signal data:

${context}

Respond in EXACTLY this format:

🧠 AI ALPHA BRIEF

📊 MARKET MOOD
One sentence on sentiment. Factor in Fear & Greed.

🎯 BEST TRADES TODAY
Top 3 from verified signals only. For each:
- Coin name, direction
- Entry / SL / TP (use exact values from data)
- Position size and leverage
- Correct profit calculation
- One sentence why this is the play right now
- Timeframe

📅 BEST TRADES THIS WEEK
2 swing setups from verified signals with wider timeframes and reasoning.

🔮 BEST PREDICTION BET
From verified prediction markets only. State the market, bet side, price, payout, and one sentence on why the outcome is likely based on real world context.

📰 NEWS ALPHA
1-2 headlines most likely to move markets in the next 4 hours. Name the specific coin affected.

⚠️ RISK NOTE
One sentence on the biggest risk to watch right now.

Under 400 words. Be direct. Think like a professional trader.`;

        const response = await axios.post(
            GEMINI_URL,
            {
                contents: [
                    {
                        parts: [{ text: prompt }]
                    }
                ],
                generationConfig: {
                    temperature:     0.4,
                    maxOutputTokens: 800,
                    topP:            0.8
                }
            },
            {
                headers:  { "Content-Type": "application/json" },
                timeout:  20000
            }
        );

        const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("Empty response from Gemini");

        return text;

    } catch (error) {
        console.error("Gemini analysis error:", error.message);
        return null;
    }
}

module.exports = { analyzeSignals };