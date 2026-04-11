const axios = require("axios");
require("dotenv").config();

const WATCHED_WALLETS = [
    { label: "Vitalik Buterin",      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
    { label: "Jump Trading",         address: "0x46340b20830761efd32832A74d7169B29FEB9758" },
    { label: "James Fickel (Whale)", address: "0x3a6b5f957e5C6EE7B98F7b6e99DA484B7AEe7fA2" }
];

const API_KEY  = process.env.ETHERSCAN_API_KEY;
const BASE_URL = "https://api.etherscan.io/v2/api";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getWalletData(address) {

    const balanceRes = await axios.get(BASE_URL, {
        params: { chainid: 1, module: "account", action: "balance", address, tag: "latest", apikey: API_KEY },
        timeout: 8000
    });

    await sleep(400); // stay under 3 calls/sec

    const txRes = await axios.get(BASE_URL, {
        params: { chainid: 1, module: "account", action: "txlist", address, page: 1, offset: 1, sort: "desc", apikey: API_KEY },
        timeout: 8000
    });

    const weiStr     = balanceRes.data.result;
    const ethBalance = (Number(BigInt(weiStr)) / 1e18).toFixed(4);
    const txCount    = txRes.data.result?.length ?? 0;

    return { ethBalance, txCount };
}

async function getWalletSignals() {

    const signals = [];

    for (const wallet of WATCHED_WALLETS) {
        try {
            const { ethBalance, txCount } = await getWalletData(wallet.address);
            signals.push({
                label:      wallet.label,
                address:    wallet.address.slice(0, 6) + "..." + wallet.address.slice(-4),
                ethBalance: ethBalance + " ETH",
                txCount
            });
        } catch (err) {
            console.error(`Wallet error for ${wallet.label}:`, err.message);
        }

        await sleep(400); // pause between wallets
    }

    return signals;
}

module.exports = { getWalletSignals };