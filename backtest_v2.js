const WebSocket = require('ws');

const symbols = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];

function calcRSI(closes, period = 14) {
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

function calcEMA(data, period) {
  const ema = [data[0]]; const k = 2/(period+1);
  for (let i = 1; i < data.length; i++) ema.push(data[i]*k + ema[i-1]*(1-k));
  return ema;
}

function calcStoch(h, l, c, kP=14) {
  const k = [];
  for (let i = 0; i < c.length; i++) {
    if (i < kP-1) { k.push(null); continue; }
    const hh = Math.max(...h.slice(i-kP+1,i+1));
    const ll = Math.min(...l.slice(i-kP+1,i+1));
    k.push(hh===ll?50:((c[i]-ll)/(hh-ll))*100);
  }
  return k;
}

function calcBB(closes, period=20, mult=2) {
  const bb = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period-1) { bb.push(null); continue; }
    const s = closes.slice(i-period+1,i+1);
    const m = s.reduce((a,b)=>a+b)/period;
    const std = Math.sqrt(s.reduce((a,b)=>a+(b-m)**2,0)/period);
    bb.push({ upper: m+mult*std, lower: m-mult*std, middle: m, width: (m+mult*std-(m-mult*std))/m });
  }
  return bb;
}

// Dynamic S/R: EMA as support/resistance + price cluster zones
function dynamicSR(c, o, h, l, ema50) {
  const zones = [];
  for (let i = 0; i < c.length; i++) {
    if (i < 50) { zones.push({}); continue; }
    
    // EMA50 as dynamic S/R
    const priceAboveEMA = c[i] > ema50[i];
    const priceTouchEMA = Math.abs(c[i] - ema50[i]) / c[i] < 0.001; // within 0.1%
    
    // Recent price range
    const recentH = h.slice(i-20, i);
    const recentL = l.slice(i-20, i);
    const highestRecent = Math.max(...recentH);
    const lowestRecent = Math.min(...recentL);
    
    // Price position in range (0=bottom, 1=top)
    const rangePos = highestRecent === lowestRecent ? 0.5 : (c[i] - lowestRecent) / (highestRecent - lowestRecent);
    
    // Count how many candles touched this price zone recently
    const zoneSize = (highestRecent - lowestRecent) * 0.05; // 5% of range
    let touchCount = 0;
    for (let j = i-30; j < i; j++) {
      if (j < 0) continue;
      if (Math.abs(l[j] - c[i]) < zoneSize || Math.abs(h[j] - c[i]) < zoneSize) touchCount++;
    }
    
    zones.push({
      priceAboveEMA,
      priceTouchEMA,
      rangePos, // 0=at range bottom (support), 1=at range top (resistance)
      touchCount, // more touches = stronger zone
      atRangeBottom: rangePos < 0.15,
      atRangeTop: rangePos > 0.85,
      inLowerZone: rangePos < 0.3,
      inUpperZone: rangePos > 0.7
    });
  }
  return zones;
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
  // Test on 5min candles (more trades, what user wants to execute on)
  for (const gran of [300, 900]) {
    const granLabel = gran === 300 ? '5min' : '15min';
    console.log('\n' + '='.repeat(70));
    console.log('  TIMEFRAME: ' + granLabel);
    console.log('='.repeat(70));
    
    for (const sym of symbols) {
      const candles = await fetchCandles(sym, gran);
      if (!candles || candles.length < 200) continue;
      
      const c = candles.map(x => parseFloat(x.close));
      const o = candles.map(x => parseFloat(x.open));
      const h = candles.map(x => parseFloat(x.high));
      const l = candles.map(x => parseFloat(x.low));
      
      const rsi14 = calcRSI(c, 14);
      const rsi7 = calcRSI(c, 7);
      const stochK = calcStoch(h, l, c);
      const ema20 = calcEMA(c, 20);
      const ema50 = calcEMA(c, 50);
      const bb = calcBB(c);
      const sr = dynamicSR(c, o, h, l, ema50);
      
      const days = candles.length * (gran/60) / 60 / 24;
      
      // A: Range bottom + RSI<30 + Stoch<20 + bullish candle
      let sA = {w:0,l:0};
      // B: Range bottom + RSI<35 + BB lower touch + bullish
      let sB = {w:0,l:0};
      // C: EMA bounce (touch EMA50 from above in uptrend) + RSI 40-60 
      let sC = {w:0,l:0};
      // D: BB squeeze + RSI extreme + range position
      let sD = {w:0,l:0};
      // E: Multi-confirm: range bottom + RSI<30 + stoch<25 + 2+ red before + bullish reversal
      let sE = {w:0,l:0};
      // F: Range extreme + RSI extreme + BB touch (triple confirmation)
      let sF = {w:0,l:0};
      // G: EMA crossover zone + RSI confirm
      let sG = {w:0,l:0};
      // H: Strongest filter: range bottom + RSI<25 + stoch<15 + BB lower + bullish engulf
      let sH = {w:0,l:0};
      
      for (let i = 55; i < candles.length - 1; i++) {
        const r14 = rsi14[i], r7 = rsi7[i], sk = stochK[i], bbv = bb[i], zone = sr[i];
        if (!r14 || !r7 || !sk || !bbv || !zone.rangePos) continue;
        
        const body = Math.abs(c[i]-o[i]);
        const range = h[i]-l[i];
        const bodyR = range > 0 ? body/range : 0;
        const bull = c[i] > o[i];
        const bear = c[i] < o[i];
        const nU = c[i+1] > c[i];
        const nD = c[i+1] < c[i];
        
        const engB = bull && i > 0 && c[i-1] < o[i-1] && c[i] > o[i-1] && o[i] <= c[i-1];
        const engS = bear && i > 0 && c[i-1] > o[i-1] && c[i] < o[i-1] && o[i] >= c[i-1];
        
        let reds = 0;
        for (let j=i-1;j>=Math.max(0,i-5);j--) { if(c[j]<o[j])reds++;else break; }
        let greens = 0;
        for (let j=i-1;j>=Math.max(0,i-5);j--) { if(c[j]>o[j])greens++;else break; }
        
        // CALL signals
        if (zone.atRangeBottom && r14 < 30 && sk < 20 && bull) { if(nU)sA.w++;else sA.l++; }
        if (zone.atRangeBottom && r14 < 35 && c[i] <= bbv.lower && bull) { if(nU)sB.w++;else sB.l++; }
        if (zone.priceTouchEMA && zone.priceAboveEMA && r14 > 40 && r14 < 60 && bull) { if(nU)sC.w++;else sC.l++; }
        if (zone.inLowerZone && r14 < 25 && c[i] <= bbv.lower) { if(nU)sD.w++;else sD.l++; }
        if (zone.atRangeBottom && r14 < 30 && sk < 25 && reds >= 2 && bull) { if(nU)sE.w++;else sE.l++; }
        if (zone.atRangeBottom && r14 < 25 && c[i] <= bbv.lower) { if(nU)sF.w++;else sF.l++; }
        if (c[i-1] < ema20[i-1] && c[i] > ema20[i] && r14 > 45 && r14 < 55) { if(nU)sG.w++;else sG.l++; }
        if (zone.atRangeBottom && r14 < 25 && sk < 15 && c[i] <= bbv.lower && engB) { if(nU)sH.w++;else sH.l++; }
        
        // PUT signals (mirror)
        if (zone.atRangeTop && r14 > 70 && sk > 80 && bear) { if(nD)sA.w++;else sA.l++; }
        if (zone.atRangeTop && r14 > 65 && c[i] >= bbv.upper && bear) { if(nD)sB.w++;else sB.l++; }
        if (zone.inUpperZone && r14 > 75 && c[i] >= bbv.upper) { if(nD)sD.w++;else sD.l++; }
        if (zone.atRangeTop && r14 > 70 && sk > 75 && greens >= 2 && bear) { if(nD)sE.w++;else sE.l++; }
        if (zone.atRangeTop && r14 > 75 && c[i] >= bbv.upper) { if(nD)sF.w++;else sF.l++; }
        if (zone.atRangeTop && r14 > 75 && sk > 85 && c[i] >= bbv.upper && engS) { if(nD)sH.w++;else sH.l++; }
      }
      
      function fmt(s, lbl) {
        const t = s.w+s.l;
        return lbl.padEnd(38) + t.toString().padStart(4) + ' trades  WR=' + (t>0?(s.w/t*100).toFixed(1):'N/A').padStart(5) + '%  ' + (t/days).toFixed(1) + '/day';
      }
      
      console.log('\n--- ' + sym + ' (' + candles.length + ' candles, ~' + days.toFixed(0) + ' days) ---');
      console.log(fmt(sA, 'A:RangeBot+RSI30+Stoch20+Bull'));
      console.log(fmt(sB, 'B:RangeBot+RSI35+BBlow+Bull'));
      console.log(fmt(sC, 'C:EMA50bounce+RSI40-60+Bull'));
      console.log(fmt(sD, 'D:LowerZone+RSI25+BBlow'));
      console.log(fmt(sE, 'E:RangeBot+RSI30+St25+2red+Bull'));
      console.log(fmt(sF, 'F:RangeBot+RSI25+BBlow(triple)'));
      console.log(fmt(sG, 'G:EMA20cross+RSI45-55'));
      console.log(fmt(sH, 'H:ALL(Bot+RSI25+St15+BB+Engulf)'));
    }
  }
})();
