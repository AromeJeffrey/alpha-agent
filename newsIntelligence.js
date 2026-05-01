const RSSParser     = require("rss-parser");
const axios         = require("axios");
require("dotenv").config();

const parser = new RSSParser({ timeout: 8000 });

// ─── CLASSIFICATION ENGINE ────────────────────────────────
// Every news item gets one of 4 decisions:
// TRADE THIS  — direct perps opportunity right now
// BET THIS    — Polymarket opportunity
// WATCH THIS  — relevant context, no immediate action
// IGNORE THIS — filtered out, never shown

const RSS_FEEDS = [
    { name: "CoinTelegraph", url: "https://cointelegraph.com/rss" },
    { name: "Decrypt",       url: "https://decrypt.co/feed" },
    { name: "CoinDesk",      url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
    { name: "The Block",     url: "https://www.theblock.co/rss.xml" }
];

// TRADE THIS — creates an immediate perps opportunity
const TRADE_TRIGGERS = [
    // Exchange events — direct price impact
    "listed on binance", "listed on coinbase", "listed on bybit",
    "listed on okx", "new listing", "delisted", "trading suspended",
    // Exploits — short the asset
    "exploit", "hacked", "drained", "bridge attack", "reentrancy",
    "smart contract bug", "protocol exploit",
    // ETF decisions — long BTC/ETH
    "etf approved", "etf rejected", "etf launch", "spot etf",
    // Token unlock — potential sell pressure
    "token unlock", "cliff unlock", "vesting",
    // Macro immediate
    "rate cut", "rate hike", "fomc decision", "fed cuts", "fed hikes",
    "emergency rate cut",
    // Whale accumulation
    "buys bitcoin", "buys eth", "strategic reserve",
    "blackrock buys", "fidelity buys", "adds bitcoin",
];

// BET THIS — creates a Polymarket opportunity
const BET_TRIGGERS = [
    // Regulatory outcomes
    "sec approves", "sec rejects", "court rules", "judge orders",
    "lawsuit settled", "charges dropped", "verdict",
    // Political/macro outcomes
    "election", "vote passed", "bill signed", "executive order",
    "tariff decision", "sanctions",
    // Protocol/ecosystem events
    "mainnet launch", "mainnet live", "protocol launch",
    "merger", "acquisition", "partnership announced",
    // Legal
    "bankruptcy filed", "chapter 11", "arrested", "indicted",
    // Prediction specific
    "polymarket", "prediction market",
];

// WATCH THIS — context but no immediate action
const WATCH_TRIGGERS = [
    // Regulatory pipeline
    "sec considers", "regulation proposed", "bill introduced",
    "congressional hearing", "cbdc",
    // Macro context
    "inflation data", "cpi", "gdp", "unemployment",
    "fed minutes", "powell speech",
    // Ecosystem development
    "raises $", "series a", "series b", "funding round",
    "ecosystem fund", "grant program",
    // Protocol development
    "upgrade scheduled", "testnet", "audit complete",
    "roadmap", "whitepaper",
    // Institutional
    "institutional interest", "hedge fund", "family office",
];

// Hard exclude — never process
const IGNORE_PATTERNS = [
    "explains", "explained", "what is", "how to", "guide",
    "opinion", "analysis:", "weekly", "monthly", "roundup",
    "here's what happened", "market wrap", "price prediction",
    "technical analysis", "on-chain analysis",
    "turns $", "trader makes", "profits from",
    "celebrity", "nft sale", "nft drop",
    "mining difficulty", "hashrate",
    "quantum", "drug discovery",
    "climate", "sustainability",
    "could", "might", "may rally", "could surge",
];

function classifyNews(title) {
    const lower = title.toLowerCase();

    // Hard exclude first
    if (IGNORE_PATTERNS.some(p => lower.includes(p))) return "IGNORE";

    // Classify by impact
    if (TRADE_TRIGGERS.some(p => lower.includes(p))) return "TRADE THIS";
    if (BET_TRIGGERS.some(p => lower.includes(p)))   return "BET THIS";
    if (WATCH_TRIGGERS.some(p => lower.includes(p))) return "WATCH THIS";

    // Default ignore anything not explicitly matched
    return "IGNORE";
}

// Determine which coin/asset is affected
function extractAffectedAsset(title) {
    const lower = title.toLowerCase();
    const assets = [
        { symbol: "BTC",  names: ["bitcoin", "btc"] },
        { symbol: "ETH",  names: ["ethereum", "eth"] },
        { symbol: "SOL",  names: ["solana", "sol"] },
        { symbol: "BNB",  names: ["bnb", "binance coin"] },
        { symbol: "XRP",  names: ["xrp", "ripple"] },
        { symbol: "ADA",  names: ["cardano", "ada"] },
        { symbol: "MATIC",names: ["polygon", "matic"] },
        { symbol: "AVAX", names: ["avalanche", "avax"] },
        { symbol: "LINK", names: ["chainlink", "link"] },
        { symbol: "UNI",  names: ["uniswap", "uni"] },
        { symbol: "AAVE", names: ["aave"] },
        { symbol: "DOT",  names: ["polkadot", "dot"] },
        { symbol: "ATOM", names: ["cosmos", "atom"] },
        { symbol: "NEAR", names: ["near protocol", "near"] },
        { symbol: "ARB",  names: ["arbitrum", "arb"] },
        { symbol: "OP",   names: ["optimism", " op "] },
    ];

    for (const asset of assets) {
        if (asset.names.some(n => lower.includes(n))) return asset.symbol;
    }
    return "MARKET"; // Broad market impact
}

// Determine expected price direction
function getPriceDirection(title, classification) {
    const lower = title.toLowerCase();

    if (classification === "TRADE THIS") {
        // Positive catalysts
        if (lower.includes("approved") || lower.includes("listed on") ||
            lower.includes("buys") || lower.includes("rate cut")) return "BULLISH";
        // Negative catalysts
        if (lower.includes("exploit") || lower.includes("hack") ||
            lower.includes("delisted") || lower.includes("rate hike") ||
            lower.includes("rejected") || lower.includes("banned")) return "BEARISH";
    }

    return "NEUTRAL";
}

async function getNewsDecision(title, source, classification, asset, direction) {
    try {
        const dirContext = direction !== "NEUTRAL"
            ? `Expected price impact: ${direction} for ${asset}`
            : "";

        const actionMap = {
            "TRADE THIS": "What exact perps trade does this create? LONG or SHORT which asset, entry zone, and why.",
            "BET THIS":   "What Polymarket market does this create or affect? Which side to bet and why.",
            "WATCH THIS": "What should a trader monitor after this? One sentence on the key thing to track."
        };

        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                contents: [{ parts: [{ text: `Professional crypto alpha desk. News: "${title}" (${source}). Classification: ${classification}. ${dirContext}\n\n${actionMap[classification]}\n\nMax 20 words. Be specific and direct.` }] }],
                generationConfig: { temperature: 0.2, maxOutputTokens: 60 }
            },
            { headers: { "Content-Type": "application/json" }, timeout: 8000 }
        );

        return response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    } catch (err) {
        return null;
    }
}

// ─── MAIN FETCH AND CLASSIFY ──────────────────────────────

const seenHeadlines = new Set();
const seenStoryKeys = new Set();

function getStoryKey(title) {
    return title.toLowerCase().replace(/[^a-z0-9\s]/g, "")
        .split(" ").filter(w => w.length > 4).slice(0, 4).join(" ");
}

function isRecent(pubDate) {
    if (!pubDate) return true;
    return new Date(pubDate).getTime() > Date.now() - (2 * 60 * 60 * 1000);
}

async function fetchAndClassifyNews() {
    const classified = { TRADE: [], BET: [], WATCH: [] };

    for (const feed of RSS_FEEDS) {
        try {
            const parsed = await parser.parseURL(feed.url);

            for (const item of parsed.items.slice(0, 10)) {
                const title   = item.title?.trim();
                const pubDate = item.pubDate || item.isoDate;

                if (!title)                      continue;
                if (!isRecent(pubDate))          { seenHeadlines.add(title); continue; }
                if (seenHeadlines.has(title))    continue;
                seenHeadlines.add(title);

                const storyKey = getStoryKey(title);
                if (seenStoryKeys.has(storyKey)) continue;

                const classification = classifyNews(title);
                if (classification === "IGNORE") continue;

                seenStoryKeys.add(storyKey);

                const asset     = extractAffectedAsset(title);
                const direction = getPriceDirection(title, classification);
                const decision  = await getNewsDecision(title, feed.name, classification, asset, direction);

                const story = {
                    title,
                    source:   feed.name,
                    url:      item.link,
                    classification,
                    asset,
                    direction,
                    decision
                };

                if (classification === "TRADE THIS") classified.TRADE.push(story);
                else if (classification === "BET THIS") classified.BET.push(story);
                else if (classification === "WATCH THIS") classified.WATCH.push(story);
            }
        } catch (err) {}
    }

    return classified;
}

// For the scheduled news monitor (15-min alerts)
const { sendAlert } = require("./telegram");
const seenTx        = new Set();
const seenNarrative = new Set();

const MONITORED_WALLETS = [
    { label: "Vitalik Buterin", address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
    { label: "Jump Trading",    address: "0x46340b20830761efd32832A74d7169B29FEB9758" }
];

async function checkWhales() {
    const alerts = [];
    for (const wallet of MONITORED_WALLETS) {
        try {
            const res = await axios.get("https://api.etherscan.io/v2/api", {
                params: { chainid: 1, module: "account", action: "txlist", address: wallet.address, page: 1, offset: 10, sort: "desc", apikey: process.env.ETHERSCAN_API_KEY },
                timeout: 8000
            });
            const txs    = Array.isArray(res.data.result) ? res.data.result : [];
            const cutoff = Math.floor(Date.now() / 1000) - 1200;

            for (const tx of txs) {
                if (parseInt(tx.timeStamp) < cutoff) continue;
                if (seenTx.has(tx.hash)) continue;
                const eth = parseInt(tx.value) / 1e18;
                if (eth < 50) continue;
                seenTx.add(tx.hash);
                const dir = tx.from.toLowerCase() === wallet.address.toLowerCase() ? "SENT" : "RECEIVED";
                alerts.push({ label: wallet.label, address: wallet.address.slice(0,6)+"..."+wallet.address.slice(-4), eth: eth.toFixed(2), dir, url: `https://etherscan.io/tx/${tx.hash}` });
            }
            await new Promise(r => setTimeout(r, 400));
        } catch (err) {}
    }
    return alerts;
}

async function checkNarrativeSignals() {
    try {
        const { isBlacklisted } = require("./confluence");
        const tRes  = await axios.get("https://api.coingecko.com/api/v3/search/trending", { timeout: 8000 });
        const coins = tRes.data.coins.map(c => ({ id: c.item.id, name: c.item.name, symbol: c.item.symbol.toUpperCase() }));
        const ids   = coins.map(c => c.id).join(",");
        const mRes  = await axios.get("https://api.coingecko.com/api/v3/coins/markets", { params: { vs_currency: "usd", ids, sparkline: false }, timeout: 8000 });
        const mkts  = mRes.data;
        const avg   = mkts.reduce((s, c) => s + (c.total_volume || 0), 0) / (mkts.length || 1);
        const alerts = [];

        for (const coin of mkts) {
            const sym = coin.symbol.toUpperCase();
            const vr  = (coin.total_volume || 0) / avg;
            const ch  = coin.price_change_percentage_24h || 0;
            if (seenNarrative.has(sym))    continue;
            if (vr < 2.5)                  continue;
            if (ch > 30 || ch < -20)       continue;
            if (isBlacklisted(sym, coin.name)) continue;
            seenNarrative.add(sym);
            const p = coin.current_price;
            alerts.push({ name: coin.name, symbol: sym, price: p, change: ch.toFixed(2), volumeRatio: vr.toFixed(1), stopLoss: parseFloat((p*0.94).toFixed(8)), takeProfit: parseFloat((p*1.30).toFixed(8)), mcap: coin.market_cap });
        }
        return alerts;
    } catch (err) { return []; }
}

async function checkForNews() {
    const classified  = await fetchAndClassifyNews();
    const whales      = await checkWhales();
    const narratives  = await checkNarrativeSignals();

    // Send TRADE THIS alerts
    for (const story of classified.TRADE) {
        let msg = `⚡ *TRADE CATALYST*\n\n`;
        msg += `*${story.classification}*\n`;
        msg += `${story.title}\nSource: ${story.source}\n`;
        msg += `Asset: ${story.asset} | Direction: ${story.direction}\n`;
        if (story.decision) msg += `\n🎯 ${story.decision}`;
        if (story.url) msg += `\n🔗 ${story.url}`;
        await sendAlert(msg);
        await new Promise(r => setTimeout(r, 2000));
    }

    // Send BET THIS alerts
    for (const story of classified.BET) {
        let msg = `🎯 *BET CATALYST*\n\n`;
        msg += `${story.title}\nSource: ${story.source}\n`;
        if (story.decision) msg += `\n💬 ${story.decision}`;
        if (story.url) msg += `\n🔗 ${story.url}`;
        await sendAlert(msg);
        await new Promise(r => setTimeout(r, 2000));
    }

    // Send whale alerts
    for (const w of whales) {
        const msg = `🐋 *WHALE ALERT*\n\n${w.label} (${w.address})\n${w.dir}: ${w.eth} ETH\n⚡ Monitor for price impact\n🔗 ${w.url}`;
        await sendAlert(msg);
        await new Promise(r => setTimeout(r, 1000));
    }

    // Send narrative signals
    for (const coin of narratives) {
        let msg = `🔥 *NARRATIVE SIGNAL*\n\n`;
        msg += `*${coin.name} (${coin.symbol})*\n`;
        msg += `Trending + ${coin.volumeRatio}x volume | $${(coin.mcap/1e6).toFixed(0)}M mcap\n`;
        msg += `Price: $${coin.price} | 24h: ${coin.change}%\n\n`;
        msg += `🟢 LONG | Entry: $${coin.price} | SL: $${coin.stopLoss} | TP: $${coin.takeProfit}\n`;
        msg += `💬 Trending + volume = watch for parabolic.`;
        await sendAlert(msg);
        await new Promise(r => setTimeout(r, 1000));
    }

    const total = classified.TRADE.length + classified.BET.length + whales.length + narratives.length;
    if (total > 0) {
        console.log(`[${new Date().toISOString()}] Intel — Trade: ${classified.TRADE.length} | Bet: ${classified.BET.length} | Whale: ${whales.length} | Narrative: ${narratives.length}`);
    }

    // Return classified news for use in main report
    return classified;
}

async function buildNewsBaseline() {
    for (const feed of RSS_FEEDS) {
        try {
            const parsed = await parser.parseURL(feed.url);
            parsed.items.slice(0, 15).forEach(item => {
                if (item.title) {
                    seenHeadlines.add(item.title.trim());
                    seenStoryKeys.add(getStoryKey(item.title.trim()));
                }
            });
        } catch (err) {}
    }
    console.log(`[News] Baseline built — ${seenHeadlines.size} headlines cached.`);
}

module.exports = { fetchAndClassifyNews, checkForNews, buildNewsBaseline };
