// ===== CLIENTE DERIV PARA MULTIPLIERS (conexao propria, isolada) =====
const WebSocket = require('ws');
const EventEmitter = require('events');

class DerivMult extends EventEmitter {
  constructor(cfg) {
    super();
    this.cfg = cfg;
    this.ws = null;
    this.authed = false;
    this.balance = 0;
    this.isVirtual = null;
    this.reqId = 1;
    this.pending = new Map();
    this.candles = {};       // symbol -> [{open,high,low,close,epoch}]
    this.subs = {};          // symbol -> subscription id
    this.activeContracts = {}; // contractId -> {symbol}
    this._closing = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.cfg.WS_URL);
      this.ws.on('open', async () => {
        try { await this.authorize(); resolve(); } catch (e) { reject(e); }
      });
      this.ws.on('message', (raw) => this._onMsg(raw));
      this.ws.on('error', (e) => { if (!this._closing) this.emit('ws_error', e); });
      this.ws.on('close', () => { this.authed = false; if (!this._closing) this._reconnect(); });
    });
  }

  _send(payload) {
    return new Promise((resolve, reject) => {
      const id = this.reqId++;
      payload.req_id = id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout '+id)); } }, 30000);
    });
  }

  _onMsg(raw) {
    let m; try { m = JSON.parse(raw); } catch(e) { return; }

    // candle stream (nao tem req_id no update)
    if (m.msg_type === 'ohlc') { this._onCandleUpdate(m.ohlc); }
    if (m.msg_type === 'proposal_open_contract') { this._onContract(m.proposal_open_contract); }
    if (m.msg_type === 'balance' && m.balance) { this.balance = m.balance.balance; }

    const id = m.req_id;
    if (id && this.pending.has(id)) {
      const { resolve, reject } = this.pending.get(id);
      this.pending.delete(id);
      if (m.error) reject(new Error(m.error.code + ': ' + m.error.message));
      else resolve(m);
    }
  }

  async authorize() {
    const r = await this._send({ authorize: this.cfg.TOKEN });
    this.authed = true;
    this.balance = r.authorize.balance;
    this.isVirtual = r.authorize.is_virtual === 1;
    this.loginid = r.authorize.loginid;
    await this._send({ balance: 1, subscribe: 1 });
    return r.authorize;
  }

  // warmup: puxa historico H1 e assina updates.
  // retorna true se OK, false se mercado fechado (nao-fatal).
  async subscribeCandles(symbol) {
    if (!this.candles[symbol]) this.candles[symbol] = [];
    let r;
    try {
      r = await this._send({
        ticks_history: symbol, end: 'latest', count: 300,
        style: 'candles', granularity: this.cfg.GRANULARITY, subscribe: 1
      });
    } catch (e) {
      if (this._isMarketClosed(e)) {
        console.log(`[MULT] ${symbol}: mercado fechado, aguardando abertura...`);
        return false;
      }
      throw e;
    }
    if (r.candles) {
      this.candles[symbol] = r.candles.map(c => ({ open:+c.open, high:+c.high, low:+c.low, close:+c.close, epoch:c.epoch }));
    }
    if (r.subscription) this.subs[symbol] = r.subscription.id;
    console.log(`[MULT] ${symbol}: ${this.candles[symbol].length} candles H${this.cfg.GRANULARITY/3600} carregados`);
    return true;
  }

  _isMarketClosed(e) {
    const s = (e && e.message ? e.message : String(e)).toLowerCase();
    return s.includes('marketisclosed') || s.includes('market is closed') ||
           s.includes('not offered') || s.includes('offeringsvalidationerror');
  }

  _onCandleUpdate(ohlc) {
    const symbol = ohlc.symbol;
    if (!this.candles[symbol]) return;
    const gran = this.cfg.GRANULARITY;
    const openTime = parseInt(ohlc.open_time) || Math.floor(parseInt(ohlc.epoch)/gran)*gran;
    const candle = { open:+ohlc.open, high:+ohlc.high, low:+ohlc.low, close:+ohlc.close, epoch:+ohlc.epoch, openTime };
    const arr = this.candles[symbol];
    const last = arr[arr.length-1];
    const lastOpen = last ? (last.openTime || Math.floor(last.epoch/gran)*gran) : null;
    if (last && lastOpen === openTime) {
      arr[arr.length-1] = candle;
    } else {
      arr.push(candle);
      if (arr.length > 350) arr.shift();
      // candle ANTERIOR fechou de vez
      if (arr.length >= 2) {
        this.emit('candle_close', { symbol, candles: arr.slice(0, -1) });
      }
    }
  }

  // compra Multiplier. dir: 1=MULTUP, -1=MULTDOWN. stake USD. slUSD/tpUSD = valores em $ (limit_order amount).
  async buyMultiplier(symbol, dir, stake, multiplier, slUSD, tpUSD) {
    const contract_type = dir === 1 ? 'MULTUP' : 'MULTDOWN';
    // proposal -> buy
    const prop = await this._send({
      proposal: 1, amount: stake, basis: 'stake', contract_type,
      currency: 'USD', symbol, multiplier,
      limit_order: { stop_loss: +slUSD.toFixed(2), take_profit: +tpUSD.toFixed(2) }
    });
    if (!prop.proposal) throw new Error('sem proposta');
    const buy = await this._send({ buy: prop.proposal.id, price: prop.proposal.ask_price });
    const cid = buy.buy.contract_id;
    this.activeContracts[cid] = { symbol };
    // assina updates do contrato
    this._send({ proposal_open_contract: 1, contract_id: cid, subscribe: 1 }).catch(()=>{});
    return { contractId: cid, buyPrice: buy.buy.buy_price, longcode: buy.buy.longcode };
  }

  _onContract(c) {
    if (!c) return;
    const sold = c.is_sold === 1 || c.is_sold === true;
    if (sold && (c.status === 'won' || c.status === 'lost')) {
      const cid = c.contract_id;
      if (!this.activeContracts[cid]) return; // ja tratado
      const won = c.status === 'won';
      const profit = (parseFloat(c.sell_price)||0) - (parseFloat(c.buy_price)||0);
      delete this.activeContracts[cid];
      if (c.balance_after) this.balance = c.balance_after;
      this.emit('contract_result', { contractId: cid, won, profit, symbol: c.underlying, buyPrice:+c.buy_price });
    }
  }

  hasOpen(symbol) { return Object.values(this.activeContracts).some(a => a.symbol === symbol); }
  openCount() { return Object.keys(this.activeContracts).length; }

  _reconnect() {
    if (this._reconnecting) return;
    this._reconnecting = true;
    const delay = 5000;
    console.log(`[MULT] Reconectando em ${delay/1000}s...`);
    setTimeout(async () => {
      this._reconnecting = false;
      try {
        await this.connect();
        for (const s of Object.keys(this.candles)) { await this.subscribeCandles(s); await new Promise(r=>setTimeout(r,500)); }
        this.emit('reconnected');
        console.log('[MULT] Reconectado.');
      } catch(e) { console.error('[MULT] Falha reconexao:', e.message); }
    }, delay);
  }

  close() { this._closing = true; try { this.ws.close(); } catch(e){} }
}

module.exports = DerivMult;
