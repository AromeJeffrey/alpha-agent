 const axios = require("axios");

// Alternative.me Fear & Greed Index — completely free, no API key needed
async function getFearAndGreed() {

    try {

        const response = await axios.get(
            "https://api.alternative.me/fng/?limit=1",
            { timeout: 8000 }
        );

        const data  = response.data.data[0];
        const value = parseInt(data.value);
        const label = data.value_classification;

        // Market bias based on Fear & Greed
        let bias         = "";
        let sizeMultiplier = 1.0;

        if (value <= 20) {
            bias           = "EXTREME FEAR — Maximum long opportunity. Increase position size.";
            sizeMultiplier = 1.4; // 40% bigger positions
        } else if (value <= 40) {
            bias           = "FEAR — Good time to accumulate longs. Normal sizing.";
            sizeMultiplier = 1.1;
        } else if (value <= 60) {
            bias           = "NEUTRAL — Trade setups as normal.";
            sizeMultiplier = 1.0;
        } else if (value <= 80) {
            bias           = "GREED — Reduce long size. Start watching for short setups.";
            sizeMultiplier = 0.8;
        } else {
            bias           = "EXTREME GREED — Market is euphoric. Favour shorts. Reduce longs.";
            sizeMultiplier = 0.6;
        }

        return { value, label, bias, sizeMultiplier };

    } catch (error) {
        console.error("Fear & Greed error:", error.message);
        return { value: 50, label: "Neutral", bias: "NEUTRAL — data unavailable.", sizeMultiplier: 1.0 };
    }
}

// Calculate recommended position size based on confidence + Fear & Greed
function getPositionSize(confidence, sizeMultiplier, baseCapital = 25) {

    let base = 0;

    if (confidence >= 90)      base = baseCapital;       // Full size
    else if (confidence >= 80) base = baseCapital * 0.80; // 80%
    else if (confidence >= 70) base = baseCapital * 0.60; // 60%
    else                       return null;               // Skip — too low

    const adjusted = parseFloat((base * sizeMultiplier).toFixed(2));

    // Hard cap at $35 — never risk more than this
    return Math.min(adjusted, 35);
}

module.exports = { getFearAndGreed, getPositionSize };