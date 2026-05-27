/**
 * Calibração USD/JPY — Encontra os melhores parâmetros para frxUSDJPY
 * 
 * Testa:
 * 1. Quais horas são boas/ruins pro JPY
 * 2. Thresholds de RSI (15/85, 20/80, 25/75)
 * 3. Body ratio thresholds
 * 4. Range/ATR thresholds
 * 5. Combinações de filtros
 */
require('dotenv').config();
const WebSocket = require('ws');
const { getRSISignal } = require('./indicators/rsi');
const { getBollingerSignal } = require('./indicators/bollinger');
const { getEMATrendContext } = require('./indicators/ema');
const { calculateATR } = require('./indicators/atr');

const APP_ID = process.env.DERIV_APP_ID || '1089';
const SYMBOL = 'frxUSDJPY';

async function fetchCandles(count = 5000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        ticks_history: SYMBOL,
        adjust_start_time: 1,
        count: Math.min(count, 5000),
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
  const entryPrice = entryCandle.close;
  const exitPrice = outcomeCandle.close;
  if (direction === 'CALL') return exitPrice > entryPrice ? 'WIN' : 'LOSS';
  return exitPrice < entryPrice ? 'WIN' : 'LOSS';
}

// =====================================================
// FASE 1: Análise por hora — WR sem nenhum filtro extra
// =====================================================
function analyzeHours(candles) {
  console.log('\n' + '═'.repeat(70));
  console.log('  FASE 1: Análise por hora UTC (RSI+BB agree, sem filtro de hora)');
  console.log('═'.repeat(70));
  
  const hourStats = {};
  for (let h = 0; h < 24; h++) hourStats[h] = { wins: 0, losses: 0, trades: [] };
  
  const WARMUP = 55;
  
  for (let i = WARMUP; i < candles.length - 1; i++) {
    const window = candles.slice(Math.max(0, i - 99), i + 1);
    const closes = window.map(c => c.close);
    const current = candles[i];
    const next = candles[i + 1];
    
    const rsi = getRSISignal(closes, 9);
    const bb = getBollingerSignal(closes, 20, 2);
    
    if (!rsi.signal || !bb.signal || rsi.signal !== bb.signal) continue;
    if (!rsi.isExtreme) continue; // RSI <20 or >80
    
    const direction = rsi.signal;
    const result = simulateTrade(direction, current, next);
    if (!result) continue;
    
    const h = new Date(current.epoch * 1000).getUTCHours();
    if (result === 'WIN') hourStats[h].wins++;
    else hourStats[h].losses++;
    hourStats[h].trades.push({ i, result, direction, rsi: rsi.value, h });
  }
  
  console.log('\n  Hora  Trades  Wins  Losses  WR%     Status');
  console.log('  ' + '─'.repeat(55));
  
  const goodHours = [];
  const badHours = [];
  
  for (let h = 0; h < 24; h++) {
    const s = hourStats[h];
    const total = s.wins + s.losses;
    if (total === 0) {
      console.log(`  H${String(h).padStart(2,'0')}    ${String(total).padStart(3)}     -     -     -       ⬜ Sem dados`);
      continue;
    }
    const wr = (s.wins / total * 100).toFixed(1);
    const wrNum = parseFloat(wr);
    let status;
    if (total < 3) {
      status = '⬜ Poucos dados';
    } else if (wrNum >= 80) {
      status = '🟢 BOA';
      goodHours.push(h);
    } else if (wrNum >= 65) {
      status = '🟡 OK';
      goodHours.push(h); // Include borderline
    } else {
      status = '🔴 RUIM';
      badHours.push(h);
    }
    console.log(`  H${String(h).padStart(2,'0')}    ${String(total).padStart(3)}    ${String(s.wins).padStart(3)}    ${String(s.losses).padStart(4)}   ${wr.padStart(5)}%   ${status}`);
  }
  
  console.log(`\n  ✅ Horas boas (≥65% WR, 3+ trades): [${goodHours.join(',')}]`);
  console.log(`  ❌ Horas ruins (<65% WR): [${badHours.join(',')}]`);
  
  return { goodHours, badHours, hourStats };
}

// =====================================================
// FASE 2: Testar diferentes RSI thresholds
// =====================================================
function testRSIThresholds(candles, goodHours) {
  console.log('\n' + '═'.repeat(70));
  console.log('  FASE 2: RSI Thresholds (dentro das horas boas do JPY)');
  console.log('═'.repeat(70));
  
  const thresholds = [
    { low: 15, high: 85, label: 'RSI <15/>85 (ultra extremo)' },
    { low: 20, high: 80, label: 'RSI <20/>80 (padrão EUR/USD)' },
    { low: 25, high: 75, label: 'RSI <25/>75 (relaxado)' },
    { low: 30, high: 70, label: 'RSI <30/>70 (muito relaxado)' },
  ];
  
  const goodSet = new Set(goodHours);
  const WARMUP = 55;
  
  for (const th of thresholds) {
    let wins = 0, losses = 0;
    
    for (let i = WARMUP; i < candles.length - 1; i++) {
      const window = candles.slice(Math.max(0, i - 99), i + 1);
      const closes = window.map(c => c.close);
      const current = candles[i];
      const next = candles[i + 1];
      const h = new Date(current.epoch * 1000).getUTCHours();
      
      if (!goodSet.has(h)) continue;
      
      const rsi = getRSISignal(closes, 9);
      const bb = getBollingerSignal(closes, 20, 2);
      
      if (!rsi.signal || !bb.signal || rsi.signal !== bb.signal) continue;
      if (rsi.value > th.low && rsi.value < th.high) continue; // Not extreme enough
      
      const direction = rsi.signal;
      const result = simulateTrade(direction, current, next);
      if (!result) continue;
      
      if (result === 'WIN') wins++;
      else losses++;
    }
    
    const total = wins + losses;
    const wr = total > 0 ? (wins / total * 100).toFixed(1) : '-';
    console.log(`  ${th.label}: ${total} trades, ${wins}W/${losses}L = ${wr}% WR`);
  }
}

// =====================================================
// FASE 3: Candle Quality Thresholds
// =====================================================
function testCandleMetrics(candles, goodHours) {
  console.log('\n' + '═'.repeat(70));
  console.log('  FASE 3: Candle Quality (Body Ratio + Range/ATR)');
  console.log('═'.repeat(70));
  
  const goodSet = new Set(goodHours);
  const WARMUP = 55;
  
  const configs = [
    { bodyMin: 0, rangeMin: 0, label: 'Sem filtro de vela' },
    { bodyMin: 0.5, rangeMin: 0, label: 'bodyRatio > 0.5' },
    { bodyMin: 0.6, rangeMin: 0, label: 'bodyRatio > 0.6 (EUR/USD padrão)' },
    { bodyMin: 0.7, rangeMin: 0, label: 'bodyRatio > 0.7' },
    { bodyMin: 0, rangeMin: 0.8, label: 'range/ATR > 0.8' },
    { bodyMin: 0, rangeMin: 1.0, label: 'range/ATR > 1.0' },
    { bodyMin: 0, rangeMin: 1.2, label: 'range/ATR > 1.2 (EUR/USD padrão)' },
    { bodyMin: 0.5, rangeMin: 0.8, label: 'body>0.5 + range>0.8' },
    { bodyMin: 0.6, rangeMin: 1.0, label: 'body>0.6 + range>1.0' },
    { bodyMin: 0.6, rangeMin: 1.2, label: 'body>0.6 + range>1.2 (EUR/USD combo)' },
    { bodyMin: 0.5, rangeMin: 1.0, label: 'body>0.5 + range>1.0' },
  ];
  
  for (const cfg of configs) {
    let wins = 0, losses = 0;
    
    for (let i = WARMUP; i < candles.length - 1; i++) {
      const window = candles.slice(Math.max(0, i - 99), i + 1);
      const closes = window.map(c => c.close);
      const current = candles[i];
      const next = candles[i + 1];
      const h = new Date(current.epoch * 1000).getUTCHours();
      
      if (!goodSet.has(h)) continue;
      
      const rsi = getRSISignal(closes, 9);
      const bb = getBollingerSignal(closes, 20, 2);
      
      if (!rsi.signal || !bb.signal || rsi.signal !== bb.signal) continue;
      if (!rsi.isExtreme) continue;
      
      // Candle metrics
      const bodySize = Math.abs(current.close - current.open);
      const candleRange = current.high - current.low;
      const bodyRatio = candleRange > 0 ? bodySize / candleRange : 0;
      const atr = calculateATR(candles.slice(Math.max(0, i - 14), i + 1), 14);
      const rangeRatio = atr > 0 ? candleRange / atr : 0;
      
      // Apply filters
      if (cfg.bodyMin > 0 && bodyRatio < cfg.bodyMin) continue;
      if (cfg.rangeMin > 0 && rangeRatio < cfg.rangeMin) continue;
      
      const direction = rsi.signal;
      const result = simulateTrade(direction, current, next);
      if (!result) continue;
      
      if (result === 'WIN') wins++;
      else losses++;
    }
    
    const total = wins + losses;
    const wr = total > 0 ? (wins / total * 100).toFixed(1) : '-';
    const icon = total < 3 ? '⬜' : parseFloat(wr) >= 90 ? '🔥' : parseFloat(wr) >= 80 ? '✅' : parseFloat(wr) >= 70 ? '⚠️' : '❌';
    console.log(`  ${icon} ${cfg.label.padEnd(45)} ${String(total).padStart(3)} trades  ${wr}% WR`);
  }
}

// =====================================================
// FASE 4: Tier system calibrado pro JPY
// =====================================================
function testTierSystem(candles, goodHours) {
  console.log('\n' + '═'.repeat(70));
  console.log('  FASE 4: Sistema de Tiers calibrado pro USD/JPY');
  console.log('═'.repeat(70));
  
  const WARMUP = 55;
  const goodSet = new Set(goodHours);
  
  // Test with relaxed RSI too
  const rsiConfigs = [
    { low: 20, high: 80, label: 'RSI 20/80' },
    { low: 25, high: 75, label: 'RSI 25/75' },
  ];
  
  for (const rsiCfg of rsiConfigs) {
    console.log(`\n  --- ${rsiCfg.label} ---`);
    
    const tiers = {
      'T1: goodHr + (bigBody OR hiRange)': { wins: 0, losses: 0 },
      'T1b: goodHr only': { wins: 0, losses: 0 },
      'T2: neutralHr + bigBody + hiRange': { wins: 0, losses: 0 },
      'ALL: qualquer hora + RSI extremo': { wins: 0, losses: 0 },
    };
    
    for (let i = WARMUP; i < candles.length - 1; i++) {
      const window = candles.slice(Math.max(0, i - 99), i + 1);
      const closes = window.map(c => c.close);
      const current = candles[i];
      const next = candles[i + 1];
      const h = new Date(current.epoch * 1000).getUTCHours();
      
      const rsi = getRSISignal(closes, 9);
      const bb = getBollingerSignal(closes, 20, 2);
      
      if (!rsi.signal || !bb.signal || rsi.signal !== bb.signal) continue;
      if (rsi.value > rsiCfg.low && rsi.value < rsiCfg.high) continue;
      
      const direction = rsi.signal;
      const result = simulateTrade(direction, current, next);
      if (!result) continue;
      
      const bodySize = Math.abs(current.close - current.open);
      const candleRange = current.high - current.low;
      const bodyRatio = candleRange > 0 ? bodySize / candleRange : 0;
      const atr = calculateATR(candles.slice(Math.max(0, i - 14), i + 1), 14);
      const rangeRatio = atr > 0 ? candleRange / atr : 0;
      const bigBody = bodyRatio > 0.6;
      const hiRange = rangeRatio > 1.2;
      
      const isGood = goodSet.has(h);
      // Bad = not in goodHours
      const isNeutral = !isGood;
      
      const w = result === 'WIN' ? 1 : 0;
      const l = result === 'LOSS' ? 1 : 0;
      
      tiers['ALL: qualquer hora + RSI extremo'].wins += w;
      tiers['ALL: qualquer hora + RSI extremo'].losses += l;
      
      if (isGood && (bigBody || hiRange)) {
        tiers['T1: goodHr + (bigBody OR hiRange)'].wins += w;
        tiers['T1: goodHr + (bigBody OR hiRange)'].losses += l;
      } else if (isGood) {
        tiers['T1b: goodHr only'].wins += w;
        tiers['T1b: goodHr only'].losses += l;
      } else if (isNeutral && bigBody && hiRange) {
        tiers['T2: neutralHr + bigBody + hiRange'].wins += w;
        tiers['T2: neutralHr + bigBody + hiRange'].losses += l;
      }
    }
    
    for (const [name, s] of Object.entries(tiers)) {
      const total = s.wins + s.losses;
      const wr = total > 0 ? (s.wins / total * 100).toFixed(1) : '-';
      const icon = total < 3 ? '⬜' : parseFloat(wr) >= 90 ? '🔥' : parseFloat(wr) >= 80 ? '✅' : parseFloat(wr) >= 70 ? '⚠️' : '❌';
      console.log(`  ${icon} ${name.padEnd(42)} ${String(total).padStart(3)} trades  ${String(s.wins).padStart(2)}W/${String(s.losses).padStart(2)}L  ${wr}% WR`);
    }
  }
}

// =====================================================
// FASE 5: Comparar EUR/USD vs JPY com mesmos params
// =====================================================
async function compareWithEURUSD() {
  console.log('\n' + '═'.repeat(70));
  console.log('  FASE 5: Comparação EUR/USD (params originais) vs USD/JPY (calibrado)');
  console.log('═'.repeat(70));
  
  // Fetch EUR/USD too
  const eurCandles = await fetchCandlesFor('frxEURUSD');
  const jpyCandles = await fetchCandlesFor('frxUSDJPY');
  
  // EUR/USD with original params
  const eurResult = testWithParams(eurCandles, {
    goodHours: new Set([4,5,6,8,11,12,14,20]),
    rsiLow: 20, rsiHigh: 80,
    bodyMin: 0.6, rangeMin: 1.2
  });
  
  // JPY results will be filled after calibration
  return { eurCandles, jpyCandles, eurResult };
}

async function fetchCandlesFor(symbol) {
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

function testWithParams(candles, params) {
  const WARMUP = 55;
  let wins = 0, losses = 0;
  
  for (let i = WARMUP; i < candles.length - 1; i++) {
    const window = candles.slice(Math.max(0, i - 99), i + 1);
    const closes = window.map(c => c.close);
    const current = candles[i];
    const next = candles[i + 1];
    const h = new Date(current.epoch * 1000).getUTCHours();
    
    if (!params.goodHours.has(h)) continue;
    
    const rsi = getRSISignal(closes, 9);
    const bb = getBollingerSignal(closes, 20, 2);
    
    if (!rsi.signal || !bb.signal || rsi.signal !== bb.signal) continue;
    if (rsi.value > params.rsiLow && rsi.value < params.rsiHigh) continue;
    
    // If body/range filters set, require at least one
    if (params.bodyMin > 0 || params.rangeMin > 0) {
      const bodySize = Math.abs(current.close - current.open);
      const candleRange = current.high - current.low;
      const bodyRatio = candleRange > 0 ? bodySize / candleRange : 0;
      const atr = calculateATR(candles.slice(Math.max(0, i - 14), i + 1), 14);
      const rangeRatio = atr > 0 ? candleRange / atr : 0;
      
      const bigBody = bodyRatio > params.bodyMin;
      const hiRange = rangeRatio > params.rangeMin;
      
      if (!bigBody && !hiRange) continue;
    }
    
    const direction = rsi.signal;
    const result = simulateTrade(direction, current, next);
    if (!result) continue;
    
    if (result === 'WIN') wins++;
    else losses++;
  }
  
  const total = wins + losses;
  return { wins, losses, total, wr: total > 0 ? (wins / total * 100).toFixed(1) : '-' };
}

// =====================================================
// MAIN
// =====================================================
async function main() {
  console.log('═'.repeat(70));
  console.log('  🔧 CALIBRAÇÃO USD/JPY — Encontrando parâmetros ótimos');
  console.log('═'.repeat(70));
  
  console.log('\n  Buscando 5000 candles M5 do USD/JPY...');
  const candles = await fetchCandles();
  const days = Math.round(candles.length / (24 * 12));
  console.log(`  ✅ ${candles.length} candles (~${days} dias)`);
  
  // FASE 1: Horas
  const { goodHours } = analyzeHours(candles);
  
  // FASE 2: RSI Thresholds
  testRSIThresholds(candles, goodHours);
  
  // FASE 3: Candle metrics
  testCandleMetrics(candles, goodHours);
  
  // FASE 4: Tier system
  testTierSystem(candles, goodHours);
  
  // FASE 5: Comparação
  console.log('\n  Buscando EUR/USD pra comparação...');
  const eurCandles = await fetchCandlesFor('frxEURUSD');
  
  console.log('\n' + '═'.repeat(70));
  console.log('  FASE 5: Comparação final');
  console.log('═'.repeat(70));
  
  const eurOrig = testWithParams(eurCandles, {
    goodHours: new Set([4,5,6,8,11,12,14,20]),
    rsiLow: 20, rsiHigh: 80,
    bodyMin: 0.6, rangeMin: 1.2
  });
  console.log(`  EUR/USD (params originais): ${eurOrig.total} trades, ${eurOrig.wr}% WR`);
  
  // JPY with JPY-optimized hours
  const jpyOpt = testWithParams(candles, {
    goodHours: new Set(goodHours),
    rsiLow: 20, rsiHigh: 80,
    bodyMin: 0.6, rangeMin: 1.2
  });
  console.log(`  USD/JPY (horas JPY, body/range EUR padrao): ${jpyOpt.total} trades, ${jpyOpt.wr}% WR`);
  
  // JPY relaxed
  const jpyRelax = testWithParams(candles, {
    goodHours: new Set(goodHours),
    rsiLow: 25, rsiHigh: 75,
    bodyMin: 0.5, rangeMin: 1.0
  });
  console.log(`  USD/JPY (horas JPY, RSI 25/75, body>0.5 OR range>1.0): ${jpyRelax.total} trades, ${jpyRelax.wr}% WR`);
  
  // JPY very relaxed  
  const jpyVRelax = testWithParams(candles, {
    goodHours: new Set(goodHours),
    rsiLow: 20, rsiHigh: 80,
    bodyMin: 0, rangeMin: 0
  });
  console.log(`  USD/JPY (horas JPY, RSI 20/80, sem filtro vela): ${jpyVRelax.total} trades, ${jpyVRelax.wr}% WR`);
  
  console.log('\n' + '═'.repeat(70));
  console.log('  📋 RESUMO DA CALIBRAÇÃO');
  console.log('═'.repeat(70));
  console.log(`\n  Horas boas pro USD/JPY: [${goodHours.join(', ')}]`);
  console.log(`  Horas boas do EUR/USD:  [4, 5, 6, 8, 11, 12, 14, 20]`);
  console.log(`\n  Sobreposição: ${goodHours.filter(h => [4,5,6,8,11,12,14,20].includes(h)).join(', ') || 'nenhuma'}`);
  console.log(`  Exclusivas JPY: ${goodHours.filter(h => ![4,5,6,8,11,12,14,20].includes(h)).join(', ') || 'nenhuma'}`);
  console.log('═'.repeat(70) + '\n');
}

main().catch(console.error);
