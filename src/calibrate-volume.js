/**
 * Calibração de Volume — Encontrar config que dê 6-8 trades/dia mantendo WR alto
 * 
 * Alavancas pra aumentar trades:
 * 1. Relaxar RSI (25/75 em vez de 20/80)
 * 2. Adicionar mais goodHours
 * 3. Relaxar candle quality (bigBody/hiRange)
 * 4. Adicionar Tier 2 e Tier 3
 * 5. Combinar tudo acima
 */
require('dotenv').config();
const WebSocket = require('ws');
const { getRSISignal } = require('./indicators/rsi');
const { getBollingerSignal } = require('./indicators/bollinger');
const { calculateATR } = require('./indicators/atr');

const APP_ID = process.env.DERIV_APP_ID || '1089';

async function fetchCandles(symbol = 'frxEURUSD', count = 5000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        ticks_history: symbol,
        adjust_start_time: 1,
        count,
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

function simulateTrade(direction, entryCandle, outcomeCandle) {
  if (!outcomeCandle) return null;
  if (direction === 'CALL') return outcomeCandle.close > entryCandle.close ? 'WIN' : 'LOSS';
  return outcomeCandle.close < entryCandle.close ? 'WIN' : 'LOSS';
}

function testConfig(candles, config) {
  const WARMUP = 55;
  const goodSet = new Set(config.goodHours);
  const badSet = new Set(config.badHours || []);
  let wins = 0, losses = 0;
  const tradesByDay = {};
  const tradeDetails = [];
  
  for (let i = WARMUP; i < candles.length - 1; i++) {
    const window = candles.slice(Math.max(0, i - 99), i + 1);
    const closes = window.map(c => c.close);
    const current = candles[i];
    const next = candles[i + 1];
    const h = new Date(current.epoch * 1000).getUTCHours();
    const dayKey = new Date(current.epoch * 1000).toISOString().slice(0, 10);
    
    // Weekend filter
    const dow = new Date(current.epoch * 1000).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    
    const rsi = getRSISignal(closes, config.rsiPeriod || 9);
    const bb = getBollingerSignal(closes, 20, 2);
    
    if (!rsi.signal || !bb.signal) continue;
    
    // Direction agreement
    if (config.requireBBAgree && rsi.signal !== bb.signal) continue;
    
    const direction = rsi.signal;
    
    // RSI threshold
    const isExtreme = rsi.value <= config.rsiLow || rsi.value >= config.rsiHigh;
    if (!isExtreme) continue;
    
    // Candle metrics
    const bodySize = Math.abs(current.close - current.open);
    const candleRange = current.high - current.low;
    const bodyRatio = candleRange > 0 ? bodySize / candleRange : 0;
    const atr = calculateATR(candles.slice(Math.max(0, i - 14), i + 1), 14);
    const rangeRatio = atr > 0 ? candleRange / atr : 0;
    const bigBody = bodyRatio > (config.bodyThreshold || 0.6);
    const hiRange = rangeRatio > (config.rangeThreshold || 1.2);
    
    // Tier logic
    let accepted = false;
    let tier = '-';
    
    if (config.tiers) {
      for (const t of config.tiers) {
        let hourOk = false;
        if (t.hourType === 'good' && goodSet.has(h)) hourOk = true;
        if (t.hourType === 'any' && !badSet.has(h)) hourOk = true;
        if (t.hourType === 'neutral' && !goodSet.has(h) && !badSet.has(h)) hourOk = true;
        if (t.hourType === 'all') hourOk = true;
        
        if (!hourOk) continue;
        
        let candleOk = true;
        if (t.candleReq === 'bigBodyOrHiRange' && !bigBody && !hiRange) candleOk = false;
        if (t.candleReq === 'bigBodyAndHiRange' && (!bigBody || !hiRange)) candleOk = false;
        if (t.candleReq === 'bigBody' && !bigBody) candleOk = false;
        
        // BB touch requirement
        if (t.requireBBTouch && !bb.bandTouch) candleOk = false;
        
        if (candleOk) {
          accepted = true;
          tier = t.name;
          break;
        }
      }
    } else {
      // Simple mode: just hour filter
      if (goodSet.has(h)) accepted = true;
      else if (!badSet.has(h) && config.allowNeutral) {
        if (!config.neutralRequireCandle || (bigBody && hiRange)) accepted = true;
      }
    }
    
    if (!accepted) continue;
    
    // BB squeeze block
    if (config.blockSqueeze && bb.isSqueeze) continue;
    
    const result = simulateTrade(direction, current, next);
    if (!result) continue;
    
    if (result === 'WIN') wins++;
    else losses++;
    
    if (!tradesByDay[dayKey]) tradesByDay[dayKey] = 0;
    tradesByDay[dayKey]++;
    
    tradeDetails.push({ h, result, rsi: rsi.value, bodyRatio, rangeRatio, tier, day: dayKey });
  }
  
  const total = wins + losses;
  const wr = total > 0 ? (wins / total * 100).toFixed(1) : '-';
  const tradeDays = Object.keys(tradesByDay).length;
  const perDay = tradeDays > 0 ? (total / tradeDays).toFixed(1) : '0';
  const maxDay = Math.max(0, ...Object.values(tradesByDay));
  const minDay = tradeDays > 0 ? Math.min(...Object.values(tradesByDay)) : 0;
  
  return { wins, losses, total, wr, perDay, tradeDays, maxDay, minDay, tradesByDay, tradeDetails };
}

async function main() {
  console.log('═'.repeat(70));
  console.log('  📊 CALIBRAÇÃO DE VOLUME — EUR/USD target 6-8 trades/dia');
  console.log('═'.repeat(70));
  
  const candles = await fetchCandles('frxEURUSD', 5000);
  const days = Math.round(candles.length / (24 * 12));
  console.log(`  ${candles.length} candles (~${days} dias)\n`);
  
  // ─── FASE 1: Análise completa por hora com RSI relaxado ───
  console.log('═'.repeat(70));
  console.log('  FASE 1: WR por hora — RSI <25/>75 + BB agree (mais trades)');
  console.log('═'.repeat(70));
  
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
    if (rsi.value > 25 && rsi.value < 75) continue;
    
    const result = simulateTrade(rsi.signal, current, next);
    if (!result) continue;
    
    const h = new Date(current.epoch * 1000).getUTCHours();
    if (result === 'WIN') hourStats[h].w++;
    else hourStats[h].l++;
  }
  
  console.log('  Hora  Trades  W    L    WR%');
  console.log('  ' + '─'.repeat(40));
  for (let h = 0; h < 24; h++) {
    const s = hourStats[h];
    const t = s.w + s.l;
    if (t === 0) { console.log(`  H${String(h).padStart(2,'0')}     0`); continue; }
    const wr = (s.w / t * 100).toFixed(1);
    const icon = t < 3 ? '⬜' : parseFloat(wr) >= 80 ? '🟢' : parseFloat(wr) >= 65 ? '🟡' : '🔴';
    console.log(`  H${String(h).padStart(2,'0')}   ${String(t).padStart(3)}    ${String(s.w).padStart(2)}   ${String(s.l).padStart(2)}   ${wr.padStart(5)}%  ${icon}`);
  }
  
  // ─── FASE 2: Configs escaladas ───
  console.log('\n' + '═'.repeat(70));
  console.log('  FASE 2: Configs escaladas (mais permissivas → mais trades)');
  console.log('═'.repeat(70));
  
  const configs = [
    {
      name: 'v6 ATUAL (baseline)',
      goodHours: [4,5,6,8,11,12,14,20],
      badHours: [0,1,2,3,9,10,15,16,17,18,19,21,22,23],
      rsiLow: 20, rsiHigh: 80,
      requireBBAgree: true,
      blockSqueeze: true,
      tiers: [
        { name: 'T1', hourType: 'good', candleReq: 'bigBodyOrHiRange' },
        { name: 'T1b', hourType: 'good', candleReq: 'none' },
        { name: 'T2', hourType: 'neutral', candleReq: 'bigBodyAndHiRange' },
      ]
    },
    {
      name: 'v6.1: RSI 25/75 (relaxar RSI)',
      goodHours: [4,5,6,8,11,12,14,20],
      badHours: [0,1,2,3,9,10,15,16,17,18,19,21,22,23],
      rsiLow: 25, rsiHigh: 75,
      requireBBAgree: true,
      blockSqueeze: true,
      tiers: [
        { name: 'T1', hourType: 'good', candleReq: 'bigBodyOrHiRange' },
        { name: 'T1b', hourType: 'good', candleReq: 'none' },
        { name: 'T2', hourType: 'neutral', candleReq: 'bigBodyAndHiRange' },
      ]
    },
    {
      name: 'v6.2: +horas (add H2,H3,H7,H13,H16,H21)',
      goodHours: [2,3,4,5,6,7,8,11,12,13,14,16,20,21],
      badHours: [0,1,9,10,15,17,18,19,22,23],
      rsiLow: 20, rsiHigh: 80,
      requireBBAgree: true,
      blockSqueeze: true,
      tiers: [
        { name: 'T1', hourType: 'good', candleReq: 'bigBodyOrHiRange' },
        { name: 'T1b', hourType: 'good', candleReq: 'none' },
      ]
    },
    {
      name: 'v6.3: RSI 25/75 + mais horas',
      goodHours: [2,3,4,5,6,7,8,11,12,13,14,16,20,21],
      badHours: [0,1,9,10,15,17,18,19,22,23],
      rsiLow: 25, rsiHigh: 75,
      requireBBAgree: true,
      blockSqueeze: true,
      tiers: [
        { name: 'T1', hourType: 'good', candleReq: 'bigBodyOrHiRange' },
        { name: 'T1b', hourType: 'good', candleReq: 'none' },
      ]
    },
    {
      name: 'v6.4: RSI 25/75 + mais horas + sem filtro vela',
      goodHours: [2,3,4,5,6,7,8,11,12,13,14,16,20,21],
      badHours: [0,1,9,10,15,17,18,19,22,23],
      rsiLow: 25, rsiHigh: 75,
      requireBBAgree: true,
      blockSqueeze: true,
      tiers: [
        { name: 'T1', hourType: 'good', candleReq: 'none' },
      ]
    },
    {
      name: 'v6.5: RSI 25/75 + TODAS horas (sem bad) + vela forte',
      goodHours: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23],
      badHours: [],
      rsiLow: 25, rsiHigh: 75,
      requireBBAgree: true,
      blockSqueeze: true,
      tiers: [
        { name: 'T1', hourType: 'good', candleReq: 'bigBodyOrHiRange' },
      ]
    },
    {
      name: 'v6.6: RSI 25/75 + horas OK + bigBody OR hiRange',
      goodHours: [2,3,4,5,6,7,8,11,12,13,14,20,21],
      badHours: [0,1,9,10,15,16,17,18,19,22,23],
      rsiLow: 25, rsiHigh: 75,
      requireBBAgree: true,
      blockSqueeze: true,
      tiers: [
        { name: 'T1', hourType: 'good', candleReq: 'bigBodyOrHiRange' },
        { name: 'T1b', hourType: 'good', candleReq: 'none' },
      ]
    },
    {
      name: 'v6.7: RSI 20/80 + mais horas + T2 sem vela exigida',
      goodHours: [4,5,6,8,11,12,14,20],
      badHours: [0,1,9,10,17,18,19],
      rsiLow: 20, rsiHigh: 80,
      requireBBAgree: true,
      blockSqueeze: true,
      tiers: [
        { name: 'T1', hourType: 'good', candleReq: 'none' },
        { name: 'T2', hourType: 'any', candleReq: 'bigBodyOrHiRange' },
      ]
    },
    {
      name: 'v6.8: RSI 25/75 + goodHrs expandido + T2 neutral com vela',
      goodHours: [2,4,5,6,8,11,12,13,14,20,21],
      badHours: [0,1,9,10,17,18,19],
      rsiLow: 25, rsiHigh: 75,
      requireBBAgree: true,
      blockSqueeze: true,
      tiers: [
        { name: 'T1', hourType: 'good', candleReq: 'none' },
        { name: 'T2', hourType: 'any', candleReq: 'bigBodyOrHiRange' },
      ]
    },
    {
      name: 'v6.9: RSI 25/75 + goodHrs expandido + BB touch em T2',
      goodHours: [2,4,5,6,8,11,12,13,14,20,21],
      badHours: [0,1,9,10,17,18,19],
      rsiLow: 25, rsiHigh: 75,
      requireBBAgree: true,
      blockSqueeze: true,
      tiers: [
        { name: 'T1', hourType: 'good', candleReq: 'none' },
        { name: 'T2', hourType: 'any', candleReq: 'bigBodyOrHiRange', requireBBTouch: true },
      ]
    },
  ];
  
  console.log(`\n  ${'Config'.padEnd(55)} Trades  /dia   WR%    Min  Max`);
  console.log('  ' + '─'.repeat(75));
  
  const results = [];
  
  for (const cfg of configs) {
    const r = testConfig(candles, cfg);
    results.push({ ...r, name: cfg.name });
    
    const icon = parseFloat(r.wr) >= 90 ? '🔥' : parseFloat(r.wr) >= 85 ? '✅' : parseFloat(r.wr) >= 80 ? '🟡' : parseFloat(r.wr) >= 70 ? '⚠️' : '❌';
    const volIcon = parseFloat(r.perDay) >= 6 ? '📈' : parseFloat(r.perDay) >= 4 ? '📊' : '📉';
    console.log(`  ${icon}${volIcon} ${cfg.name.padEnd(52)} ${String(r.total).padStart(3)}   ${r.perDay.padStart(4)}   ${r.wr.padStart(5)}%   ${String(r.minDay).padStart(2)}   ${String(r.maxDay).padStart(2)}`);
  }
  
  // ─── FASE 3: Detalhe do melhor candidato ───
  console.log('\n' + '═'.repeat(70));
  console.log('  FASE 3: Melhores candidatos (WR ≥ 85% + 4+ trades/dia)');
  console.log('═'.repeat(70));
  
  const good = results.filter(r => parseFloat(r.wr) >= 83 && parseFloat(r.perDay) >= 3.5);
  
  if (good.length === 0) {
    console.log('  Nenhum candidato com WR ≥ 83% e 4+ trades/dia');
    console.log('  Relaxando pra WR ≥ 80% e 3+ trades/dia...');
    const ok = results.filter(r => parseFloat(r.wr) >= 78 && parseFloat(r.perDay) >= 3);
    for (const r of ok) {
      console.log(`\n  → ${r.name}`);
      console.log(`    ${r.total} trades em ${r.tradeDays} dias = ${r.perDay}/dia | WR: ${r.wr}%`);
      console.log(`    Trades por dia: ${Object.entries(r.tradesByDay).map(([d,n]) => `${d.slice(5)}:${n}`).join(' | ')}`);
    }
  }
  
  for (const r of good) {
    console.log(`\n  🏆 ${r.name}`);
    console.log(`    ${r.total} trades em ${r.tradeDays} dias = ${r.perDay}/dia | WR: ${r.wr}%`);
    console.log(`    Min: ${r.minDay}/dia | Max: ${r.maxDay}/dia`);
    console.log(`    Trades por dia: ${Object.entries(r.tradesByDay).map(([d,n]) => `${d.slice(5)}:${n}`).join(' | ')}`);
    
    // Tier breakdown
    const tierStats = {};
    for (const t of r.tradeDetails) {
      if (!tierStats[t.tier]) tierStats[t.tier] = { w: 0, l: 0 };
      if (t.result === 'WIN') tierStats[t.tier].w++;
      else tierStats[t.tier].l++;
    }
    for (const [tier, s] of Object.entries(tierStats)) {
      const total = s.w + s.l;
      console.log(`    ${tier}: ${total} trades, ${(s.w/total*100).toFixed(1)}% WR`);
    }
  }
  
  console.log('\n' + '═'.repeat(70));
  console.log('  💡 RECOMENDAÇÃO');
  console.log('═'.repeat(70));
  
  // Find sweet spot: highest WR with perDay >= 5
  const sweetSpot = results
    .filter(r => parseFloat(r.perDay) >= 4)
    .sort((a, b) => parseFloat(b.wr) - parseFloat(a.wr));
  
  if (sweetSpot.length > 0) {
    const best = sweetSpot[0];
    console.log(`  Melhor equilíbrio: ${best.name}`);
    console.log(`  ${best.perDay} trades/dia com ${best.wr}% WR`);
  }
  
  const target = results
    .filter(r => parseFloat(r.perDay) >= 5.5)
    .sort((a, b) => parseFloat(b.wr) - parseFloat(a.wr));
  
  if (target.length > 0) {
    const best = target[0];
    console.log(`\n  Mais próximo de 6-8/dia: ${best.name}`);
    console.log(`  ${best.perDay} trades/dia com ${best.wr}% WR`);
  }
  
  console.log('═'.repeat(70) + '\n');
}

main().catch(console.error);
