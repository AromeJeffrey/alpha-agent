require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");

const token  = process.env.TELEGRAM_TOKEN;
const chatId = process.env.CHAT_ID;
const bot    = new TelegramBot(token);

const MAX_LENGTH = 4000;

// Split message into chunks at newline boundaries
function splitMessage(message) {
    if (message.length <= MAX_LENGTH) return [message];

    const chunks = [];
    let current  = "";
    const lines  = message.split("\n");

    for (const line of lines) {
        if ((current + line + "\n").length > MAX_LENGTH) {
            if (current) chunks.push(current.trim());
            current = line + "\n";
        } else {
            current += line + "\n";
        }
    }

    if (current.trim()) chunks.push(current.trim());
    return chunks;
}

async function sendAlert(message) {
    const chunks = splitMessage(message);

    for (let i = 0; i < chunks.length; i++) {
        try {
            await bot.sendMessage(chatId, chunks[i]);
            // Small delay between chunks
            if (i < chunks.length - 1) {
                await new Promise(r => setTimeout(r, 500));
            }
        } catch (err) {
            console.error(`Telegram send error (chunk ${i + 1}):`, err.message);
        }
    }
}

module.exports = { sendAlert };