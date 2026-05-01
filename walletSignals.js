const axios = require("axios");
require("dotenv").config();

const MONITORED_WALLETS = [
    { label: "Vitalik Buterin", address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
    { label: "Jump Trading",    address: "0x46340b20830761efd32832A74d7169B29FEB9758" }
];

async function getWalletSignals() {
    const results = [];

    for (const wallet of MONITORED_WALLETS) {
        try {
            const res = await axios.get("https://api.etherscan.io/v2/api", {
                params: {
                    chainid: 1,
                    module:  "account",
                    action:  "balance",
                    address: wallet.address,
                    tag:     "latest",
                    apikey:  process.env.ETHERSCAN_API_KEY
                },
                timeout: 8000
            });

            const ethBalance = (parseInt(res.data.result) / 1e18).toFixed(2) + " ETH";
            results.push({ label: wallet.label, address: wallet.address, ethBalance });

            await new Promise(r => setTimeout(r, 300));
        } catch (err) {}
    }

    return results;
}

module.exports = { getWalletSignals };