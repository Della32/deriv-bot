/**
 * Trading Engine v2.2 — OTC Synthetics
 * Automatic mode: analyze every 5min candle close, execute if signal found
 * Progression (martingale) shared across all symbols
 * Modern Telegram notifications with HTML + inline buttons
 * v2.2 — SQLite state persistence for crash recovery
 */

const ChartPatternAnalyzer = require('./strategy/analyzer');
const Progression = require('./strategy/progression');

// Pretty names for symbols
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

    // Cooldown per symbol
    this.lastTradeTime = {};
    this.COOLDOWN_MS = 6 * 60 * 1000;

    // Safety: max trades per day
    this.MAX_DAILY_TRADES = 20;
    this.dailyTrades = 0;
    this.lastResetDay = new Date().toDateString();

    // DB statements for state persistence
    if (this.db) {
      this._stmtGet = this.db.prepare('SELECT value FROM state WHERE key = ?');
      this._stmtSet = this.db.prepare("INSERT OR REPLACE INTO state (key, value, updated_at) VALUES (?, ?, datetime('now'))");

      // Restore state from DB
      this._restoreState();
    }

    // Auto-save state every 60 seconds
    this._saveInterval = setInterval(() => this.saveState(), 60000);
  }

  // ===== STATE PERSISTENCE =====

  _restoreState() {
    try {
      // Restore progression
      const progData = this._stmtGet.get('progression');
      if (progData) {
        this.progression.fromJSON(JSON.parse(progData.value));
      }

      // Restore stats
      const statsData = this._stmtGet.get('stats');
      if (statsData) {
        const s = JSON.parse(statsData.value);
        this.stats.wins = s.wins || 0;
        this.stats.losses = s.losses || 0;
        this.stats.totalProfit = s.totalProfit || 0;
        console.log(`[ENGINE] Stats restored: ${this.stats.wins}W/${this.stats.losses}L, P&L: $${this.stats.totalProfit.toFixed(2)}`);
      }

      // Restore daily trades count
      const dailyData = this._stmtGet.get('daily_trades');
      if (dailyData) {
        const d = JSON.parse(dailyData.value);
        if (d.day === new Date().toDateString()) {
          this.dailyTrades = d.count || 0;
          console.log(`[ENGINE] Daily trades restored: ${this.dailyTrades}`);
        }
      }

      // Restore last trade times per symbol
      const lttData = this._stmtGet.get('last_trade_times');
      if (lttData) {
        this.lastTradeTime = JSON.parse(lttData.value);
        console.log(`[ENGINE] Last trade times restored for ${Object.keys(this.lastTradeTime).length} symbols`);
      }

      console.log('[ENGINE] State restored from database');
    } catch (e) {
      console.error('[ENGINE] State restore error (starting fresh):', e.message);
    }
  }

  saveState() {
    if (!this.db || !this._stmtSet) return;
    try {
      this._stmtSet.run('progression', JSON.stringify(this.progression.toJSON()));
      this._stmtSet.run('stats', JSON.stringify(this.stats));
      this._stmtSet.run('daily_trades', JSON.stringify({
        day: new Date().toDateString(),
        count: this.dailyTrades
      }));
      this._stmtSet.run('last_trade_times', JSON.stringify(this.lastTradeTime));
    } catch (e) {
      console.error('[ENGINE] State save error:', e.message);
    }
  }

  // ===== HELPERS =====

  _name(symbol) {
    return SYMBOL_NAMES[symbol] || symbol;
  }

  _short(symbol) {
    return SYMBOL_SHORT[symbol] || symbol;
  }

  _time() {
    return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Rio_Branco' });
  }

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
    console.log(`[ENGINE] Progression level: ${this.progression.currentLevel}`);

    // Listen for candle closes
    this.deriv.on('candle_close', (data) => this._onCandleClose(data));

    // Listen for contract results
    this.deriv.on('contract_result', (result) => this._onContractResult(result));

    // Listen for trade errors
    this.deriv.on('trade_error', (error) => this._onTradeError(error));

    // Fallback: transaction stream (catches sell events if POC subscription fails)
    this.deriv.on('transaction', (tx) => {
      if (tx.action === 'sell' && this.activeTrade) {
        console.log(`[ENGINE] Transaction sell detected: contract=${tx.contract_id}, amount=${tx.amount}`);
        // Give POC subscription 3 seconds to handle it first, then fallback
        setTimeout(() => {
          if (this.activeTrade && this.activeTrade.contractId == tx.contract_id) {
            console.log(`[ENGINE] Using transaction fallback for contract ${tx.contract_id}`);
            const sellAmount = parseFloat(tx.amount);
            const profit = sellAmount - this.activeTrade.stake;
            const won = profit > 0;
            this._onContractResult({
              contractId: tx.contract_id,
              won,
              profit,
              buyPrice: this.activeTrade.stake,
              payout: this.activeTrade.payout,
              balanceAfter: tx.balance || this.deriv.getBalance(),
              symbol: this.activeTrade.symbol
            });
          }
        }, 3000);
      }
    });

    // NOTE: Startup Telegram message is now handled in index.js with dedup logic
  }

  stop() {
    this.running = false;
    this.saveState();
    if (this._saveInterval) clearInterval(this._saveInterval);
    console.log('[ENGINE] Stopped — state saved');
  }

  async _onCandleClose(data) {
    if (!this.running) return;
    if (this.activeTrade) return;

    const today = new Date().toDateString();
    if (today !== this.lastResetDay) {
      this.dailyTrades = 0;
      this.lastResetDay = today;
    }
    if (this.dailyTrades >= this.MAX_DAILY_TRADES) return;

    const now = Date.now();
    if (this.lastTradeTime[data.symbol] && now - this.lastTradeTime[data.symbol] < this.COOLDOWN_MS) {
      return;
    }

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

    // Safety check for real account
    if (!this.deriv.isDemo()) {
      const balance = this.deriv.getBalance();
      if (stake > balance * 0.3) {
        console.log(`[ENGINE] ⚠️ Stake too high. Skipping.`);
        return;
      }
    }

    this.activeTrade = {
      symbol: signal.symbol,
      direction: signal.direction,
      stake,
      level,
      strategy: signal.strategy,
      confidence: signal.confidence,
      details: signal.details,
      label: this._name(signal.symbol),
      shortLabel: this._short(signal.symbol),
      timestamp: Date.now()
    };

    // Safety timeout: 7 min
    this._tradeTimeout = setTimeout(() => {
      if (this.activeTrade) {
        console.log(`[ENGINE] ⚠️ Trade timeout!`);
        const t = this.activeTrade;
        this.activeTrade = null;
        if (this.telegram) {
          this.telegram.send(
            `⚠️ <b>Trade Timeout</b>\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `${t.label} | ${t.direction}\n` +
            `Resultado não recebido em 7 min.\n` +
            `Trade liberado automaticamente.`
          );
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

      // Save state immediately after trade
      this.saveState();

      const dirEmoji = signal.direction === 'CALL' ? '🟢' : '🔴';
      const dirIcon = signal.direction === 'CALL' ? '📈' : '📉';
      const confPct = (signal.confidence * 100).toFixed(0);
      const confBar = '█'.repeat(Math.round(signal.confidence * 10)) + '░'.repeat(10 - Math.round(signal.confidence * 10));

      // Send trade open message
      if (this.telegram) {
        const msg = await this.telegram.send(
          `${dirEmoji} <b>TRADE ABERTO</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `\n` +
          `${dirIcon} <b>${signal.direction}</b> — ${this._name(signal.symbol)}\n` +
          `\n` +
          `💰 Entrada: <b>$${stake.toFixed(2)}</b>\n` +
          `🎯 Payout: <b>$${result.payout}</b>\n` +
          `📊 Lucro potencial: <b>$${(parseFloat(result.payout) - stake).toFixed(2)}</b>\n` +
          `\n` +
          `🧠 Estratégia: <code>${signal.strategy}</code>\n` +
          `📋 ${signal.details}\n` +
          `🔋 Confiança: ${confBar} ${confPct}%\n` +
          `\n` +
          `🔄 Level: ${level} | Trade #${this.dailyTrades}\n` +
          `🕐 ${this._time()}\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `<i>⏳ Aguardando resultado (5 min)...</i>`,
          {
            buttons: [
              [{ text: `⏳ Operando — ${this._short(signal.symbol)}`, callback_data: 'info' }],
              [{ text: `📊 ${this._statsLine()}`, callback_data: 'stats' }]
            ]
          }
        );
        this.tradeMessageId = msg?.message_id || null;
      }

      console.log(`[ENGINE] Trade placed: contract=${result.contractId}, payout=$${result.payout}`);
    } catch (e) {
      console.error(`[ENGINE] Trade failed:`, e.message);
      this.activeTrade = null;

      if (this.telegram) {
        this.telegram.send(
          `❌ <b>Trade Falhou</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `${signal.direction} — ${this._name(signal.symbol)}\n` +
          `Erro: <code>${e.message}</code>`
        );
      }
    }
  }

  async _onContractResult(result) {
    if (!this.activeTrade) return;

    if (this._tradeTimeout) {
      clearTimeout(this._tradeTimeout);
      this._tradeTimeout = null;
    }

    const trade = this.activeTrade;
    this.activeTrade = null;

    // Update progression
    if (result.won) {
      this.stats.wins++;
      this.progression.reset();
    } else {
      this.stats.losses++;
      this.progression.advance(trade.stake);
    }
    this.stats.totalProfit += result.profit;

    // Save state immediately after result
    this.saveState();

    const totalTrades = this.stats.wins + this.stats.losses;
    const wr = totalTrades > 0 ? (this.stats.wins / totalTrades * 100).toFixed(1) : '0.0';
    const nextStake = this.progression.getNextStake();
    const nextLevel = this.progression.currentLevel;

    console.log(`[ENGINE] ${result.won ? '🟢 WIN' : '🔴 LOSS'} | Profit: $${result.profit} | Balance: $${result.balanceAfter}`);
    console.log(`[ENGINE] Stats: ${this._statsLine()} | P&L: $${this.stats.totalProfit.toFixed(2)}`);

    // Save to DB trades table
    if (this.db) {
      try {
        this.db.prepare(`
          INSERT INTO trades (symbol, direction, stake, payout, profit, won, strategy, level, balance_after, timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          trade.symbol, trade.direction, trade.stake, trade.payout || 0,
          result.profit, result.won ? 1 : 0, trade.strategy, trade.level,
          result.balanceAfter, new Date().toISOString()
        );
      } catch (e) {
        console.error('[ENGINE] DB error:', e.message);
      }
    }

    // Update the trade message with result
    if (this.telegram) {
      const profitSign = result.profit >= 0 ? '+' : '';
      const plSign = this.stats.totalProfit >= 0 ? '+' : '';

      if (result.won) {
        const winMsg =
          `✅ <b>WIN</b>  •  ${trade.shortLabel}\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `\n` +
          `${trade.direction === 'CALL' ? '📈' : '📉'} <b>${trade.direction}</b> — ${trade.label}\n` +
          `\n` +
          `💰 Entrada: $${trade.stake.toFixed(2)}\n` +
          `💵 Retorno: <b>$${(trade.stake + result.profit).toFixed(2)}</b>\n` +
          `✨ Lucro: <b>${profitSign}$${result.profit.toFixed(2)}</b>\n` +
          `\n` +
          `💼 Saldo: <b>$${parseFloat(result.balanceAfter).toFixed(2)}</b>\n` +
          `📊 ${this._statsLine()}\n` +
          `💵 P&L: <b>${plSign}$${this.stats.totalProfit.toFixed(2)}</b>\n` +
          `\n` +
          `➡️ Próximo: Level ${nextLevel} ($${nextStake.toFixed(2)})\n` +
          `🕐 ${this._time()}\n` +
          `━━━━━━━━━━━━━━━━━━`;

        if (this.tradeMessageId) {
          await this.telegram.editMessage(this.tradeMessageId, winMsg, {
            buttons: [
              [{ text: `✅ WIN +$${result.profit.toFixed(2)}`, callback_data: 'won' }],
              [{ text: `📊 ${this._statsLine()}`, callback_data: 'stats' }, { text: `💰 $${parseFloat(result.balanceAfter).toFixed(2)}`, callback_data: 'bal' }]
            ]
          });
        } else {
          await this.telegram.send(winMsg, {
            buttons: [
              [{ text: `✅ WIN +$${result.profit.toFixed(2)}`, callback_data: 'won' }],
              [{ text: `📊 ${this._statsLine()}`, callback_data: 'stats' }, { text: `💰 $${parseFloat(result.balanceAfter).toFixed(2)}`, callback_data: 'bal' }]
            ]
          });
        }
      } else {
        const lossMsg =
          `❌ <b>LOSS</b>  •  ${trade.shortLabel}\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `\n` +
          `${trade.direction === 'CALL' ? '📈' : '📉'} <b>${trade.direction}</b> — ${trade.label}\n` +
          `\n` +
          `💰 Entrada: $${trade.stake.toFixed(2)}\n` +
          `💸 Perdido: <b>$${Math.abs(result.profit).toFixed(2)}</b>\n` +
          `\n` +
          `💼 Saldo: <b>$${parseFloat(result.balanceAfter).toFixed(2)}</b>\n` +
          `📊 ${this._statsLine()}\n` +
          `💵 P&L: <b>${plSign}$${this.stats.totalProfit.toFixed(2)}</b>\n` +
          `\n` +
          `⚡ Martingale: Level ${nextLevel} ($${nextStake.toFixed(2)})\n` +
          `🕐 ${this._time()}\n` +
          `━━━━━━━━━━━━━━━━━━`;

        if (this.tradeMessageId) {
          await this.telegram.editMessage(this.tradeMessageId, lossMsg, {
            buttons: [
              [{ text: `❌ LOSS -$${Math.abs(result.profit).toFixed(2)}`, callback_data: 'lost' }],
              [{ text: `📊 ${this._statsLine()}`, callback_data: 'stats' }, { text: `💰 $${parseFloat(result.balanceAfter).toFixed(2)}`, callback_data: 'bal' }]
            ]
          });
        } else {
          await this.telegram.send(lossMsg, {
            buttons: [
              [{ text: `❌ LOSS -$${Math.abs(result.profit).toFixed(2)}`, callback_data: 'lost' }],
              [{ text: `📊 ${this._statsLine()}`, callback_data: 'stats' }, { text: `💰 $${parseFloat(result.balanceAfter).toFixed(2)}`, callback_data: 'bal' }]
            ]
          });
        }
      }

      this.tradeMessageId = null;
    }

    // Safety: max progression
    if (this.progression.currentLevel >= this.progression.maxLevel) {
      console.log('[ENGINE] ⚠️ Max progression reached. Resetting.');
      this.progression.hardReset();
      this.saveState();
      if (this.telegram) {
        this.telegram.send(
          `🚨 <b>Alerta — Max Progression</b>\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `Nível máximo de martingale atingido.\n` +
          `Resetando para Level 0.`,
          {
            buttons: [
              [{ text: '⚠️ Resetado para Level 0', callback_data: 'reset' }]
            ]
          }
        );
      }
    }
  }

  _onTradeError(error) {
    console.error('[ENGINE] Trade error:', error.message);
    this.activeTrade = null;
  }
}

module.exports = TradingEngine;
