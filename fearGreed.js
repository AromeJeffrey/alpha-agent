const axios = require("axios");

async function getFearAndGreed() {
    try {
        const res = await axios.get(
            "https://api.alternative.me/fng/?limit=1",
            { timeout: 8000 }
        );

        const data  = res.data.data[0];
        const value = parseInt(data.value);
        const label = data.value_classification;

        let bias = "";
        if (value <= 20)      bias = "Extreme Fear — contrarian long opportunities";
        else if (value <= 40) bias = "Fear — favor longs on quality setups";
        else if (value <= 60) bias = "Neutral — trade setups on individual merit";
        else if (value <= 80) bias = "Greed — caution on longs, watch for tops";
        else                  bias = "Extreme Greed — favor shorts on rejections";

        return { value, label, bias };

    } catch (err) {
        console.error("[F&G] Failed to fetch:", err.message);
        return { value: 50, label: "Neutral", bias: "Neutral — trade setups on individual merit" };
    }
}

module.exports = { getFearAndGreed };