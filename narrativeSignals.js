const axios = require("axios");

async function getNarrativeSignals() {
    try {
        const res  = await axios.get("https://api.coingecko.com/api/v3/search/trending", { timeout: 8000 });
        const coins = res.data.coins.map(c => ({
            id:     c.item.id,
            name:   c.item.name,
            symbol: c.item.symbol.toUpperCase()
        }));
        return coins;
    } catch (err) {
        console.error("[Narrative] Failed:", err.message);
        return [];
    }
}

module.exports = { getNarrativeSignals };