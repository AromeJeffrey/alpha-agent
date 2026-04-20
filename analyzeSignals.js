const axios = require("axios");
require("dotenv").config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

async function callGemini(prompt, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await axios.post(
                GEMINI_URL,
                {
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.3, maxOutputTokens: 700, topP: 0.8 }
                },
                { headers: { "Content-Type": "application/json" }, timeout: 25000 }
            );
            const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) throw new Error("Empty response");
            return text;
        } catch (error) {
            if (error.response?.status === 429 && attempt < retries) {
                const wait = attempt * 15;
                console.log(`Gemini rate limited — waiting ${wait}s (retry ${attempt + 1}/${retries})`);
                await new Promise(r => setTimeout(r, wait * 1000));
                continue;
            }
            throw error;
        }
    }
}

async function analyzeSignals({ volumeSignals, narrativeSignals, predictionSignals, newsSignals, fgData, noTradeToday }) {

    try {

        // If no trades found, give a different brief
        if (noTradeToday) {
            const noTradePrompt = `You are a disciplined professional crypto trader.

Today's scan found NO trades that passed the confluence threshold.
Fear & Greed: ${fgData?.value || 50}/100 (${fgData?.label || "Neutral"})
Market bias: ${fgData?.bias || "Neutral"}

Write a brief NO TRADE TODAY message (max 100 words) explaining:
- Why protecting capital today is the right call
- What market conditions would need to change before entering trades
- One thing to watch for the next session

Be direct and professional. No fluff.`;

            return await callGemini(noTradePrompt);
        }

        let context = "";

        if (fgData) {
            context += `MARKET SENTIMENT: Fear & Greed ${fgData.value}/100 (${fgData.label})\n`;
            context += `Bias: ${fgData.bias}\n\n`;
        }

        if (volumeSignals.length > 0) {
            context += "VERIFIED TRADE SETUPS:\n";
            volumeSignals.forEach((c, i) => {
                context += `${i + 1}. ${c.name} (${c.symbol}) — ${c.direction}\n`;
                context += `   Setup: ${c.setupType} | Confluence: ${c.confluenceScore}/100\n`;
                context += `   Price: $${c.price} | Entry: $${c.entry} | SL: $${c.stopLoss} | TP: $${c.takeProfit}\n`;
                context += `   Leverage: ${c.leverage}x | R:R 1:${c.rrRatio} | Profit at TP: +$${c.profitAtTP}\n`;
                context += `   Timeframe: ${c.timeframe}\n`;
                context += `   Invalidation: ${c.invalidation}\n`;
                context += `   Reason: ${c.reasoning}\n\n`;
            });
        }

        if (predictionSignals.length > 0) {
            context += "PREDICTION MARKET EDGES:\n";
            predictionSignals.forEach(m => {
                context += `- "${m.question}"\n`;
                context += `  BET ${m.betSide} @ ${m.marketPrice}¢ | Fair value: ${m.fairValue}% | Edge: +${m.edge}%\n`;
                context += `  Confidence: ${m.confidence}/10 | $10 pays $${m.payout10}\n`;
                context += `  ${m.reasoning}\n\n`;
            });
        }

        if (newsSignals.length > 0) {
            context += "NEWS:\n";
            newsSignals.slice(0, 3).forEach(n => context += `- ${n.title}\n`);
        }

        const prompt = `You are a professional Web3 decision engine — elite crypto analyst and perps trader.
Trading on Bybit and MEXC with $25 capital. Goal: disciplined daily profits.

RULES:
1. ONLY reference the verified setups listed below
2. Use EXACT prices from the data — never invent numbers
3. Be brutally honest — if a setup looks weak, say so
4. Think like a risk manager, not a hype machine

Today's verified data:
${context}

Respond in this EXACT format:

🧠 DECISION BRIEF

📊 MARKET READ
2 sentences. BTC macro + Fear & Greed reading + what it means for today.

🎯 PRIORITY TRADE
The single best setup from verified signals only.
- Name, direction, entry/SL/TP (exact)
- Leverage and capital
- Why this is the strongest setup today
- What would invalidate it

📈 SECONDARY TRADE (if exists)
Second best setup. Same format. Skip if only one trade exists.

🎯 BEST PREDICTION BET (if exists)
Market name, BET side, price, fair value, edge, $10 payout.
Why the market is mispriced right now.

⚡ CATALYST TO WATCH
One thing in the news that could accelerate or kill today's trades.

⚠️ RISK
One sentence. What kills all of today's setups.

Under 350 words. Decisive. Professional.`;

        return await callGemini(prompt);

    } catch (error) {
        console.error("Gemini analysis error:", error.message);
        return null;
    }
}

module.exports = { analyzeSignals };