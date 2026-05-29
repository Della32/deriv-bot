/**
 * Deriv OTC Bot — Main Entry Point
 * Trades synthetic indices (Volatility 10/25/50/75/100) on demo
 * v2.1 — Persistence + Anti-sleep fixes
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const Database = require('better-sqlite3');
const DerivService = require('./services/deriv');
const TelegramService = require('./services/telegram');
const TradingEngine = require('./engine');

// Ensure data directory exists (Render deploys fresh filesystem)
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log('[INIT] Created data/ directory');
}

const TOKEN = process.env.DERIV_TOKEN || 'apdZ8m2GEvMgHDg';
const APP_ID = process.env.DERIV_APP_ID || '1089';
const SYMBOLS = (process.env.ASSETS || 'R_75,R_25,R_100,R_50,R_10').split(',').map(s => s.trim());

const TG_TOKEN = process.env.TG_BOT_TOKEN || '8580195488:AAHcHcUVwgrzZiQBAztVsjRgcL965qXMoX8';
const TG_CHAT = process.env.TG_CHAT_ID || '-1003957633197';
const PORT = process.env.PORT || 3000;

// ===== 1. START HTTP SERVER FIRST (Render needs a listening port quickly) =====
let botStatus = 'starting';

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: botStatus,
    uptime: process.uptime(),
    uptimeFormatted: `${Math.floor(process.uptime() / 60)}m ${Math.floor(process.uptime() % 60)}s`,
    timestamp: new Date().toISOString()
  }));
});

server.listen(PORT, () => {
  console.log(`[HTTP] Health check on port ${PORT}`);
  // Only start bot AFTER port is bound
  startBot();
});

// ===== 2. SELF-PING (every 4 min to prevent Render sleep) =====
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || process.env.RENDER_SERVICE_URL;
const PING_INTERVAL = 4 * 60 * 1000;

function selfPing() {
  const url = RENDER_URL || `http://localhost:${PORT}`;
  const mod = url.startsWith('https') ? require('https') : http;
  mod.get(url, (res) => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => {
      console.log(`[PING] OK (uptime: ${Math.floor(process.uptime())}s, status: ${botStatus})`);
    });
  }).on('error', (e) => {
    console.log(`[PING] Failed: ${e.message}`);
    setTimeout(selfPing, 30000);
  });
}

setTimeout(selfPing, 60000);
setInterval(selfPing, PING_INTERVAL);

// ===== 3. BOT STARTUP (async, never crashes the process) =====
async function startBot() {
  try {
    console.log('='.repeat(50));
    console.log('  DERIV OTC BOT v2.1 — Synthetic Indices');
    console.log('  Symbols:', SYMBOLS.join(', '));
    console.log('  Duration: 5 minutes | Timeframes: 5m + 15m');
    console.log('  Persistence: SQLite state restore enabled');
    console.log('='.repeat(50));

    // Init DB
    botStatus = 'init_db';
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

    db.exec(`
      CREATE TABLE IF NOT EXISTS state (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Init Telegram
    const telegram = new TelegramService(TG_TOKEN, TG_CHAT);

    // Init Deriv — retry connection up to 10 times
    botStatus = 'connecting_deriv';
    const deriv = new DerivService(TOKEN, APP_ID);
    let connected = false;
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        console.log(`[BOT] Connecting to Deriv (attempt ${attempt}/10)...`);
        await deriv.connect();
        connected = true;
        break;
      } catch (e) {
        console.error(`[BOT] Attempt ${attempt} failed: ${e.message}`);
        if (attempt < 10) {
          const wait = Math.min(attempt * 3000, 30000);
          console.log(`[BOT] Retrying in ${wait/1000}s...`);
          await new Promise(r => setTimeout(r, wait));
        }
      }
    }

    if (!connected) {
      console.error('[BOT] Failed to connect after 10 attempts.');
      botStatus = 'error_no_connection';
      // Don't exit! Keep the HTTP server alive, retry later
      setTimeout(startBot, 60000);
      return;
    }

    // Safety check
    if (!deriv.isDemo()) {
      console.log('\n⚠️  REAL ACCOUNT DETECTED! Safety lock active.\n');
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
    const stmtGet = db.prepare('SELECT value FROM state WHERE key = ?');
    const stmtSet = db.prepare("INSERT OR REPLACE INTO state (key, value, updated_at) VALUES (?, ?, datetime('now'))");

    const lastStartup = stmtGet.get('last_startup_ts');
    const now = Date.now();
    const STARTUP_DEDUP_MS = 30 * 60 * 1000;
    let shouldSendStartup = true;

    if (lastStartup) {
      const elapsed = now - parseInt(lastStartup.value);
      if (elapsed < STARTUP_DEDUP_MS) {
        shouldSendStartup = false;
        console.log(`[BOT] Skipping startup msg (last ${Math.round(elapsed/1000)}s ago)`);
      }
    }
    stmtSet.run('last_startup_ts', String(now));

    if (shouldSendStartup) {
      const progStatus = engine.progression.currentLevel > 0
        ? `\n⚡ Martingale restaurado: Level ${engine.progression.currentLevel}`
        : '';
      const statsStatus = (engine.stats.wins + engine.stats.losses) > 0
        ? `\n📊 Stats restaurados: ${engine.stats.wins}W/${engine.stats.losses}L`
        : '';

      await telegram.send(
        `🤖 *Bot OTC v2.1 Iniciado*\n` +
        `📊 Ativos: ${SYMBOLS.join(', ')}\n` +
        `💰 Balance: $${deriv.getBalance()}\n` +
        `⏱ Expiração: 5 minutos\n` +
        `🔄 Stake: $${engine.progression.getNextStake().toFixed(2)}` +
        progStatus + statsStatus
      );
    } else {
      console.log('[BOT] Silent restart — state restored from DB');
    }

    botStatus = 'running';
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
    const shutdown = () => {
      console.log('\n[BOT] Shutting down — saving state...');
      engine.saveState();
      engine.stop();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (err) {
    console.error('[BOT] Startup error:', err.message, err.stack);
    botStatus = `error: ${err.message}`;
    // Don't crash! Keep HTTP alive, retry in 60s
    console.log('[BOT] Will retry startup in 60s...');
    setTimeout(startBot, 60000);
  }
}
