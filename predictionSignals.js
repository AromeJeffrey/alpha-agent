const axios = require("axios");
require("dotenv").config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ODDS_API_KEY = process.env.ODDS_API_KEY;

// ─── CATEGORY DEFINITIONS ────────────────────────────────
const CATEGORIES = {
    CRYPTO:   { priority: 1, keywords: ["bitcoin","btc","ethereum","eth","crypto","blockchain","defi","nft","solana","sol","sec","etf","coinbase","binance","stablecoin","web3","token","dao","doge","xrp"] },
    POLITICS: { priority: 2, keywords: ["trump","biden","election","president","congress","federal reserve","fed ","interest rate","inflation","tariff","war","ceasefire","ukraine","russia","china","iran","government","vote","sanction"] },
    TECH:     { priority: 3, keywords: ["ai ","artificial intelligence","openai","gpt","google","apple","microsoft","meta","tesla","nvidia","chip","semiconductor","gta","amazon","ipo"] },
    SPORTS:   { priority: 4, keywords: ["nba","nfl","nhl","mlb","fifa","world cup","super bowl","championship","stanley cup","finals","playoffs","soccer","football","basketball","baseball","hockey","tennis","golf","ufc","mma"] }
};

function categorizeMarket(question) {
    const lower = question.toLowerCase();
    for (const [category, config] of Object.entries(CATEGORIES)) {
        if (config.keywords.some(kw => lower.includes(kw))) {
            return { category, priority: config.priority };
        }
    }
    return { category: "OTHER", priority: 5 };
}

// ─── FAIR VALUE ESTIMATOR ─────────────────────────────────
// Uses AI to estimate true probability independent of market price
// Edge = fair value - current market price

async function estimateFairValue(question, betSide, marketPrice, bookmakerProb, category) {

    try {

        const categoryCtx = {
            CRYPTO:   "Use knowledge of crypto markets, SEC actions, ETF flows, and on-chain data.",
            POLITICS: "Use polling data, geopolitical trends, and base rates for political outcomes.",
            TECH:     "Use tech industry trends, product cycles, and company performance data.",
            SPORTS:   "Use current standings, recent form, injury reports, and tournament history.",
            OTHER:    "Use all available context and base rates."
        };

        let bookmakerContext = "";
        if (bookmakerProb !== null) {
            bookmakerContext = `\nSportsbook consensus probability: ${bookmakerProb}%`;
        }

        const prompt = `You are a professional prediction market analyst specializing in finding pricing inefficiencies.

Question: "${question}"
Current Polymarket price: ${marketPrice}¢ (implied probability: ${marketPrice}%)
Proposed bet side: ${betSide}
Category: ${category}
${bookmakerContext}

${categoryCtx[category] || categoryCtx.OTHER}

Your job:
1. Estimate the TRUE probability of ${betSide} based on real-world evidence
2. Identify if there is a genuine edge vs the current market price
3. Be conservative — only recommend if edge is clear and reasoning is solid

Respond in EXACTLY this JSON format:
{
  "fairValue": <number 0-100, your estimated true probability>,
  "edge": <fairValue minus marketPrice, positive means market underpricing>,
  "confidence": <1-10>,
  "verdict": "BET THIS" or "SKIP",
  "reasoning": "<2-3 sentences explaining your probability estimate with specific evidence>"
}

Only output "BET THIS" if:
- Edge is 8% or more (fair value meaningfully higher than market price)
- Confidence is 7 or higher
- You have specific real-world basis for your estimate`;

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

        return {
            fairValue:  parsed.fairValue,
            edge:       parsed.edge,
            confidence: parsed.confidence,
            verdict:    parsed.verdict,
            reasoning:  parsed.reasoning,
            bookmakerProb
        };

    } catch (err) {
        return null;
    }
}

// ─── BOOKMAKER ODDS ───────────────────────────────────────

const SPORTS_LIST = [
    "americanfootball_nfl","basketball_nba","icehockey_nhl",
    "baseball_mlb","soccer_epl","soccer_uefa_champs_league",
    "soccer_spain_la_liga","soccer_germany_bundesliga",
    "soccer_italy_serie_a","soccer_france_ligue_one",
    "mma_mixed_martial_arts","golf_pga_championship"
];

async function getBookmakerOdds() {
    const oddsMap = {};
    for (const sport of SPORTS_LIST) {
        try {
            const response = await axios.get(
                `https://api.the-odds-api.com/v4/sports/${sport}/odds`,
                { params: { apiKey: ODDS_API_KEY, regions: "us", markets: "h2h", oddsFormat: "decimal" }, timeout: 8000 }
            );
            for (const event of response.data) {
                for (const bookmaker of (event.bookmakers || [])) {
                    for (const market of (bookmaker.markets || [])) {
                        for (const outcome of (market.outcomes || [])) {
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

function findBookmakerProbability(question, oddsMap) {
    const lower = question.toLowerCase();
    let bestMatch = null, bestLen = 0;
    for (const [teamName, prob] of Object.entries(oddsMap)) {
        if (teamName.length < 4) continue;
        const regex = new RegExp(`\\b${teamName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (regex.test(lower) && teamName.length > bestLen) {
            bestMatch = prob;
            bestLen   = teamName.length;
        }
    }
    return bestMatch;
}

// ─── MAIN ─────────────────────────────────────────────────

async function getPredictionSignals() {

    try {

        console.log("[Predictions] Scanning for pricing inefficiencies...");

        const [polyResponse, oddsMap] = await Promise.all([
            axios.get("https://gamma-api.polymarket.com/markets", {
                params: { active: true, closed: false, limit: 100 }
            }),
            getBookmakerOdds()
        ]);

        const markets    = polyResponse.data;
        const candidates = [];

        for (const market of markets) {

            if (!market.liquidity || !market.outcomePrices)                continue;
            if (parseFloat(market.liquidity) < 5000)                       continue; // Min $5k liquidity
            if (!market.volume24hr || parseFloat(market.volume24hr) < 500) continue; // Min $500 24h vol

            let outcomes = [];
            try { outcomes = JSON.parse(market.outcomePrices); }
            catch (e) { continue; }

            const yesPrice = parseFloat(outcomes[0]);
            const noPrice  = parseFloat(outcomes[1]);
            if (isNaN(yesPrice) || isNaN(noPrice)) continue;

            // Look for asymmetric opportunities — priced 5¢ to 45¢
            // Below 5¢ = too speculative, above 45¢ = insufficient upside for 3x target
            let betSide = null, betPrice = null;
            if (yesPrice >= 0.05 && yesPrice <= 0.45)   { betSide = "YES"; betPrice = yesPrice; }
            else if (noPrice >= 0.05 && noPrice <= 0.45) { betSide = "NO";  betPrice = noPrice; }
            if (!betSide) continue;

            const { category, priority } = categorizeMarket(market.question);

            // Skip categories with no financial relevance
            if (category === "OTHER" && parseFloat(market.liquidity) < 50000) continue;

            candidates.push({
                question:    market.question,
                betSide,
                marketPrice: (betPrice * 100).toFixed(0),
                betPriceRaw: betPrice,
                payout5:     (5  / betPrice).toFixed(2),
                payout10:    (10 / betPrice).toFixed(2),
                volume24hr:  parseFloat(market.volume24hr).toFixed(0),
                liquidity:   parseFloat(market.liquidity).toFixed(0),
                url:         `https://polymarket.com/event/${market.slug}`,
                category,
                priority
            });
        }

        // Sort by priority then volume
        candidates.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            return parseFloat(b.volume24hr) - parseFloat(a.volume24hr);
        });

        // Take top 2 per category, max 10 to analyze
        const toAnalyze = [];
        const catCount  = {};
        for (const market of candidates) {
            catCount[market.category] = catCount[market.category] || 0;
            if (catCount[market.category] < 2) {
                toAnalyze.push(market);
                catCount[market.category]++;
            }
            if (toAnalyze.length >= 10) break;
        }

        console.log(`[Predictions] Analyzing ${toAnalyze.length} markets for edge...`);

        const results = [];

        for (const market of toAnalyze) {
            const bookmakerProb = findBookmakerProbability(market.question, oddsMap);

            // Skip if bookmaker edge is suspiciously large (bad match)
            if (bookmakerProb !== null) {
                const rawEdge = bookmakerProb - parseFloat(market.marketPrice);
                if (rawEdge > 40) {
                    await new Promise(r => setTimeout(r, 500));
                    continue;
                }
            }

            const analysis = await estimateFairValue(
                market.question,
                market.betSide,
                market.marketPrice,
                bookmakerProb,
                market.category
            );

            if (!analysis) {
                await new Promise(r => setTimeout(r, 500));
                continue;
            }

            // Only keep genuine edges
            if (analysis.verdict === "BET THIS" && analysis.edge >= 8 && analysis.confidence >= 7) {
                results.push({ ...market, ...analysis });
            }

            await new Promise(r => setTimeout(r, 800));
        }

        // Sort by edge size — biggest mispricings first
        results.sort((a, b) => b.edge - a.edge);

        console.log(`[Predictions] Found ${results.length} genuine pricing inefficiencies.`);

        return results.slice(0, 4);

    } catch (error) {
        console.error("Prediction signal error:", error.message);
        return [];
    }
}

module.exports = { getPredictionSignals };