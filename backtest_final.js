const WebSocket = require('ws');

// Focus: 15min candles, strategies B and D/F which showed best results
// Test multiple RSI/stoch thresholds to optimize
// Also test with 5min expiry (enter on 15min signal, expire 5min later)

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
  console.log('COMPREHENSIVE BACKTEST — Finding best strategy for OTC synthetics\n');
  
  const allResults = [];
  
  for (const sym of symbols) {
    const candles = await fetchCandles(sym, 900); // 15min
    if (!candles || candles.length < 200) continue;
    
    const c = candles.map(x => parseFloat(x.close));
    const o = candles.map(x => parseFloat(x.open));
    const h = candles.map(x => parseFloat(x.high));
    const l = candles.map(x => parseFloat(x.low));
    
    const rsi14 = calcRSI(c, 14);
    const rsi7 = calcRSI(c, 7);
    const rsi21 = calcRSI(c, 21);
    const bb = calcBB(c);
    const bb15 = calcBB(c, 15, 2);
    const ema20 = calcEMA(c, 20);
    const ema50 = calcEMA(c, 50);
    
    const days = candles.length * 15 / 60 / 24;
    
    // Optimized strategies with various thresholds
    const configs = [
      // { name, rsiPeriod, rsiOB, rsiOS, needBB, needBull, rangeThresh, minBody }
      { name: 'RSI14<30+BB+Bull',    rsi: rsi14, os: 30, ob: 70, bb: true, bull: true, rng: 0.15, body: 0 },
      { name: 'RSI14<35+BB+Bull',    rsi: rsi14, os: 35, ob: 65, bb: true, bull: true, rng: 0.15, body: 0 },
      { name: 'RSI14<30+BB(noBody)', rsi: rsi14, os: 30, ob: 70, bb: true, bull: false, rng: 0.15, body: 0 },
      { name: 'RSI7<20+BB+Bull',     rsi: rsi7,  os: 20, ob: 80, bb: true, bull: true, rng: 0.15, body: 0 },
      { name: 'RSI7<25+BB+Bull',     rsi: rsi7,  os: 25, ob: 75, bb: true, bull: true, rng: 0.15, body: 0 },
      { name: 'RSI14<30+BB+BigBody', rsi: rsi14, os: 30, ob: 70, bb: true, bull: true, rng: 0.15, body: 0.5 },
      { name: 'RSI14<25+BB+Rng20',   rsi: rsi14, os: 25, ob: 75, bb: true, bull: false, rng: 0.20, body: 0 },
      { name: 'RSI14<30+BB+Rng20',   rsi: rsi14, os: 30, ob: 70, bb: true, bull: false, rng: 0.20, body: 0 },
      { name: 'RSI21<30+BB+Bull',    rsi: rsi21, os: 30, ob: 70, bb: true, bull: true, rng: 0.15, body: 0 },
      { name: 'RSI14<30+EMAbelow',   rsi: rsi14, os: 30, ob: 70, bb: false, bull: true, rng: 0.15, body: 0, ema: true },
      // Dual RSI confirmation
      { name: 'RSI7<25+RSI14<35+BB', rsi: rsi7, os: 25, ob: 75, bb: true, bull: true, rng: 0.15, body: 0, dualRsi: rsi14, dualOs: 35, dualOb: 65 },
      { name: 'RSI7<20+RSI14<30+BB', rsi: rsi7, os: 20, ob: 80, bb: true, bull: false, rng: 0.15, body: 0, dualRsi: rsi14, dualOs: 30, dualOb: 70 },
    ];
    
    for (const cfg of configs) {
      let w = 0, loss = 0;
      
      for (let i = 55; i < candles.length - 1; i++) {
        const r = cfg.rsi[i];
        const bbv = cfg.bb ? bb[i] : null;
        if (!r) continue;
        if (cfg.dualRsi && !cfg.dualRsi[i]) continue;
        
        // Range position
        const recentH = h.slice(Math.max(0,i-20), i);
        const recentL = l.slice(Math.max(0,i-20), i);
        const hh = Math.max(...recentH);
        const ll = Math.min(...recentL);
        const rngPos = hh === ll ? 0.5 : (c[i] - ll) / (hh - ll);
        
        const body = Math.abs(c[i]-o[i]);
        const range = h[i]-l[i];
        const bodyR = range > 0 ? body/range : 0;
        const bull = c[i] > o[i];
        const bear = c[i] < o[i];
        
        // CALL
        let callSignal = r < cfg.os && rngPos < cfg.rng;
        if (cfg.bb && bbv && callSignal) callSignal = c[i] <= bbv.lower;
        if (cfg.bull && callSignal) callSignal = callSignal && bull;
        if (cfg.body > 0 && callSignal) callSignal = callSignal && bodyR > cfg.body;
        if (cfg.ema && callSignal) callSignal = callSignal && c[i] < ema50[i];
        if (cfg.dualRsi && callSignal) callSignal = callSignal && cfg.dualRsi[i] < cfg.dualOs;
        
        if (callSignal) { if (c[i+1] > c[i]) w++; else loss++; }
        
        // PUT
        let putSignal = r > cfg.ob && rngPos > (1 - cfg.rng);
        if (cfg.bb && bbv && putSignal) putSignal = c[i] >= bbv.upper;
        if (cfg.bull && putSignal) putSignal = putSignal && bear;
        if (cfg.body > 0 && putSignal) putSignal = putSignal && bodyR > cfg.body;
        if (cfg.ema && putSignal) putSignal = putSignal && c[i] > ema50[i];
        if (cfg.dualRsi && putSignal) putSignal = putSignal && cfg.dualRsi[i] > cfg.dualOb;
        
        if (putSignal) { if (c[i+1] < c[i]) w++; else loss++; }
      }
      
      const total = w + loss;
      const wr = total > 0 ? (w/total*100).toFixed(1) : 'N/A';
      const perDay = (total/days).toFixed(2);
      
      if (total > 5) { // only show if meaningful sample
        allResults.push({ sym, name: cfg.name, total, w, loss, wr: parseFloat(wr), perDay: parseFloat(perDay) });
      }
    }
  }
  
  // Sort by WR descending, show top results
  allResults.sort((a,b) => b.wr - a.wr);
  
  console.log('\n========== TOP STRATEGIES BY WIN RATE (min 5 trades) ==========\n');
  console.log('Symbol'.padEnd(8) + 'Strategy'.padEnd(30) + 'Trades'.padStart(7) + '  WR%'.padStart(7) + '  /day'.padStart(7));
  console.log('-'.repeat(62));
  
  allResults.slice(0, 30).forEach(r => {
    console.log(r.sym.padEnd(8) + r.name.padEnd(30) + r.total.toString().padStart(7) + r.wr.toFixed(1).padStart(7) + '%' + r.perDay.toFixed(2).padStart(6));
  });
  
  // Also show best per symbol
  console.log('\n========== BEST PER SYMBOL ==========\n');
  for (const sym of symbols) {
    const symResults = allResults.filter(r => r.sym === sym && r.total >= 10);
    if (symResults.length === 0) continue;
    const best = symResults[0]; // already sorted by WR
    console.log(sym + ': ' + best.name + ' -> ' + best.total + ' trades, WR=' + best.wr + '%, ' + best.perDay + '/day');
  }
  
  // Estimate combined daily trades if we use best strategy per symbol
  console.log('\n========== COMBINED ESTIMATE ==========');
  let totalPerDay = 0;
  for (const sym of symbols) {
    const symResults = allResults.filter(r => r.sym === sym && r.total >= 10 && r.wr >= 65);
    if (symResults.length > 0) {
      totalPerDay += symResults[0].perDay;
      console.log(sym + ': ' + symResults[0].perDay + '/day @ ' + symResults[0].wr + '% WR');
    }
  }
  console.log('Total estimated: ' + totalPerDay.toFixed(1) + ' trades/day');
})();
