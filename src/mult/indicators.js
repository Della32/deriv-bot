// ===== INDICADORES + CONFLUENCIA (estrategia validada Ouro+Prata) =====
function ema(v, p) { const k = 2/(p+1); const o = []; let pr; for (let i=0;i<v.length;i++){ pr = i===0 ? v[0] : v[i]*k + pr*(1-k); o.push(pr);} return o; }
function atr(c, p=14){ const tr=[]; for(let i=0;i<c.length;i++){ if(i===0){tr.push(c[i].high-c[i].low);continue;} tr.push(Math.max(c[i].high-c[i].low, Math.abs(c[i].high-c[i-1].close), Math.abs(c[i].low-c[i-1].close))); } const o=[]; let pr; for(let i=0;i<tr.length;i++){ pr=i===0?tr[0]:(pr*(p-1)+tr[i])/p; o.push(pr);} return o; }
function rsi(cl, p=14){ const o=new Array(cl.length).fill(50); let g=0,l=0; for(let i=1;i<=p;i++){const d=cl[i]-cl[i-1]; if(d>0)g+=d; else l-=d;} g/=p; l/=p; o[p]=l===0?100:100-100/(1+g/l); for(let i=p+1;i<cl.length;i++){const d=cl[i]-cl[i-1]; const gg=d>0?d:0, ll=d<0?-d:0; g=(g*(p-1)+gg)/p; l=(l*(p-1)+ll)/p; o[i]=l===0?100:100-100/(1+g/l);} return o; }
function roc(cl, p=10){ return cl.map((v,i)=> i<p ? 0 : (v-cl[i-p])/cl[i-p]*100); }
function macdHist(cl){ const e12=ema(cl,12), e26=ema(cl,26); const macd=cl.map((_,i)=>e12[i]-e26[i]); const sig=ema(macd,9); return macd.map((m,i)=>m-sig[i]); }

// votos -7..+7 por barra
function buildVotes(c){
  const cl = c.map(x=>x.close);
  const e9=ema(cl,9), e21=ema(cl,21), e50=ema(cl,50), e200=ema(cl,200);
  const r=rsi(cl,14), h=macdHist(cl), rc=roc(cl,10);
  const votes=[];
  for(let i=0;i<c.length;i++){
    if(i<200){ votes.push(0); continue; }
    let v=0;
    v += e50[i]>e200[i]?1:(e50[i]<e200[i]?-1:0);
    v += e9[i]>e21[i]?1:(e9[i]<e21[i]?-1:0);
    v += (r[i]>50&&r[i]<75)?1:((r[i]<50&&r[i]>25)?-1:0);
    v += h[i]>0?1:(h[i]<0?-1:0);
    v += rc[i]>0?1:(rc[i]<0?-1:0);
    let hh=-1e18, ll=1e18; for(let k=i-20;k<i;k++){ if(c[k].high>hh)hh=c[k].high; if(c[k].low<ll)ll=c[k].low; }
    v += c[i].close>hh?1:(c[i].close<ll?-1:0);
    v += c[i].close>e50[i]?1:(c[i].close<e50[i]?-1:0);
    votes.push(v);
  }
  return votes;
}

// sinal na ULTIMA barra fechada. retorna {dir, votes, confidence} ou null
function signalNow(candles, minVotes){
  if (candles.length < 210) return null;
  const votes = buildVotes(candles);
  const i = candles.length - 1;
  let dir = 0;
  if (votes[i] >= minVotes && votes[i-1] < minVotes) dir = 1;
  else if (votes[i] <= -minVotes && votes[i-1] > -minVotes) dir = -1;
  if (!dir) return null;
  const a = atr(candles, 14);
  const conf = Math.abs(votes[i]) >= 6 ? 'FORTE' : 'MEDIO';
  return { dir, votes: votes[i], confidence: conf, atr: a[a.length-1], entry: candles[i].close };
}

module.exports = { ema, atr, rsi, roc, macdHist, buildVotes, signalNow };
