/**
 * Deriv OTC Bot — Main Entry Point
 * Trades synthetic indices (Volatility 10/25/50/75/100) on demo
 * v2.1 — Persistence + Anti-sleep fixes
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
  console.log('  DERIV OTC BOT v2.1 — Synthetic Indices');
  console.log('  Symbols:', SYMBOLS.join(', '));
  console.log('  Duration: 5 minutes | Timeframes: 5m + 15m');
  console.log('  Persistence: SQLite state restore enabled');
  console.log('='.repeat(50));

  // Init DB
  const db = new Database('./data/bot.db');
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT, direction TEXT, stake REAL, payout REAL,
      profit REAL, won INTEGER, strategy TEXT, level INTEGER,
      balance_after REAL, timestamp TEXT
    )
  `);

  // State persistence table
  db.exec(`
    CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
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
  }

  // Init Engine (with DB for persistence)
  const engine = new TradingEngine(deriv, telegram, db);
  engine.start(SYMBOLS);

  // Subscribe to all symbols
  for (const symbol of SYMBOLS) {
    await deriv.subscribeCandles(symbol);
    await new Promise(r => setTimeout(r, 1000));
  }

  // ===== Startup message dedup =====
  // Only send "Bot Iniciado" if last startup was >30min ago
  const stmtGet = db.prepare('SELECT value FROM state WHERE key = ?');
  const stmtSet = db.prepare('INSERT OR REPLACE INTO state (key, value, updated_at) VALUES (?, ?, datetime("now"))');

  const lastStartup = stmtGet.get('last_startup_ts');
  const now = Date.now();
  const STARTUP_DEDUP_MS = 30 * 60 * 1000; // 30 minutes
  let shouldSendStartup = true;

  if (lastStartup) {
    const elapsed = now - parseInt(lastStartup.value);
    if (elapsed < STARTUP_DEDUP_MS) {
      shouldSendStartup = false;
      console.log(`[BOT] Skipping startup message (last was ${Math.round(elapsed/1000)}s ago)`);
    }
  }
  stmtSet.run('last_startup_ts', String(now));

  if (shouldSendStartup) {
    await telegram.send(
      `🤖 *Bot OTC v2.1 Iniciado*\n` +
      `📊 Ativos: ${SYMBOLS.join(', ')}\n` +
      `💰 Balance: $${deriv.getBalance()}\n` +
      `⏱ Expiração: 5 minutos\n` +
      `🔄 Base stake: $${engine.progression.getNextStake().toFixed(2)}\n` +
      `♻️ Estado restaurado do banco`
    );
  } else {
    console.log('[BOT] Silent restart — state restored from DB');
  }

  console.log('\n[BOT] Ready! Waiting for signals on 5min candle closes...\n');

  // Status log every 15 min
  setInterval(() => {
    const stats = engine.stats;
    const total = stats.wins + stats.losses;
    if (total > 0) {
      console.log(`[STATUS] ${stats.wins}W/${stats.losses}L (${(stats.wins/total*100).toFixed(1)}%) | P&L: $${stats.totalProfit.toFixed(2)} | Balance: $${deriv.getBalance()}`);
    }
  }, 900000);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[BOT] Shutting down — saving state...');
    engine.saveState();
    engine.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n[BOT] SIGTERM — saving state...');
    engine.saveState();
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
const startTime = Date.now();

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    uptime: process.uptime(),
    uptimeFormatted: `${Math.floor(process.uptime() / 60)}m ${Math.floor(process.uptime() % 60)}s`,
    timestamp: new Date().toISOString()
  }));
});
server.listen(PORT, () => console.log(`[HTTP] Health check on port ${PORT}`));

// ===== Self-ping to prevent Render free tier sleep =====
// Render sleeps after ~15min of no inbound HTTP requests
// Ping every 4 minutes to stay well within the window
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || process.env.RENDER_SERVICE_URL;
const PING_INTERVAL = 4 * 60 * 1000; // 4 minutes

function selfPing() {
  const url = RENDER_URL || `http://localhost:${PORT}`;
  const mod = url.startsWith('https') ? require('https') : require('http');
  mod.get(url, (res) => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => {
      console.log(`[PING] Self-ping OK (uptime: ${Math.floor(process.uptime())}s)`);
    });
  }).on('error', (e) => {
    console.log(`[PING] Self-ping failed: ${e.message} — retrying in 30s`);
    // Retry quickly on failure
    setTimeout(selfPing, 30000);
  });
}

// First ping after 60s, then every 4 min
setTimeout(selfPing, 60000);
setInterval(selfPing, PING_INTERVAL);
