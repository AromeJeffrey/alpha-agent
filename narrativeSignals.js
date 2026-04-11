const axios = require("axios");

async function getNarrativeSignals() {

    try {

        const response = await axios.get(
            "https://api.coingecko.com/api/v3/search/trending"
        );

        const coins = response.data.coins;

        const narratives = coins.map(c => ({
            name: c.item.name,
            symbol: c.item.symbol,
            score: c.item.score
        }));

        return narratives.slice(0, 5);

    } catch (error) {

        console.error("Narrative detection error:", error.message);
        return [];

    }
}

module.exports = { getNarrativeSignals };