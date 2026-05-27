/**
 * Backtest v7 — Valida o Analyzer multi-asset calibrado
 */
require('dotenv').config();
const WebSocket = require('ws');
const Analyzer = require('./strategy/analyzer');

const APP_ID = process.env.DERIV_APP_ID || '1089';
const PAIRS = ['frxEURUSD', 'frxGBPJPY', 'frxAUDCAD', 'frxAUDJPY'];

async function fetchCandles(symbol) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        ticks_history: symbol,
        adjust_start_time: 1,
        count: 5000,
        end: 'latest',
        granularity: 300,
        style: 'candles'
      }));
    });
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.error) { ws.close(); return reject(new Error(msg.error.message)); }
      if (msg.candles) {
        ws.close();
        resolve(msg.candles.map(c => ({
          open: parseFloat(c.open),
          high: parseFloat(c.high),
          low: parseFloat(c.low),
          close: parseFloat(c.close),
          epoch: c.epoch
        })));
      }
    });
    ws.on('error', reject);
    setTimeout(() => { ws.close(); reject(new Error('Timeout')); }, 30000);
  });
}

async function main() {
  console.log('═'.repeat(70));
  console.log('  🧪 BACKTEST v7 — Analyzer Multi-Asset Calibrado');
  console.log('═'.repeat(70));

  const analyzer = new Analyzer();
  const allTrades = [];
  const pairStats = {};

  for (const symbol of PAIRS) {
    process.stdout.write(`  ${symbol}...`);
    const candles = await fetchCandles(symbol);
    const WARMUP = 55;
    let wins = 0, losses = 0;
    const tradesByDay = {};
    const trades = [];

    for (let i = WARMUP; i < candles.length - 1; i++) {
      const window = candles.slice(Math.max(0, i - 99), i + 1);
      const current = candles[i];
      const next = candles[i + 1];

      const result = analyzer.analyze(symbol, window, current.epoch * 1000);
      if (!result.signal) continue;

      const direction = result.signal;
      let tradeResult;
      if (direction === 'CALL') tradeResult = next.close > current.close ? 'WIN' : 'LOSS';
      else tradeResult = next.close < current.close ? 'WIN' : 'LOSS';

      if (tradeResult === 'WIN') wins++;
      else losses++;

      const dayKey = new Date(current.epoch * 1000).toISOString().slice(0, 10);
      tradesByDay[dayKey] = (tradesByDay[dayKey] || 0) + 1;

      trades.push({
        symbol,
        time: new Date(current.epoch * 1000).toISOString().slice(0, 16),
        hour: new Date(current.epoch * 1000).getUTCHours(),
        direction,
        result: tradeResult,
        tier: result.tierName,
        rsi: result.indicators.rsi.value,
        confidence: result.confidence,
      });
    }

    const total = wins + losses;
    const tradeDays = Object.keys(tradesByDay).length;
    const perDay = tradeDays > 0 ? (total / tradeDays).toFixed(1) : '0';
    const wr = total > 0 ? (wins / total * 100).toFixed(1) : '-';

    pairStats[symbol] = { wins, losses, total, wr, perDay, tradeDays, tradesByDay };
    allTrades.push(...trades);

    console.log(` ${total} trades, ${wr}% WR, ${perDay}/dia`);
    await new Promise(ok => setTimeout(ok, 1500));
  }

  // ─── RESUMO COMBINADO ───
  console.log('\n' + '═'.repeat(70));
  console.log('  📊 RESUMO COMBINADO');
  console.log('═'.repeat(70));

  let totalW = 0, totalL = 0;
  const allDays = {};

  for (const [sym, s] of Object.entries(pairStats)) {
    totalW += s.wins;
    totalL += s.losses;
    for (const [day, count] of Object.entries(s.tradesByDay)) {
      allDays[day] = (allDays[day] || 0) + count;
    }
    const icon = parseFloat(s.wr) >= 90 ? '🔥' : parseFloat(s.wr) >= 85 ? '✅' : '🟡';
    console.log(`  ${icon} ${sym.padEnd(13)} ${String(s.total).padStart(3)} trades  ${s.wr.padStart(5)}% WR  ${s.perDay.padStart(4)}/dia`);
  }

  const totalTrades = totalW + totalL;
  const totalDays = Object.keys(allDays).length;
  const combinedWR = totalTrades > 0 ? (totalW / totalTrades * 100).toFixed(1) : '-';
  const combinedPerDay = totalDays > 0 ? (totalTrades / totalDays).toFixed(1) : '0';

  console.log('  ' + '─'.repeat(55));
  console.log(`  🏆 TOTAL:       ${String(totalTrades).padStart(3)} trades  ${combinedWR.padStart(5)}% WR  ${combinedPerDay.padStart(4)}/dia`);
  console.log(`     ${totalW}W / ${totalL}L em ${totalDays} dias`);

  // Trades por dia
  console.log('\n  📅 Trades por dia:');
  const sortedDays = Object.entries(allDays).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [day, count] of sortedDays) {
    const dow = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][new Date(day).getUTCDay()];
    const bar = '█'.repeat(count);
    console.log(`    ${day} (${dow}) ${bar} ${count}`);
  }

  const avg = sortedDays.length > 0 ? (sortedDays.reduce((s, d) => s + d[1], 0) / sortedDays.length).toFixed(1) : '0';
  const min = Math.min(...sortedDays.map(d => d[1]));
  const max = Math.max(...sortedDays.map(d => d[1]));
  console.log(`\n    Média: ${avg}/dia | Min: ${min} | Max: ${max}`);

  // Losses detail
  const lossDetails = allTrades.filter(t => t.result === 'LOSS');
  if (lossDetails.length > 0) {
    console.log('\n  ❌ Detalhes das losses:');
    for (const l of lossDetails) {
      console.log(`    ${l.time} ${l.symbol.replace('frx','')} ${l.direction} H${l.hour} RSI:${l.rsi} ${l.tier}`);
    }
  }

  // Progression simulation
  console.log('\n' + '═'.repeat(70));
  console.log('  💰 SIMULAÇÃO COM PROGRESSÃO (R$1.20 base, payout 85%)');
  console.log('═'.repeat(70));

  const baseBet = 1.20;
  const payout = 0.85;
  let profit = 0;
  let level = 1;
  let accumulated = 0;

  for (const t of allTrades) {
    let bet;
    if (level === 1) bet = baseBet;
    else bet = Math.round(((accumulated + 1) / payout) * 100) / 100;

    if (t.result === 'WIN') {
      const win = Math.round(bet * payout * 100) / 100;
      profit += win - accumulated;
      level = 1;
      accumulated = 0;
    } else {
      accumulated += bet;
      profit -= bet;
      level = Math.min(level + 1, 6);
      if (level > 6) { level = 1; accumulated = 0; }
    }
  }

  console.log(`  Lucro estimado: R$${profit.toFixed(2)} em ${totalDays} dias`);
  console.log(`  Média: R$${(profit / totalDays).toFixed(2)}/dia`);

  console.log('\n' + '═'.repeat(70) + '\n');
}

main().catch(console.error);
