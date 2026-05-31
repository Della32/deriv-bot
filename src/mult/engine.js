// ===== ENGINE MULTIPLIER: confluencia Ouro+Prata + risco + alerta =====
const { signalNow } = require('./indicators');
const RiskManager = require('./risk');

class MultEngine {
  constructor(deriv, telegram, db, cfg) {
    this.deriv = deriv;
    this.tg = telegram;
    this.db = db;
    this.cfg = cfg;
    this.risk = new RiskManager(db, cfg);
    this.multiplier = cfg.MULTIPLIER; // pode ser null -> resolve no 1o trade
    this._stmtTrade = db.prepare(`INSERT INTO mult_trades (symbol,dir,stake,sl,tp,confidence,votes,contract_id,result,profit_virtual,balance_virtual,ts) VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`);
    // mapa contractId -> contexto pra calcular pnl virtual
    this.openCtx = {};
  }

  start() {
    this.deriv.on('candle_close', (d) => this._onCandle(d).catch(e => console.error('[ENGINE] erro:', e.message)));
    this.deriv.on('contract_result', (r) => this._onResult(r));
    console.log('[ENGINE] Multiplier engine ON. Ativos:', this.cfg.ASSETS.join(', '));
  }

  async _onCandle({ symbol, candles }) {
    // 1) virada de mes / aporte
    const roll = this.risk.rolloverMonth();
    if (roll) { console.log('[RISK]', roll); await this._tg(roll); }

    // 2) travas de protecao
    const prot = this.risk.check();
    if (prot.blocked) return; // silencioso (ja avisou quando ativou)

    // 3) ja tem posicao nesse ativo?
    if (this.deriv.hasOpen(symbol)) return;

    // 4) sinal de confluencia na barra fechada
    const sig = signalNow(candles, this.cfg.MIN_CONFLUENCE);
    if (!sig) return;
    if (!sig.atr || sig.atr <= 0) return;

    // 5) tamanho e SL/TP em $ (na escala do MULTIPLIER real)
    const stakeVirtual = this.risk.stake();              // ex $1.10 (5% de $22)
    // resolve multiplicador se ainda nao definido
    if (!this.multiplier) {
      this.multiplier = await this._resolveMultiplier(symbol);
      if (!this.multiplier) { console.log('[ENGINE] sem multiplicador disponivel'); return; }
    }
    // No Multiplier, SL/TP sao em $ de PnL. Queremos: perda no SL = stake (risco 1R), ganho no TP = 2x stake.
    // limit_order.stop_loss = valor de perda; take_profit = valor de ganho (ambos em USD positivos).
    const slUSD = stakeVirtual;          // arrisca 1x o stake
    const tpUSD = stakeVirtual * this.cfg.RR; // ganha 2x (R:R 1:2)

    const dirTxt = sig.dir === 1 ? 'COMPRA' : 'VENDA';
    console.log(`[ENGINE] SINAL ${dirTxt} ${this.cfg.NAME[symbol]} | votos ${sig.votes} | ${sig.confidence} | stake $${stakeVirtual} SL $${slUSD} TP $${tpUSD}`);

    // 6) alerta Telegram ANTES de executar
    await this._tg(
      `${sig.dir===1?'🟢 COMPRA':'🔴 VENDA'} <b>${this.cfg.NAME[symbol]}</b>\n`+
      `Confianca: ${sig.confidence} (votos ${sig.votes}/7)\n`+
      `Entrada: ${sig.entry}\n`+
      `Stake: $${stakeVirtual} | Risco 1R / Alvo 2R\n`+
      `Banca virtual: $${this.risk.s.virtualBalance.toFixed(2)} (R$${(this.risk.s.virtualBalance*this.cfg.CAMBIO).toFixed(0)})`
    );

    // 7) executa no demo
    try {
      const res = await this.deriv.buyMultiplier(symbol, sig.dir, stakeVirtual, this.multiplier, slUSD, tpUSD);
      this.openCtx[res.contractId] = { symbol, dir: sig.dir, stake: stakeVirtual, sl: slUSD, tp: tpUSD, conf: sig.confidence, votes: sig.votes };
      console.log(`[ENGINE] Executado contrato ${res.contractId}`);
    } catch (e) {
      console.error('[ENGINE] erro buy:', e.message);
      await this._tg(`⚠️ Erro ao executar ${this.cfg.NAME[symbol]}: ${e.message}`);
    }
  }

  // resolve o menor multiplicador valido via proposal
  async _resolveMultiplier(symbol) {
    for (const m of [30, 60, 100, 150, 200]) {
      try {
        await this.deriv._send({ proposal:1, amount:1, basis:'stake', contract_type:'MULTUP',
          currency:'USD', symbol, multiplier:m, limit_order:{stop_loss:0.5, take_profit:1} });
        return m;
      } catch (e) { /* tenta proximo */ }
    }
    return null;
  }

  _onResult(r) {
    const ctx = this.openCtx[r.contractId];
    if (!ctx) return;
    delete this.openCtx[r.contractId];
    // PnL virtual: na nossa escala, win = +2x stake, loss = -1x stake (definido pelo SL/TP)
    const pnlVirtual = r.won ? ctx.tp : -ctx.sl;
    this.risk.applyResult(pnlVirtual, r.won);
    const sum = this.risk.summary();
    console.log(`[ENGINE] ${r.won?'🟢 WIN':'🔴 LOSS'} ${this.cfg.NAME[ctx.symbol]} | PnL virtual $${pnlVirtual.toFixed(2)} | banca $${sum.bal.toFixed(2)} | ${sum.w}W/${sum.l}L`);
    try {
      this._stmtTrade.run(ctx.symbol, ctx.dir===1?'BUY':'SELL', ctx.stake, ctx.sl, ctx.tp, ctx.conf, ctx.votes, r.contractId, r.won?'WIN':'LOSS', pnlVirtual, sum.bal);
    } catch(e){}
    this._tg(
      `${r.won?'🟢 GANHOU':'🔴 PERDEU'} <b>${this.cfg.NAME[ctx.symbol]}</b>\n`+
      `PnL: ${pnlVirtual>=0?'+':''}$${pnlVirtual.toFixed(2)} (R$${(pnlVirtual*this.cfg.CAMBIO).toFixed(2)})\n`+
      `Banca: $${sum.bal.toFixed(2)} (R$${(sum.bal*this.cfg.CAMBIO).toFixed(0)})\n`+
      `Acerto: ${sum.wr}% (${sum.w}W/${sum.l}L) | Lucro total: ${sum.lucro>=0?'+':''}$${sum.lucro.toFixed(2)}`
    );
  }

  async _tg(text) {
    if (!this.tg) return;
    try { await this.tg.send(text); } catch(e) { /* nao quebra o bot por causa do telegram */ }
  }
}

module.exports = MultEngine;
