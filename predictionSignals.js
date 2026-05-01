const axios = require("axios");
require("dotenv").config();

const ODDS_API_KEY = process.env.ODDS_API_KEY;

const CATEGORIES = {
    CRYPTO:   { priority: 1, keywords: ["bitcoin","btc","ethereum","eth","crypto","blockchain","defi","nft","solana","sol","sec","etf","coinbase","binance","stablecoin","web3","token","dao","doge","xrp"] },
    POLITICS: { priority: 2, keywords: ["trump","biden","election","president","congress","federal reserve","fed ","interest rate","inflation","tariff","war","ceasefire","ukraine","russia","china","iran","government","vote","sanction"] },
    TECH:     { priority: 3, keywords: ["ai ","artificial intelligence","openai","gpt","google","apple","microsoft","meta","tesla","nvidia","chip","semiconductor","amazon","ipo"] },
    SPORTS:   { priority: 4, keywords: ["nba","nfl","nhl","mlb","fifa","world cup","super bowl","championship","stanley cup","finals","playoffs","soccer","football","basketball","baseball","hockey","tennis","golf","ufc","mma"] }
};

function categorizeMarket(question) {
    const lower = question.toLowerCase();
    for (const [category, config] of Object.entries(CATEGORIES)) {
        if (config.keywords.some(kw => lower.includes(kw))) return { category, priority: config.priority };
    }
    return { category: "OTHER", priority: 5 };
}

async function estimateFairValue(question, betSide, marketPrice, bookmakerProb, category) {
    try {
        const categoryCtx = {
            CRYPTO:   "Use knowledge of crypto markets, SEC actions, ETF flows, and on-chain data.",
            POLITICS: "Use polling data, geopolitical trends, and base rates for political outcomes.",
            TECH:     "Use tech industry trends, product cycles, and company performance data.",
            SPORTS:   "Use current standings, recent form, injury reports, and tournament history.",
            OTHER:    "Use all available context and base rates."
        };

        let bookmakerContext = bookmakerProb !== null
            ? `\nSportsbook consensus probability: ${bookmakerProb}%` : "";

        const prompt = `You are a professional prediction market analyst finding pricing inefficiencies.

Question: "${question}"
Current Polymarket price: ${marketPrice}¢ (implied probability: ${marketPrice}%)
Proposed bet side: ${betSide}
Category: ${category}
${bookmakerContext}

${categoryCtx[category] || categoryCtx.OTHER}

Estimate the TRUE probability of ${betSide} based on real-world evidence.
Only recommend if edge is 8%+ and you have specific evidence.

Respond ONLY in this JSON format:
{
  "fairValue": <number 0-100>,
  "edge": <fairValue minus marketPrice>,
  "confidence": <1-10>,
  "verdict": "BET THIS" or "SKIP",
  "reasoning": "<2-3 sentences with specific evidence>"
}`;

        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.2, maxOutputTokens: 200 }
            },
            { headers: { "Content-Type": "application/json" }, timeout: 12000 }
        );

        const raw    = response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
        return { fairValue: parsed.fairValue, edge: parsed.edge, confidence: parsed.confidence, verdict: parsed.verdict, reasoning: parsed.reasoning, bookmakerProb };

    } catch (err) {
        return null;
    }
}

async function getBookmakerOdds() {
    const oddsMap = {};
    const sports  = ["americanfootball_nfl","basketball_nba","icehockey_nhl","baseball_mlb","soccer_epl","mma_mixed_martial_arts"];

    for (const sport of sports) {
        try {
            const res = await axios.get(`https://api.the-odds-api.com/v4/sports/${sport}/odds`, {
                params: { apiKey: ODDS_API_KEY, regions: "us", markets: "h2h", oddsFormat: "decimal" },
                timeout: 8000
            });
            for (const event of res.data) {
                for (const bm of (event.bookmakers || [])) {
                    for (const mkt of (bm.markets || [])) {
                        for (const outcome of (mkt.outcomes || [])) {
                            const name = outcome.name.toLowerCase().trim();
                            const prob = parseFloat((1 / outcome.price * 100).toFixed(1));
                            if (!oddsMap[name]) oddsMap[name] = [];
                            oddsMap[name].push(prob);
                        }
                    }
                }
            }
            await new Promise(r => setTimeout(r, 300));
        } catch (err) {}
    }

    const averaged = {};
    for (const [name, probs] of Object.entries(oddsMap)) {
        averaged[name] = parseFloat((probs.reduce((a, b) => a + b, 0) / probs.length).toFixed(1));
    }
    return averaged;
}

function findBookmakerProb(question, oddsMap) {
    const lower = question.toLowerCase();
    let bestMatch = null, bestLen = 0;
    for (const [name, prob] of Object.entries(oddsMap)) {
        if (name.length < 4) continue;
        const regex = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (regex.test(lower) && name.length > bestLen) { bestMatch = prob; bestLen = name.length; }
    }
    return bestMatch;
}

async function getPredictionSignals() {
    try {
        console.log("[Predictions] Scanning for pricing inefficiencies...");

        const [polyRes, oddsMap] = await Promise.all([
            axios.get("https://gamma-api.polymarket.com/markets", { params: { active: true, closed: false, limit: 100 } }),
            getBookmakerOdds()
        ]);

        const markets    = polyRes.data;
        const candidates = [];

        for (const market of markets) {
            if (!market.liquidity || !market.outcomePrices) continue;
            if (parseFloat(market.liquidity) < 5000)       continue;
            if (!market.volume24hr || parseFloat(market.volume24hr) < 500) continue;

            let outcomes = [];
            try { outcomes = JSON.parse(market.outcomePrices); } catch (e) { continue; }

            const yesPrice = parseFloat(outcomes[0]);
            const noPrice  = parseFloat(outcomes[1]);
            if (isNaN(yesPrice) || isNaN(noPrice)) continue;

            let betSide = null, betPrice = null;
            if (yesPrice >= 0.05 && yesPrice <= 0.45)      { betSide = "YES"; betPrice = yesPrice; }
            else if (noPrice >= 0.05 && noPrice <= 0.45)   { betSide = "NO";  betPrice = noPrice; }
            if (!betSide) continue;

            const { category, priority } = categorizeMarket(market.question);
            if (category === "OTHER" && parseFloat(market.liquidity) < 50000) continue;

            candidates.push({
                question: market.question, betSide,
                marketPrice: (betPrice * 100).toFixed(0),
                betPriceRaw: betPrice,
                payout5:     (5  / betPrice).toFixed(2),
                payout10:    (10 / betPrice).toFixed(2),
                volume24hr:  parseFloat(market.volume24hr).toFixed(0),
                liquidity:   parseFloat(market.liquidity).toFixed(0),
                url:         `https://polymarket.com/event/${market.slug}`,
                category, priority
            });
        }

        candidates.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            return parseFloat(b.volume24hr) - parseFloat(a.volume24hr);
        });

        // Top 2 per category, max 10 to analyze
        const toAnalyze = [];
        const catCount  = {};
        for (const m of candidates) {
            catCount[m.category] = catCount[m.category] || 0;
            if (catCount[m.category] < 2) { toAnalyze.push(m); catCount[m.category]++; }
            if (toAnalyze.length >= 10) break;
        }

        console.log(`[Predictions] Analyzing ${toAnalyze.length} markets...`);

        const results = [];

        for (const market of toAnalyze) {
            const bookmakerProb = findBookmakerProb(market.question, oddsMap);
            if (bookmakerProb !== null && (bookmakerProb - parseFloat(market.marketPrice)) > 40) {
                await new Promise(r => setTimeout(r, 500));
                continue;
            }

            const analysis = await estimateFairValue(market.question, market.betSide, market.marketPrice, bookmakerProb, market.category);
            if (!analysis) { await new Promise(r => setTimeout(r, 500)); continue; }

            if (analysis.verdict === "BET THIS" && analysis.edge >= 8 && analysis.confidence >= 7) {
                results.push({ ...market, ...analysis });
            }
            await new Promise(r => setTimeout(r, 800));
        }

        results.sort((a, b) => b.edge - a.edge);
        console.log(`[Predictions] ${results.length} genuine edges found.`);
        return results.slice(0, 4);

    } catch (error) {
        console.error("[Predictions] Error:", error.message);
        return [];
    }
}

module.exports = { getPredictionSignals };