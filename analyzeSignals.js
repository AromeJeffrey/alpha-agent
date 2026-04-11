const axios = require("axios");
require("dotenv").config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;

async function analyzeSignals({ volumeSignals, narrativeSignals, nftSignals, walletSignals, predictionSignals, newsSignals }) {

    try {

        // Build a clean summary of all signals to feed to the AI
        let context = "";

        if (volumeSignals.length > 0) {
            context += "MOMENTUM SIGNALS:\n";
            volumeSignals.forEach(c => {
                context += `- ${c.name} (${c.symbol}): $${c.price}, 24h change ${c.change.toFixed(2)}%\n`;
            });
            context += "\n";
        }

        if (narrativeSignals.length > 0) {
            context += "TRENDING NARRATIVES:\n";
            narrativeSignals.forEach(c => {
                context += `- ${c.name} (${c.symbol}), trend score ${c.score}\n`;
            });
            context += "\n";
        }

        if (nftSignals.length > 0) {
            context += "NFT SIGNALS:\n";
            nftSignals.forEach(n => {
                context += `- ${n.name} (${n.symbol}): $${n.price}, 24h ${n.change24h}, volume ${n.volume24h}\n`;
            });
            context += "\n";
        }

        if (walletSignals.length > 0) {
            context += "SMART MONEY WALLETS:\n";
            walletSignals.forEach(w => {
                context += `- ${w.label} (${w.address}): ${w.ethBalance}, ${w.txCount} recent txns\n`;
            });
            context += "\n";
        }

        if (predictionSignals.length > 0) {
            context += "PREDICTION MARKET OPPORTUNITIES:\n";
            predictionSignals.forEach(m => {
                context += `- "${m.question}" — Bet ${m.betSide} @ ${m.betPrice}, $10 pays $${m.payout10}, 24hr vol $${m.volume24hr}, liquidity $${m.liquidity}\n`;
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
                        content: `You are a sharp, no-nonsense Web3 alpha analyst. 
You receive raw market signals every day and your job is to give a concise, actionable intelligence brief.
Your tone is direct, confident, and focused on making money.
Always structure your response in exactly this format:

🧠 AI ALPHA BRIEF

📊 MARKET MOOD
One sentence on overall crypto market sentiment based on the signals.

🎯 TOP TRADE OPPORTUNITY
The single best trade or bet from all signals. Be specific — name the asset or market, give the entry, explain why briefly.

🔮 BEST PREDICTION BET
Pick the single best Polymarket bet. State the market, which side, the price, the $10 payout, and give one sentence of reasoning.

📰 NEWS THAT MATTERS
Pick the 1-2 news items most likely to move markets. One sentence each on why it matters.

⚠️ RISK NOTE
One sentence warning about the biggest risk in today's signals.

Keep the entire brief under 300 words. No fluff.`
                    },
                    {
                        role: "user",
                        content: `Here are today's signals:\n\n${context}\n\nGive me the alpha brief.`
                    }
                ],
                max_tokens: 500,
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