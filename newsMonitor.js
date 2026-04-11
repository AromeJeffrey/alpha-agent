const fs        = require("fs");
const path      = require("path");
const RSSParser = require("rss-parser");
const axios     = require("axios");
const { sendAlert } = require("./telegram");

const parser    = new RSSParser({ timeout: 8000 });
const SEEN_FILE = path.join(__dirname, "seenHeadlines.json");

const RSS_FEEDS = [
    { name: "CoinTelegraph", url: "https://cointelegraph.com/rss" },
    { name: "Decrypt",       url: "https://decrypt.co/feed" },
    { name: "CoinDesk",      url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
    { name: "The Block",     url: "https://www.theblock.co/rss.xml" }
];

// Keywords that make a story worth alerting on immediately
const HIGH_PRIORITY_KEYWORDS = [
    "hack", "exploit", "breach", "stolen", "rug",
    "sec", "lawsuit", "ban", "banned", "arrest",
    "etf", "approval", "approved", "rejected",
    "federal reserve", "fed ", "interest rate",
    "blackrock", "fidelity", "coinbase", "binance",
    "bitcoin", "ethereum", "solana",
    "crash", "collapse", "bankrupt", "insolvent",
    "breaking", "urgent", "flash"
];

function loadSeenHeadlines() {
    try {
        if (fs.existsSync(SEEN_FILE)) {
            const data = fs.readFileSync(SEEN_FILE, "utf8");
            return new Set(JSON.parse(data));
        }
    } catch (e) {
        console.error("Error loading seen headlines:", e.message);
    }
    return new Set();
}

function saveSeenHeadlines(seen) {
    try {
        // Keep only the last 500 headlines to prevent file growing forever
        const arr = Array.from(seen).slice(-500);
        fs.writeFileSync(SEEN_FILE, JSON.stringify(arr), "utf8");
    } catch (e) {
        console.error("Error saving seen headlines:", e.message);
    }
}

function isHighPriority(title) {
    const lower = title.toLowerCase();
    return HIGH_PRIORITY_KEYWORDS.some(keyword => lower.includes(keyword));
}

async function getAIContext(title, source) {
    try {
        const response = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.1-8b-instant",
                messages: [
                    {
                        role: "system",
                        content: `You are a crypto market analyst. When given a news headline, 
give a single sentence (max 20 words) explaining why it matters to crypto traders right now. 
Be direct and specific. No fluff.`
                    },
                    {
                        role: "user",
                        content: `Headline: "${title}" from ${source}. Why does this matter?`
                    }
                ],
                max_tokens: 60,
                temperature: 0.5
            },
            {
                headers: {
                    "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                    "Content-Type":  "application/json"
                },
                timeout: 8000
            }
        );

        return response.data.choices[0].message.content.trim();

    } catch (err) {
        return null;
    }
}

async function checkForNews() {

    const seen     = loadSeenHeadlines();
    const newStories = [];

    for (const feed of RSS_FEEDS) {
        try {
            const parsed = await parser.parseURL(feed.url);

            for (const item of parsed.items.slice(0, 10)) {
                const title = item.title?.trim();
                if (!title || seen.has(title)) continue;

                seen.add(title);
                newStories.push({
                    title,
                    source:   feed.name,
                    url:      item.link,
                    priority: isHighPriority(title)
                });
            }

        } catch (err) {
            // Silent fail — don't spam console every 15 mins
        }
    }

    saveSeenHeadlines(seen);

    // Only alert on high priority stories
    const urgent = newStories.filter(s => s.priority);

    for (const story of urgent) {

        const context = await getAIContext(story.title, story.source);

        let message = `🔴 *BREAKING NEWS*\n\n`;
        message += `${story.title}\n`;
        message += `Source: ${story.source}\n`;
        if (context) {
            message += `\n⚡ *Why it matters:* ${context}\n`;
        }
        if (story.url) {
            message += `\n🔗 ${story.url}`;
        }

        await sendAlert(message);

        // Small delay between multiple alerts
        await new Promise(r => setTimeout(r, 1000));
    }

    if (urgent.length > 0) {
        console.log(`[${new Date().toISOString()}] Sent ${urgent.length} breaking news alert(s).`);
    }
}

module.exports = { checkForNews };