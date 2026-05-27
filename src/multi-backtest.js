/**
 * Multi-Asset Backtest — Testa v6 em vários pares pra encontrar os melhores
 */
require('dotenv').config();
const WebSocket = require('ws');
const Analyzer = require('./strategy/analyzer');

const APP_ID = process.env.DERIV_APP_ID || '1089';

// Pares disponíveis na Deriv pra binary options
const ASSETS = [
  'frxEURUSD', 'frxGBPUSD', 'frxUSDJPY', 'frxAUDUSD', 
  'frxEURGBP', 'frxEURJPY', 'frxGBPJPY', 'frxUSDCAD',
  'frxUSDCHF', 'frxAUDJPY', 'frxNZDUSD', 'frxAUDCAD',
  'frxEURCAD', 'frxEURAUD'
];

async function fetchCandles(symbol, count = 5000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        ticks_history: symbol,
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
  else return exitPrice < entryPrice ? 'WIN' : 'LOSS';
}

async function testAsset(symbol) {
  try {
    const candles = await fetchCandles(symbol);
    const analyzer = new Analyzer();
    const WARMUP = 55;
    
    let wins = 0, losses = 0;
    const hourStats = {};
    
    for (let i = WARMUP; i < candles.length - 1; i++) {
      const window = candles.slice(Math.max(0, i - 99), i + 1);
      const currentCandle = candles[i];
      const nextCandle = candles[i + 1];
      
      const result = analyzer.analyze(symbol, window, currentCandle.epoch * 1000);
      if (!result.signal) continue;
      
      const tradeResult = simulateTrade(result.signal, currentCandle, nextCandle);
      if (!tradeResult) continue;
      
      if (tradeResult === 'WIN') wins++;
      else {
        losses++;
        analyzer.registerLossAt(symbol, currentCandle.epoch * 1000);
      }
      
      const h = new Date(currentCandle.epoch * 1000).getUTCHours();
      if (!hourStats[h]) hourStats[h] = { w: 0, l: 0 };
      if (tradeResult === 'WIN') hourStats[h].w++;
      else hourStats[h].l++;
    }
    
    const total = wins + losses;
    const wr = total > 0 ? (wins / total * 100).toFixed(1) : '0.0';
    const days = Math.round(candles.length / (24 * 12));
    const perDay = total > 0 ? (total / days).toFixed(1) : '0';
    
    // Melhor hora
    let bestHour = '-', bestHourWR = 0;
    for (const [h, s] of Object.entries(hourStats)) {
      const t = s.w + s.l;
      if (t >= 2) {
        const hwr = (s.w / t * 100);
        if (hwr > bestHourWR) { bestHourWR = hwr; bestHour = `H${h}`; }
      }
    }
    
    return { symbol, candles: candles.length, days, total, wins, losses, wr, perDay, bestHour, bestHourWR: bestHourWR.toFixed(0) };
  } catch (err) {
    return { symbol, error: err.message };
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  📊 MULTI-ASSET BACKTEST — Estratégia v6 em todos os pares');
  console.log('═══════════════════════════════════════════════════════════════════════\n');
  
  const results = [];
  
  for (const asset of ASSETS) {
    process.stdout.write(`  Testando ${asset}...`);
    const r = await testAsset(asset);
    if (r.error) {
      console.log(` ❌ ${r.error}`);
    } else {
      console.log(` ✅ ${r.total} trades, ${r.wr}% WR`);
    }
    results.push(r);
    // Pequeno delay pra não sobrecarregar API
    await new Promise(ok => setTimeout(ok, 1500));
  }
  
  // Ranking
  const valid = results.filter(r => !r.error && r.total >= 5).sort((a, b) => parseFloat(b.wr) - parseFloat(a.wr));
  
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('  🏆 RANKING POR WIN RATE');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  #  Par           Candles  Dias  Trades  W    L    WR%     /dia  MelhorH');
  console.log('  ───────────────────────────────────────────────────────────────────────');
  
  valid.forEach((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    const wrColor = parseFloat(r.wr) >= 85 ? '🔥' : parseFloat(r.wr) >= 70 ? '✅' : parseFloat(r.wr) >= 60 ? '⚠️' : '❌';
    console.log(`  ${medal} ${r.symbol.padEnd(13)} ${String(r.candles).padStart(5)}  ${String(r.days).padStart(4)}  ${String(r.total).padStart(6)}  ${String(r.wins).padStart(3)}  ${String(r.losses).padStart(3)}  ${r.wr.padStart(5)}% ${wrColor}  ${r.perDay.padStart(4)}  ${r.bestHour}(${r.bestHourWR}%)`);
  });
  
  // Recomendação
  const top = valid.filter(r => parseFloat(r.wr) >= 80 && r.total >= 10);
  
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  if (top.length > 0) {
    console.log('  💎 RECOMENDADOS (WR ≥ 80% com 10+ trades):');
    top.forEach(r => {
      console.log(`     → ${r.symbol} — ${r.wr}% WR, ${r.total} trades em ${r.days} dias`);
    });
  }
  
  const noData = results.filter(r => r.error);
  if (noData.length > 0) {
    console.log(`\n  ⚠️ Sem dados: ${noData.map(r => r.symbol).join(', ')}`);
  }
  
  const lowTrades = results.filter(r => !r.error && r.total < 5);
  if (lowTrades.length > 0) {
    console.log(`  ⚠️ Poucos trades (<5): ${lowTrades.map(r => `${r.symbol}(${r.total})`).join(', ')}`);
  }
  
  console.log('═══════════════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
