const axios = require("axios");
require("dotenv").config();

const ODDS_API_KEY    = process.env.ODDS_API_KEY;
const GEMINI_API_KEY  = process.env.GEMINI_API_KEY;

// ─── CATEGORIES ───────────────────────────────────────────
const CATEGORIES = {
    CRYPTO:   { priority: 1, keywords: ["bitcoin","btc","ethereum","eth","crypto","blockchain","defi","nft","solana","sol","sec","etf","coinbase","binance","stablecoin","web3","token","dao","doge","xrp","chainlink","avalanche","cardano","ondo"] },
    POLITICS: { priority: 2, keywords: ["trump","biden","election","president","congress","federal reserve","fed ","interest rate","inflation","tariff","war","ceasefire","ukraine","russia","china","iran","government","vote","sanction","nato","pope","supreme court"] },
    TECH:     { priority: 3, keywords: ["ai ","artificial intelligence","openai","gpt","google","apple","microsoft","meta","tesla","nvidia","chip","semiconductor","amazon","ipo","gta","rockstar","spacex","elon"] },
    SPORTS:   { priority: 4, keywords: [
        "nba","nfl","nhl","mlb","super bowl","stanley cup","playoffs",
        "basketball","baseball","hockey","ufc","mma","tennis","golf","boxing",
        "f1","formula 1","formula one","nascar","olympics",
        "premier league","championship","league one","league two","efl",
        "champions league","ucl","europa league","uel","conference league",
        "la liga","bundesliga","serie a","ligue 1","eredivisie","primeira liga",
        "super lig","scottish premiership","mls","a-league",
        "world cup","euro 2026","euros","nations league","copa america","afcon",
        "gold cup","concacaf","copa del rey","dfb pokal","coupe de france",
        "coppa italia","fa cup","carabao cup","scottish cup",
        "relegation","promotion","top scorer","golden boot","ballon d'or",
        "win the league","win the cup","win the title","qualify for",
        "arsenal","chelsea","manchester","liverpool","tottenham","everton",
        "aston villa","newcastle","west ham","leicester","brighton","fulham",
        "real madrid","barcelona","atletico","sevilla","valencia","villarreal",
        "bayern","dortmund","rb leipzig","leverkusen","frankfurt",
        "juventus","inter milan","ac milan","napoli","roma","lazio","fiorentina",
        "psg","marseille","lyon","monaco","nice","lille","rennes",
        "porto","benfica","sporting cp","braga",
        "ajax","psv","feyenoord","celtic","rangers",
        "galatasaray","fenerbahce","besiktas",
        "flamengo","palmeiras","river plate","boca juniors",
        "al-hilal","al-nassr","al-ahly",
        "messi","ronaldo","mbappe","haaland","vinicius","bellingham","salah","kane"
    ] }
};

function categorizeMarket(question) {
    const lower = question.toLowerCase();
    for (const [category, config] of Object.entries(CATEGORIES)) {
        if (config.keywords.some(kw => lower.includes(kw))) return { category, priority: config.priority };
    }
    return { category: "OTHER", priority: 5 };
}

// ─── CORE AI ANALYST WITH LIVE WEB SEARCH ────────────────
// Gemini searches the web in real time before estimating probability.
// No hardcoded context — everything comes from current search results.
// This means Haaland goal tallies, injury news, election polls,
// crypto prices — all fetched live before each decision.

async function estimateFairValue(question, betSide, marketPrice, bookmakerProb, category) {
    try {
        const today = new Date().toISOString().split("T")[0];

        const prompt = `You are an expert prediction market trader. Today is ${today}.

TASK: Search the web for current, real-world information about this market, then determine if it is mispriced.

MARKET: "${question}"
Current Polymarket price: ${marketPrice}¢ (= ${marketPrice}% implied probability)
Proposed bet: ${betSide}
Category: ${category}
${bookmakerProb ? `Sportsbook consensus: ${bookmakerProb}%` : ""}

STEP 1 — SEARCH: Look up current facts relevant to this question. Search for:
- Current status/standings/scores/polls relevant to the outcome
- Recent news that affects the probability
- Any injuries, disqualifications, rule changes, or events that shift the odds

STEP 2 — REALITY CHECK: Based on what you found:
- Is this outcome actually likely given current real-world conditions?
- What would have to happen for ${betSide} to resolve correctly?
- Is the market price reasonable or clearly wrong?

STEP 3 — EDGE ANALYSIS:
- INFORMATION EDGE: Recent news not yet priced in
- OVERREACTION: Market emotionally moved by news
- TIME_BASED: Probability converging as resolution nears
- LOW_LIQUIDITY: Poorly informed market
- MEAN_REVERSION: Extreme move without justification

STEP 4 — TRADE DECISION:
- QUICK_FLIP: Resolution in hours/days, 40-60% return potential
- HOLD: Resolution in weeks, solid edge
- AVOID: Too uncertain or no real edge

STRICT REJECTION RULES — output SKIP if any apply:
- You could not find relevant current information
- Outcome is technically possible but practically very unlikely
- Edge is under 10% after accounting for real-world facts
- Resolution conditions are ambiguous
- Market is above 90% or below 10% (unless edge is overwhelming)

Capital is only $5 per trade. Be conservative and skeptical. No forced trades.

Respond ONLY in this exact JSON format (no markdown):
{
  "fairValue": <your estimated true probability 0-100>,
  "edge": <fairValue minus ${marketPrice}>,
  "edgeType": "<INFORMATION|OVERREACTION|TIME_BASED|LOW_LIQUIDITY|MEAN_REVERSION>",
  "confidence": <1-10>,
  "verdict": "BET THIS" or "SKIP",
  "tradeAction": "QUICK_FLIP" or "HOLD" or "AVOID",
  "riskLevel": "LOW" or "MEDIUM" or "HIGH",
  "realityCheck": "<what you found when you searched — specific facts that support your estimate>",
  "expectedMove": "<e.g. 40% → 55%>",
  "reasoning": "<2-3 sentences: what the market is missing and why your estimate is more accurate>"
}`;

        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                contents: [{ parts: [{ text: prompt }] }],
                // Enable Google Search grounding — Gemini searches web before responding
                tools: [{ google_search: {} }],
                generationConfig: { temperature: 0.15, maxOutputTokens: 500 }
            },
            { headers: { "Content-Type": "application/json" }, timeout: 25000 }
        );

        // Extract text — may come from text block or after tool use
        const parts = response.data?.candidates?.[0]?.content?.parts || [];
        const raw   = parts.map(p => p.text || "").join("").trim();
        if (!raw) return null;

        const clean = raw.replace(/```json|```/g, "").trim();

        // Find JSON in the response
        const jsonMatch = clean.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;

        const p = JSON.parse(jsonMatch[0]);

        if (!p || p.verdict !== "BET THIS")  return null;
        if (p.edge < 10)                     return null;
        if (p.confidence < 6)                return null;
        if (p.tradeAction === "AVOID")        return null;

        return {
            fairValue:    Math.round(p.fairValue),
            edge:         Math.round(p.edge * 10) / 10,
            edgeType:     p.edgeType     || "UNKNOWN",
            confidence:   p.confidence,
            verdict:      p.verdict,
            tradeAction:  p.tradeAction  || "HOLD",
            riskLevel:    p.riskLevel    || "MEDIUM",
            realityCheck: p.realityCheck || "",
            expectedMove: p.expectedMove || "",
            reasoning:    p.reasoning    || "",
            bookmakerProb
        };

    } catch (err) {
        console.error("[Predictions] AI error:", err.message);
        return null;
    }
}

// ─── BOOKMAKER ODDS ───────────────────────────────────────
async function getBookmakerOdds() {
    const oddsMap = {};
    const sports  = [
        "americanfootball_nfl","basketball_nba","icehockey_nhl",
        "baseball_mlb","soccer_epl","mma_mixed_martial_arts",
        "soccer_uefa_champs_league","soccer_spain_la_liga",
        "soccer_germany_bundesliga","soccer_italy_serie_a",
        "soccer_france_ligue_one","soccer_fifa_world_cup"
    ];

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
        if (regex.test(lower) && name.length > bestLen) {
            bestMatch = prob; bestLen = name.length;
        }
    }
    return bestMatch;
}

// ─── MAIN ─────────────────────────────────────────────────
async function getPredictionSignals() {
    try {
        console.log("[Predictions] Scanning Polymarket with reality-check framework...");

        // Fetch ALL Polymarket markets via true pagination
        const oddsMapPromise = getBookmakerOdds();
        const markets        = [];
        let   offset         = 0;
        const PAGE           = 100;

        while (true) {
            try {
                const res = await axios.get("https://gamma-api.polymarket.com/markets", {
                    params: { active: true, closed: false, limit: PAGE, offset },
                    timeout: 12000
                });
                const page = res.data;
                if (!page || page.length === 0) break;
                markets.push(...page);
                if (page.length < PAGE) break;
                offset += PAGE;
                await new Promise(r => setTimeout(r, 400));
            } catch (err) {
                console.error(`[Predictions] Fetch error at offset ${offset}:`, err.message);
                break;
            }
        }

        const oddsMap = await oddsMapPromise;
        console.log(`[Predictions] Fetched ${markets.length} total markets from Polymarket.`);
        const candidates = [];

        for (const market of markets) {
            if (!market.liquidity || !market.outcomePrices) continue;
            if (parseFloat(market.liquidity) < 3000)       continue;
            if (!market.volume24hr || parseFloat(market.volume24hr) < 200) continue;

            let outcomes = [];
            try { outcomes = JSON.parse(market.outcomePrices); } catch (e) { continue; }

            const yesPrice = parseFloat(outcomes[0]);
            const noPrice  = parseFloat(outcomes[1]);
            if (isNaN(yesPrice) || isNaN(noPrice)) continue;

            // Look for asymmetric bets — 3¢ to 55¢
            let betSide = null, betPrice = null;
            if (yesPrice >= 0.03 && yesPrice <= 0.55)    { betSide = "YES"; betPrice = yesPrice; }
            else if (noPrice >= 0.03 && noPrice <= 0.55) { betSide = "NO";  betPrice = noPrice; }
            if (!betSide) continue;

            const { category, priority } = categorizeMarket(market.question);

            candidates.push({
                question:    market.question,
                betSide,
                marketPrice: Math.round(betPrice * 100),
                betPriceRaw: betPrice,
                payout5:     (5  / betPrice).toFixed(2),
                payout10:    (10 / betPrice).toFixed(2),
                volume24hr:  parseFloat(market.volume24hr || 0).toFixed(0),
                liquidity:   parseFloat(market.liquidity).toFixed(0),
                url:         market.slug ? `https://polymarket.com/event/${market.slug}` : `https://polymarket.com/markets?search=${encodeURIComponent(market.question.slice(0,40))}`,
                category,
                priority
            });
        }

        // Sort by priority then liquidity
        // Sort by category priority then 24h volume — most active markets first
        candidates.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            return parseFloat(b.volume24hr) - parseFloat(a.volume24hr);
        });

        // Top 5 per category, max 25 analyzed
        const toAnalyze = [];
        const catCount  = {};
        for (const m of candidates) {
            catCount[m.category] = catCount[m.category] || 0;
            if (catCount[m.category] < 5) {
                toAnalyze.push(m);
                catCount[m.category]++;
            }
            if (toAnalyze.length >= 25) break;
        }

        console.log(`[Predictions] Analyzing ${toAnalyze.length} markets across: ${Object.keys(catCount).join(", ")}`);

        const results = [];

        for (const market of toAnalyze) {
            const bookmakerProb = findBookmakerProb(market.question, oddsMap);
            const analysis      = await estimateFairValue(
                market.question, market.betSide, market.marketPrice,
                bookmakerProb, market.category
            );

            if (analysis) {
                results.push({ ...market, ...analysis });
                console.log(`[Predictions] ✅ ${market.betSide} "${market.question.slice(0,40)}..." edge:+${analysis.edge}% conf:${analysis.confidence}/10 action:${analysis.tradeAction}`);
            } else {
                console.log(`[Predictions] ❌ Skip: "${market.question.slice(0,40)}..."`);
            }

            await new Promise(r => setTimeout(r, 1200));
        }

        // Sort: quick flips first, then by confidence
        results.sort((a, b) => {
            const actionOrder = { QUICK_FLIP: 0, HOLD: 1 };
            if ((actionOrder[a.tradeAction] || 1) !== (actionOrder[b.tradeAction] || 1)) {
                return (actionOrder[a.tradeAction] || 1) - (actionOrder[b.tradeAction] || 1);
            }
            return b.confidence - a.confidence;
        });

        console.log(`[Predictions] ${results.length} genuine edges found.`);
        return results.slice(0, 3);

    } catch (error) {
        console.error("[Predictions] Error:", error.message);
        return [];
    }
}

module.exports = { getPredictionSignals };