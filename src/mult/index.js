/**
 * BOT MULTIPLIER — Confluencia Ouro+Prata (estrategia validada 11/11 meses)
 * Produto: Multipliers com SL/TP (R:R 1:2). SEM martingale.
 * Banca virtual $22 + $22/mes (simula R$100 + R$100/mes). Opera na DEMO.
 * Protecao: stop -25% mes, -40% total.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const Database = require('better-sqlite3');

const cfg = require('./config');
const DerivMult = require('./derivMult');
const MultEngine = require('./engine');
const TelegramService = require('../services/telegram');

const PORT = process.env.PORT || 3000;
let status = 'starting';

// health check + anti-sleep
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status, bot: 'multiplier-gold-silver', uptime: process.uptime() }));
});
server.listen(PORT, () => { console.log(`[HTTP] porta ${PORT}`); start(); });

// self-ping (Render/Railway free)
const EXT_URL = process.env.RENDER_EXTERNAL_URL || process.env.RAILWAY_STATIC_URL;
setInterval(() => {
  const url = EXT_URL || `http://localhost:${PORT}`;
  const mod = url.startsWith('https') ? require('https') : http;
  mod.get(url, () => {}).on('error', () => {});
}, 4 * 60 * 1000);

// re-tenta assinar candles a cada 10min ate o mercado abrir (nao-fatal)
let _marketRetry = null;
function scheduleMarketRetry(deriv, cfg) {
  if (_marketRetry) return;
  _marketRetry = setInterval(async () => {
    let anyOpen = false;
    for (const s of cfg.ASSETS) {
      try { if (await deriv.subscribeCandles(s)) anyOpen = true; } catch(e){}
      await new Promise(r=>setTimeout(r,800));
    }
    if (anyOpen) {
      console.log('[BOT] ✅ Mercado abriu — candles assinados. Operacao retomada.');
      clearInterval(_marketRetry); _marketRetry = null;
    }
  }, 10 * 60 * 1000);
}

async function start() {
  try {
    console.log('='.repeat(56));
    console.log('  BOT MULTIPLIER — OURO + PRATA (confluencia min 5)');
    console.log('  R:R 1:2 | SEM martingale | banca virtual $22 +$22/mes');
    console.log('  Protecao: stop -25% mes / -40% total');
    console.log('='.repeat(56));

    const dataDir = path.join(__dirname, '..', '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    status = 'init_db';
    const db = new Database(path.join(dataDir, 'mult.db'));
    db.pragma('journal_mode = WAL');
    db.exec(`CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')))`);
    db.exec(`CREATE TABLE IF NOT EXISTS mult_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT, dir TEXT, stake REAL, sl REAL, tp REAL,
      confidence TEXT, votes INTEGER, contract_id TEXT, result TEXT, profit_virtual REAL, balance_virtual REAL, ts TEXT)`);

    const telegram = new TelegramService(cfg.TG_TOKEN, cfg.TG_CHAT);

    status = 'connecting';
    const deriv = new DerivMult(cfg);
    let connected = false;
    for (let a = 1; a <= 10 && !connected; a++) {
      try { console.log(`[BOT] Conectando Deriv (${a}/10)...`); await deriv.connect(); connected = true; }
      catch (e) { console.error(`[BOT] tentativa ${a}: ${e.message}`); await new Promise(r=>setTimeout(r, Math.min(a*3000,30000))); }
    }
    if (!connected) { status = 'no_connection'; setTimeout(start, 60000); return; }

    // trava de seguranca: SO opera demo
    if (!deriv.isVirtual) {
      console.error('[BOT] ⚠️ CONTA REAL detectada! Abortando — este bot so opera DEMO.');
      await telegram.send('🛑 ABORTADO: token aponta pra conta REAL. Este bot so opera DEMO nesta fase.');
      status = 'real_account_blocked';
      return;
    }

    const engine = new MultEngine(deriv, telegram, db, cfg);
    engine.start();

    let anyOpen = false;
    for (const s of cfg.ASSETS) {
      const ok = await deriv.subscribeCandles(s);
      if (ok) anyOpen = true;
      await new Promise(r=>setTimeout(r,800));
    }

    // se mercado fechado, agenda re-tentativa periodica ate abrir (sem tratar como erro)
    if (!anyOpen) {
      console.log('[BOT] Mercado fechado (fim de semana). Bot no ar, aguardando abertura...');
      scheduleMarketRetry(deriv, cfg);
    }

    status = 'running';
    const sum = engine.risk.summary();
    const marketLine = anyOpen
      ? `✅ Mercado aberto — monitorando candles H1.`
      : `🕒 Mercado de metais fechado (fim de semana). Bot no ar, aguardando abertura (seg 00:00 UTC).`;
    await telegram.send(
      `🤖 <b>Bot Ouro+Prata iniciado</b> (Multiplier)\n`+
      `Conta: ${deriv.loginid} (DEMO)\n`+
      `Estrategia: confluencia min 5/7 | R:R 1:2 | sem martingale\n`+
      `Banca virtual: ${sum.bal.toFixed(2)} (R${(sum.bal*cfg.CAMBIO).toFixed(0)})\n`+
      marketLine
    );
    console.log('[BOT] Rodando. Aguardando fechamento de candles H1...');

    const shutdown = () => { console.log('[BOT] Encerrando...'); deriv.close(); process.exit(0); };
    process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);

  } catch (e) {
    console.error('[BOT] erro startup:', e.message, e.stack);
    status = 'error:'+e.message;
    setTimeout(start, 60000);
  }
}
