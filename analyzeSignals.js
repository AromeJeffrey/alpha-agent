const axios = require("axios");
require("dotenv").config();

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

async function callGemini(prompt, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await axios.post(
                GEMINI_URL,
                {
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.3, maxOutputTokens: 600, topP: 0.8 }
                },
                { headers: { "Content-Type": "application/json" }, timeout: 25000 }
            );
            const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) throw new Error("Empty response");
            return text;
        } catch (err) {
            if (err.response?.status === 429 && attempt < retries) {
                const wait = attempt * 15;
                console.log(`[AI] Rate limited — waiting ${wait}s (attempt ${attempt + 1}/${retries})`);
                await new Promise(r => setTimeout(r, wait * 1000));
                continue;
            }
            throw err;
        }
    }
}

async function analyzeSignals({ decision, walletSignals, newsSignals }) {
    try {
        const { regime, fgData, btcMacro, executableTrades, executableBets,
                noTradeToday, noBetsToday } = decision;

        let ctx = "";
        ctx += `MARKET REGIME: ${regime.label}\n`;
        ctx += `Fear & Greed: ${fgData.value}/100 (${fgData.label})\n`;
        ctx += `BTC: $${btcMacro.price} | ${(btcMacro.change24h||0).toFixed(2)}% | ${btcMacro.trend}\n`;
        ctx += `Bias: ${regime.description}\n\n`;

        if (executableTrades?.length > 0) {
            ctx += `VERIFIED TRADE SETUPS:\n`;
            executableTrades.forEach((c, i) => {
                ctx += `${i+1}. ${c.name} (${c.symbol}) — ${c.direction} | ${c.rank}\n`;
                ctx += `   Entry: $${c.entry} | SL: $${c.stopLoss} | TP: $${c.takeProfit}\n`;
                ctx += `   ${c.leverage}x | R:R 1:${c.rrRatio} | +$${c.profitAtTP} at TP\n`;
                ctx += `   ${c.reasoning}\n\n`;
            });
        } else {
            ctx += `PERPS: NO TRADE TODAY\n\n`;
        }

        if (executableBets?.length > 0) {
            ctx += `PREDICTION EDGES:\n`;
            executableBets.forEach(m => {
                ctx += `- "${m.question}" BET ${m.betSide} @ ${m.marketPrice}¢\n`;
                ctx += `  Fair value: ${m.fairValue}% | Edge: +${m.edge}% | $10 pays $${m.payout10}\n`;
                ctx += `  ${m.reasoning}\n\n`;
            });
        } else {
            ctx += `PREDICTIONS: NO EDGE TODAY\n\n`;
        }

        if (newsSignals?.length > 0) {
            ctx += `NEWS:\n`;
            newsSignals.slice(0, 3).forEach(n => ctx += `- ${n.title}\n`);
        }

        const isQuiet = noTradeToday && noBetsToday;

        const prompt = isQuiet
            ? `Professional crypto trader. No trades or bets today.

Market context:
${ctx}

Write a STANDBY brief (max 80 words):
- Why no trades today given the regime
- What condition would trigger action
- One thing to watch next session

Format:
🧠 MASTER BRIEF
📊 STANDBY MODE
[reasoning]
⏳ WATCH FOR
[trigger]`

            : `You are a Master Alpha Engine — professional crypto trader.

RULES:
1. ONLY reference verified setups from data — NEVER invent prices or coins
2. Use EXACT entry/SL/TP values provided
3. Think like a risk desk, not a hype channel

Data:
${ctx}

Respond EXACTLY:

🧠 MASTER BRIEF

📊 MARKET READ
2 sentences. Regime + what it means for today.

${executableTrades?.length > 0 ? `⚡ PRIORITY TRADE
Best setup — Direction | Entry | SL | TP | Leverage | Why now | Invalidation` : `📊 PERPS: NO TRADE`}

${executableTrades?.length > 1 ? `📈 SECONDARY TRADE
Second best setup. Same format.` : ""}

${executableBets?.length > 0 ? `🎯 BEST BET
Market + side + price + fair value + edge + why mispriced` : `🎯 PREDICTIONS: NO EDGE`}

⚠️ KILL SWITCH
One condition that kills all setups today.

Under 300 words. Decisive.`;

        return await callGemini(prompt);

    } catch (err) {
        console.error("[AI] analyzeSignals error:", err.message);
        return null;
    }
}

module.exports = { analyzeSignals };