const axios = require("axios");

async function getVolumeSignals() {
    try {
        const response = await axios.get(
            "https://api.coingecko.com/api/v3/coins/markets",
            {
                params: {
                    vs_currency: "usd",
                    order: "volume_desc",
                    per_page: 20,
                    page: 1,
                    sparkline: false
                }
            }
        );

        const coins = response.data;

        const signals = coins
            .filter(coin => coin.price_change_percentage_24h > 5)
            .slice(0, 5)
            .map(coin => ({
                name: coin.name,
                symbol: coin.symbol.toUpperCase(),
                price: coin.current_price,
                change: coin.price_change_percentage_24h
            }));

        return signals;

    } catch (error) {
        console.error("Error fetching signals:", error.message);
        return [];
    }
}

module.exports = { getVolumeSignals };