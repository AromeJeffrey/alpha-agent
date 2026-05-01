const axios = require("axios");

async function getNFTSignals() {

    try {

        // Free endpoint — NFT-related tokens sorted by volume
        const response = await axios.get(
            "https://api.coingecko.com/api/v3/coins/markets",
            {
                params: {
                    vs_currency:   "usd",
                    category:      "non-fungible-tokens-nft",
                    order:         "volume_desc",
                    per_page:      20,
                    page:          1,
                    sparkline:     false
                }
            }
        );

        const coins = response.data;

        // Only flag tokens showing real movement
        const signals = coins
            .filter(coin => {
                const change = coin.price_change_percentage_24h;
                return change !== null && Math.abs(change) > 8;
            })
            .slice(0, 5)
            .map(coin => ({
                name:        coin.name,
                symbol:      coin.symbol.toUpperCase(),
                price:       coin.current_price,
                change24h:   coin.price_change_percentage_24h?.toFixed(2) + "%",
                volume24h:   "$" + Number(coin.total_volume).toLocaleString(),
                marketCap:   "$" + Number(coin.market_cap).toLocaleString()
            }));

        return signals;

    } catch (error) {
        console.error("NFT signal error:", error.message);
        return [];
    }
}

module.exports = { getNFTSignals };