/**
 * BACKTEST COMPLETO — Deriv OTC Synthetics
 * Puxa dados históricos reais via API, simula todas as estratégias
 * com progressão martingale idêntica ao bot live.
 */

const WebSocket = require('ws');
const ChartPatternAnalyzer = require('./src/strategy/analyzer');

const APP_ID = 1089;
const SYMBOLS = ['R_75', 'R_25', 'R_100', 'R_50', 'R_10'];
const BASE_STAKE = 5.00;
const PAYOUT = 0.92;
const MAX_LEVEL = 6;
const INITIAL_BALANCE = 10000;

// How many 5m candles to fetch (max ~5000 from Deriv = ~17 days)
const CANDLE_COUNT = 5000;

const SYMBOL_NAMES = {
  'R_10': 'Vol 10', 'R_25': 'Vol 25', 'R_50': 'Vol 50',
  'R_75': 'Vol 75', 'R_100': 'Vol 100'
};

// ---- Fetch historical candles ----
function fetchCandles(symbol, granularity, count) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
    const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 30000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        ticks_history: symbol,
        style: 'candles',
        granularity,
        count,
        end: 'latest',
        adjust_start_time: 1
      }));
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.error) { clearTimeout(timeout); ws.close(); reject(new Error(msg.error.message)); return; }
      if (msg.candles) {
        clearTimeout(timeout);
        ws.close();
        resolve(msg.candles.map(c => ({
          open: +c.open, high: +c.high, low: +c.low, close: +c.close,
          epoch: c.epoch
        })));
      }
    });

    ws.on('error', (e) => { clearTimeout(timeout); reject(e); });
  });
}

// ---- Progression (Martingale) ----
class Progression {
  constructor() { this.reset(); }
  reset() { this.level = 0; this.totalLost = 0; }
  getStake() {
    if (this.level === 0) return BASE_STAKE;
    return Math.ceil(((this.totalLost + BASE_STAKE) / PAYOUT) * 100) / 100;
  }
  advance(lost) { this.totalLost += lost; this.level++; }
}

// ---- Run backtest ----
async function main() {
  console.log('='.repeat(60));
  console.log('  BACKTEST COMPLETO — Chart Patterns + Martingale');
  console.log('  Ativos:', SYMBOLS.join(', '));
  console.log(`  Stake base: $${BASE_STAKE} | Payout: ${PAYOUT*100}% | Max nível: ${MAX_LEVEL}`);
  console.log('='.repeat(60));
  console.log();

  // 1) Fetch all candles
  const allCandles = {};
  for (const sym of SYMBOLS) {
    process.stdout.write(`  Buscando ${sym} 5m (${CANDLE_COUNT} candles)...`);
    const c5m = await fetchCandles(sym, 300, CANDLE_COUNT);
    process.stdout.write(` ${c5m.length} OK | `);
    
    process.stdout.write(`15m...`);
    const c15m = await fetchCandles(sym, 900, Math.floor(CANDLE_COUNT / 3));
    console.log(` ${c15m.length} OK`);
    
    allCandles[sym] = { c5m, c15m };
  }

  // Date range
  const allEpochs = Object.values(allCandles).flatMap(d => d.c5m.map(c => c.epoch));
  const startDate = new Date(Math.min(...allEpochs) * 1000);
  const endDate = new Date(Math.max(...allEpochs) * 1000);
  const totalDays = ((endDate - startDate) / 86400000).toFixed(1);

  console.log(`\n  Período: ${startDate.toISOString().slice(0,10)} → ${endDate.toISOString().slice(0,10)} (${totalDays} dias)`);
  console.log();

  // 2) Simulate
  const analyzer = new ChartPatternAnalyzer();
  const prog = new Progression();
  let balance = INITIAL_BALANCE;
  let maxBalance = balance;
  let minBalance = balance;
  let maxDrawdown = 0;

  const trades = [];
  const strategyStats = {};
  const symbolStats = {};
  const dailyStats = {};
  const levelStats = {};
  
  // Cooldown tracking per symbol
  const lastTradeEpoch = {};
  const COOLDOWN = 6 * 60; // 6 min in seconds

  // We need at least 50 candles to start analyzing
  const MIN_CANDLES = 50;

  for (const sym of SYMBOLS) {
    symbolStats[sym] = { wins: 0, losses: 0, profit: 0, trades: 0 };
  }

  // Process candles chronologically across all symbols
  // Build timeline of 5m candle closes
  const timeline = [];
  for (const sym of SYMBOLS) {
    const { c5m, c15m } = allCandles[sym];
    for (let i = MIN_CANDLES; i < c5m.length; i++) {
      timeline.push({
        symbol: sym,
        index: i,
        epoch: c5m[i].epoch,
        candles5m: c5m.slice(Math.max(0, i - 200), i + 1),
        // Find matching 15m candles up to this epoch
        candles15m: c15m.filter(c => c.epoch <= c5m[i].epoch).slice(-50)
      });
    }
  }

  // Sort by epoch (chronological)
  timeline.sort((a, b) => a.epoch - b.epoch);

  console.log(`  Total de pontos de análise: ${timeline.length.toLocaleString()}`);
  console.log('  Simulando...\n');

  let signalCount = 0;

  for (const point of timeline) {
    const { symbol, epoch, candles5m, candles15m } = point;

    // Cooldown check
    if (lastTradeEpoch[symbol] && (epoch - lastTradeEpoch[symbol]) < COOLDOWN) continue;

    // Skip if active trade (simplified: we assume 5min duration, no overlap)
    // In reality the bot waits for result before next trade

    // Analyze
    const signal = analyzer.analyze(symbol, candles5m, candles15m);
    if (!signal) continue;

    signalCount++;

    // Check max level
    if (prog.level >= MAX_LEVEL) {
      prog.reset(); // hard reset at max level
    }

    const stake = prog.getStake();
    
    // Can we afford it?
    if (stake > balance) {
      prog.reset();
      continue;
    }

    // Determine win/loss based on actual next candle
    // For 5min expiry: we check if price moved in our direction after 5 minutes
    // The next candle's close vs current candle's close
    const currentIdx = point.index;
    const allC5m = allCandles[symbol].c5m;
    
    if (currentIdx + 1 >= allC5m.length) continue; // no next candle
    
    const entryPrice = allC5m[currentIdx].close;
    const exitPrice = allC5m[currentIdx + 1].close;
    
    let won = false;
    if (signal.direction === 'CALL') {
      won = exitPrice > entryPrice;
    } else {
      won = exitPrice < entryPrice;
    }

    const day = new Date(epoch * 1000).toISOString().slice(0, 10);
    const profit = won ? (stake * PAYOUT) : -stake;
    balance += profit;

    if (balance > maxBalance) maxBalance = balance;
    if (balance < minBalance) minBalance = balance;
    const dd = maxBalance - balance;
    if (dd > maxDrawdown) maxDrawdown = dd;

    // Record trade
    trades.push({
      symbol, direction: signal.direction, strategy: signal.strategy,
      stake, profit, won, level: prog.level, balance, day, epoch
    });

    // Update stats
    const strat = signal.strategy;
    if (!strategyStats[strat]) strategyStats[strat] = { wins: 0, losses: 0, profit: 0, trades: 0 };
    strategyStats[strat].trades++;
    if (won) { strategyStats[strat].wins++; } else { strategyStats[strat].losses++; }
    strategyStats[strat].profit += profit;

    symbolStats[symbol].trades++;
    if (won) { symbolStats[symbol].wins++; } else { symbolStats[symbol].losses++; }
    symbolStats[symbol].profit += profit;

    const lvl = prog.level;
    if (!levelStats[lvl]) levelStats[lvl] = { wins: 0, losses: 0, profit: 0, trades: 0 };
    levelStats[lvl].trades++;
    if (won) { levelStats[lvl].wins++; } else { levelStats[lvl].losses++; }
    levelStats[lvl].profit += profit;

    if (!dailyStats[day]) dailyStats[day] = { wins: 0, losses: 0, profit: 0, trades: 0, balance };
    dailyStats[day].trades++;
    if (won) { dailyStats[day].wins++; } else { dailyStats[day].losses++; }
    dailyStats[day].profit += profit;
    dailyStats[day].balance = balance;

    // Cooldown
    lastTradeEpoch[symbol] = epoch;

    // Progression
    if (won) {
      prog.reset();
    } else {
      prog.advance(stake);
    }
  }

  // ---- RESULTS ----
  const totalTrades = trades.length;
  const wins = trades.filter(t => t.won).length;
  const losses = totalTrades - wins;
  const totalProfit = balance - INITIAL_BALANCE;
  const winRate = totalTrades > 0 ? (wins / totalTrades * 100).toFixed(1) : '0.0';

  console.log('='.repeat(60));
  console.log('  📊 RESULTADO DO BACKTEST');
  console.log('='.repeat(60));
  console.log();
  console.log(`  📅 Período: ${startDate.toISOString().slice(0,10)} → ${endDate.toISOString().slice(0,10)} (${totalDays} dias)`);
  console.log(`  📈 Sinais detectados: ${signalCount.toLocaleString()}`);
  console.log(`  🔄 Trades executados: ${totalTrades}`);
  console.log(`  ✅ Wins: ${wins}  |  ❌ Losses: ${losses}`);
  console.log(`  📊 Win Rate: ${winRate}%`);
  console.log(`  💰 Lucro total: $${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)}`);
  console.log(`  💵 Balance final: $${balance.toFixed(2)}`);
  console.log(`  📉 Max Drawdown: $${maxDrawdown.toFixed(2)}`);
  console.log(`  📈 Max Balance: $${maxBalance.toFixed(2)}`);
  console.log(`  📊 ROI: ${((totalProfit / INITIAL_BALANCE) * 100).toFixed(2)}%`);
  console.log(`  📊 Trades/dia: ${(totalTrades / parseFloat(totalDays)).toFixed(1)}`);
  console.log();

  // Streaks
  let maxWinStreak = 0, maxLossStreak = 0, curWin = 0, curLoss = 0;
  for (const t of trades) {
    if (t.won) { curWin++; curLoss = 0; maxWinStreak = Math.max(maxWinStreak, curWin); }
    else { curLoss++; curWin = 0; maxLossStreak = Math.max(maxLossStreak, curLoss); }
  }
  console.log(`  🔥 Maior sequência WIN: ${maxWinStreak}`);
  console.log(`  💀 Maior sequência LOSS: ${maxLossStreak}`);
  console.log();

  // By strategy
  console.log('━'.repeat(60));
  console.log('  POR ESTRATÉGIA');
  console.log('━'.repeat(60));
  const sortedStrats = Object.entries(strategyStats).sort((a, b) => b[1].profit - a[1].profit);
  console.log(`  ${'Estratégia'.padEnd(22)} ${'Trades'.padStart(7)} ${'Wins'.padStart(6)} ${'Loss'.padStart(6)} ${'WR%'.padStart(7)} ${'Lucro'.padStart(10)}`);
  console.log(`  ${'─'.repeat(22)} ${'─'.repeat(7)} ${'─'.repeat(6)} ${'─'.repeat(6)} ${'─'.repeat(7)} ${'─'.repeat(10)}`);
  for (const [name, s] of sortedStrats) {
    const wr = s.trades > 0 ? (s.wins / s.trades * 100).toFixed(1) : '0.0';
    const emoji = s.profit >= 0 ? '🟢' : '🔴';
    console.log(`  ${emoji} ${name.padEnd(20)} ${String(s.trades).padStart(7)} ${String(s.wins).padStart(6)} ${String(s.losses).padStart(6)} ${(wr + '%').padStart(7)} $${(s.profit >= 0 ? '+' : '') + s.profit.toFixed(2).padStart(9)}`);
  }
  console.log();

  // By symbol
  console.log('━'.repeat(60));
  console.log('  POR ATIVO');
  console.log('━'.repeat(60));
  const sortedSymbols = Object.entries(symbolStats).sort((a, b) => b[1].profit - a[1].profit);
  console.log(`  ${'Ativo'.padEnd(10)} ${'Trades'.padStart(7)} ${'Wins'.padStart(6)} ${'Loss'.padStart(6)} ${'WR%'.padStart(7)} ${'Lucro'.padStart(10)}`);
  console.log(`  ${'─'.repeat(10)} ${'─'.repeat(7)} ${'─'.repeat(6)} ${'─'.repeat(6)} ${'─'.repeat(7)} ${'─'.repeat(10)}`);
  for (const [name, s] of sortedSymbols) {
    if (s.trades === 0) continue;
    const wr = (s.wins / s.trades * 100).toFixed(1);
    const emoji = s.profit >= 0 ? '🟢' : '🔴';
    console.log(`  ${emoji} ${name.padEnd(8)} ${String(s.trades).padStart(7)} ${String(s.wins).padStart(6)} ${String(s.losses).padStart(6)} ${(wr + '%').padStart(7)} $${(s.profit >= 0 ? '+' : '') + s.profit.toFixed(2).padStart(9)}`);
  }
  console.log();

  // By progression level
  console.log('━'.repeat(60));
  console.log('  POR NÍVEL DE PROGRESSÃO (MARTINGALE)');
  console.log('━'.repeat(60));
  for (let l = 0; l <= MAX_LEVEL; l++) {
    const s = levelStats[l];
    if (!s) continue;
    const wr = (s.wins / s.trades * 100).toFixed(1);
    const emoji = s.profit >= 0 ? '🟢' : '🔴';
    console.log(`  ${emoji} Nível ${l}: ${s.trades} trades (${s.wins}W/${s.losses}L) — WR ${wr}% — $${s.profit >= 0 ? '+' : ''}${s.profit.toFixed(2)}`);
  }
  console.log();

  // Daily breakdown
  console.log('━'.repeat(60));
  console.log('  POR DIA');
  console.log('━'.repeat(60));
  const sortedDays = Object.entries(dailyStats).sort((a, b) => a[0].localeCompare(b[0]));
  console.log(`  ${'Dia'.padEnd(12)} ${'Trades'.padStart(7)} ${'W/L'.padStart(8)} ${'WR%'.padStart(7)} ${'Lucro'.padStart(10)} ${'Balance'.padStart(12)}`);
  console.log(`  ${'─'.repeat(12)} ${'─'.repeat(7)} ${'─'.repeat(8)} ${'─'.repeat(7)} ${'─'.repeat(10)} ${'─'.repeat(12)}`);
  
  let greenDays = 0, redDays = 0;
  for (const [day, s] of sortedDays) {
    const wr = (s.wins / s.trades * 100).toFixed(0);
    const emoji = s.profit >= 0 ? '🟢' : '🔴';
    if (s.profit >= 0) greenDays++; else redDays++;
    console.log(`  ${emoji} ${day} ${String(s.trades).padStart(7)} ${(s.wins + '/' + s.losses).padStart(8)} ${(wr + '%').padStart(7)} $${(s.profit >= 0 ? '+' : '') + s.profit.toFixed(2).padStart(9)} $${s.balance.toFixed(2).padStart(11)}`);
  }
  console.log();
  console.log(`  🟢 Dias verdes: ${greenDays}  |  🔴 Dias vermelhos: ${redDays}  |  Taxa: ${(greenDays / (greenDays + redDays) * 100).toFixed(0)}%`);
  console.log();

  // Consistency metrics
  const profits = sortedDays.map(([_, s]) => s.profit);
  const avgDaily = profits.reduce((a, b) => a + b, 0) / profits.length;
  const variance = profits.reduce((s, p) => s + Math.pow(p - avgDaily, 2), 0) / profits.length;
  const stdDev = Math.sqrt(variance);
  const sharpe = stdDev > 0 ? (avgDaily / stdDev) : 0;

  console.log('━'.repeat(60));
  console.log('  MÉTRICAS DE CONSISTÊNCIA');
  console.log('━'.repeat(60));
  console.log(`  📊 Lucro médio/dia: $${avgDaily >= 0 ? '+' : ''}${avgDaily.toFixed(2)}`);
  console.log(`  📊 Desvio padrão: $${stdDev.toFixed(2)}`);
  console.log(`  📊 Sharpe Ratio (diário): ${sharpe.toFixed(3)}`);
  console.log(`  📊 Profit Factor: ${(() => {
    const grossProfit = trades.filter(t => t.won).reduce((s, t) => s + t.profit, 0);
    const grossLoss = Math.abs(trades.filter(t => !t.won).reduce((s, t) => s + t.profit, 0));
    return grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : 'Inf';
  })()}`);
  console.log(`  📊 Max Drawdown: $${maxDrawdown.toFixed(2)} (${(maxDrawdown / maxBalance * 100).toFixed(2)}%)`);
  console.log(`  📊 Recovery Factor: ${maxDrawdown > 0 ? (totalProfit / maxDrawdown).toFixed(2) : 'Inf'}`);
  console.log();

  // Verdict
  console.log('='.repeat(60));
  if (totalProfit > 0 && parseFloat(winRate) >= 45 && maxDrawdown < INITIAL_BALANCE * 0.3) {
    console.log('  ✅ VEREDICTO: ESTRATÉGIA CONSISTENTE');
    console.log(`  O sistema gerou $${totalProfit.toFixed(2)} em ${totalDays} dias.`);
    if (parseFloat(sharpe) > 0.5) {
      console.log('  Sharpe > 0.5: Boa relação risco/retorno.');
    }
    if (greenDays > redDays) {
      console.log(`  ${greenDays}/${greenDays + redDays} dias verdes: Consistência boa.`);
    }
  } else if (totalProfit > 0) {
    console.log('  ⚠️  VEREDICTO: LUCRATIVO MAS COM RESSALVAS');
    if (maxDrawdown > INITIAL_BALANCE * 0.2) {
      console.log(`  Drawdown alto ($${maxDrawdown.toFixed(2)}) — cuidado com gestão de risco.`);
    }
  } else {
    console.log('  ❌ VEREDICTO: ESTRATÉGIA NÃO CONSISTENTE NESTE PERÍODO');
    console.log('  Ajustar parâmetros ou filtrar estratégias fracas.');
  }
  console.log('='.repeat(60));
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
