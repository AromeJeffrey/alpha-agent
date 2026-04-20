const axios = require("axios");
require("dotenv").config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

// Retry Gemini call up to 3 times with backoff on 429
async function callGemini(prompt, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await axios.post(
                GEMINI_URL,
                {
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature:     0.4,
                        maxOutputTokens: 800,
                        topP:            0.8
                    }
                },
                {
                    headers: { "Content-Type": "application/json" },
                    timeout: 25000
                }
            );

            const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) throw new Error("Empty response from Gemini");
            return text;

        } catch (error) {
            const is429 = error.response?.status === 429;
            const isLast = attempt === retries;

            if (is429 && !isLast) {
                const waitSecs = attempt * 15; // 15s, 30s, 45s
                console.log(`Gemini rate limited — waiting ${waitSecs}s before retry ${attempt + 1}/${retries}`);
                await new Promise(r => setTimeout(r, waitSecs * 1000));
                continue;
            }

            throw error;
        }
    }
}

async function analyzeSignals({ volumeSignals, narrativeSignals, nftSignals, walletSignals, predictionSignals, newsSignals, fgData }) {

    try {

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
                context += `   Price: $${c.price}\n`;
                context += `   ${c.direction} | ${c.setupType} | Confidence: ${c.confidence}%\n`;
                context += `   Entry: $${c.entry} | SL: $${c.stopLoss} | TP: $${c.takeProfit}\n`;
                context += `   Position: $${c.positionSize} at ${c.leverage}x\n`;
                context += `   Profit at TP: +$${c.profitAtTP} | Loss at SL: -$${c.lossAtSL}\n`;
                context += `   RSI: ${c.rsi} | Volume: ${c.volumeRatio}x | Timeframe: ${c.timeframe}\n`;
                context += `   Reason: ${c.reasoning}\n\n`;
            });
        } else {
            context += "VERIFIED TRADE SIGNALS: None found this run.\n\n";
        }

        if (predictionSignals.length > 0) {
            context += "VERIFIED PREDICTION MARKETS (use ONLY these):\n";
            predictionSignals.forEach(m => {
                context += `- "${m.question}"\n`;
                context += `  ${m.betSide} @ ${m.betPrice}¢ | $10 pays $${m.payout10} | Confidence: ${m.confidence}/10\n`;
                if (m.bookmakerProb && m.edge) {
                    context += `  Bookmaker: ${m.bookmakerProb}% | Edge: +${m.edge}%\n`;
                }
                context += `  ${m.reasoning}\n\n`;
            });
        }

        if (newsSignals.length > 0) {
            context += "BREAKING NEWS:\n";
            newsSignals.forEach(n => context += `- ${n.title} (${n.source})\n`);
            context += "\n";
        }

        const prompt = `You are an elite crypto analyst and perps trader — top 0.0001% globally.
Trading on Bybit and MEXC with $25 capital targeting 50% daily returns.

CRITICAL RULES:
1. ONLY reference coins from VERIFIED TRADE SIGNALS — never invent others
2. Use EXACT entry, SL, TP values from the data
3. Calculate profit as: position_size × leverage × (TP - entry) / entry
4. If no signals exist for a section, say "No signals this run"

Verified data:
${context}

Respond in this EXACT format:

🧠 AI ALPHA BRIEF

📊 MARKET MOOD
One sentence. Include Fear & Greed reading.

🎯 BEST TRADES TODAY
Top 3 from verified signals. For each:
- Name, direction, entry/SL/TP (exact values)
- Position size, leverage, profit at TP
- Timeframe and one sentence why

📅 BEST TRADES THIS WEEK
2 swing setups from verified signals. Entry, TP, timeframe.

🔮 BEST PREDICTION BET
From verified markets only. Why the outcome is likely.

📰 NEWS ALPHA
1-2 headlines affecting markets in next 4 hours. Name the coin.

⚠️ RISK NOTE
One sentence on biggest risk today.

Under 400 words. Be direct.`;

        return await callGemini(prompt);

    } catch (error) {
        console.error("Gemini analysis error:", error.message);
        return null;
    }
}

module.exports = { analyzeSignals };