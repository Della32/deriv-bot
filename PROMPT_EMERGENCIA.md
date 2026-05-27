# 🚨 PROMPT DE EMERGÊNCIA — DERIV BOT OTC

**Use este prompt para reparar, redeployar ou manter o bot caso ele caia.**
**Cole este prompt INTEIRO em qualquer IA (Runable, ChatGPT, Claude, etc).**

---

## CONTEXTO

Eu tenho um bot de opções binárias que opera automaticamente na Deriv (conta demo) em índices sintéticos OTC (Volatility 10/25/50/75/100). Ele usa estratégias de chart patterns (double top/bottom, head & shoulders, triângulos, flags, wedges, cup & handle, engulfing, hammer, etc.) com martingale compartilhado entre símbolos.

O bot estava rodando no **Render.com** como web service (plano free). Se ele caiu, preciso que você faça ele voltar a funcionar.

---

## CREDENCIAIS E LINKS IMPORTANTES

```
# Deriv API
DERIV_TOKEN=<SEU_DERIV_TOKEN>
DERIV_APP_ID=1089
ASSETS=R_75,R_25,R_100,R_50,R_10

# Telegram (notificações)
TG_BOT_TOKEN=<SEU_TG_BOT_TOKEN>
TG_CHAT_ID=<SEU_TG_CHAT_ID>

# GitHub
REPO: https://github.com/Della32/deriv-bot (PÚBLICO)
GITHUB_USER: Della32
GITHUB_TOKEN: <SEU_GITHUB_TOKEN>

# Render.com
RENDER_API_KEY: <SEU_RENDER_API_KEY>
RENDER_SERVICE_ID: srv-d8bj26d7vvec739ti7o0
RENDER_URL: https://deriv-bot-hmvk.onrender.com
RENDER_DASHBOARD: https://dashboard.render.com/web/srv-d8bj26d7vvec739ti7o0

# Railway (conta backup)
RAILWAY_TOKEN: <SEU_RAILWAY_TOKEN>
RAILWAY_PROJECT_ID: 3a572196-09c9-4921-af66-1d5ca0b0f0fa
RAILWAY_SERVICE_ID: 7d04266a-ffa4-491d-b2da-292cf3f69d69
RAILWAY_ENV_ID: 446d3beb-0880-4ad1-babb-bb5160dd2844

# Conta Deriv Demo
ACCOUNT_ID: VRTC11240175
```

---

## PASSO 1 — VERIFICAR SE O BOT ESTÁ RODANDO

```bash
curl -s https://deriv-bot-hmvk.onrender.com
```

Se retornar `{"status":"ok","uptime":...}` → **está funcionando, não precisa fazer nada.**

Se der erro ou timeout → **o bot caiu. Siga os passos abaixo.**

---

## PASSO 2 — TENTAR REDEPLOY NO RENDER

```bash
# Trigger manual deploy via API
curl -s -X POST "https://api.render.com/v1/services/srv-d8bj26d7vvec739ti7o0/deploys" \
  -H "Authorization: Bearer <SEU_RENDER_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Aguarde 3-5 minutos e verifique o status:

```bash
curl -s -X GET "https://api.render.com/v1/services/srv-d8bj26d7vvec739ti7o0/deploys?limit=1" \
  -H "Authorization: Bearer <SEU_RENDER_API_KEY>"
```

Se o status for `"live"` → **bot voltou!**
Se o status for `"build_failed"` → **siga para o passo 3.**

---

## PASSO 3 — RECRIAR O BOT DO ZERO

Caso o serviço no Render tenha sido deletado ou a conta tenha problema, recrie tudo:

### 3.1 — Clonar o repositório

```bash
git clone https://github.com/Della32/deriv-bot.git
cd deriv-bot
```

### 3.2 — Criar arquivo .env

```bash
cat > .env << 'EOF'
DERIV_TOKEN=<SEU_DERIV_TOKEN>
DERIV_APP_ID=1089
ASSETS=R_75,R_25,R_100,R_50,R_10
TG_BOT_TOKEN=<SEU_TG_BOT_TOKEN>
TG_CHAT_ID=<SEU_TG_CHAT_ID>
PORT=3000
EOF
```

### 3.3 — Testar localmente

```bash
npm install
mkdir -p data
node src/index.js
```

Se funcionar (conectar na Deriv + enviar mensagem no Telegram), o código está ok.

### 3.4 — Criar novo serviço no Render via API

```bash
curl -s -X POST https://api.render.com/v1/services \
  -H "Authorization: Bearer <SEU_RENDER_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "web_service",
    "name": "deriv-bot",
    "ownerId": "tea-d8bict6gvqtc73ctdppg",
    "repo": "https://github.com/Della32/deriv-bot",
    "branch": "main",
    "serviceDetails": {
      "runtime": "docker",
      "plan": "free",
      "envVars": [
        {"key": "DERIV_TOKEN", "value": "<SEU_DERIV_TOKEN>"},
        {"key": "DERIV_APP_ID", "value": "1089"},
        {"key": "ASSETS", "value": "R_75,R_25,R_100,R_50,R_10"},
        {"key": "TG_BOT_TOKEN", "value": "<SEU_TG_BOT_TOKEN>"},
        {"key": "TG_CHAT_ID", "value": "<SEU_TG_CHAT_ID>"},
        {"key": "PORT", "value": "10000"},
        {"key": "RENDER_EXTERNAL_URL", "value": "PREENCHER_DEPOIS_COM_A_URL"}
      ]
    }
  }'
```

**IMPORTANTE**: Depois que o serviço for criado, pegue a URL retornada (campo `serviceDetails.url`) e atualize a env var `RENDER_EXTERNAL_URL` com ela.

---

## PASSO 4 — ALTERNATIVA: RODAR LOCALMENTE NO SANDBOX

Se o Render não funcionar, rode direto no sandbox da Runable:

```bash
cd /home/user/deriv-bot
npm install
mkdir -p data
tmux new-session -d -s bot "node src/index.js"
```

Para verificar se está rodando:
```bash
tmux capture-pane -t bot -p | tail -20
```

**Nota**: Isso funciona mas pode cair se a sessão expirar.

---

## PASSO 5 — ALTERNATIVA: RAILWAY

Se o Render morrer totalmente, tente Railway:

```bash
# Verificar se o token ainda funciona
curl -s -X POST https://backboard.railway.app/graphql/v2 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SEU_RAILWAY_TOKEN>" \
  -d '{"query":"{ me { id email isVerified } }"}'
```

Se `isVerified: true`, pode fazer deploy. Se `false`, a conta precisa ser verificada em https://railway.app/verify

Para triggar deploy no Railway:
```bash
curl -s -X POST https://backboard.railway.app/graphql/v2 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SEU_RAILWAY_TOKEN>" \
  -d '{"query":"mutation { serviceInstanceDeploy(serviceId: \"7d04266a-ffa4-491d-b2da-292cf3f69d69\", environmentId: \"446d3beb-0880-4ad1-babb-bb5160dd2844\") }"}'
```

---

## CÓDIGO FONTE COMPLETO

Caso o repositório GitHub seja deletado ou corrompido, aqui está o código fonte completo para recriar do zero.

### Estrutura de arquivos:
```
deriv-bot/
├── Dockerfile
├── package.json
├── .gitignore
├── .env
├── data/
│   └── bot.db (criado automaticamente)
└── src/
    ├── index.js
    ├── engine.js
    ├── strategy/
    │   ├── analyzer.js
    │   └── progression.js
    ├── services/
    │   ├── deriv.js
    │   ├── telegram.js
    │   ├── reporter.js
    │   └── news.js
    ├── indicators/
    │   ├── rsi.js
    │   ├── ema.js
    │   ├── bollinger.js
    │   └── atr.js
    └── db/
        └── database.js
```

### Dockerfile
```dockerfile
FROM node:20-slim

# Install build dependencies for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Create data directory
RUN mkdir -p data

EXPOSE 3000

CMD ["node", "src/index.js"]
```

### package.json
```json
{
  "name": "deriv-bot",
  "version": "6.0.0",
  "description": "Deriv Binary Options Bot — Chart Pattern Strategy",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "start:telegram": "node src/index.js --telegram-only",
    "backtest": "node src/backtest.js"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "type": "commonjs",
  "engines": {
    "node": ">=18.0.0"
  },
  "dependencies": {
    "better-sqlite3": "^12.10.0",
    "dotenv": "^17.4.2",
    "node-fetch": "^2.7.0",
    "ws": "^8.21.0"
  }
}
```

### .gitignore
```
node_modules/
data/*.db
.env
```

### src/index.js
```javascript
/**
 * Deriv OTC Bot — Main Entry Point
 * Trades synthetic indices (Volatility 10/25/50/75/100) on demo
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const DerivService = require('./services/deriv');
const TelegramService = require('./services/telegram');
const TradingEngine = require('./engine');

const TOKEN = process.env.DERIV_TOKEN || '<SEU_DERIV_TOKEN>';
const APP_ID = process.env.DERIV_APP_ID || '1089';
const SYMBOLS = (process.env.ASSETS || 'R_75,R_25,R_100,R_50,R_10').split(',').map(s => s.trim());

const TG_TOKEN = process.env.TG_BOT_TOKEN || '<SEU_TG_BOT_TOKEN>';
const TG_CHAT = process.env.TG_CHAT_ID || '<SEU_TG_CHAT_ID>';

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
  }

  // Init Engine
  const engine = new TradingEngine(deriv, telegram, db);
  engine.start(SYMBOLS);

  // Subscribe to all symbols
  for (const symbol of SYMBOLS) {
    await deriv.subscribeCandles(symbol);
    await new Promise(r => setTimeout(r, 1000));
  }

  // Notify Telegram
  await telegram.send(
    `🤖 *Bot OTC v2.0 Iniciado*\n` +
    `📊 Ativos: ${SYMBOLS.join(', ')}\n` +
    `💰 Balance: $${deriv.getBalance()}\n` +
    `⏱ Expiração: 5 minutos\n` +
    `🔄 Base stake: $5.00`
  );

  console.log('\n[BOT] Ready! Waiting for signals on 5min candle closes...\n');

  // Status log every 15min
  setInterval(() => {
    const stats = engine.stats;
    const total = stats.wins + stats.losses;
    if (total > 0) {
      console.log(`[STATUS] ${stats.wins}W/${stats.losses}L (${(stats.wins/total*100).toFixed(1)}%) | P&L: $${stats.totalProfit.toFixed(2)} | Balance: $${deriv.getBalance()}`);
    }
  }, 900000);

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

// ===== Self-ping to prevent Render free tier sleep =====
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || process.env.RENDER_SERVICE_URL;
if (RENDER_URL) {
  setInterval(() => {
    require('http').get(RENDER_URL, () => {}).on('error', () => {});
    console.log('[PING] Self-ping to stay awake');
  }, 10 * 60 * 1000);
} else {
  setInterval(() => {
    require('http').get(`http://localhost:${process.env.PORT || 3000}`, () => {}).on('error', () => {});
  }, 10 * 60 * 1000);
}
```

### src/engine.js
```javascript
/**
 * Trading Engine v2.1 — OTC Synthetics
 */

const ChartPatternAnalyzer = require('./strategy/analyzer');
const Progression = require('./strategy/progression');

const SYMBOL_NAMES = {
  'R_10': 'Volatility 10 Index',
  'R_25': 'Volatility 25 Index',
  'R_50': 'Volatility 50 Index',
  'R_75': 'Volatility 75 Index',
  'R_100': 'Volatility 100 Index'
};

const SYMBOL_SHORT = {
  'R_10': 'Vol 10',
  'R_25': 'Vol 25',
  'R_50': 'Vol 50',
  'R_75': 'Vol 75',
  'R_100': 'Vol 100'
};

class TradingEngine {
  constructor(deriv, telegram, db) {
    this.deriv = deriv;
    this.telegram = telegram;
    this.db = db;
    this.analyzer = new ChartPatternAnalyzer();
    this.progression = new Progression();
    this.activeTrade = null;
    this.running = false;
    this.stats = { wins: 0, losses: 0, totalProfit: 0 };
    this.tradeMessageId = null;
    this.lastTradeTime = {};
    this.COOLDOWN_MS = 6 * 60 * 1000;
    this.MAX_DAILY_TRADES = 20;
    this.dailyTrades = 0;
    this.lastResetDay = new Date().toDateString();
  }

  _name(symbol) { return SYMBOL_NAMES[symbol] || symbol; }
  _short(symbol) { return SYMBOL_SHORT[symbol] || symbol; }
  _time() { return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Rio_Branco' }); }
  _statsLine() {
    const t = this.stats.wins + this.stats.losses;
    const wr = t > 0 ? (this.stats.wins / t * 100).toFixed(1) : '0.0';
    return `${this.stats.wins}W / ${this.stats.losses}L  (${wr}%)`;
  }

  start(symbols) {
    this.running = true;
    this.symbols = symbols;
    console.log(`[ENGINE] Started with ${symbols.length} symbols`);
    console.log(`[ENGINE] Base stake: $${this.progression.getNextStake().toFixed(2)}`);

    this.deriv.on('candle_close', (data) => this._onCandleClose(data));
    this.deriv.on('contract_result', (result) => this._onContractResult(result));
    this.deriv.on('trade_error', (error) => this._onTradeError(error));

    this.deriv.on('transaction', (tx) => {
      if (tx.action === 'sell' && this.activeTrade) {
        console.log(`[ENGINE] Transaction sell detected: contract=${tx.contract_id}, amount=${tx.amount}`);
        setTimeout(() => {
          if (this.activeTrade && this.activeTrade.contractId == tx.contract_id) {
            console.log(`[ENGINE] Using transaction fallback for contract ${tx.contract_id}`);
            const sellAmount = parseFloat(tx.amount);
            const profit = sellAmount - this.activeTrade.stake;
            const won = profit > 0;
            this._onContractResult({
              contractId: tx.contract_id, won, profit,
              buyPrice: this.activeTrade.stake,
              payout: this.activeTrade.payout,
              balanceAfter: tx.balance || this.deriv.getBalance(),
              symbol: this.activeTrade.symbol
            });
          }
        }, 3000);
      }
    });

    if (this.telegram) {
      const symbolList = symbols.map(s => `  • ${this._name(s)}`).join('\n');
      this.telegram.send(
        `🤖 <b>Bot Iniciado</b>\n━━━━━━━━━━━━━━━━━━\n\n📊 <b>Ativos monitorados:</b>\n${symbolList}\n\n⏱ Timeframe: 5 minutos\n💰 Stake inicial: $${this.progression.getNextStake().toFixed(2)}\n🕐 Horário: ${this._time()}\n━━━━━━━━━━━━━━━━━━\n<i>Aguardando sinais...</i>`
      );
    }
  }

  stop() { this.running = false; console.log('[ENGINE] Stopped'); }

  async _onCandleClose(data) {
    if (!this.running) return;
    if (this.activeTrade) return;

    const today = new Date().toDateString();
    if (today !== this.lastResetDay) { this.dailyTrades = 0; this.lastResetDay = today; }
    if (this.dailyTrades >= this.MAX_DAILY_TRADES) return;

    const now = Date.now();
    if (this.lastTradeTime[data.symbol] && now - this.lastTradeTime[data.symbol] < this.COOLDOWN_MS) return;

    const { symbol, candles5m, candles15m } = data;
    const signal = this.analyzer.analyze(symbol, candles5m, candles15m);
    if (!signal) return;

    console.log(`\n[ENGINE] 🎯 SIGNAL: ${signal.direction} on ${this._name(signal.symbol)}`);
    console.log(`[ENGINE] Strategy: ${signal.strategy} | Confidence: ${(signal.confidence * 100).toFixed(0)}%`);
    await this._executeTrade(signal);
  }

  async _executeTrade(signal) {
    const stake = this.progression.getNextStake();
    const level = this.progression.currentLevel;
    console.log(`[ENGINE] Executing: ${signal.direction} $${stake.toFixed(2)} on ${this._name(signal.symbol)} (Level ${level})`);

    if (!this.deriv.isDemo()) {
      const balance = this.deriv.getBalance();
      if (stake > balance * 0.3) { console.log(`[ENGINE] ⚠️ Stake too high. Skipping.`); return; }
    }

    this.activeTrade = {
      symbol: signal.symbol, direction: signal.direction, stake, level,
      strategy: signal.strategy, confidence: signal.confidence, details: signal.details,
      label: this._name(signal.symbol), shortLabel: this._short(signal.symbol), timestamp: Date.now()
    };

    this._tradeTimeout = setTimeout(() => {
      if (this.activeTrade) {
        console.log(`[ENGINE] ⚠️ Trade timeout!`);
        const t = this.activeTrade;
        this.activeTrade = null;
        if (this.telegram) {
          this.telegram.send(`⚠️ <b>Trade Timeout</b>\n━━━━━━━━━━━━━━━━━━\n${t.label} | ${t.direction}\nResultado não recebido em 7 min.\nTrade liberado automaticamente.`);
        }
      }
    }, 7 * 60 * 1000);

    try {
      const result = await this.deriv.buyContract(signal.symbol, signal.direction, stake);
      this.activeTrade.contractId = result.contractId;
      this.activeTrade.payout = result.payout;
      this.activeTrade.buyPrice = result.buyPrice;
      this.lastTradeTime[signal.symbol] = Date.now();
      this.dailyTrades++;

      const dirEmoji = signal.direction === 'CALL' ? '🟢' : '🔴';
      const dirIcon = signal.direction === 'CALL' ? '📈' : '📉';
      const confPct = (signal.confidence * 100).toFixed(0);
      const confBar = '█'.repeat(Math.round(signal.confidence * 10)) + '░'.repeat(10 - Math.round(signal.confidence * 10));

      if (this.telegram) {
        const msg = await this.telegram.send(
          `${dirEmoji} <b>TRADE ABERTO</b>\n━━━━━━━━━━━━━━━━━━\n\n${dirIcon} <b>${signal.direction}</b> — ${this._name(signal.symbol)}\n\n💰 Entrada: <b>$${stake.toFixed(2)}</b>\n🎯 Payout: <b>$${result.payout}</b>\n📊 Lucro potencial: <b>$${(parseFloat(result.payout) - stake).toFixed(2)}</b>\n\n🧠 Estratégia: <code>${signal.strategy}</code>\n📋 ${signal.details}\n🔋 Confiança: ${confBar} ${confPct}%\n\n🔄 Level: ${level} | Trade #${this.dailyTrades}\n🕐 ${this._time()}\n━━━━━━━━━━━━━━━━━━\n<i>⏳ Aguardando resultado (5 min)...</i>`
        );
        this.tradeMessageId = msg?.message_id || null;
      }
      console.log(`[ENGINE] Trade placed: contract=${result.contractId}, payout=$${result.payout}`);
    } catch (e) {
      console.error(`[ENGINE] Trade failed:`, e.message);
      this.activeTrade = null;
      if (this.telegram) {
        this.telegram.send(`❌ <b>Trade Falhou</b>\n━━━━━━━━━━━━━━━━━━\n${signal.direction} — ${this._name(signal.symbol)}\nErro: <code>${e.message}</code>`);
      }
    }
  }

  async _onContractResult(result) {
    if (!this.activeTrade) return;
    if (this._tradeTimeout) { clearTimeout(this._tradeTimeout); this._tradeTimeout = null; }

    const trade = this.activeTrade;
    this.activeTrade = null;

    if (result.won) { this.stats.wins++; this.progression.reset(); }
    else { this.stats.losses++; this.progression.advance(trade.stake); }
    this.stats.totalProfit += result.profit;

    const totalTrades = this.stats.wins + this.stats.losses;
    const wr = totalTrades > 0 ? (this.stats.wins / totalTrades * 100).toFixed(1) : '0.0';
    const nextStake = this.progression.getNextStake();
    const nextLevel = this.progression.currentLevel;

    console.log(`[ENGINE] ${result.won ? '🟢 WIN' : '🔴 LOSS'} | Profit: $${result.profit} | Balance: $${result.balanceAfter}`);
    console.log(`[ENGINE] Stats: ${this._statsLine()} | P&L: $${this.stats.totalProfit.toFixed(2)}`);

    if (this.db) {
      try {
        this.db.prepare(`INSERT INTO trades (symbol, direction, stake, payout, profit, won, strategy, level, balance_after, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(trade.symbol, trade.direction, trade.stake, trade.payout || 0, result.profit, result.won ? 1 : 0, trade.strategy, trade.level, result.balanceAfter, new Date().toISOString());
      } catch (e) { console.error('[ENGINE] DB error:', e.message); }
    }

    if (this.telegram) {
      const profitSign = result.profit >= 0 ? '+' : '';
      const plSign = this.stats.totalProfit >= 0 ? '+' : '';

      if (result.won) {
        const winMsg = `✅ <b>WIN</b>  •  ${trade.shortLabel}\n━━━━━━━━━━━━━━━━━━\n\n${trade.direction === 'CALL' ? '📈' : '📉'} <b>${trade.direction}</b> — ${trade.label}\n\n💰 Entrada: $${trade.stake.toFixed(2)}\n💵 Retorno: <b>$${(trade.stake + result.profit).toFixed(2)}</b>\n✨ Lucro: <b>${profitSign}$${result.profit.toFixed(2)}</b>\n\n💼 Saldo: <b>$${parseFloat(result.balanceAfter).toFixed(2)}</b>\n📊 ${this._statsLine()}\n💵 P&L: <b>${plSign}$${this.stats.totalProfit.toFixed(2)}</b>\n\n➡️ Próximo: Level ${nextLevel} ($${nextStake.toFixed(2)})\n🕐 ${this._time()}\n━━━━━━━━━━━━━━━━━━`;
        if (this.tradeMessageId) await this.telegram.editMessage(this.tradeMessageId, winMsg);
        else await this.telegram.send(winMsg);
      } else {
        const lossMsg = `❌ <b>LOSS</b>  •  ${trade.shortLabel}\n━━━━━━━━━━━━━━━━━━\n\n${trade.direction === 'CALL' ? '📈' : '📉'} <b>${trade.direction}</b> — ${trade.label}\n\n💰 Entrada: $${trade.stake.toFixed(2)}\n💸 Perdido: <b>$${Math.abs(result.profit).toFixed(2)}</b>\n\n💼 Saldo: <b>$${parseFloat(result.balanceAfter).toFixed(2)}</b>\n📊 ${this._statsLine()}\n💵 P&L: <b>${plSign}$${this.stats.totalProfit.toFixed(2)}</b>\n\n⚡ Martingale: Level ${nextLevel} ($${nextStake.toFixed(2)})\n🕐 ${this._time()}\n━━━━━━━━━━━━━━━━━━`;
        if (this.tradeMessageId) await this.telegram.editMessage(this.tradeMessageId, lossMsg);
        else await this.telegram.send(lossMsg);
      }
      this.tradeMessageId = null;
    }

    if (this.progression.currentLevel >= this.progression.maxLevel) {
      console.log('[ENGINE] ⚠️ Max progression reached. Resetting.');
      this.progression.hardReset();
      if (this.telegram) {
        this.telegram.send(`🚨 <b>Alerta — Max Progression</b>\n━━━━━━━━━━━━━━━━━━\nNível máximo de martingale atingido.\nResetando para Level 0.`);
      }
    }
  }

  _onTradeError(error) {
    console.error('[ENGINE] Trade error:', error.message);
    this.activeTrade = null;
  }
}

module.exports = TradingEngine;
```

### src/strategy/analyzer.js
```javascript
/**
 * Chart Pattern Analyzer v3.0
 * Detects: double top/bottom, H&S, triangles, flags, wedges, cup&handle,
 * candlestick patterns, triple top/bottom, rounding top/bottom
 */

class ChartPatternAnalyzer {
  constructor() {
    this.minCandles = 20;
  }

  analyze(symbol, candles5m, candles15m) {
    if (!candles5m || candles5m.length < this.minCandles) return null;

    const lookback = Math.min(candles5m.length, 50);
    const recent = candles5m.slice(-lookback);
    const trend15m = this._getTrend(candles15m);

    const detectors = [
      () => this._detectDoubleTopBottom(recent, symbol),
      () => this._detectHeadAndShoulders(recent, symbol),
      () => this._detectTriangle(recent, symbol, trend15m),
      () => this._detectFlag(recent, symbol, trend15m),
      () => this._detectWedge(recent, symbol, trend15m),
      () => this._detectCupAndHandle(recent, symbol),
      () => this._detectCandlestickPatterns(recent, symbol, trend15m),
      () => this._detectTripleTopBottom(recent, symbol),
      () => this._detectRounding(recent, symbol),
    ];

    for (const detect of detectors) {
      const signal = detect();
      if (signal) return signal;
    }
    return null;
  }

  _getTrend(candles) {
    if (!candles || candles.length < 5) return 'neutral';
    const recent = candles.slice(-10);
    const firstHalf = recent.slice(0, 5);
    const secondHalf = recent.slice(5);
    const avgFirst = firstHalf.reduce((s, c) => s + c.close, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, c) => s + c.close, 0) / secondHalf.length;
    const diff = (avgSecond - avgFirst) / avgFirst;
    if (diff > 0.001) return 'up';
    if (diff < -0.001) return 'down';
    return 'neutral';
  }

  _getLocalTrend(candles, count = 10) {
    if (candles.length < count) return 'neutral';
    const segment = candles.slice(-count);
    const first = segment.slice(0, Math.floor(count / 2));
    const second = segment.slice(Math.floor(count / 2));
    const avgF = first.reduce((s, c) => s + c.close, 0) / first.length;
    const avgS = second.reduce((s, c) => s + c.close, 0) / second.length;
    const diff = (avgS - avgF) / avgF;
    if (diff > 0.0008) return 'up';
    if (diff < -0.0008) return 'down';
    return 'neutral';
  }

  _findPivots(candles, leftBars = 3, rightBars = 3) {
    const pivotHighs = [];
    const pivotLows = [];
    for (let i = leftBars; i < candles.length - rightBars; i++) {
      let isHigh = true, isLow = true;
      for (let j = i - leftBars; j <= i + rightBars; j++) {
        if (j === i) continue;
        if (candles[j].high >= candles[i].high) isHigh = false;
        if (candles[j].low <= candles[i].low) isLow = false;
      }
      if (isHigh) pivotHighs.push({ index: i, price: candles[i].high, candle: candles[i] });
      if (isLow) pivotLows.push({ index: i, price: candles[i].low, candle: candles[i] });
    }
    return { pivotHighs, pivotLows };
  }

  _detectDoubleTopBottom(candles, symbol) {
    const { pivotHighs, pivotLows } = this._findPivots(candles, 3, 2);
    const last = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];

    if (pivotHighs.length >= 2) {
      const top1 = pivotHighs[pivotHighs.length - 2];
      const top2 = pivotHighs[pivotHighs.length - 1];
      const tolerance = top1.price * 0.003;
      if (Math.abs(top1.price - top2.price) < tolerance && top2.index - top1.index >= 4) {
        let neckline = Infinity;
        for (let i = top1.index; i <= top2.index; i++) {
          if (candles[i].low < neckline) neckline = candles[i].low;
        }
        if (last.close < neckline && prevCandle.close >= neckline) {
          return { symbol, direction: 'PUT', strategy: 'double_top', confidence: 0.75, details: `Double Top (M) — neckline quebrada @ ${neckline.toFixed(4)}` };
        }
      }
    }

    if (pivotLows.length >= 2) {
      const bot1 = pivotLows[pivotLows.length - 2];
      const bot2 = pivotLows[pivotLows.length - 1];
      const tolerance = bot1.price * 0.003;
      if (Math.abs(bot1.price - bot2.price) < tolerance && bot2.index - bot1.index >= 4) {
        let neckline = -Infinity;
        for (let i = bot1.index; i <= bot2.index; i++) {
          if (candles[i].high > neckline) neckline = candles[i].high;
        }
        if (last.close > neckline && prevCandle.close <= neckline) {
          return { symbol, direction: 'CALL', strategy: 'double_bottom', confidence: 0.75, details: `Double Bottom (W) — neckline rompida @ ${neckline.toFixed(4)}` };
        }
      }
    }
    return null;
  }

  _detectHeadAndShoulders(candles, symbol) {
    const { pivotHighs, pivotLows } = this._findPivots(candles, 3, 2);
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];

    if (pivotHighs.length >= 3) {
      const h = pivotHighs.slice(-3);
      if (h[1].price > h[0].price && h[1].price > h[2].price) {
        const shoulderTol = h[0].price * 0.005;
        if (Math.abs(h[0].price - h[2].price) < shoulderTol) {
          let neckLeft = Infinity, neckRight = Infinity;
          for (let i = h[0].index; i <= h[1].index; i++) { if (candles[i].low < neckLeft) neckLeft = candles[i].low; }
          for (let i = h[1].index; i <= h[2].index; i++) { if (candles[i].low < neckRight) neckRight = candles[i].low; }
          const neckline = Math.max(neckLeft, neckRight);
          if (last.close < neckline && prev.close >= neckline) {
            return { symbol, direction: 'PUT', strategy: 'head_shoulders', confidence: 0.80, details: `Head & Shoulders — neckline quebrada @ ${neckline.toFixed(4)}` };
          }
        }
      }
    }

    if (pivotLows.length >= 3) {
      const l = pivotLows.slice(-3);
      if (l[1].price < l[0].price && l[1].price < l[2].price) {
        const shoulderTol = l[0].price * 0.005;
        if (Math.abs(l[0].price - l[2].price) < shoulderTol) {
          let neckLeft = -Infinity, neckRight = -Infinity;
          for (let i = l[0].index; i <= l[1].index; i++) { if (candles[i].high > neckLeft) neckLeft = candles[i].high; }
          for (let i = l[1].index; i <= l[2].index; i++) { if (candles[i].high > neckRight) neckRight = candles[i].high; }
          const neckline = Math.min(neckLeft, neckRight);
          if (last.close > neckline && prev.close <= neckline) {
            return { symbol, direction: 'CALL', strategy: 'inv_head_shoulders', confidence: 0.80, details: `Inv Head & Shoulders — neckline rompida @ ${neckline.toFixed(4)}` };
          }
        }
      }
    }
    return null;
  }

  _slope(pivots) {
    if (pivots.length < 2) return 0;
    const first = pivots[0], last = pivots[pivots.length - 1];
    const indexDiff = last.index - first.index;
    if (indexDiff === 0) return 0;
    return (last.price - first.price) / first.price / indexDiff;
  }

  _detectTriangle(candles, symbol, trend15m) {
    const { pivotHighs, pivotLows } = this._findPivots(candles, 2, 2);
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    if (pivotHighs.length < 2 || pivotLows.length < 2) return null;
    const recentHighs = pivotHighs.slice(-3);
    const recentLows = pivotLows.slice(-3);
    const highSlope = this._slope(recentHighs);
    const lowSlope = this._slope(recentLows);
    const lastHigh = recentHighs[recentHighs.length - 1].price;
    const lastLow = recentLows[recentLows.length - 1].price;

    if (highSlope < -0.00005 && lowSlope > 0.00005) {
      if (last.close > lastHigh && prev.close <= lastHigh) return { symbol, direction: 'CALL', strategy: 'sym_triangle_bull', confidence: 0.70, details: `Triângulo Simétrico — breakout p/ cima @ ${lastHigh.toFixed(4)}` };
      if (last.close < lastLow && prev.close >= lastLow) return { symbol, direction: 'PUT', strategy: 'sym_triangle_bear', confidence: 0.70, details: `Triângulo Simétrico — breakout p/ baixo @ ${lastLow.toFixed(4)}` };
    }
    if (Math.abs(highSlope) < 0.00003 && lowSlope > 0.00005) {
      const resistance = recentHighs.reduce((s, p) => s + p.price, 0) / recentHighs.length;
      if (last.close > resistance && prev.close <= resistance) return { symbol, direction: 'CALL', strategy: 'asc_triangle', confidence: 0.75, details: `Triângulo Ascendente — resistência rompida @ ${resistance.toFixed(4)}` };
    }
    if (highSlope < -0.00005 && Math.abs(lowSlope) < 0.00003) {
      const support = recentLows.reduce((s, p) => s + p.price, 0) / recentLows.length;
      if (last.close < support && prev.close >= support) return { symbol, direction: 'PUT', strategy: 'desc_triangle', confidence: 0.75, details: `Triângulo Descendente — suporte quebrado @ ${support.toFixed(4)}` };
    }
    return null;
  }

  _detectFlag(candles, symbol, trend15m) {
    if (candles.length < 20) return null;
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const segment = candles.slice(-20);
    let maxMove = 0, impulseDir = null, impulseEnd = 0;
    for (let i = 0; i < 12; i++) {
      for (let j = i + 3; j < i + 8 && j < segment.length; j++) {
        const move = (segment[j].close - segment[i].close) / segment[i].close;
        if (Math.abs(move) > Math.abs(maxMove)) { maxMove = move; impulseDir = move > 0 ? 'up' : 'down'; impulseEnd = j; }
      }
    }
    if (Math.abs(maxMove) < 0.002) return null;
    if (impulseEnd >= segment.length - 3) return null;
    const flagCandles = segment.slice(impulseEnd);
    if (flagCandles.length < 3) return null;
    const flagHighs = flagCandles.map(c => c.high);
    const flagLows = flagCandles.map(c => c.low);
    const flagRange = Math.max(...flagHighs) - Math.min(...flagLows);
    const impulseRange = Math.abs(segment[impulseEnd].close - segment[0].close);
    if (flagRange > impulseRange * 0.6) return null;

    if (impulseDir === 'up') {
      const flagHigh = Math.max(...flagHighs);
      if (last.close > flagHigh && prev.close <= flagHigh) return { symbol, direction: 'CALL', strategy: 'bull_flag', confidence: 0.72, details: `Flag Bullish — breakout acima da bandeira @ ${flagHigh.toFixed(4)}` };
    }
    if (impulseDir === 'down') {
      const flagLow = Math.min(...flagLows);
      if (last.close < flagLow && prev.close >= flagLow) return { symbol, direction: 'PUT', strategy: 'bear_flag', confidence: 0.72, details: `Flag Bearish — breakout abaixo da bandeira @ ${flagLow.toFixed(4)}` };
    }
    return null;
  }

  _detectWedge(candles, symbol, trend15m) {
    const { pivotHighs, pivotLows } = this._findPivots(candles, 2, 2);
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    if (pivotHighs.length < 2 || pivotLows.length < 2) return null;
    const recentHighs = pivotHighs.slice(-3);
    const recentLows = pivotLows.slice(-3);
    const highSlope = this._slope(recentHighs);
    const lowSlope = this._slope(recentLows);

    if (highSlope > 0.00002 && lowSlope > 0.00002 && lowSlope > highSlope * 0.5) {
      const lastLow = recentLows[recentLows.length - 1].price;
      if (last.close < lastLow && prev.close >= lastLow) return { symbol, direction: 'PUT', strategy: 'rising_wedge', confidence: 0.70, details: `Rising Wedge — breakout p/ baixo @ ${lastLow.toFixed(4)}` };
    }
    if (highSlope < -0.00002 && lowSlope < -0.00002 && highSlope < lowSlope * 0.5) {
      const lastHigh = recentHighs[recentHighs.length - 1].price;
      if (last.close > lastHigh && prev.close <= lastHigh) return { symbol, direction: 'CALL', strategy: 'falling_wedge', confidence: 0.70, details: `Falling Wedge — breakout p/ cima @ ${lastHigh.toFixed(4)}` };
    }
    return null;
  }

  _detectCupAndHandle(candles, symbol) {
    if (candles.length < 25) return null;
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const seg = candles.slice(-25);
    const closes = seg.map(c => c.close);
    const midStart = 5, midEnd = 18;

    let minIdx = midStart;
    for (let i = midStart; i <= midEnd; i++) { if (closes[i] < closes[minIdx]) minIdx = i; }
    const leftRim = closes[0], rightRim = closes[midEnd], cupBottom = closes[minIdx];
    const rimAvg = (leftRim + rightRim) / 2;
    const cupDepth = (rimAvg - cupBottom) / rimAvg;

    if (cupDepth > 0.002 && cupDepth < 0.02) {
      const rimDiff = Math.abs(leftRim - rightRim) / rimAvg;
      if (rimDiff < 0.005) {
        const handleCandles = seg.slice(midEnd);
        if (handleCandles.length >= 3) {
          const handleLow = Math.min(...handleCandles.map(c => c.low));
          const handleHigh = Math.max(leftRim, rightRim);
          if (handleLow > cupBottom + (rimAvg - cupBottom) * 0.5) {
            if (last.close > handleHigh && prev.close <= handleHigh) return { symbol, direction: 'CALL', strategy: 'cup_handle', confidence: 0.75, details: `Cup & Handle — breakout @ ${handleHigh.toFixed(4)}` };
          }
        }
      }
    }

    let maxIdx = midStart;
    for (let i = midStart; i <= midEnd; i++) { if (closes[i] > closes[maxIdx]) maxIdx = i; }
    const cupTop = closes[maxIdx];
    const invCupDepth = (cupTop - rimAvg) / rimAvg;
    if (invCupDepth > 0.002 && invCupDepth < 0.02) {
      const rimDiff = Math.abs(leftRim - rightRim) / rimAvg;
      if (rimDiff < 0.005) {
        const handleCandles = seg.slice(midEnd);
        if (handleCandles.length >= 3) {
          const handleHigh = Math.max(...handleCandles.map(c => c.high));
          const handleLow = Math.min(leftRim, rightRim);
          if (handleHigh < cupTop - (cupTop - rimAvg) * 0.5) {
            if (last.close < handleLow && prev.close >= handleLow) return { symbol, direction: 'PUT', strategy: 'inv_cup_handle', confidence: 0.75, details: `Inv Cup & Handle — breakdown @ ${handleLow.toFixed(4)}` };
          }
        }
      }
    }
    return null;
  }

  _detectCandlestickPatterns(candles, symbol, trend15m) {
    if (candles.length < 10) return null;
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const localTrend = this._getLocalTrend(candles, 10);
    const body = Math.abs(last.close - last.open);
    const range = last.high - last.low;
    const isBullish = last.close > last.open;
    if (range === 0) return null;

    if (localTrend === 'down') {
      const pBody = Math.abs(prev.close - prev.open);
      const pRange = prev.high - prev.low;
      const pLowerWick = Math.min(prev.open, prev.close) - prev.low;
      const pUpperWick = prev.high - Math.max(prev.open, prev.close);
      if (pRange > 0 && pLowerWick > pBody * 2 && pUpperWick < pBody * 0.5 && isBullish) {
        return { symbol, direction: 'CALL', strategy: 'hammer', confidence: 0.65, details: `Hammer + confirmação bullish — reversão de fundo` };
      }
    }

    if (localTrend === 'up') {
      const pBody = Math.abs(prev.close - prev.open);
      const pRange = prev.high - prev.low;
      const pUpperWick = prev.high - Math.max(prev.open, prev.close);
      const pLowerWick = Math.min(prev.open, prev.close) - prev.low;
      if (pRange > 0 && pUpperWick > pBody * 2 && pLowerWick < pBody * 0.5 && !isBullish) {
        return { symbol, direction: 'PUT', strategy: 'shooting_star', confidence: 0.65, details: `Shooting Star + confirmação bearish — reversão de topo` };
      }
      if (pRange > 0 && pLowerWick > pBody * 2 && pUpperWick < pBody * 0.5 && !isBullish) {
        return { symbol, direction: 'PUT', strategy: 'hanging_man', confidence: 0.63, details: `Hanging Man + confirmação bearish — topo` };
      }
    }

    if (localTrend === 'down' && isBullish && prev.close < prev.open) {
      if (last.open <= prev.close && last.close >= prev.open && body > Math.abs(prev.close - prev.open) * 1.3) {
        return { symbol, direction: 'CALL', strategy: 'bull_engulfing', confidence: 0.68, details: `Bullish Engulfing — reversão de fundo` };
      }
    }

    if (localTrend === 'up' && !isBullish && prev.close > prev.open) {
      if (last.open >= prev.close && last.close <= prev.open && body > Math.abs(prev.close - prev.open) * 1.3) {
        return { symbol, direction: 'PUT', strategy: 'bear_engulfing', confidence: 0.68, details: `Bearish Engulfing — reversão de topo` };
      }
    }
    return null;
  }

  _detectTripleTopBottom(candles, symbol) {
    const { pivotHighs, pivotLows } = this._findPivots(candles, 3, 2);
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];

    if (pivotHighs.length >= 3) {
      const tops = pivotHighs.slice(-3);
      const avgTop = tops.reduce((s, p) => s + p.price, 0) / 3;
      const maxDev = Math.max(...tops.map(p => Math.abs(p.price - avgTop)));
      if (maxDev / avgTop < 0.003) {
        let support = Infinity;
        for (let i = tops[0].index; i <= tops[2].index; i++) { if (candles[i].low < support) support = candles[i].low; }
        if (last.close < support && prev.close >= support) return { symbol, direction: 'PUT', strategy: 'triple_top', confidence: 0.78, details: `Triple Top — suporte quebrado @ ${support.toFixed(4)}` };
      }
    }

    if (pivotLows.length >= 3) {
      const bots = pivotLows.slice(-3);
      const avgBot = bots.reduce((s, p) => s + p.price, 0) / 3;
      const maxDev = Math.max(...bots.map(p => Math.abs(p.price - avgBot)));
      if (maxDev / avgBot < 0.003) {
        let resistance = -Infinity;
        for (let i = bots[0].index; i <= bots[2].index; i++) { if (candles[i].high > resistance) resistance = candles[i].high; }
        if (last.close > resistance && prev.close <= resistance) return { symbol, direction: 'CALL', strategy: 'triple_bottom', confidence: 0.78, details: `Triple Bottom — resistência rompida @ ${resistance.toFixed(4)}` };
      }
    }
    return null;
  }

  _detectRounding(candles, symbol) {
    if (candles.length < 20) return null;
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const seg = candles.slice(-20);
    const closes = seg.map(c => c.close);
    const mid = Math.floor(closes.length / 2);
    const firstHalf = closes.slice(0, mid);
    const secondHalf = closes.slice(mid);
    const firstSlope = (firstHalf[firstHalf.length - 1] - firstHalf[0]) / firstHalf[0];
    const secondSlope = (secondHalf[secondHalf.length - 1] - secondHalf[0]) / secondHalf[0];

    if (firstSlope < -0.001 && secondSlope > 0.001) {
      const resistance = Math.max(closes[0], closes[closes.length - 2]);
      if (last.close > resistance && prev.close <= resistance) return { symbol, direction: 'CALL', strategy: 'rounding_bottom', confidence: 0.68, details: `Rounding Bottom — breakout @ ${resistance.toFixed(4)}` };
    }
    if (firstSlope > 0.001 && secondSlope < -0.001) {
      const support = Math.min(closes[0], closes[closes.length - 2]);
      if (last.close < support && prev.close >= support) return { symbol, direction: 'PUT', strategy: 'rounding_top', confidence: 0.68, details: `Rounding Top — breakdown @ ${support.toFixed(4)}` };
    }
    return null;
  }
}

module.exports = ChartPatternAnalyzer;
```

### src/strategy/progression.js
```javascript
class Progression {
  constructor(baseStake = 5.00) {
    this.baseStake = baseStake;
    this.currentLevel = 0;
    this.maxLevel = 6;
    this.totalLost = 0;
    this.targetProfit = baseStake;
    this.payout = 0.92;
  }

  getNextStake() {
    if (this.currentLevel === 0) return this.baseStake;
    return Math.ceil(((this.totalLost + this.targetProfit) / this.payout) * 100) / 100;
  }

  advance(lostAmount) {
    this.totalLost += lostAmount;
    this.currentLevel++;
    console.log(`[PROG] Level ${this.currentLevel}: lost $${this.totalLost.toFixed(2)}, next stake: $${this.getNextStake().toFixed(2)}`);
  }

  reset() { this.currentLevel = 0; this.totalLost = 0; }
  hardReset() { this.reset(); console.log('[PROG] Hard reset to level 0'); }
  getStatus() { return { level: this.currentLevel, totalLost: this.totalLost, nextStake: this.getNextStake(), maxLevel: this.maxLevel }; }
}

module.exports = Progression;
```

### src/services/deriv.js
```javascript
const WebSocket = require('ws');
const EventEmitter = require('events');

class DerivService extends EventEmitter {
  constructor(token, appId = '1089') {
    super();
    this.token = token;
    this.appId = appId;
    this.ws = null;
    this.authorized = false;
    this.balance = 0;
    this.accountId = '';
    this.currency = 'USD';
    this.reconnectDelay = 3000;
    this.maxReconnects = 10;
    this.reconnectCount = 0;
    this.subscriptions = {};
    this.pendingBuy = null;
    this._reqIdMap = {};
    this._nextReqId = 100;
    this._activeContractId = null;
    this._resultEmitted = false;
    this._pocPollInterval = null;
    this.candles = {};
  }

  _reqId(symbol, tf) { const id = this._nextReqId++; this._reqIdMap[id] = { symbol, tf }; return id; }

  connect() {
    return new Promise((resolve, reject) => {
      const url = `wss://ws.derivws.com/websockets/v3?app_id=${this.appId}`;
      this.ws = new WebSocket(url);
      this.ws.on('open', () => { console.log('[DERIV] WebSocket connected'); this.ws.send(JSON.stringify({ authorize: this.token })); });
      this._msgCount = 0;
      this.ws.on('message', (data) => {
        try {
          const str = typeof data === 'string' ? data : data.toString();
          const msg = JSON.parse(str);
          this._msgCount++;
          if (this._msgCount <= 30 || this._msgCount % 100 === 0) console.log(`[DERIV] msg #${this._msgCount}: ${msg.msg_type}`);
          this._handleMessage(msg, resolve);
        } catch (e) { console.error('[DERIV] Parse error:', e.message); }
      });
      this.ws.on('close', () => { console.log('[DERIV] WebSocket closed'); this.authorized = false; this._stopPocPolling(); this._reconnect(); });
      this.ws.on('error', (err) => { console.error('[DERIV] WebSocket error:', err.message); reject(err); });
      setTimeout(() => { if (!this.authorized) reject(new Error('Auth timeout')); }, 15000);
    });
  }

  _handleMessage(msg, resolveConnect) {
    if (msg.error) { console.error('[DERIV] API Error:', msg.error.code, msg.error.message); if (msg.msg_type === 'buy') this.emit('trade_error', msg.error); return; }
    switch (msg.msg_type) {
      case 'authorize': this.authorized = true; this.balance = msg.authorize.balance; this.accountId = msg.authorize.loginid; this.currency = msg.authorize.currency; console.log(`[DERIV] Authorized: ${this.accountId} | Balance: $${this.balance}`); this.reconnectCount = 0; this.ws.send(JSON.stringify({ balance: 1, subscribe: 1 })); this.ws.send(JSON.stringify({ transaction: 1, subscribe: 1 })); if (resolveConnect) resolveConnect(); this.emit('authorized', msg.authorize); break;
      case 'candles': this._handleCandleHistory(msg); break;
      case 'ohlc': this._handleCandleUpdate(msg); break;
      case 'proposal': this._handleProposal(msg); break;
      case 'buy': this._handleBuy(msg); break;
      case 'proposal_open_contract': this._handleContractUpdate(msg); break;
      case 'balance': if (msg.balance) this.balance = msg.balance.balance; this.emit('balance', this.balance); break;
      case 'transaction': if (msg.transaction) this.emit('transaction', msg.transaction); break;
      default: if (msg.ohlc) this._handleCandleUpdate(msg); break;
    }
  }

  async subscribeCandles(symbol) {
    if (!this.candles[symbol]) this.candles[symbol] = { '5m': [], '15m': [] };
    for (const [tf, gran] of [['5m', 300], ['15m', 900]]) {
      this.ws.send(JSON.stringify({ ticks_history: symbol, adjust_start_time: 1, count: 200, end: 'latest', granularity: gran, style: 'candles', subscribe: 1, req_id: this._reqId(symbol, tf) }));
    }
    console.log(`[DERIV] Subscribing to ${symbol} candles (5m + 15m)`);
  }

  _handleCandleHistory(msg) {
    const reqId = msg.req_id; const mapping = this._reqIdMap[reqId]; if (!mapping) return;
    const { symbol, tf } = mapping;
    if (!this.candles[symbol]) this.candles[symbol] = { '5m': [], '15m': [] };
    if (msg.candles) {
      this.candles[symbol][tf] = msg.candles.map(c => ({ open: parseFloat(c.open), high: parseFloat(c.high), low: parseFloat(c.low), close: parseFloat(c.close), epoch: c.epoch }));
      console.log(`[DERIV] Loaded ${msg.candles.length} ${tf} candles for ${symbol}`);
    }
    if (msg.subscription) this.subscriptions[`${symbol}_${tf}`] = msg.subscription.id;
    const data = this.candles[symbol];
    if (data['5m'].length > 0 && data['15m'].length > 0) this.emit('candles_ready', symbol);
  }

  _handleCandleUpdate(msg) {
    const ohlc = msg.ohlc; if (!ohlc) return;
    const symbol = ohlc.symbol; const gran = parseInt(ohlc.granularity);
    const tf = gran === 300 ? '5m' : gran === 900 ? '15m' : null;
    if (!tf || !this.candles[symbol]) return;
    const openTime = parseInt(ohlc.open_time) || Math.floor(parseInt(ohlc.epoch) / gran) * gran;
    const candle = { open: parseFloat(ohlc.open), high: parseFloat(ohlc.high), low: parseFloat(ohlc.low), close: parseFloat(ohlc.close), epoch: parseInt(ohlc.epoch), openTime: openTime };
    const candles = this.candles[symbol][tf];
    const last = candles.length > 0 ? candles[candles.length - 1] : null;
    const lastOpenTime = last ? (last.openTime || Math.floor(last.epoch / gran) * gran) : null;
    if (last && lastOpenTime === openTime) { candles[candles.length - 1] = candle; }
    else {
      candles.push(candle); if (candles.length > 250) candles.shift();
      if (tf === '5m' && candles.length >= 2) {
        const closedCandle = candles[candles.length - 2];
        console.log(`[CANDLE] ${symbol} 5m CLOSED | open_time=${closedCandle.openTime} | O:${closedCandle.open} H:${closedCandle.high} L:${closedCandle.low} C:${closedCandle.close}`);
        this.emit('candle_close', { symbol, candle: closedCandle, candles5m: candles.slice(0, -1), candles15m: this.candles[symbol]['15m'].slice(0, -1) });
      }
    }
  }

  async buyContract(symbol, direction, amount) {
    const contractType = direction === 'CALL' ? 'CALL' : 'PUT';
    return new Promise((resolve, reject) => {
      this.pendingBuy = { resolve, reject, amount };
      this.ws.send(JSON.stringify({ proposal: 1, amount, basis: 'stake', contract_type: contractType, currency: this.currency, duration: 5, duration_unit: 'm', symbol }));
      setTimeout(() => { if (this.pendingBuy) { this.pendingBuy = null; reject(new Error('Trade timeout')); } }, 30000);
    });
  }

  _handleProposal(msg) {
    if (!this.pendingBuy) return;
    const proposal = msg.proposal;
    console.log(`[DERIV] Proposal: stake=$${proposal.ask_price}, payout=$${proposal.payout}`);
    this.ws.send(JSON.stringify({ buy: proposal.id, price: proposal.ask_price }));
    if (proposal.id) this.ws.send(JSON.stringify({ forget: proposal.id }));
  }

  _handleBuy(msg) {
    const buy = msg.buy;
    console.log(`[DERIV] Trade executed: contract_id=${buy.contract_id}, payout=$${buy.payout}`);
    this._activeContractId = buy.contract_id; this._resultEmitted = false;
    this.ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: buy.contract_id, subscribe: 1, req_id: this._nextReqId++ }));
    this._startPocPolling(buy.contract_id);
    if (this.pendingBuy) {
      this.pendingBuy.resolve({ contractId: buy.contract_id, buyPrice: buy.buy_price, payout: buy.payout, transactionId: buy.transaction_id, balanceAfter: buy.balance_after, shortcode: buy.shortcode, longcode: buy.longcode });
      this.pendingBuy = null;
    }
  }

  _startPocPolling(contractId) {
    this._stopPocPolling();
    this._pocPollInterval = setInterval(() => {
      if (this._resultEmitted) { this._stopPocPolling(); return; }
      console.log(`[DERIV] Polling contract ${contractId} status...`);
      this.ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: contractId, req_id: this._nextReqId++ }));
    }, 30000);
  }

  _stopPocPolling() { if (this._pocPollInterval) { clearInterval(this._pocPollInterval); this._pocPollInterval = null; } }

  _handleContractUpdate(msg) {
    const contract = msg.proposal_open_contract; if (!contract) return;
    if (this._resultEmitted && contract.contract_id == this._activeContractId) return;
    const isSold = contract.is_sold === 1 || contract.is_sold === true;
    const status = contract.status;
    if (isSold && (status === 'won' || status === 'lost')) {
      const won = status === 'won';
      const sellPrice = parseFloat(contract.sell_price) || 0;
      const buyPrice = parseFloat(contract.buy_price) || 0;
      const profit = sellPrice - buyPrice;
      const balAfter = contract.balance_after || this.balance;
      console.log(`[DERIV] ${won ? 'WIN' : 'LOSS'}: profit=${profit.toFixed(2)}, sell=${sellPrice}, buy=${buyPrice}, balance=${balAfter}`);
      if (contract.balance_after) this.balance = contract.balance_after;
      this._resultEmitted = true; this._stopPocPolling();
      this.emit('contract_result', { contractId: contract.contract_id, won, profit, buyPrice, payout: parseFloat(contract.payout), balanceAfter: balAfter, entrySpot: contract.entry_spot_display_value, exitSpot: contract.exit_spot_display_value, symbol: contract.underlying });
      if (msg.subscription) this.ws.send(JSON.stringify({ forget: msg.subscription.id }));
    }
  }

  _reconnect() {
    if (this.reconnectCount >= this.maxReconnects) { console.error('[DERIV] Max reconnects reached'); this.emit('disconnected'); return; }
    this.reconnectCount++;
    console.log(`[DERIV] Reconnecting in ${this.reconnectDelay / 1000}s (attempt ${this.reconnectCount})`);
    setTimeout(async () => {
      try { await this.connect(); for (const symbol of Object.keys(this.candles)) await this.subscribeCandles(symbol); this.emit('reconnected'); }
      catch (e) { console.error('[DERIV] Reconnect failed:', e.message); }
    }, this.reconnectDelay);
  }

  getBalance() { return this.balance; }
  getAccountId() { return this.accountId; }
  isDemo() { return this.accountId.startsWith('VRTC'); }
}

module.exports = DerivService;
```

### src/services/telegram.js
```javascript
const https = require('https');

class TelegramService {
  constructor(botToken, chatId) { this.botToken = botToken; this.chatId = chatId; }

  async send(text, options = {}) {
    return new Promise((resolve) => {
      const payload = { chat_id: this.chatId, text, parse_mode: 'HTML' };
      if (options.buttons) payload.reply_markup = JSON.stringify({ inline_keyboard: options.buttons });
      const data = JSON.stringify(payload);
      const reqOptions = { hostname: 'api.telegram.org', path: `/bot${this.botToken}/sendMessage`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } };
      const req = https.request(reqOptions, (res) => { let body = ''; res.on('data', d => body += d); res.on('end', () => { try { const resp = JSON.parse(body); if (!resp.ok) console.error('[TG] Error:', resp.description); else resolve(resp.result); } catch(e) { resolve(); } }); });
      req.on('error', (e) => { console.error('[TG] Send error:', e.message); resolve(); });
      req.write(data); req.end();
    });
  }

  async editMessage(messageId, text, options = {}) {
    return new Promise((resolve) => {
      const payload = { chat_id: this.chatId, message_id: messageId, text, parse_mode: 'HTML' };
      if (options.buttons) payload.reply_markup = JSON.stringify({ inline_keyboard: options.buttons });
      const data = JSON.stringify(payload);
      const reqOptions = { hostname: 'api.telegram.org', path: `/bot${this.botToken}/editMessageText`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } };
      const req = https.request(reqOptions, (res) => { let body = ''; res.on('data', d => body += d); res.on('end', () => { try { const resp = JSON.parse(body); if (!resp.ok) console.error('[TG] Edit error:', resp.description); } catch(e) {} resolve(); }); });
      req.on('error', (e) => { console.error('[TG] Edit error:', e.message); resolve(); });
      req.write(data); req.end();
    });
  }
}

module.exports = TelegramService;
```

---

## CONFIGURAÇÕES DO BOT

| Parâmetro | Valor |
|-----------|-------|
| Base Stake | $5.00 |
| Martingale Levels | 0-6 |
| Payout Rate | 92% |
| Timeframe | 5 minutos |
| Expiração | 5 minutos |
| Tipo de contrato | CALL/PUT |
| Cooldown por símbolo | 6 minutos |
| Max trades/dia | 20 |
| Conta | Demo VRTC11240175 |
| Símbolos | R_75, R_25, R_100, R_50, R_10 |

---

## TROUBLESHOOTING

### Bot não conecta na Deriv
- Verifique se o token `<SEU_DERIV_TOKEN>` ainda é válido em https://app.deriv.com/account/api-token
- Se expirou, gere um novo token com permissões: Read, Trade, Payments

### Bot não manda mensagem no Telegram
- Verifique se o bot token está correto
- Teste: `curl -s "https://api.telegram.org/bot<SEU_TG_BOT_TOKEN>/sendMessage?chat_id=<SEU_TG_CHAT_ID>&text=teste"`

### Better-sqlite3 não compila
- O Dockerfile já inclui `python3 make g++`
- Se ainda falhar, tente `npm rebuild better-sqlite3`

### Render dorme (free tier)
- O bot tem self-ping a cada 10 minutos
- Se mesmo assim dormir, acesse a URL manualmente para acordar

### Bot não opera (sem sinais)
- Normal — chart patterns são raros. Pode ficar horas sem sinal.
- Verifique logs: `[CANDLE] ... 5m CLOSED` deve aparecer a cada 5 min
- Se não aparece, problema na conexão WebSocket

---

**ÚLTIMA ATUALIZAÇÃO**: 27 de maio de 2026
**VERSÃO**: v3.0 (Chart Pattern Strategies)
