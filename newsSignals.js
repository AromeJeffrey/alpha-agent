const RSSParser = require("rss-parser");
const parser    = new RSSParser({ timeout: 8000 });

const FEEDS = [
    { name: "CoinTelegraph", url: "https://cointelegraph.com/rss" },
    { name: "Decrypt",       url: "https://decrypt.co/feed" },
    { name: "CoinDesk",      url: "https://www.coindesk.com/arc/outboundfeeds/rss/" }
];

async function getNewsSignals() {
    const headlines = [];

    for (const feed of FEEDS) {
        try {
            const parsed = await parser.parseURL(feed.url);
            const item   = parsed.items[0];
            if (item?.title) {
                headlines.push({ title: item.title, source: feed.name, url: item.link });
            }
        } catch (err) {}
    }

    return headlines;
}

module.exports = { getNewsSignals };