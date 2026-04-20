const RSSParser     = require("rss-parser");
const axios         = require("axios");
require("dotenv").config();
const { sendAlert } = require("./telegram");

const parser = new RSSParser({ timeout: 8000 });

// In-memory state
const seenHeadlines    = new Set();
const seenStoryKeys    = new Set(); // For cross-source dedup by keywords
const seenTransactions = new Set();
const seenNarratives   = new Set();

const RSS_FEEDS = [
    { name: "CoinTelegraph", url: "https://cointelegraph.com/rss" },
    { name: "Decrypt",       url: "https://decrypt.co/feed" },
    { name: "CoinDesk",      url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
    { name: "The Block",     url: "https://www.theblock.co/rss.xml" }
];

// ─── STRICT BREAKING NEWS FILTER ─────────────────────────
// Only stories that require IMMEDIATE action or awareness
// Editorial content, explainers, opinion = excluded

const BREAKING_KEYWORDS = [
    // Exchange/Protocol critical events
    "exploit", "hack", "hacked", "drained", "stolen", "attack",
    "rug pull", "exit scam", "insolvent", "bankrupt",
    // Regulatory immediate impact
    "sec charges", "sec sues", "cftc charges", "arrested", "indicted",
    "banned", "sanctions", "delisted", "delisting",
    // Major institutional moves
    "etf approved", "etf rejected", "etf launch",
    "blackrock buys", "fidelity buys",
    // Major price events
    "all-time high", "ath", "market crash", "flash crash",
    // Macro immediate impact
    "rate cut", "rate hike", "emergency meeting", "fomc decision",
    // Exchange specific
    "binance", "coinbase", "bybit", "okx", "kraken",
    // Direct crypto critical
    "bitcoin halving", "ethereum upgrade", "hard fork",
    "bridge exploit", "smart contract exploit"
];

// Stories that look crypto-related but are NOT actionable breaking news
const EXCLUDE_PATTERNS = [
    "explains", "explained", "what is", "how to", "guide",
    "opinion:", "analysis:", "weekly", "monthly", "roundup",
    "turns $", "made $", "profits from", // hype/clickbait
    "warns of", "wants retail", "head wants",
    "drug discovery", // OpenAI pharma stuff irrelevant
    "mining difficulty", // not immediately actionable
    "meme coin lawsuit", // legal proceedings, slow moving
    "plebs eat first" // niche mining topic
];

function isGenuineBreakingNews(title) {
    const lower = title.toLowerCase();

    // First check if it matches any exclude patterns
    if (EXCLUDE_PATTERNS.some(p => lower.includes(p))) return false;

    // Must match a genuine breaking keyword
    return BREAKING_KEYWORDS.some(kw => lower.includes(kw));
}

// Generate a story key for cross-source deduplication
// Extracts the core subject so "RAVE pump" from 3 sources = 1 alert
function getStoryKey(title) {
    const lower = title.toLowerCase();
    // Extract key entities/numbers that identify a unique story
    const words = lower
        .replace(/[^a-z0-9\s]/g, "")
        .split(" ")
        .filter(w => w.length > 4) // Only meaningful words
        .slice(0, 4) // First 4 significant words
        .join(" ");
    return words;
}

function isRecentArticle(pubDate) {
    if (!pubDate) return true;
    return new Date(pubDate).getTime() > Date.now() - (2 * 60 * 60 * 1000);
}

async function getAIContext(title, source, retries = 2) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                {
                    contents: [{ parts: [{ text: `Crypto trader perspective. This just broke: "${title}". Write ONE sentence (max 15 words) on the immediate trade implication. Be specific.` }] }],
                    generationConfig: { temperature: 0.3, maxOutputTokens: 50 }
                },
                { headers: { "Content-Type": "application/json" }, timeout: 8000 }
            );
            return response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
        } catch (err) {
            if (err.response?.status === 429 && attempt < retries) {
                await new Promise(r => setTimeout(r, 20000)); // Wait 20s on rate limit
                continue;
            }
            return null; // Fail silently — context is optional
        }
    }
    return null;
}

// ─── NEWS MONITOR ─────────────────────────────────────────

async function checkRSSNews() {
    const newStories = [];

    for (const feed of RSS_FEEDS) {
        try {
            const parsed = await parser.parseURL(feed.url);

            for (const item of parsed.items.slice(0, 10)) {
                const title   = item.title?.trim();
                const pubDate = item.pubDate || item.isoDate;

                if (!title) continue;

                // Time filter first
                if (!isRecentArticle(pubDate)) {
                    seenHeadlines.add(title);
                    continue;
                }

                // Skip if exact headline seen
                if (seenHeadlines.has(title)) continue;
                seenHeadlines.add(title);

                // Cross-source dedup — skip if same story already sent from another source
                const storyKey = getStoryKey(title);
                if (seenStoryKeys.has(storyKey)) continue;

                // Apply strict breaking news filter
                if (!isGenuineBreakingNews(title)) continue;

                seenStoryKeys.add(storyKey);
                newStories.push({ title, source: feed.name, url: item.link });
            }
        } catch (err) {}
    }

    return newStories;
}

// ─── WHALE MONITOR ────────────────────────────────────────

const MONITORED_WALLETS = [
    { label: "Vitalik Buterin", address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
    { label: "Jump Trading",    address: "0x46340b20830761efd32832A74d7169B29FEB9758" }
];

async function checkLargeTransactions() {
    const alerts = [];

    for (const wallet of MONITORED_WALLETS) {
        try {
            const response = await axios.get("https://api.etherscan.io/v2/api", {
                params: {
                    chainid: 1,
                    module:  "account",
                    action:  "txlist",
                    address: wallet.address,
                    page:    1,
                    offset:  10,
                    sort:    "desc",
                    apikey:  process.env.ETHERSCAN_API_KEY
                },
                timeout: 8000
            });

            const txs = response.data.result;
            if (!Array.isArray(txs)) continue;

            const twentyMinsAgo = Math.floor(Date.now() / 1000) - 1200;

            for (const tx of txs) {
                if (parseInt(tx.timeStamp) < twentyMinsAgo) continue;
                if (seenTransactions.has(tx.hash))          continue;

                const ethValue = parseInt(tx.value) / 1e18;
                if (ethValue < 50) continue;

                seenTransactions.add(tx.hash);

                const direction = tx.from.toLowerCase() === wallet.address.toLowerCase()
                    ? "SENT" : "RECEIVED";

                alerts.push({
                    label:    wallet.label,
                    address:  wallet.address.slice(0, 6) + "..." + wallet.address.slice(-4),
                    ethValue: ethValue.toFixed(2),
                    direction,
                    url:      `https://etherscan.io/tx/${tx.hash}`
                });
            }

            await new Promise(r => setTimeout(r, 400));
        } catch (err) {}
    }

    return alerts;
}

// ─── NARRATIVE TRADE ALERTS ───────────────────────────────

async function checkNarrativeSignals() {
    try {
        const trendRes = await axios.get(
            "https://api.coingecko.com/api/v3/search/trending",
            { timeout: 8000 }
        );

        const trending = trendRes.data.coins.map(c => ({
            id:     c.item.id,
            name:   c.item.name,
            symbol: c.item.symbol.toUpperCase()
        }));

        const ids    = trending.map(c => c.id).join(",");
        const mktRes = await axios.get(
            "https://api.coingecko.com/api/v3/coins/markets",
            {
                params: { vs_currency: "usd", ids, sparkline: false },
                timeout: 8000
            }
        );

        const marketData = mktRes.data;
        const avgVolume  = marketData.reduce((s, c) => s + (c.total_volume || 0), 0) / (marketData.length || 1);
        const alerts     = [];

        for (const coin of marketData) {
            const symbol      = coin.symbol.toUpperCase();
            const volumeRatio = (coin.total_volume || 0) / avgVolume;
            const change      = coin.price_change_percentage_24h || 0;

            if (seenNarratives.has(symbol))              continue;
            if (volumeRatio < 2.0)                       continue;
            if (change > 25 || change < -20)             continue;

            seenNarratives.add(symbol);

            const price      = coin.current_price;
            const stopLoss   = parseFloat((price * 0.94).toFixed(8));
            const takeProfit = parseFloat((price * 1.30).toFixed(8));

            alerts.push({
                name: coin.name, symbol, price,
                change: change.toFixed(2),
                volumeRatio: volumeRatio.toFixed(1),
                stopLoss, takeProfit,
                marketCap: coin.market_cap
            });
        }

        return alerts;
    } catch (err) {
        return [];
    }
}

// ─── MAIN ─────────────────────────────────────────────────

async function checkForNews() {

    const [urgent, whaleAlerts, narrativeAlerts] = await Promise.all([
        checkRSSNews(),
        checkLargeTransactions(),
        checkNarrativeSignals()
    ]);

    // Breaking news alerts
    for (const story of urgent) {
        const context = await getAIContext(story.title, story.source);
        let message   = `🔴 *BREAKING*\n\n${story.title}\nSource: ${story.source}\n`;
        if (context)   message += `\n⚡ ${context}\n`;
        if (story.url) message += `\n🔗 ${story.url}`;
        await sendAlert(message);
        await new Promise(r => setTimeout(r, 1000));
    }

    // Whale alerts
    for (const alert of whaleAlerts) {
        let message = `🐋 *WHALE ALERT*\n\n`;
        message += `${alert.label} (${alert.address})\n`;
        message += `${alert.direction}: ${alert.ethValue} ETH\n`;
        message += `⚡ Large on-chain movement — watch for price impact\n`;
        message += `🔗 ${alert.url}`;
        await sendAlert(message);
        await new Promise(r => setTimeout(r, 1000));
    }

    // Narrative trade alerts
    for (const coin of narrativeAlerts) {
        let message = `🔥 *NARRATIVE TRADE ALERT*\n\n`;
        message += `*${coin.name} (${coin.symbol})*\n`;
        message += `Trending + ${coin.volumeRatio}x volume\n`;
        message += `Price: $${coin.price} | 24h: ${coin.change}%\n`;
        message += `MCap: $${(coin.marketCap/1e6).toFixed(0)}M\n\n`;
        message += `🟢 LONG SETUP\n`;
        message += `Entry: $${coin.price}\n`;
        message += `Stop Loss: $${coin.stopLoss}\n`;
        message += `Take Profit: $${coin.takeProfit} (+30%)\n`;
        message += `💬 Trending with volume confirmation — watch for parabolic move.`;
        await sendAlert(message);
        await new Promise(r => setTimeout(r, 1000));
    }

    const total = urgent.length + whaleAlerts.length + narrativeAlerts.length;
    if (total > 0) {
        console.log(`[${new Date().toISOString()}] Alerts — News: ${urgent.length} | Whale: ${whaleAlerts.length} | Narrative: ${narrativeAlerts.length}`);
    }
}

module.exports = { checkForNews };