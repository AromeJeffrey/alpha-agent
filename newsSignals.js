const RSSParser = require("rss-parser");

const parser = new RSSParser({ timeout: 8000 });

const RSS_FEEDS = [
    { name: "CoinTelegraph", url: "https://cointelegraph.com/rss" },
    { name: "Decrypt",       url: "https://decrypt.co/feed" },
    { name: "CoinDesk",      url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
    { name: "The Block",     url: "https://www.theblock.co/rss.xml" }
];

async function getNewsSignals() {

    const articles = [];

    for (const feed of RSS_FEEDS) {
        try {
            const parsed = await parser.parseURL(feed.url);
            const latest = parsed.items.slice(0, 3).map(item => ({
                title:  item.title,
                source: feed.name,
                url:    item.link
            }));
            articles.push(...latest);
        } catch (err) {
            console.error(`RSS error (${feed.name}):`, err.message);
        }
    }

    // Deduplicate by title
    const seen   = new Set();
    const unique = [];

    for (const article of articles) {
        const key = article.title?.toLowerCase().trim();
        if (key && !seen.has(key)) {
            seen.add(key);
            unique.push(article);
        }
    }

    return unique.slice(0, 6);
}

module.exports = { getNewsSignals };