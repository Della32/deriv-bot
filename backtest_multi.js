const WebSocket = require('ws');

// Multi-timeframe approach:
// Analyze on 15min for direction bias + S/R
// Enter on 5min candle confirmation
// Expire in 5 minutes

const symbols = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];

function calcRSI(closes, period) {
  const rsi = [];
  for (let i = 0; i < period; i++) rsi.push(null);
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i]-closes[i-1]; if(d>0)ag+=d;else al+=Math.abs(d); }
  ag/=period; al/=period;
  rsi.push(al===0?100:100-100/(1+ag/al));
  for (let i = period+1; i < closes.length; i++) {
    const d = closes[i]-closes[i-1];
    ag = (ag*(period-1)+(d>0?d:0))/period;
    al = (al*(period-1)+(d<0?Math.abs(d):0))/period;
    rsi.push(al===0?100:100-100/(1+ag/al));
  }
  return rsi;
}

function calcBB(closes, period=20, mult=2) {
  const bb = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period-1) { bb.push(null); continue; }
    const s = closes.slice(i-period+1,i+1);
    const m = s.reduce((a,b)=>a+b)/period;
    const std = Math.sqrt(s.reduce((a,b)=>a+(b-m)**2,0)/period);
    bb.push({ upper: m+mult*std, lower: m-mult*std, middle: m });
  }
  return bb;
}

function calcEMA(data, period) {
  const ema = [data[0]]; const k = 2/(period+1);
  for (let i = 1; i < data.length; i++) ema.push(data[i]*k + ema[i-1]*(1-k));
  return ema;
}

function fetchCandles(sym, granularity) {
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');
    ws.on('open', () => {
      ws.send(JSON.stringify({ ticks_history: sym, adjust_start_time: 1, count: 5000, end: 'latest', granularity, style: 'candles' }));
    });
    ws.on('message', (data) => {
      const resp = JSON.parse(data);
      if (resp.candles) { ws.close(); resolve(resp.candles); }
      if (resp.error) { ws.close(); resolve(null); }
    });
    setTimeout(() => resolve(null), 12000);
  });
}

(async () => {
  console.log('MULTI-TIMEFRAME BACKTEST: 15min analysis -> 5min execution\n');
  console.log('Also testing: progression recovery (if WR > 55%, martingale makes it profitable)\n');
  
  const payout = 0.92; // 92% payout
  
  for (const sym of symbols) {
    // Fetch both timeframes
    const [candles15, candles5] = await Promise.all([
      fetchCandles(sym, 900),
      fetchCandles(sym, 300)
    ]);
    
    if (!candles15 || !candles5 || candles15.length < 200 || candles5.length < 200) continue;
    
    // Build 15min indicators
    const c15 = candles15.map(x => parseFloat(x.close));
    const h15 = candles15.map(x => parseFloat(x.high));
    const l15 = candles15.map(x => parseFloat(x.low));
    const o15 = candles15.map(x => parseFloat(x.open));
    const rsi15 = calcRSI(c15, 14);
    const bb15 = calcBB(c15);
    const ema20_15 = calcEMA(c15, 20);
    
    // Build 5min indicators
    const c5 = candles5.map(x => parseFloat(x.close));
    const h5 = candles5.map(x => parseFloat(x.high));
    const l5 = candles5.map(x => parseFloat(x.low));
    const o5 = candles5.map(x => parseFloat(x.open));
    const rsi5 = calcRSI(c5, 14);
    const rsi5_7 = calcRSI(c5, 7);
    const bb5 = calcBB(c5);
    const ema20_5 = calcEMA(c5, 20);
    const ema50_5 = calcEMA(c5, 50);
    
    const days = candles5.length * 5 / 60 / 24;
    
    // Map 5min candle index to corresponding 15min candle
    // Each 15min candle = 3 x 5min candles
    // Use epoch times to align
    const t15 = candles15.map(x => x.epoch);
    const t5 = candles5.map(x => x.epoch);
    
    function get15idx(idx5) {
      const epoch = t5[idx5];
      // Find the most recent closed 15min candle
      for (let j = t15.length - 1; j >= 0; j--) {
        if (t15[j] + 900 <= epoch) return j; // closed 15min candle before this 5min
      }
      return -1;
    }
    
    // Strategies with 5min entry + 15min bias
    let strategies = {
      // MTF1: 15min RSI<35 + BB lower zone + 5min bullish candle
      mtf1: { w: 0, l: 0 },
      // MTF2: 15min RSI<30 + 5min RSI<30 + 5min bullish
      mtf2: { w: 0, l: 0 },
      // MTF3: 15min trend (price < EMA20) + 5min RSI<25 oversold bounce
      mtf3: { w: 0, l: 0 },
      // MTF4: 15min BB lower + 5min RSI crossing back from <20
      mtf4: { w: 0, l: 0 },
      // Pure5: RSI7<20 + RSI14<30 + BB lower + bullish (5min only but stricter)
      pure5a: { w: 0, l: 0 },
      // Pure5b: RSI14<35 + price below BB lower + bullish + body>50%
      pure5b: { w: 0, l: 0 },
      // Pure5c: RSI<30 + 3 consecutive red + next is green
      pure5c: { w: 0, l: 0 },
      // Pure5d: RSI<25 + below BB + below EMA50 (extreme oversold)
      pure5d: { w: 0, l: 0 },
      // Pure5e: RSI7 crossing from <15 to >15 (hook) + price above open
      pure5e: { w: 0, l: 0 },
    };
    
    for (let i = 55; i < candles5.length - 1; i++) {
      const r5_14 = rsi5[i], r5_7 = rsi5_7[i], r5_14p = rsi5[i-1], r5_7p = rsi5_7[i-1];
      const bbv5 = bb5[i];
      if (!r5_14 || !r5_7 || !bbv5 || !r5_7p) continue;
      
      const bull5 = c5[i] > o5[i];
      const bear5 = c5[i] < o5[i];
      const body5 = Math.abs(c5[i]-o5[i]);
      const range5 = h5[i]-l5[i];
      const bodyR5 = range5 > 0 ? body5/range5 : 0;
      const nU = c5[i+1] > c5[i];
      const nD = c5[i+1] < c5[i];
      
      // Consecutive reds
      let reds = 0;
      for (let j=i-1;j>=Math.max(0,i-6);j--) { if(c5[j]<o5[j])reds++;else break; }
      let greens = 0;
      for (let j=i-1;j>=Math.max(0,i-6);j--) { if(c5[j]>o5[j])greens++;else break; }
      
      // Get 15min context
      const idx15 = get15idx(i);
      const r15 = idx15 >= 0 ? rsi15[idx15] : null;
      const bb15v = idx15 >= 0 ? bb15[idx15] : null;
      
      // CALL signals
      // MTF1
      if (r15 && r15 < 35 && bb15v && c15[idx15] <= bb15v.lower && bull5) {
        if (nU) strategies.mtf1.w++; else strategies.mtf1.l++;
      }
      // MTF2
      if (r15 && r15 < 30 && r5_14 < 30 && bull5) {
        if (nU) strategies.mtf2.w++; else strategies.mtf2.l++;
      }
      // MTF3
      if (idx15 >= 0 && c15[idx15] < ema20_15[idx15] && r5_14 < 25 && bull5) {
        if (nU) strategies.mtf3.w++; else strategies.mtf3.l++;
      }
      // MTF4
      if (bb15v && c15[idx15] <= bb15v.lower && r5_7p < 20 && r5_7 >= 20) {
        if (nU) strategies.mtf4.w++; else strategies.mtf4.l++;
      }
      
      // Pure 5min
      if (r5_7 < 20 && r5_14 < 30 && c5[i] <= bbv5.lower && bull5) {
        if (nU) strategies.pure5a.w++; else strategies.pure5a.l++;
      }
      if (r5_14 < 35 && c5[i] <= bbv5.lower && bull5 && bodyR5 > 0.5) {
        if (nU) strategies.pure5b.w++; else strategies.pure5b.l++;
      }
      if (r5_14 < 30 && reds >= 3 && bull5) {
        if (nU) strategies.pure5c.w++; else strategies.pure5c.l++;
      }
      if (r5_14 < 25 && c5[i] <= bbv5.lower && c5[i] < ema50_5[i]) {
        if (nU) strategies.pure5d.w++; else strategies.pure5d.l++;
      }
      if (r5_7p < 15 && r5_7 >= 15 && bull5) {
        if (nU) strategies.pure5e.w++; else strategies.pure5e.l++;
      }
      
      // PUT signals (mirror)
      if (r15 && r15 > 65 && bb15v && c15[idx15] >= bb15v.upper && bear5) {
        if (nD) strategies.mtf1.w++; else strategies.mtf1.l++;
      }
      if (r15 && r15 > 70 && r5_14 > 70 && bear5) {
        if (nD) strategies.mtf2.w++; else strategies.mtf2.l++;
      }
      if (idx15 >= 0 && c15[idx15] > ema20_15[idx15] && r5_14 > 75 && bear5) {
        if (nD) strategies.mtf3.w++; else strategies.mtf3.l++;
      }
      if (bb15v && c15[idx15] >= bb15v.upper && r5_7p > 80 && r5_7 <= 80) {
        if (nD) strategies.mtf4.w++; else strategies.mtf4.l++;
      }
      if (r5_7 > 80 && r5_14 > 70 && c5[i] >= bbv5.upper && bear5) {
        if (nD) strategies.pure5a.w++; else strategies.pure5a.l++;
      }
      if (r5_14 > 65 && c5[i] >= bbv5.upper && bear5 && bodyR5 > 0.5) {
        if (nD) strategies.pure5b.w++; else strategies.pure5b.l++;
      }
      if (r5_14 > 70 && greens >= 3 && bear5) {
        if (nD) strategies.pure5c.w++; else strategies.pure5c.l++;
      }
      if (r5_14 > 75 && c5[i] >= bbv5.upper && c5[i] > ema50_5[i]) {
        if (nD) strategies.pure5d.w++; else strategies.pure5d.l++;
      }
      if (r5_7p > 85 && r5_7 <= 85 && bear5) {
        if (nD) strategies.pure5e.w++; else strategies.pure5e.l++;
      }
    }
    
    console.log('=== ' + sym + ' (' + candles5.length + ' x 5min, ~' + days.toFixed(0) + ' days) ===');
    
    for (const [name, s] of Object.entries(strategies)) {
      const t = s.w + s.l;
      if (t < 3) continue;
      const wr = (s.w/t*100).toFixed(1);
      const pd = (t/days).toFixed(2);
      
      // Calculate profitability with martingale (max 4 levels)
      // Level 0: $1, Level 1: $2.15, Level 2: $4.63, Level 3: $9.97
      // Break-even WR with payout 92% = 1/1.92 = 52.1%
      const breakeven = 1 / (1 + payout) * 100;
      const profitable = parseFloat(wr) > breakeven ? 'PROFIT' : 'LOSS';
      
      // With martingale: expected profit per sequence
      const p = s.w / t;
      // Profit if win on level 0: +payout
      // Profit if lose level 0, win level 1: -1 + 2.15*payout = -1 + 1.978 = +0.978  
      const baseStake = 1;
      const levels = [1, 2.2, 4.84, 10.65, 23.43]; // each covers losses + profit
      let martProfit = 0;
      let runningLossProb = 1;
      for (let lv = 0; lv < 5; lv++) {
        const prevLosses = levels.slice(0, lv).reduce((a,b) => a+b, 0);
        const winPayout = levels[lv] * payout;
        const netProfit = winPayout - prevLosses;
        const probWinHere = runningLossProb * p;
        martProfit += probWinHere * netProfit;
        runningLossProb *= (1 - p);
      }
      // Probability of losing all 5 levels
      const totalLoss = levels.reduce((a,b) => a+b, 0);
      martProfit -= runningLossProb * totalLoss;
      
      const martLabel = martProfit > 0 ? 'MART+' : 'MART-';
      
      const marker = parseFloat(wr) >= 65 ? ' ***' : parseFloat(wr) >= 58 ? ' **' : '';
      console.log('  ' + name.padEnd(12) + t.toString().padStart(5) + ' trades  WR=' + wr.padStart(5) + '%  ' + pd.padStart(5) + '/day  ' + profitable.padEnd(6) + '  ' + martLabel + '($' + martProfit.toFixed(3) + '/seq)' + marker);
    }
    
    // Reset
    for (const k of Object.keys(strategies)) strategies[k] = { w: 0, l: 0 };
    console.log('');
  }
  
  console.log('\nNOTE: Break-even WR at 92% payout = 52.1%');
  console.log('With martingale (5 levels), even 55% WR is profitable');
  console.log('*** = WR >= 65%, ** = WR >= 58%');
})();
