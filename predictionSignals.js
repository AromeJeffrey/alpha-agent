const axios = require("axios");
require("dotenv").config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ODDS_API_KEY = process.env.ODDS_API_KEY;

// ─── CATEGORY DEFINITIONS ────────────────────────────────
const CATEGORIES = {
    CRYPTO: {
        priority: 1,
        keywords: [
            "bitcoin", "btc", "ethereum", "eth", "crypto", "blockchain",
            "defi", "nft", "altcoin", "solana", "sol", "sec", "etf",
            "coinbase", "binance", "stablecoin", "web3", "token", "dao",
            "polymarket", "doge", "xrp", "ripple", "usdc", "tether"
        ]
    },
    POLITICS: {
        priority: 2,
        keywords: [
            "trump", "biden", "election", "president", "congress", "senate",
            "federal reserve", "fed ", "interest rate", "gdp", "inflation",
            "tariff", "war", "ceasefire", "nato", "ukraine", "russia",
            "china", "iran", "israel", "government", "democrat", "republican",
            "prime minister", "vote", "referendum", "policy", "sanction"
        ]
    },
    TECH: {
        priority: 3,
        keywords: [
            "ai ", "artificial intelligence", "openai", "gpt", "claude",
            "google", "apple", "microsoft", "meta", "tesla", "spacex",
            "elon", "musk", "nvidia", "chip", "semiconductor", "gta",
            "twitter", "x.com", "amazon", "startup", "ipo"
        ]
    },
    SPORTS: {
        priority: 4,
        keywords: [
            "nba", "nfl", "nhl", "mlb", "fifa", "world cup", "super bowl",
            "championship", "stanley cup", "finals", "playoffs", "league",
            "soccer", "football", "basketball", "baseball", "hockey",
            "tennis", "golf", "ufc", "mma", "boxing", "olympic",
            "win the", "beat the", "score"
        ]
    }
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

// ─── SPORTS ODDS ─────────────────────────────────────────
const SPORTS_LIST = [
    "americanfootball_nfl",
    "basketball_nba",
    "icehockey_nhl",
    "baseball_mlb",
    "soccer_epl",
    "soccer_uefa_champs_league",
    "soccer_spain_la_liga",
    "soccer_germany_bundesliga",
    "soccer_italy_serie_a",
    "soccer_france_ligue_one",
    "mma_mixed_martial_arts",
    "golf_pga_championship"
];

async function getBookmakerOdds() {
    const oddsMap = {};
    for (const sport of SPORTS_LIST) {
        try {
            const response = await axios.get(
                `https://api.the-odds-api.com/v4/sports/${sport}/odds`,
                {
                    params: {
                        apiKey: ODDS_API_KEY,
                        regions: "us",
                        markets: "h2h",
                        oddsFormat: "decimal"
                    },
                    timeout: 8000
                }
            );
            for (const event of response.data) {
                for (const bookmaker of (event.bookmakers || [])) {
                    for (const market of (bookmaker.markets || [])) {
                        for (const outcome of (market.outcomes || [])) {
                            const name = outcome.name.toLowerCase();
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
    for (const [teamName, prob] of Object.entries(oddsMap)) {
        if (lower.includes(teamName)) return prob;
    }
    return null;
}

// ─── AI SCORING ──────────────────────────────────────────
async function scoreMarket(question, betSide, betPrice, bookmakerProb, category) {

    try {
        let oddsContext = "";
        if (bookmakerProb !== null) {
            const edge = (bookmakerProb - parseFloat(betPrice)).toFixed(1);
            oddsContext = `\nBookmaker consensus: ${bookmakerProb}%\nPolymarket implied: ${betPrice}%\nEdge: ${edge > 0 ? "+" : ""}${edge}%`;
        }

        const categoryContext = {
            CRYPTO:   "Use your knowledge of crypto markets, SEC actions, ETF approvals, and on-chain data.",
            POLITICS: "Use your knowledge of polling data, geopolitical trends, and historical precedent.",
            TECH:     "Use your knowledge of tech industry trends, product releases, and company performance.",
            SPORTS:   "Use your knowledge of team standings, recent form, injuries, and historical performance.",
            OTHER:    "Use your best judgment based on available context."
        };

        const response = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    {
                        role: "system",
                        content: `You are a sharp prediction market analyst covering crypto, politics, tech, and sports.
${categoryContext[category] || categoryContext.OTHER}

Respond in EXACTLY this JSON format, nothing else:
{
  "confidence": <number 1-10>,
  "verdict": "RECOMMEND" or "SKIP",
  "reasoning": "<one clear sentence explaining your verdict>"
}

Confidence guide:
1-3: Very unlikely, avoid
4-5: Uncertain, weak edge
6-7: Reasonable likelihood, some edge
8-10: Strong real-world basis, clear edge

If bookmaker probability is HIGHER than Polymarket price, the market is underpriced — increase confidence.
Only RECOMMEND if confidence is 6 or above.`
                    },
                    {
                        role: "user",
                        content: `Category: ${category}
Question: "${question}"
Proposed bet: ${betSide} at ${betPrice} cents${oddsContext}

Evaluate this bet.`
                    }
                ],
                max_tokens: 150,
                temperature: 0.3
            },
            {
                headers: {
                    "Authorization": `Bearer ${GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                },
                timeout: 10000
            }
        );

        const raw    = response.data.choices[0].message.content.trim();
        const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());

        return {
            confidence:    parsed.confidence,
            verdict:       parsed.verdict,
            reasoning:     parsed.reasoning,
            bookmakerProb,
            edge: bookmakerProb !== null
                ? (bookmakerProb - parseFloat(betPrice)).toFixed(1)
                : null
        };

    } catch (err) {
        return { confidence: 5, verdict: "UNSCORED", reasoning: "AI scoring unavailable.", bookmakerProb: null, edge: null };
    }
}

// ─── MAIN ─────────────────────────────────────────────────
async function getPredictionSignals() {

    try {

        console.log("[Predictions] Fetching markets and bookmaker odds...");

        const [polyResponse, oddsMap] = await Promise.all([
            axios.get("https://gamma-api.polymarket.com/markets", {
                params: { active: true, closed: false, limit: 100 }
            }),
            getBookmakerOdds()
        ]);

        console.log(`[Predictions] Bookmaker odds loaded for ${Object.keys(oddsMap).length} participants.`);

        const markets    = polyResponse.data;
        const candidates = [];

        for (const market of markets) {

            if (!market.liquidity || !market.outcomePrices)              continue;
            if (parseFloat(market.liquidity) < 500)                      continue;
            if (!market.volume24hr || parseFloat(market.volume24hr) < 100) continue;

            let outcomes = [];
            try { outcomes = JSON.parse(market.outcomePrices); }
            catch (e) { continue; }

            const yesPrice = parseFloat(outcomes[0]);
            const noPrice  = parseFloat(outcomes[1]);
            if (isNaN(yesPrice) || isNaN(noPrice)) continue;

            let betSide = null, betPrice = null;
            if (yesPrice >= 0.10 && yesPrice <= 0.45)      { betSide = "YES"; betPrice = yesPrice; }
            else if (noPrice >= 0.10 && noPrice <= 0.45)   { betSide = "NO";  betPrice = noPrice; }
            if (!betSide) continue;

            const { category, priority } = categorizeMarket(market.question);

            candidates.push({
                question:   market.question,
                betSide,
                betPrice:   (betPrice * 100).toFixed(0),
                betPriceRaw: betPrice,
                payout5:    (5  / betPrice).toFixed(2),
                payout10:   (10 / betPrice).toFixed(2),
                volume24hr: parseFloat(market.volume24hr).toFixed(0),
                liquidity:  parseFloat(market.liquidity).toFixed(0),
                url:        `https://polymarket.com/event/${market.slug}`,
                category,
                priority
            });
        }

        // Sort by priority first (crypto > politics > tech > sports), then volume
        candidates.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            return parseFloat(b.volume24hr) - parseFloat(a.volume24hr);
        });

        // Take top 2 from each category, max 10 total to score
        const toScore  = [];
        const catCount = {};

        for (const market of candidates) {
            catCount[market.category] = (catCount[market.category] || 0);
            if (catCount[market.category] < 2) {
                toScore.push(market);
                catCount[market.category]++;
            }
            if (toScore.length >= 10) break;
        }

        console.log(`[Predictions] Scoring ${toScore.length} markets across categories:`, catCount);

        const scored = [];
        for (const market of toScore) {
            const bookmakerProb = findBookmakerProbability(market.question, oddsMap);
            const score = await scoreMarket(
                market.question,
                market.betSide,
                market.betPrice,
                bookmakerProb,
                market.category
            );
            scored.push({ ...market, ...score });
            await new Promise(r => setTimeout(r, 500));
        }

        // Return RECOMMEND markets sorted by priority then confidence
        const recommended = scored
            .filter(m => m.verdict === "RECOMMEND")
            .sort((a, b) => {
                if (a.priority !== b.priority) return a.priority - b.priority;
                return b.confidence - a.confidence;
            })
            .slice(0, 6);

        if (recommended.length === 0) {
            return scored.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
        }

        return recommended;

    } catch (error) {
        console.error("Prediction signal error:", error.message);
        return [];
    }
}

module.exports = { getPredictionSignals };