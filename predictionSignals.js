const axios = require("axios");
require("dotenv").config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ODDS_API_KEY = process.env.ODDS_API_KEY;

// All sports supported by The Odds API free tier
const SPORTS = [
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
    "tennis_atp_french_open",
    "golf_pga_championship"
];

// Fetch bookmaker odds for all sports and build a lookup map
async function getBookmakerOdds() {

    const oddsMap = {};

    for (const sport of SPORTS) {
        try {
            const response = await axios.get(
                `https://api.the-odds-api.com/v4/sports/${sport}/odds`,
                {
                    params: {
                        apiKey:   ODDS_API_KEY,
                        regions:  "us",
                        markets:  "h2h",
                        oddsFormat: "decimal"
                    },
                    timeout: 8000
                }
            );

            const events = response.data;

            for (const event of events) {
                // Store by team/participant name for fuzzy matching later
                for (const bookmaker of (event.bookmakers || [])) {
                    for (const market of (bookmaker.markets || [])) {
                        for (const outcome of (market.outcomes || [])) {
                            const name  = outcome.name.toLowerCase();
                            const price = parseFloat(outcome.price);
                            // Convert decimal odds to implied probability
                            const impliedProb = (1 / price * 100).toFixed(1);

                            if (!oddsMap[name]) {
                                oddsMap[name] = [];
                            }
                            oddsMap[name].push(parseFloat(impliedProb));
                        }
                    }
                }
            }

            // Small delay to avoid rate limiting
            await new Promise(r => setTimeout(r, 300));

        } catch (err) {
            // Silent fail per sport — don't kill everything if one sport fails
        }
    }

    // Average the implied probability across all bookmakers per team
    const averaged = {};
    for (const [name, probs] of Object.entries(oddsMap)) {
        const avg = probs.reduce((a, b) => a + b, 0) / probs.length;
        averaged[name] = parseFloat(avg.toFixed(1));
    }

    return averaged;
}

// Try to find bookmaker odds for a given market question
function findBookmakerProbability(question, oddsMap) {

    const questionLower = question.toLowerCase();

    for (const [teamName, prob] of Object.entries(oddsMap)) {
        if (questionLower.includes(teamName)) {
            return prob;
        }
    }

    return null;
}

// Score each market with AI + bookmaker data
async function scoreMarket(question, betSide, betPrice, bookmakerProb) {

    try {

        let oddsContext = "";
        if (bookmakerProb !== null) {
            const polymarketProb = parseFloat(betPrice);
            const edge = (bookmakerProb - polymarketProb).toFixed(1);
            oddsContext = `\nBookmaker consensus probability: ${bookmakerProb}%\nPolymarket implied probability: ${polymarketProb}%\nEdge: ${edge > 0 ? "+" : ""}${edge}%`;
        }

        const response = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    {
                        role: "system",
                        content: `You are a sharp prediction market analyst. Evaluate the real-world 
likelihood of a prediction market outcome based on current statistics, recent form, 
historical precedent, and any bookmaker data provided.

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

If bookmaker odds show the Polymarket price is LOWER than bookmaker implied probability, 
that means Polymarket is underpricing the outcome — increase confidence.
Only RECOMMEND if confidence is 6 or above.`
                    },
                    {
                        role: "user",
                        content: `Question: "${question}"
Proposed bet: ${betSide} at ${betPrice} cents (Polymarket implied probability: ${betPrice}%)${oddsContext}

Evaluate this bet.`
                    }
                ],
                max_tokens: 150,
                temperature: 0.3
            },
            {
                headers: {
                    "Authorization": `Bearer ${GROQ_API_KEY}`,
                    "Content-Type":  "application/json"
                },
                timeout: 10000
            }
        );

        const raw     = response.data.choices[0].message.content.trim();
        const cleaned = raw.replace(/```json|```/g, "").trim();
        const parsed  = JSON.parse(cleaned);

        return {
            confidence:       parsed.confidence,
            verdict:          parsed.verdict,
            reasoning:        parsed.reasoning,
            bookmakerProb:    bookmakerProb,
            edge:             bookmakerProb !== null
                                ? (bookmakerProb - parseFloat(betPrice)).toFixed(1)
                                : null
        };

    } catch (err) {
        return {
            confidence:    5,
            verdict:       "UNSCORED",
            reasoning:     "AI scoring unavailable.",
            bookmakerProb: null,
            edge:          null
        };
    }
}

async function getPredictionSignals() {

    try {

        // Fetch Polymarket and bookmaker odds in parallel
        console.log("[Predictions] Fetching Polymarket markets and bookmaker odds...");

        const [polyResponse, oddsMap] = await Promise.all([
            axios.get("https://gamma-api.polymarket.com/markets", {
                params: { active: true, closed: false, limit: 100 }
            }),
            getBookmakerOdds()
        ]);

        console.log(`[Predictions] Bookmaker odds loaded for ${Object.keys(oddsMap).length} teams/participants.`);

        const markets  = polyResponse.data;
        const candidates = [];

        for (const market of markets) {

            if (!market.liquidity || !market.outcomePrices) continue;
            if (parseFloat(market.liquidity) < 500)          continue;
            if (!market.volume24hr || parseFloat(market.volume24hr) < 100) continue;

            let outcomes = [];
            try {
                outcomes = JSON.parse(market.outcomePrices);
            } catch (e) {
                continue;
            }

            const yesPrice = parseFloat(outcomes[0]);
            const noPrice  = parseFloat(outcomes[1]);
            if (isNaN(yesPrice) || isNaN(noPrice)) continue;

            let betSide  = null;
            let betPrice = null;

            if (yesPrice >= 0.10 && yesPrice <= 0.45) {
                betSide  = "YES";
                betPrice = yesPrice;
            } else if (noPrice >= 0.10 && noPrice <= 0.45) {
                betSide  = "NO";
                betPrice = noPrice;
            }

            if (!betSide) continue;

            candidates.push({
                question:    market.question,
                betSide,
                betPrice:    (betPrice * 100).toFixed(0),
                betPriceRaw: betPrice,
                payout5:     (5  / betPrice).toFixed(2),
                payout10:    (10 / betPrice).toFixed(2),
                volume24hr:  parseFloat(market.volume24hr).toFixed(0),
                liquidity:   parseFloat(market.liquidity).toFixed(0),
                url:         `https://polymarket.com/event/${market.slug}`
            });
        }

        // Sort by volume, take top 8 to score
        candidates.sort((a, b) => parseFloat(b.volume24hr) - parseFloat(a.volume24hr));
        const toScore = candidates.slice(0, 8);

        console.log(`[Predictions] Scoring ${toScore.length} markets with AI + bookmaker data...`);

        const scored = [];
        for (const market of toScore) {

            const bookmakerProb = findBookmakerProbability(market.question, oddsMap);

            const score = await scoreMarket(
                market.question,
                market.betSide,
                market.betPrice,
                bookmakerProb
            );

            scored.push({ ...market, ...score });
            await new Promise(r => setTimeout(r, 500));
        }

        // Return RECOMMEND markets sorted by confidence
        const recommended = scored
            .filter(m => m.verdict === "RECOMMEND")
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 5);

        if (recommended.length === 0) {
            return scored
                .sort((a, b) => b.confidence - a.confidence)
                .slice(0, 3);
        }

        return recommended;

    } catch (error) {
        console.error("Prediction signal error:", error.message);
        return [];
    }
}

module.exports = { getPredictionSignals };