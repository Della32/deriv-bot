/**
 * Scan imediato — Verifica RSI + BB de todos os pares AGORA
 * Ignora filtro de hora pra achar o mais próximo de um sinal
 */
require('dotenv').config();
const WebSocket = require('ws');
const { getRSISignal } = require('./indicators/rsi');
const { getBollingerSignal } = require('./indicators/bollinger');
const { calculateATR } = require('./indicators/atr');

const APP_ID = process.env.DERIV_APP_ID || '1089';
const PAIRS = ['frxEURUSD', 'frxGBPJPY', 'frxAUDCAD', 'frxAUDJPY', 'frxUSDJPY', 'frxGBPUSD', 'frxAUDUSD', 'frxEURJPY'];

async function fetchCandles(symbol) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        ticks_history: symbol,
        adjust_start_time: 1,
        count: 100,
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
    setTimeout(() => { ws.close(); reject(new Error('Timeout')); }, 15000);
  });
}

async function main() {
  console.log('═'.repeat(65));
  console.log('  🔍 SCAN IMEDIATO — Qual par tá mais perto de um sinal?');
  console.log('  Hora UTC:', new Date().getUTCHours() + ':' + String(new Date().getUTCMinutes()).padStart(2,'0'));
  console.log('═'.repeat(65));

  const results = [];

  for (const symbol of PAIRS) {
    try {
      const candles = await fetchCandles(symbol);
      const closes = candles.map(c => c.close);
      const current = candles[candles.length - 1];
      
      const rsi = getRSISignal(closes, 9);
      const bb = getBollingerSignal(closes, 20, 2);
      const atr = calculateATR(candles, 14);
      
      const bodySize = Math.abs(current.close - current.open);
      const candleRange = current.high - current.low;
      const bodyRatio = candleRange > 0 ? bodySize / candleRange : 0;
      const rangeRatio = atr > 0 ? candleRange / atr : 0;
      
      // Score: quão perto tá de um sinal
      let score = 0;
      let direction = null;
      let reasons = [];
      
      // RSI extremo?
      if (rsi.value <= 20 || rsi.value >= 80) { score += 3; reasons.push('RSI EXTREMO ✅'); }
      else if (rsi.value <= 25 || rsi.value >= 75) { score += 2; reasons.push('RSI quase extremo'); }
      else if (rsi.value <= 30 || rsi.value >= 70) { score += 1; reasons.push('RSI tendendo'); }
      else reasons.push('RSI neutro');
      
      // RSI + BB concordam?
      if (rsi.signal && bb.signal && rsi.signal === bb.signal) { 
        score += 2; 
        direction = rsi.signal;
        reasons.push(`RSI+BB=${direction} ✅`); 
      } else if (rsi.signal) {
        direction = rsi.signal;
        reasons.push('RSI≠BB');
      }
      
      // Vela forte?
      if (bodyRatio > 0.6) { score += 1; reasons.push('bigBody ✅'); }
      if (rangeRatio > 1.2) { score += 1; reasons.push('hiRange ✅'); }
      
      // BB touch?
      if (bb.bandTouch) { score += 1; reasons.push('BB touch ✅'); }
      
      // Squeeze?
      if (bb.isSqueeze) { score -= 1; reasons.push('SQUEEZE ❌'); }

      results.push({
        symbol,
        rsi: rsi.value,
        rsiSignal: rsi.signal,
        bbSignal: bb.signal,
        direction,
        bodyRatio: bodyRatio.toFixed(2),
        rangeRatio: rangeRatio.toFixed(2),
        score,
        reasons,
        bbTouch: bb.bandTouch,
        squeeze: bb.isSqueeze,
      });
    } catch (err) {
      console.log(`  ${symbol}: ❌ ${err.message}`);
    }
    await new Promise(ok => setTimeout(ok, 800));
  }

  // Ranking
  results.sort((a, b) => b.score - a.score);
  
  console.log(`\n  ${'Par'.padEnd(13)} ${'RSI'.padStart(6)} ${'Dir'.padStart(5)} ${'Body'.padStart(5)} ${'R/ATR'.padStart(6)} ${'Score'.padStart(5)}  Detalhes`);
  console.log('  ' + '─'.repeat(62));
  
  for (const r of results) {
    const icon = r.score >= 5 ? '🔥' : r.score >= 3 ? '🟡' : '⬜';
    console.log(`  ${icon} ${r.symbol.padEnd(12)} ${String(r.rsi).padStart(5)} ${(r.direction || '-').padStart(5)} ${r.bodyRatio.padStart(5)} ${r.rangeRatio.padStart(6)} ${String(r.score).padStart(5)}  ${r.reasons.join(' | ')}`);
  }

  const best = results[0];
  console.log(`\n  🏆 Mais próximo: ${best.symbol} (score ${best.score})`);
  console.log(`     RSI: ${best.rsi} | Direção: ${best.direction || 'indefinida'} | Body: ${best.bodyRatio} | Range/ATR: ${best.rangeRatio}`);
  
  if (best.direction && best.score >= 3) {
    console.log(`\n  ✅ RECOMENDAÇÃO: ${best.direction} em ${best.symbol}`);
  } else {
    console.log(`\n  ⚠️ Nenhum par com sinal forte agora. Melhor candidato: ${best.symbol}`);
  }

  console.log('\n' + '═'.repeat(65));
}

main().catch(console.error);
