/**
 * Calibração individual de TODOS os pares — encontrar params ótimos pra cada um
 * Depois ranquear e escolher os melhores pra compor o bot
 */
require('dotenv').config();
const WebSocket = require('ws');
const { getRSISignal } = require('./indicators/rsi');
const { getBollingerSignal } = require('./indicators/bollinger');
const { calculateATR } = require('./indicators/atr');

const APP_ID = process.env.DERIV_APP_ID || '1089';

const PAIRS = [
  'frxEURUSD', 'frxGBPUSD', 'frxUSDJPY', 'frxAUDUSD',
  'frxEURGBP', 'frxEURJPY', 'frxGBPJPY', 'frxUSDCAD',
  'frxUSDCHF', 'frxAUDJPY', 'frxNZDUSD', 'frxEURAUD',
  'frxEURCAD', 'frxAUDCAD'
];

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

function simulateTrade(dir, entry, outcome) {
  if (!outcome) return null;
  if (dir === 'CALL') return outcome.close > entry.close ? 'WIN' : 'LOSS';
  return outcome.close < entry.close ? 'WIN' : 'LOSS';
}

/**
 * FASE 1: Encontrar horas boas pra cada par (RSI 20/80 + BB agree, sem filtro hora)
 */
function findGoodHours(candles) {
  const hourStats = {};
  for (let h = 0; h < 24; h++) hourStats[h] = { w: 0, l: 0 };
  const WARMUP = 55;

  for (let i = WARMUP; i < candles.length - 1; i++) {
    const window = candles.slice(Math.max(0, i - 99), i + 1);
    const closes = window.map(c => c.close);
    const current = candles[i];
    const next = candles[i + 1];
    const dow = new Date(current.epoch * 1000).getUTCDay();
    if (dow === 0 || dow === 6) continue;

    const rsi = getRSISignal(closes, 9);
    const bb = getBollingerSignal(closes, 20, 2);
    if (!rsi.signal || !bb.signal || rsi.signal !== bb.signal) continue;
    // Use RSI 25/75 to get more data points for hour analysis
    if (rsi.value > 25 && rsi.value < 75) continue;

    const result = simulateTrade(rsi.signal, current, next);
    if (!result) continue;

    const h = new Date(current.epoch * 1000).getUTCHours();
    if (result === 'WIN') hourStats[h].w++;
    else hourStats[h].l++;
  }

  const good = [], bad = [];
  for (let h = 0; h < 24; h++) {
    const s = hourStats[h];
    const t = s.w + s.l;
    if (t < 2) continue; // Poucos dados, ignora
    const wr = s.w / t * 100;
    if (wr >= 70 && t >= 3) good.push(h);
    else if (wr < 55) bad.push(h);
  }

  return { good, bad, hourStats };
}

/**
 * FASE 2: Testar combinações de params com as horas boas encontradas
 */
function testConfigs(candles, goodHours, badHours) {
  const WARMUP = 55;
  const goodSet = new Set(goodHours);
  const badSet = new Set(badHours);

  const configs = [
    // Config A: Strict (RSI 20/80 + goodHours + bigBody OR hiRange)
    { name: 'strict', rsiLow: 20, rsiHigh: 80, useGoodHours: true, candleFilter: 'or', bodyTh: 0.6, rangeTh: 1.2 },
    // Config B: Strict sem filtro vela
    { name: 'strict_noCF', rsiLow: 20, rsiHigh: 80, useGoodHours: true, candleFilter: 'none' },
    // Config C: RSI 25/75 + goodHours + bigBody OR hiRange
    { name: 'relaxRSI', rsiLow: 25, rsiHigh: 75, useGoodHours: true, candleFilter: 'or', bodyTh: 0.6, rangeTh: 1.2 },
    // Config D: RSI 25/75 + goodHours sem filtro vela
    { name: 'relaxRSI_noCF', rsiLow: 25, rsiHigh: 75, useGoodHours: true, candleFilter: 'none' },
    // Config E: RSI 20/80 + goodHours + body>0.5 OR range>1.0 (relaxed candle)
    { name: 'relaxCandle', rsiLow: 20, rsiHigh: 80, useGoodHours: true, candleFilter: 'or', bodyTh: 0.5, rangeTh: 1.0 },
    // Config F: RSI 20/80 + não-bad hours + bigBody OR hiRange
    { name: 'notBadHr', rsiLow: 20, rsiHigh: 80, useNotBad: true, candleFilter: 'or', bodyTh: 0.6, rangeTh: 1.2 },
    // Config G: RSI 20/80 + não-bad hours sem filtro
    { name: 'notBadHr_noCF', rsiLow: 20, rsiHigh: 80, useNotBad: true, candleFilter: 'none' },
  ];

  const results = [];

  for (const cfg of configs) {
    let wins = 0, losses = 0;
    const tradesByDay = {};

    for (let i = WARMUP; i < candles.length - 1; i++) {
      const window = candles.slice(Math.max(0, i - 99), i + 1);
      const closes = window.map(c => c.close);
      const current = candles[i];
      const next = candles[i + 1];
      const dow = new Date(current.epoch * 1000).getUTCDay();
      if (dow === 0 || dow === 6) continue;
      const h = new Date(current.epoch * 1000).getUTCHours();

      // Hour filter
      if (cfg.useGoodHours && !goodSet.has(h)) continue;
      if (cfg.useNotBad && badSet.has(h)) continue;

      const rsi = getRSISignal(closes, 9);
      const bb = getBollingerSignal(closes, 20, 2);
      if (!rsi.signal || !bb.signal || rsi.signal !== bb.signal) continue;
      if (rsi.value > cfg.rsiLow && rsi.value < cfg.rsiHigh) continue;

      // Candle filter
      if (cfg.candleFilter !== 'none') {
        const bodySize = Math.abs(current.close - current.open);
        const candleRange = current.high - current.low;
        const bodyRatio = candleRange > 0 ? bodySize / candleRange : 0;
        const atr = calculateATR(candles.slice(Math.max(0, i - 14), i + 1), 14);
        const rangeRatio = atr > 0 ? candleRange / atr : 0;
        const bigBody = bodyRatio > (cfg.bodyTh || 0.6);
        const hiRange = rangeRatio > (cfg.rangeTh || 1.2);

        if (cfg.candleFilter === 'or' && !bigBody && !hiRange) continue;
        if (cfg.candleFilter === 'and' && (!bigBody || !hiRange)) continue;
      }

      // Squeeze block
      if (bb.isSqueeze) continue;

      const result = simulateTrade(rsi.signal, current, next);
      if (!result) continue;

      if (result === 'WIN') wins++;
      else losses++;

      const dayKey = new Date(current.epoch * 1000).toISOString().slice(0, 10);
      tradesByDay[dayKey] = (tradesByDay[dayKey] || 0) + 1;
    }

    const total = wins + losses;
    const tradeDays = Object.keys(tradesByDay).length;
    const perDay = tradeDays > 0 ? total / tradeDays : 0;
    const wr = total > 0 ? wins / total * 100 : 0;

    results.push({
      name: cfg.name,
      wins, losses, total,
      wr: wr.toFixed(1),
      perDay: perDay.toFixed(1),
      tradeDays,
      goodHours: goodHours.join(','),
    });
  }

  return results;
}

async function calibratePair(symbol) {
  try {
    const candles = await fetchCandles(symbol);
    const days = Math.round(candles.length / (24 * 12));

    // Find good hours
    const { good, bad, hourStats } = findGoodHours(candles);

    if (good.length === 0) {
      return { symbol, error: 'Nenhuma hora boa encontrada', days };
    }

    // Test all configs
    const results = testConfigs(candles, good, bad);

    // Find best: highest WR with at least 1 trade/day avg
    const viable = results.filter(r => r.total >= 5 && parseFloat(r.wr) >= 70);
    viable.sort((a, b) => {
      // Score: WR * 0.7 + perDay * 3 (balance WR and volume)
      const scoreA = parseFloat(a.wr) * 0.7 + parseFloat(a.perDay) * 3;
      const scoreB = parseFloat(b.wr) * 0.7 + parseFloat(b.perDay) * 3;
      return scoreB - scoreA;
    });

    // Also find highest WR regardless of volume
    const bestWR = results.filter(r => r.total >= 5).sort((a, b) => parseFloat(b.wr) - parseFloat(a.wr));

    return {
      symbol,
      days,
      candles: candles.length,
      goodHours: good,
      badHours: bad,
      hourStats,
      allResults: results,
      bestBalanced: viable[0] || null,
      bestWR: bestWR[0] || null,
    };
  } catch (err) {
    return { symbol, error: err.message };
  }
}

async function main() {
  console.log('═'.repeat(75));
  console.log('  🔧 CALIBRAÇÃO INDIVIDUAL — Todos os 14 pares forex');
  console.log('═'.repeat(75));

  const allResults = [];

  for (const pair of PAIRS) {
    process.stdout.write(`\n  Calibrando ${pair}...`);
    const result = await calibratePair(pair);

    if (result.error) {
      console.log(` ❌ ${result.error}`);
    } else {
      const best = result.bestWR;
      if (best) {
        console.log(` ✅ ${best.total} trades, ${best.wr}% WR, ${best.perDay}/dia [${result.goodHours.join(',')}]`);
      } else {
        console.log(` ⚠️ Nenhuma config viável`);
      }
    }

    allResults.push(result);
    await new Promise(ok => setTimeout(ok, 1500));
  }

  // ─── RANKING FINAL ───
  console.log('\n\n' + '═'.repeat(75));
  console.log('  🏆 RANKING — Melhor config de cada par (WR ≥ 70%, 5+ trades)');
  console.log('═'.repeat(75));

  const ranked = allResults
    .filter(r => !r.error && r.bestWR)
    .map(r => ({
      symbol: r.symbol,
      days: r.days,
      ...r.bestWR,
      goodHoursArr: r.goodHours,
      // Score combines WR and volume
      score: parseFloat(r.bestWR.wr) * 0.6 + parseFloat(r.bestWR.perDay) * 5,
    }))
    .sort((a, b) => parseFloat(b.wr) - parseFloat(a.wr));

  console.log(`\n  ${'#'.padStart(2)}  ${'Par'.padEnd(13)} ${'Config'.padEnd(16)} ${'Trades'.padStart(6)}  ${'/dia'.padStart(5)}  ${'WR%'.padStart(6)}  ${'Horas boas'}`);
  console.log('  ' + '─'.repeat(72));

  ranked.forEach((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    const wrNum = parseFloat(r.wr);
    const icon = wrNum >= 90 ? '🔥' : wrNum >= 85 ? '✅' : wrNum >= 80 ? '🟡' : wrNum >= 70 ? '⚠️' : '❌';
    console.log(`  ${medal} ${r.symbol.padEnd(13)} ${r.name.padEnd(16)} ${String(r.total).padStart(6)}  ${r.perDay.padStart(5)}  ${r.wr.padStart(5)}% ${icon}  [${r.goodHoursArr.join(',')}]`);
  });

  // ─── DETALHE DOS TOP 5 ───
  console.log('\n\n' + '═'.repeat(75));
  console.log('  📋 DETALHE DOS TOP 5 — Todas as configs testadas');
  console.log('═'.repeat(75));

  const top5 = ranked.slice(0, 7);
  for (const r of top5) {
    const full = allResults.find(a => a.symbol === r.symbol);
    if (!full || !full.allResults) continue;

    console.log(`\n  ─── ${r.symbol} (${full.days} dias, horas boas: [${full.goodHours.join(',')}]) ───`);
    console.log(`  ${'Config'.padEnd(18)} ${'Trades'.padStart(6)}  ${'/dia'.padStart(5)}  ${'WR%'.padStart(6)}  ${'W'.padStart(3)}/${'L'.padStart(3)}`);

    for (const cfg of full.allResults) {
      if (cfg.total === 0) continue;
      const icon = parseFloat(cfg.wr) >= 90 ? '🔥' : parseFloat(cfg.wr) >= 85 ? '✅' : parseFloat(cfg.wr) >= 80 ? '🟡' : parseFloat(cfg.wr) >= 70 ? '⚠️' : '❌';
      console.log(`  ${icon} ${cfg.name.padEnd(18)} ${String(cfg.total).padStart(6)}  ${cfg.perDay.padStart(5)}  ${cfg.wr.padStart(5)}%  ${String(cfg.wins).padStart(3)}/${String(cfg.losses).padStart(3)}`);
    }
  }

  // ─── RECOMENDAÇÃO FINAL ───
  console.log('\n\n' + '═'.repeat(75));
  console.log('  💎 RECOMENDAÇÃO — Composição do bot pra 6-8 trades/dia');
  console.log('═'.repeat(75));

  // Pick pairs that together give 6-8 trades/day with good WR
  const candidates = ranked.filter(r => parseFloat(r.wr) >= 80);
  let totalPerDay = 0;
  const selected = [];

  // Start with best WR, add until we hit target
  for (const c of candidates) {
    selected.push(c);
    totalPerDay += parseFloat(c.perDay);
    if (totalPerDay >= 7) break;
  }

  if (selected.length > 0) {
    console.log('\n  Pares selecionados:');
    let sumTrades = 0, sumWins = 0, sumLosses = 0;
    for (const s of selected) {
      console.log(`    → ${s.symbol} | ${s.name} | ${s.perDay}/dia | ${s.wr}% WR | Horas: [${s.goodHoursArr.join(',')}]`);
      sumTrades += s.total;
      sumWins += s.wins;
      sumLosses += s.losses;
    }
    const combinedWR = sumTrades > 0 ? (sumWins / sumTrades * 100).toFixed(1) : '-';
    console.log(`\n  📊 Total estimado: ${totalPerDay.toFixed(1)} trades/dia | WR combinado: ${combinedWR}%`);
    console.log(`  📊 Pares: ${selected.length} | Assets: ${selected.map(s => s.symbol).join(',')}`);
  }

  // Also show if we need to relax to hit target
  if (totalPerDay < 6) {
    console.log('\n  ⚠️ Não atingiu 6/dia com WR ≥ 80%. Adicionando WR ≥ 75%:');
    const extra = ranked.filter(r => parseFloat(r.wr) >= 75 && !selected.find(s => s.symbol === r.symbol));
    for (const e of extra) {
      selected.push(e);
      totalPerDay += parseFloat(e.perDay);
      console.log(`    + ${e.symbol} | ${e.name} | ${e.perDay}/dia | ${e.wr}% WR`);
      if (totalPerDay >= 7) break;
    }
    let sumTrades = 0, sumWins = 0;
    for (const s of selected) { sumTrades += s.total; sumWins += s.wins; }
    console.log(`\n  📊 Total: ${totalPerDay.toFixed(1)} trades/dia | WR: ${(sumWins/sumTrades*100).toFixed(1)}%`);
    console.log(`  📊 Assets: ${selected.map(s => s.symbol).join(',')}`);
  }

  // Hour overlap check
  console.log('\n  ⏰ Mapa de horas (quais pares operam em cada hora):');
  const hourMap = {};
  for (const s of selected) {
    for (const h of s.goodHoursArr) {
      if (!hourMap[h]) hourMap[h] = [];
      hourMap[h].push(s.symbol.replace('frx', ''));
    }
  }
  for (let h = 0; h < 24; h++) {
    if (hourMap[h] && hourMap[h].length > 0) {
      console.log(`    H${String(h).padStart(2,'0')}: ${hourMap[h].join(', ')}`);
    }
  }

  console.log('\n' + '═'.repeat(75) + '\n');
}

main().catch(console.error);
