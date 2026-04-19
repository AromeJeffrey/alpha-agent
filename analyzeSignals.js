const axios = require("axios");
require("dotenv").config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;

async function analyzeSignals({ volumeSignals, narrativeSignals, nftSignals, walletSignals, predictionSignals, newsSignals, fgData }) {

    try {

        let context = "";

        // Fear & Greed context
        if (fgData) {
            context += `MARKET SENTIMENT:\n`;
            context += `Fear & Greed Index: ${fgData.value}/100 (${fgData.label})\n`;
            context += `Bias: ${fgData.bias}\n\n`;
        }

        if (volumeSignals.length > 0) {
            context += "TRADE SIGNALS:\n";
            volumeSignals.forEach(c => {
                context += `- ${c.name} (${c.symbol}): $${c.price}, RSI ${c.rsi}, Vol ${c.volumeRatio}x\n`;
                context += `  ${c.direction} | ${c.setupType} | Confidence ${c.confidence}%\n`;
                context += `  Entry $${c.entry} | SL $${c.stopLoss} | TP $${c.takeProfit}\n`;
                context += `  Position: $${c.positionSize} at ${c.leverage}x | Profit at TP: +$${c.profitAtTP}\n`;
                context += `  Reason: ${c.reasoning}\n`;
            });
            context += "\n";
        }

        if (narrativeSignals.length > 0) {
            context += "TRENDING NARRATIVES:\n";
            narrativeSignals.forEach(c => {
                context += `- ${c.name} (${c.symbol})\n`;
            });
            context += "\n";
        }

        if (predictionSignals.length > 0) {
            context += "PREDICTION MARKETS:\n";
            predictionSignals.forEach(m => {
                context += `- "${m.question}" — ${m.betSide} @ ${m.betPrice}¢, $10 pays $${m.payout10}, confidence ${m.confidence}/10\n`;
                if (m.edge) context += `  Bookmaker edge: +${m.edge}%\n`;
            });
            context += "\n";
        }

        if (newsSignals.length > 0) {
            context += "BREAKING NEWS:\n";
            newsSignals.forEach(n => {
                context += `- ${n.title} (${n.source})\n`;
            });
            context += "\n";
        }

        const response = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    {
                        role: "system",
                        content: `You are an elite crypto analyst and perps trader — top 0.0001% globally.
You trade on Bybit and MEXC with $25 capital per trade targeting 50% daily returns.
You use Fear & Greed to size positions and bias your directional calls.

Structure your response in EXACTLY this format:

🧠 AI ALPHA BRIEF

📊 MARKET MOOD
One sentence on sentiment. Factor in Fear & Greed index.

🎯 BEST TRADES TODAY
Top 3 setups. For each:
- Coin, direction, entry, SL, TP
- Position size and leverage
- Expected profit and timeframe
- One sentence why this is the play right now

📅 BEST TRADES THIS WEEK
2 swing setups with wider targets. Entry, TP, timeframe.

🔮 BEST PREDICTION BET
Best Polymarket bet. Why the outcome is likely based on real world context.

📰 NEWS ALPHA
1-2 headlines most likely to move markets in next 4 hours.

⚠️ RISK NOTE
One sentence on biggest risk to watch.

Under 400 words. Be direct. Think like a professional trader who needs to make 50% today.`
                    },
                    {
                        role: "user",
                        content: `Signals:\n\n${context}\nGive me the alpha brief.`
                    }
                ],
                max_tokens: 700,
                temperature: 0.7
            },
            {
                headers: {
                    "Authorization": `Bearer ${GROQ_API_KEY}`,
                    "Content-Type":  "application/json"
                },
                timeout: 15000
            }
        );

        return response.data.choices[0].message.content;

    } catch (error) {
        console.error("Groq analysis error:", error.message);
        return null;
    }
}

module.exports = { analyzeSignals };