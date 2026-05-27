const WebSocket = require('ws');

const symbols = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];
const granularities = [
  { label: '30min', g: 1800 },
  { label: '1h', g: 3600 }
];

function calcRSI(closes, period = 14) {
  const rsi = [];
  for (let i = 0; i < period; i++) rsi.push(null);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i-1];
    if (diff > 0) avgGain += diff; else avgLoss += Math.abs(diff);
  }
  avgGain /= period; avgLoss /= period;
  rsi.push(avgLoss === 0 ? 100 : 100 - 100/(1 + avgGain/avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i-1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period-1) + gain) / period;
    avgLoss = (avgLoss * (period-1) + loss) / period;
    rsi.push(avgLoss === 0 ? 100 : 100 - 100/(1 + avgGain/avgLoss));
  }
  return rsi;
}

function calcStoch(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
  const k = [], d = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < kPeriod - 1) { k.push(null); d.push(null); continue; }
    const hSlice = highs.slice(i - kPeriod + 1, i + 1);
    const lSlice = lows.slice(i - kPeriod + 1, i + 1);
    const hh = Math.max(...hSlice);
    const ll = Math.min(...lSlice);
    k.push(hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100);
    const validK = k.filter(x => x !== null);
    d.push(validK.length >= dPeriod ? validK.slice(-dPeriod).reduce((a,b) => a+b) / dPeriod : null);
  }
  return { k, d };
}

// Find support/resistance levels using pivot points and price clustering
function findSR(highs, lows, closes, lookback = 50) {
  // For each candle, find nearby S/R zones
  const srZones = [];
  
  for (let i = 0; i < closes.length; i++) {
    if (i < lookback) { srZones.push({ supports: [], resistances: [] }); continue; }
    
    const sliceH = highs.slice(i - lookback, i);
    const sliceL = lows.slice(i - lookback, i);
    const sliceC = closes.slice(i - lookback, i);
    
    // Find swing highs (local maxima)
    const swingHighs = [];
    const swingLows = [];
    for (let j = 2; j < sliceH.length - 2; j++) {
      if (sliceH[j] > sliceH[j-1] && sliceH[j] > sliceH[j-2] && sliceH[j] > sliceH[j+1] && sliceH[j] > sliceH[j+2]) {
        swingHighs.push(sliceH[j]);
      }
      if (sliceL[j] < sliceL[j-1] && sliceL[j] < sliceL[j-2] && sliceL[j] < sliceL[j+1] && sliceL[j] < sliceL[j+2]) {
        swingLows.push(sliceL[j]);
      }
    }
    
    // Cluster nearby levels (within 0.1% of price)
    const price = closes[i];
    const threshold = price * 0.002; // 0.2% zone
    
    // Find support zones near current price (below)
    const supports = swingLows.filter(s => s < price && price - s < threshold * 3);
    const resistances = swingHighs.filter(r => r > price && r - price < threshold * 3);
    
    // Count touches for each level (strength)
    const supportStrength = supports.length;
    const resistanceStrength = resistances.length;
    
    // Closest support/resistance
    const closestSupport = supports.length > 0 ? Math.max(...supports) : null;
    const closestResistance = resistances.length > 0 ? Math.min(...resistances) : null;
    
    // Is price AT support or resistance? (within 0.15%)
    const atSupport = closestSupport && (price - closestSupport) / price < 0.0015;
    const atResistance = closestResistance && (closestResistance - price) / price < 0.0015;
    
    // Support zone strength (how many times price bounced near this area)
    let bounceCountSupport = 0;
    let bounceCountResistance = 0;
    if (closestSupport) {
      for (let j = 0; j < sliceL.length; j++) {
        if (Math.abs(sliceL[j] - closestSupport) / closestSupport < 0.002) bounceCountSupport++;
      }
    }
    if (closestResistance) {
      for (let j = 0; j < sliceH.length; j++) {
        if (Math.abs(sliceH[j] - closestResistance) / closestResistance < 0.002) bounceCountResistance++;
      }
    }
    
    srZones.push({
      atSupport,
      atResistance,
      supportStrength: bounceCountSupport,
      resistanceStrength: bounceCountResistance,
      closestSupport,
      closestResistance
    });
  }
  return srZones;
}

function fetchCandles(sym, granularity) {
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');
    ws.on('open', () => {
      ws.send(JSON.stringify({
        ticks_history: sym, adjust_start_time: 1, count: 5000,
        end: 'latest', granularity, style: 'candles'
      }));
    });
    ws.on('message', (data) => {
      const resp = JSON.parse(data);
      if (resp.candles) { ws.close(); resolve(resp.candles); }
      if (resp.error) { ws.close(); resolve(null); }
    });
    setTimeout(() => { resolve(null); }, 12000);
  });
}

function runBacktest(candles, granMin, sym) {
  const c = candles.map(x => parseFloat(x.close));
  const o = candles.map(x => parseFloat(x.open));
  const h = candles.map(x => parseFloat(x.high));
  const l = candles.map(x => parseFloat(x.low));
  
  const rsi7 = calcRSI(c, 7);
  const rsi14 = calcRSI(c, 14);
  const stoch = calcStoch(h, l, c);
  const sr = findSR(h, l, c, 50);
  const days = candles.length * granMin / 60 / 24;
  
  // ===== COMBINED STRATEGIES =====
  
  // S1: AT SUPPORT + RSI oversold + bullish candle + stoch low
  let s1 = { w: 0, l: 0, trades: [] };
  // S2: AT RESISTANCE + RSI overbought + bearish candle + stoch high  
  // (combined with S1 for both directions)
  
  // S3: AT SUPPORT + RSI<30 + 2+ consecutive bearish (exhaustion at support)
  let s2 = { w: 0, l: 0, trades: [] };
  
  // S4: S/R bounce + RSI divergence + stoch cross
  let s3 = { w: 0, l: 0, trades: [] };
  
  // S5: Strong S/R (3+ bounces) + RSI extreme + engulfing
  let s4 = { w: 0, l: 0, trades: [] };
  
  // S6: ALL filters combined: S/R + RSI + Stoch + candle pattern
  let s5 = { w: 0, l: 0, trades: [] };
  
  // S7: Relaxed — S/R zone + RSI<35/>65 + any confirmation
  let s6 = { w: 0, l: 0, trades: [] };
  
  for (let i = 55; i < candles.length - 1; i++) {
    const r7 = rsi7[i], r14 = rsi14[i], r7p = rsi7[i-1], r14p = rsi14[i-1];
    const sk = stoch.k[i], sd = stoch.d[i], skp = stoch.k[i-1], sdp = stoch.d[i-1];
    const zone = sr[i];
    if (!r7 || !r14 || !sk || !sd || !zone || !r7p || !skp || !sdp) continue;
    
    const body = Math.abs(c[i] - o[i]);
    const range = h[i] - l[i];
    const bodyR = range > 0 ? body / range : 0;
    const bull = c[i] > o[i];
    const bear = c[i] < o[i];
    const nextUp = c[i+1] > c[i];
    const nextDn = c[i+1] < c[i];
    
    const engulfBull = bull && c[i-1] < o[i-1] && c[i] > o[i-1] && o[i] <= c[i-1];
    const engulfBear = bear && c[i-1] > o[i-1] && c[i] < o[i-1] && o[i] >= c[i-1];
    
    let consRed = 0, consGreen = 0;
    for (let j = i-1; j >= Math.max(0, i-5); j--) {
      if (c[j] < o[j]) consRed++; else break;
    }
    for (let j = i-1; j >= Math.max(0, i-5); j--) {
      if (c[j] > o[j]) consGreen++; else break;
    }
    
    // CALL signals
    // S1: At support + RSI<30 + bullish + stoch<25
    if (zone.atSupport && r14 < 30 && bull && sk < 25) {
      if (nextUp) s1.w++; else s1.l++;
    }
    // PUT: At resistance + RSI>70 + bearish + stoch>75
    if (zone.atResistance && r14 > 70 && bear && sk > 75) {
      if (nextDn) s1.w++; else s1.l++;
    }
    
    // S2: At support + RSI<30 + 2+ red candles before (exhaustion)
    if (zone.atSupport && r14 < 30 && consRed >= 2 && bull) {
      if (nextUp) s2.w++; else s2.l++;
    }
    if (zone.atResistance && r14 > 70 && consGreen >= 2 && bear) {
      if (nextDn) s2.w++; else s2.l++;
    }
    
    // S3: S/R + RSI hook + stoch cross
    if (zone.atSupport && r14p < 25 && r14 >= 25 && skp < sdp && sk >= sd) {
      if (nextUp) s3.w++; else s3.l++;
    }
    if (zone.atResistance && r14p > 75 && r14 <= 75 && skp > sdp && sk <= sd) {
      if (nextDn) s3.w++; else s3.l++;
    }
    
    // S4: Strong S/R (3+ bounces) + RSI extreme + engulfing
    if (zone.atSupport && zone.supportStrength >= 3 && r14 < 30 && engulfBull) {
      if (nextUp) s4.w++; else s4.l++;
    }
    if (zone.atResistance && zone.resistanceStrength >= 3 && r14 > 70 && engulfBear) {
      if (nextDn) s4.w++; else s4.l++;
    }
    
    // S5: ALL combined — S/R + RSI<25 + stoch<20 + bullish + bodyR>0.5
    if (zone.atSupport && r14 < 25 && sk < 20 && bull && bodyR > 0.5) {
      if (nextUp) s5.w++; else s5.l++;
    }
    if (zone.atResistance && r14 > 75 && sk > 80 && bear && bodyR > 0.5) {
      if (nextDn) s5.w++; else s5.l++;
    }
    
    // S6: Relaxed — near S/R + RSI<35 + any bullish signal
    if (zone.atSupport && r14 < 35 && bull) {
      if (nextUp) s6.w++; else s6.l++;
    }
    if (zone.atResistance && r14 > 65 && bear) {
      if (nextDn) s6.w++; else s6.l++;
    }
  }
  
  function fmt(s, label) {
    const t = s.w + s.l;
    const wr = t > 0 ? (s.w/t*100).toFixed(1) : 'N/A';
    return label.padEnd(30) + t.toString().padStart(4) + ' trades  WR=' + wr.padStart(5) + '%  ' + (t/days).toFixed(1) + '/day';
  }
  
  return {
    header: `${sym} (${candles.length} candles, ~${days.toFixed(0)} days)`,
    lines: [
      fmt(s1, 'S1:SR+RSI30+Bull+Stoch25'),
      fmt(s2, 'S2:SR+RSI30+2redExhaust'),
      fmt(s3, 'S3:SR+RSIhook+StochCross'),
      fmt(s4, 'S4:StrongSR+RSI+Engulf'),
      fmt(s5, 'S5:ALL(SR+RSI25+St20+body)'),
      fmt(s6, 'S6:Relaxed(SR+RSI35+bull)')
    ]
  };
}

(async () => {
  for (const { label, g } of granularities) {
    console.log('\n' + '='.repeat(70));
    console.log('  TIMEFRAME: ' + label + ' candles');
    console.log('='.repeat(70));
    
    for (const sym of symbols) {
      const candles = await fetchCandles(sym, g);
      if (!candles || candles.length < 100) { console.log(sym + ': insufficient data'); continue; }
      const result = runBacktest(candles, g / 60, sym);
      console.log('\n--- ' + result.header + ' ---');
      result.lines.forEach(l => console.log(l));
    }
  }
})();
