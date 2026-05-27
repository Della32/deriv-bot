/**
 * Deriv OTC Bot — Main Entry Point
 * Trades synthetic indices (Volatility 10/25/50/75/100) on demo
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const DerivService = require('./services/deriv');
const TelegramService = require('./services/telegram');
const TradingEngine = require('./engine');

const TOKEN = process.env.DERIV_TOKEN || 'apdZ8m2GEvMgHDg';
const APP_ID = process.env.DERIV_APP_ID || '1089';
const SYMBOLS = (process.env.ASSETS || 'R_75,R_25,R_100,R_50,R_10').split(',').map(s => s.trim());

const TG_TOKEN = process.env.TG_BOT_TOKEN || '8580195488:AAHcHcUVwgrzZiQBAztVsjRgcL965qXMoX8';
const TG_CHAT = process.env.TG_CHAT_ID || '-1003957633197';

async function main() {
  console.log('='.repeat(50));
  console.log('  DERIV OTC BOT v2.0 — Synthetic Indices');
  console.log('  Symbols:', SYMBOLS.join(', '));
  console.log('  Duration: 5 minutes | Timeframes: 5m + 15m');
  console.log('='.repeat(50));

  // Init DB
  const db = new Database('./data/bot.db');
  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT, direction TEXT, stake REAL, payout REAL,
      profit REAL, won INTEGER, strategy TEXT, level INTEGER,
      balance_after REAL, timestamp TEXT
    )
  `);

  // Init Telegram
  const telegram = new TelegramService(TG_TOKEN, TG_CHAT);

  // Init Deriv
  const deriv = new DerivService(TOKEN, APP_ID);
  await deriv.connect();

  // Safety check
  if (!deriv.isDemo()) {
    console.log('\n⚠️  REAL ACCOUNT DETECTED! Safety lock active.');
    console.log('Remove the safety lock in engine.js to enable real trading.\n');
    // Still allow but with warning — engine has balance safety check
  }

  // Init Engine
  const engine = new TradingEngine(deriv, telegram, db);
  engine.start(SYMBOLS);

  // Subscribe to all symbols
  for (const symbol of SYMBOLS) {
    await deriv.subscribeCandles(symbol);
    // Small delay between subscriptions
    await new Promise(r => setTimeout(r, 1000));
  }

  // Notify Telegram
  await telegram.send(
    `🤖 *Bot OTC v2.0 Iniciado*\n` +
    `📊 Ativos: ${SYMBOLS.join(', ')}\n` +
    `💰 Balance: $${deriv.getBalance()}\n` +
    `⏱ Expiração: 5 minutos\n` +
    `🔄 Base stake: $1.20`
  );

  console.log('\n[BOT] Ready! Waiting for signals on 5min candle closes...\n');

  // Keep alive
  setInterval(() => {
    const stats = engine.stats;
    const total = stats.wins + stats.losses;
    if (total > 0) {
      console.log(`[STATUS] ${stats.wins}W/${stats.losses}L (${(stats.wins/total*100).toFixed(1)}%) | P&L: $${stats.totalProfit.toFixed(2)} | Balance: $${deriv.getBalance()}`);
    }
  }, 900000); // Every 15 min

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[BOT] Shutting down...');
    engine.stop();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('[BOT] Fatal error:', err);
  process.exit(1);
});

// ===== HTTP Health Check Server (for cloud hosting) =====
const http = require('http');
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
});
server.listen(PORT, () => console.log(`[HTTP] Health check on port ${PORT}`));
