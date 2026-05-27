/**
 * Backtest v2 — Estratégia de Reversão com Filtros Otimizados
 * 
 * Usa dados históricos reais da Deriv, simula candle a candle.
 * 
 * Uso: node src/backtest.js [--days=30] [--asset=frxEURUSD] [--payout=0.85]
 *      node src/backtest.js --raw  (mostra todos os sinais sem filtros)
 */

require('dotenv').config();
const WebSocket = require('ws');
const Analyzer = require('./strategy/analyzer');
const Progression = require('./strategy/progression');
const { calculateATR } = require('./indicators/atr');
const { getRSISignal } = require('./indicators/rsi');
const { getBollingerSignal } = require('./indicators/bollinger');
const { getEMATrendContext } = require('./indicators/ema');

// === CONFIG ===
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : defaultVal;
}

const DAYS = parseInt(getArg('days', '30'));
const ASSET = getArg('asset', 'frxEURUSD');
const PAYOUT = parseFloat(getArg('payout', '0.85'));
const BASE_BET = parseFloat(getArg('bet', '1.20'));
const STOP_LOSS = parseFloat(getArg('sl', '30'));
const STOP_WIN = parseFloat(getArg('sw', '50'));
const MAX_LEVEL = parseInt(getArg('maxlevel', '6'));
const RAW_MODE = args.includes('--raw');

const APP_ID = process.env.DERIV_APP_ID || '1089';

// === FETCH CANDLES ===
async function fetchCandles(symbol, count) {
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

    ws.on('error', (err) => reject(err));
    setTimeout(() => { ws.close(); reject(new Error('Timeout')); }, 30000);
  });
}

// === SIMULA RESULTADO ===
function simulateTrade(direction, entryCandle, outcomeCandle) {
  if (!outcomeCandle) return null;
  const entryPrice = entryCandle.close;
  const exitPrice = outcomeCandle.close;

  if (direction === 'CALL') return exitPrice > entryPrice ? 'WIN' : 'LOSS';
  else return exitPrice < entryPrice ? 'WIN' : 'LOSS';
}

// === RAW SIGNAL ANALYSIS (sem filtros, pra diagnóstico) ===
async function runRawAnalysis(allCandles) {
  console.log('\n🔬 RAW SIGNAL ANALYSIS — Todos os sinais RSI+BB sem filtros\n');

  const WARMUP = 55;
  const rawTrades = [];

  for (let i = WARMUP; i < allCandles.length - 1; i++) {
    const window = allCandles.slice(Math.max(0, i - 99), i + 1);
    const closes = window.map(c => c.close);
    const currentCandle = allCandles[i];
    const nextCandle = allCandles[i + 1];

    const rsi = getRSISignal(closes, 9);
    const bb = getBollingerSignal(closes, 20, 2);
    const ema = getEMATrendContext(closes);
    const atr = calculateATR(window, 14);

    // Sinal primário: RSI + BB concordam
    if (!rsi.signal || !bb.signal || rsi.signal !== bb.signal) continue;

    const direction = rsi.signal;
    const result = simulateTrade(direction, currentCandle, nextCandle);
    if (!result) continue;

    const date = new Date(currentCandle.epoch * 1000);
    const prevCandle = i > 0 ? allCandles[i - 1] : null;
    const prevIsUp = prevCandle ? prevCandle.close > prevCandle.open : false;

    rawTrades.push({
      date: date.toISOString().slice(0, 16),
      hour: date.getUTCHours(),
      direction,
      result,
      rsi: rsi.value,
      rsiExtreme: rsi.isExtreme,
      rsiDivergence: rsi.divergence,
      bbWidth: bb.bb ? bb.bb.width : 0,
      bbIsWide: bb.isWide,
      bbBandTouch: bb.bandTouch,
      bbPosition: bb.pricePosition,
      atr,
      emaConfirms: ema.trendBias === direction,
      emaStretched: ema.isStretched,
      prevCandleUp: prevIsUp,
      prevConfirms: (direction === 'CALL' && !prevIsUp) || (direction === 'PUT' && prevIsUp)
    });
  }

  // Análise
  const wins = rawTrades.filter(t => t.result === 'WIN').length;
  const total = rawTrades.length;
  console.log(`Total sinais RSI+BB: ${total} | Wins: ${wins} | WR: ${(wins/total*100).toFixed(1)}%\n`);

  // Breakdown por filtro
  const filters = [
    { name: 'BB Width >= 0.003', fn: t => t.bbIsWide },
    { name: 'BB Width < 0.003', fn: t => !t.bbIsWide },
    { name: 'BB Band Touch', fn: t => t.bbBandTouch },
    { name: 'ATR >= 0.0004', fn: t => t.atr >= 0.0004 },
    { name: 'ATR < 0.0004', fn: t => t.atr < 0.0004 },
    { name: 'RSI Extreme (<20/>80)', fn: t => t.rsiExtreme },
    { name: 'RSI Divergence', fn: t => t.rsiDivergence === t.direction },
    { name: 'EMA Confirms', fn: t => t.emaConfirms },
    { name: 'EMA Stretched', fn: t => t.emaStretched },
    { name: 'Prev Candle Confirms', fn: t => t.prevConfirms },
    { name: 'Hours 8-11 UTC', fn: t => t.hour >= 8 && t.hour <= 11 },
    { name: 'Hours 14-15 UTC', fn: t => t.hour >= 14 && t.hour <= 15 },
    { name: 'Hours 8-11,14-15', fn: t => (t.hour >= 8 && t.hour <= 11) || (t.hour >= 14 && t.hour <= 15) },
  ];

  console.log('FILTRO                    | Trades | Wins | WR%');
  console.log('──────────────────────────|--------|------|------');
  filters.forEach(f => {
    const subset = rawTrades.filter(f.fn);
    const w = subset.filter(t => t.result === 'WIN').length;
    const wr = subset.length > 0 ? (w/subset.length*100).toFixed(1) : '0.0';
    console.log(`${f.name.padEnd(26)}| ${String(subset.length).padStart(6)} | ${String(w).padStart(4)} | ${wr}%`);
  });

  // Combos
  console.log('\nCOMBOS:');
  console.log('──────────────────────────────────────────────────');
  
  const combos = [
    { name: 'BBWide + ATR≥0.0004', fn: t => t.bbIsWide && t.atr >= 0.0004 },
    { name: 'BBWide + ATR + Hours', fn: t => t.bbIsWide && t.atr >= 0.0004 && ((t.hour >= 8 && t.hour <= 11) || (t.hour >= 14 && t.hour <= 15)) },
    { name: 'BBWide + ATR + Hours + PrevConfirm', fn: t => t.bbIsWide && t.atr >= 0.0004 && ((t.hour >= 8 && t.hour <= 11) || (t.hour >= 14 && t.hour <= 15)) && t.prevConfirms },
    { name: 'BBWide + ATR + Hours + EMA', fn: t => t.bbIsWide && t.atr >= 0.0004 && ((t.hour >= 8 && t.hour <= 11) || (t.hour >= 14 && t.hour <= 15)) && t.emaConfirms },
    { name: 'BBWide + ATR + Hours + EMA + Prev', fn: t => t.bbIsWide && t.atr >= 0.0004 && ((t.hour >= 8 && t.hour <= 11) || (t.hour >= 14 && t.hour <= 15)) && t.emaConfirms && t.prevConfirms },
    { name: 'ALL FILTERS', fn: t => t.bbIsWide && t.atr >= 0.0004 && ((t.hour >= 8 && t.hour <= 11) || (t.hour >= 14 && t.hour <= 15)) && t.emaConfirms && t.prevConfirms },
    { name: 'BBWide + RSI Extreme', fn: t => t.bbIsWide && t.rsiExtreme },
    { name: 'BandTouch + ATR', fn: t => t.bbBandTouch && t.atr >= 0.0004 },
    { name: 'BandTouch + BBWide + ATR', fn: t => t.bbBandTouch && t.bbIsWide && t.atr >= 0.0004 },
  ];

  combos.forEach(f => {
    const subset = rawTrades.filter(f.fn);
    const w = subset.filter(t => t.result === 'WIN').length;
    const wr = subset.length > 0 ? (w/subset.length*100).toFixed(1) : '0.0';
    console.log(`${f.name.padEnd(38)}| ${String(subset.length).padStart(4)} | ${String(w).padStart(3)} | ${wr}%`);
  });

  // Hour breakdown
  console.log('\nWR POR HORA UTC:');
  for (let h = 0; h < 24; h++) {
    const subset = rawTrades.filter(t => t.hour === h);
    if (subset.length > 0) {
      const w = subset.filter(t => t.result === 'WIN').length;
      console.log(`  ${String(h).padStart(2)}:00  ${subset.length} trades  ${w}W/${subset.length-w}L  ${(w/subset.length*100).toFixed(1)}%`);
    }
  }
}

// === MAIN BACKTEST ===
async function runBacktest() {
  console.log('═══════════════════════════════════════════════════');
  console.log('📊 BACKTEST v2 — Reversal Strategy (Optimized Filters)');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Ativo:      ${ASSET}`);
  console.log(`  Período:    ${DAYS} dias`);
  console.log(`  Payout:     ${(PAYOUT * 100).toFixed(0)}%`);
  console.log(`  Aposta:     R$${BASE_BET} (progressão até nível ${MAX_LEVEL})`);
  console.log(`  Stop Loss:  R$${STOP_LOSS} | Stop Win: R$${STOP_WIN}`);
  console.log(`  Modo:       ${RAW_MODE ? 'RAW (sem filtros)' : 'FILTRADO'}`);
  console.log('═══════════════════════════════════════════════════\n');

  const totalCandles = Math.min(DAYS * 24 * 12, 5000);
  console.log(`⏳ Buscando ${totalCandles} candles de ${ASSET}...`);
  
  const allCandles = await fetchCandles(ASSET, totalCandles);
  console.log(`✅ ${allCandles.length} candles recebidos`);
  
  const firstDate = new Date(allCandles[0].epoch * 1000);
  const lastDate = new Date(allCandles[allCandles.length - 1].epoch * 1000);
  console.log(`   De: ${firstDate.toISOString().slice(0, 16)} UTC`);
  console.log(`   Até: ${lastDate.toISOString().slice(0, 16)} UTC`);

  // Se modo raw, roda análise sem filtros
  if (RAW_MODE) {
    await runRawAnalysis(allCandles);
    return;
  }

  // === SIMULAÇÃO COM FILTROS ===
  const WARMUP = 55;
  const trades = [];
  const dailyResults = {};
  let totalProfit = 0;
  let maxDrawdown = 0;
  let peakProfit = 0;
  let signalsGenerated = 0;
  let signalsFiltered = 0;
  let filterReasons = {};

  let currentDay = null;
  let progression = new Progression(BASE_BET, MAX_LEVEL);
  let dayStopped = false;

  // Analyzer persistente (mantém estado de filtros entre candles)
  const analyzer = new Analyzer();

  for (let i = WARMUP; i < allCandles.length - 1; i++) {
    const window = allCandles.slice(Math.max(0, i - 99), i + 1);
    const currentCandle = allCandles[i];
    const nextCandle = allCandles[i + 1];

    const date = new Date(currentCandle.epoch * 1000);
    const dayKey = date.toISOString().slice(0, 10);

    if (dayKey !== currentDay) {
      if (currentDay) {
        dailyResults[currentDay] = {
          profit: Math.round(progression.dailyProfit * 100) / 100,
          wins: progression.dailyWins,
          losses: progression.dailyLosses,
          total: progression.dailyWins + progression.dailyLosses,
          winRate: progression.dailyWins + progression.dailyLosses > 0
            ? Math.round((progression.dailyWins / (progression.dailyWins + progression.dailyLosses)) * 100)
            : 0
        };
      }
      currentDay = dayKey;
      progression.resetDaily();
      dayStopped = false;
    }

    if (dayStopped) continue;

    // Passa o epoch do candle como "agora" pra que filtros de horário funcionem
    const result = analyzer.analyze(ASSET, window, currentCandle.epoch * 1000);

    if (!result.signal) {
      if (result.reason && !result.reason.includes('insuficientes') && !result.reason.includes('Sem sinal')) {
        signalsFiltered++;
        // Simplifica a razão pra agrupamento
        const shortReason = result.reason.length > 60 ? result.reason.slice(0, 60) : result.reason;
        filterReasons[shortReason] = (filterReasons[shortReason] || 0) + 1;
      }
      continue;
    }

    signalsGenerated++;
    const direction = result.signal;

    const tradeResult = simulateTrade(direction, currentCandle, nextCandle);
    if (!tradeResult) continue;

    const betAmount = progression.getBetAmount(PAYOUT);

    if (tradeResult === 'WIN') {
      const winResult = progression.registerWin(betAmount, PAYOUT);
      totalProfit += winResult.profit;
    } else {
      const lossResult = progression.registerLoss(betAmount);
      totalProfit -= betAmount;
      // Registra loss pra cooldown no analyzer (usando timestamp do candle)
      analyzer.registerLossAt(ASSET, currentCandle.epoch * 1000);
    }

    if (totalProfit > peakProfit) peakProfit = totalProfit;
    const currentDrawdown = peakProfit - totalProfit;
    if (currentDrawdown > maxDrawdown) maxDrawdown = currentDrawdown;

    trades.push({
      date: date.toISOString().slice(0, 16),
      direction,
      entry: currentCandle.close,
      exit: nextCandle.close,
      result: tradeResult,
      bet: betAmount,
      level: tradeResult === 'LOSS' ? progression.currentLevel : 1,
      runningProfit: Math.round(totalProfit * 100) / 100,
      rsi: result.indicators.rsi.value,
      bbWidth: result.indicators.bb.bb ? result.indicators.bb.bb.width : 0,
      bbPos: result.indicators.bb.pricePosition,
      confidence: result.confidence,
      tier: result.tier
    });

    const stopCheck = progression.checkDailyStops(STOP_LOSS, STOP_WIN);
    if (stopCheck.stopped) dayStopped = true;
  }

  // Último dia
  if (currentDay) {
    dailyResults[currentDay] = {
      profit: Math.round(progression.dailyProfit * 100) / 100,
      wins: progression.dailyWins,
      losses: progression.dailyLosses,
      total: progression.dailyWins + progression.dailyLosses,
      winRate: progression.dailyWins + progression.dailyLosses > 0
        ? Math.round((progression.dailyWins / (progression.dailyWins + progression.dailyLosses)) * 100)
        : 0
    };
  }

  printReport(trades, dailyResults, totalProfit, maxDrawdown, signalsGenerated, signalsFiltered, filterReasons, allCandles);
}

function printReport(trades, dailyResults, totalProfit, maxDrawdown, signalsGenerated, signalsFiltered, filterReasons, allCandles) {
  const wins = trades.filter(t => t.result === 'WIN').length;
  const losses = trades.filter(t => t.result === 'LOSS').length;
  const total = trades.length;
  const winRate = total > 0 ? (wins / total * 100).toFixed(1) : 0;

  const totalBet = trades.reduce((sum, t) => sum + t.bet, 0);
  const avgBet = total > 0 ? (totalBet / total).toFixed(2) : 0;
  const maxBet = total > 0 ? Math.max(...trades.map(t => t.bet)).toFixed(2) : 0;

  let maxWinStreak = 0, maxLossStreak = 0, curWin = 0, curLoss = 0;
  trades.forEach(t => {
    if (t.result === 'WIN') { curWin++; curLoss = 0; if (curWin > maxWinStreak) maxWinStreak = curWin; }
    else { curLoss++; curWin = 0; if (curLoss > maxLossStreak) maxLossStreak = curLoss; }
  });

  const days = Object.entries(dailyResults);
  const profitDays = days.filter(([, d]) => d.profit > 0).length;
  const lossDays = days.filter(([, d]) => d.profit < 0).length;
  const zeroDays = days.filter(([, d]) => d.profit === 0 && d.total === 0).length;
  const activeDays = days.length - zeroDays;

  // Confidence breakdown
  const highConf = trades.filter(t => t.confidence >= 75);
  const highConfWins = highConf.filter(t => t.result === 'WIN').length;
  const medConf = trades.filter(t => t.confidence >= 60 && t.confidence < 75);
  const medConfWins = medConf.filter(t => t.result === 'WIN').length;
  const lowConf = trades.filter(t => t.confidence < 60);
  const lowConfWins = lowConf.filter(t => t.result === 'WIN').length;

  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║          📊 RESULTADO DO BACKTEST v2                  ║');
  console.log('╠═══════════════════════════════════════════════════════╣');
  console.log(`║  Sinais gerados:       ${String(signalsGenerated).padStart(6)}                      ║`);
  console.log(`║  Sinais filtrados:     ${String(signalsFiltered).padStart(6)}                      ║`);
  console.log('╠═══════════════════════════════════════════════════════╣');
  console.log(`║  Operações:            ${String(total).padStart(6)}                      ║`);
  console.log(`║  Wins:                 ${String(wins).padStart(6)}                      ║`);
  console.log(`║  Losses:               ${String(losses).padStart(6)}                      ║`);
  console.log(`║  ★ WIN RATE:           ${String(winRate + '%').padStart(7)}                     ║`);
  console.log('╠═══════════════════════════════════════════════════════╣');
  console.log(`║  Lucro Total:       R$${String(totalProfit.toFixed(2)).padStart(9)}                    ║`);
  console.log(`║  Max Drawdown:      R$${String(maxDrawdown.toFixed(2)).padStart(9)}                    ║`);
  console.log(`║  Aposta Média:      R$${String(avgBet).padStart(9)}                    ║`);
  console.log(`║  Aposta Máxima:     R$${String(maxBet).padStart(9)}                    ║`);
  console.log('╠═══════════════════════════════════════════════════════╣');
  console.log(`║  Maior sequência WIN:     ${String(maxWinStreak).padStart(4)}                      ║`);
  console.log(`║  Maior sequência LOSS:    ${String(maxLossStreak).padStart(4)}                      ║`);
  console.log('╠═══════════════════════════════════════════════════════╣');
  console.log(`║  Dias ativos:          ${String(activeDays).padStart(6)}                      ║`);
  console.log(`║  Dias lucrativos:      ${String(profitDays).padStart(6)}                      ║`);
  console.log(`║  Dias no vermelho:     ${String(lossDays).padStart(6)}                      ║`);
  console.log('╠═══════════════════════════════════════════════════════╣');
  console.log('║  CONFIANÇA                                           ║');
  console.log(`║  Alta (≥75):  ${highConf.length} trades  ${highConf.length > 0 ? (highConfWins/highConf.length*100).toFixed(1) : 0}% WR                      ║`);
  console.log(`║  Média (60-74): ${medConf.length} trades  ${medConf.length > 0 ? (medConfWins/medConf.length*100).toFixed(1) : 0}% WR                    ║`);
  console.log(`║  Baixa (<60): ${lowConf.length} trades  ${lowConf.length > 0 ? (lowConfWins/lowConf.length*100).toFixed(1) : 0}% WR                      ║`);
  console.log('╚═══════════════════════════════════════════════════════╝');

  // Top/bottom days
  const sortedDays = days.filter(([, d]) => d.total > 0).sort((a, b) => b[1].profit - a[1].profit);

  if (sortedDays.length > 0) {
    console.log('\n📈 TOP 5 MELHORES DIAS:');
    sortedDays.slice(0, 5).forEach(([date, d]) => {
      console.log(`   ${date}  R$${d.profit >= 0 ? '+' : ''}${d.profit.toFixed(2).padStart(7)}  |  ${d.wins}W/${d.losses}L  (${d.winRate}%)`);
    });

    console.log('\n📉 TOP 5 PIORES DIAS:');
    sortedDays.slice(-5).reverse().forEach(([date, d]) => {
      console.log(`   ${date}  R$${d.profit >= 0 ? '+' : ''}${d.profit.toFixed(2).padStart(7)}  |  ${d.wins}W/${d.losses}L  (${d.winRate}%)`);
    });
  }

  // Filter reasons
  if (Object.keys(filterReasons).length > 0) {
    console.log('\n🔒 FILTROS MAIS ATIVADOS:');
    const sorted = Object.entries(filterReasons).sort((a, b) => b[1] - a[1]);
    sorted.slice(0, 10).forEach(([reason, count]) => {
      console.log(`   ${String(count).padStart(5)}x  ${reason}`);
    });
  }

  // Last 20 trades
  if (trades.length > 0) {
    console.log('\n📋 ÚLTIMAS 20 OPERAÇÕES:');
    console.log('   Data              Dir   Entry      Exit       Res   Bet     P&L      RSI   BBw    Conf');
    console.log('   ────────────────────────────────────────────────────────────────────────────────────');
    trades.slice(-20).forEach(t => {
      const dir = t.direction.padEnd(4);
      const res = t.result === 'WIN' ? '✅' : '❌';
      const pnl = `R$${t.runningProfit >= 0 ? '+' : ''}${t.runningProfit.toFixed(2)}`;
      console.log(`   ${t.date}  ${dir}  ${String(t.entry).padEnd(10)} ${String(t.exit).padEnd(10)} ${res}  R$${t.bet.toFixed(2).padStart(5)}  ${pnl.padStart(10)}  ${String(t.rsi).padStart(5)}  ${t.bbWidth}  ${t.confidence}`);
    });
  }

  // Equity curve
  if (trades.length > 10) {
    console.log('\n📈 CURVA DE EQUITY:');
    const step = Math.max(1, Math.floor(trades.length / 50));
    let line = '   ';
    const maxProf = Math.max(...trades.map(t => t.runningProfit));
    const minProf = Math.min(...trades.map(t => t.runningProfit));
    const range = maxProf - minProf || 1;

    for (let i = 0; i < trades.length; i += step) {
      const normalized = Math.round(((trades[i].runningProfit - minProf) / range) * 8);
      const chars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█', '█'];
      line += chars[normalized];
    }
    console.log(line);
    console.log(`   Min: R$${minProf.toFixed(2)}  |  Max: R$${maxProf.toFixed(2)}`);
  }

  // Verdict
  console.log('\n═══════════════════════════════════════════════════');
  if (total === 0) {
    console.log('⚠️  NENHUMA OPERAÇÃO — filtros muito restritivos');
  } else if (total < 10) {
    console.log(`⚠️  AMOSTRA PEQUENA (${total} trades) — precisa de mais dados ou filtros mais relaxados`);
  } else if (parseFloat(winRate) >= 80) {
    console.log(`🏆 EXCELENTE — Win rate ${winRate}% com ${total} trades!`);
  } else if (parseFloat(winRate) >= 70) {
    console.log(`✅ BOM — Win rate ${winRate}% com ${total} trades. Aceitável com progressão.`);
  } else if (parseFloat(winRate) >= 60) {
    console.log(`⚠️  MARGINAL — Win rate ${winRate}%. Precisa de ajustes pra 70%+.`);
  } else {
    console.log(`❌ REPROVADA — Win rate ${winRate}% insuficiente.`);
  }
  console.log('═══════════════════════════════════════════════════\n');
}

runBacktest().catch(err => {
  console.error('❌ Erro no backtest:', err);
  process.exit(1);
});
