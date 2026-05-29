/**
 * Deriv WebSocket Service v2.3 — OTC Synthetics
 * Handles: auth, candle subscriptions (5min + 15min), trade execution
 * v2.3 — Unlimited reconnects for Render restarts, exponential backoff
 */

const WebSocket = require('ws');
const EventEmitter = require('events');

class DerivService extends EventEmitter {
  constructor(token, appId = '1089') {
    super();
    this.token = token;
    this.appId = appId;
    this.ws = null;
    this.authorized = false;
    this.balance = 0;
    this.accountId = '';
    this.currency = 'USD';

    // Reconnection — never give up
    this.reconnectDelay = 3000;
    this.maxReconnectDelay = 60000; // cap at 60s
    this.reconnectCount = 0;
    this._reconnecting = false;

    this.subscriptions = {};
    this.pendingBuy = null;

    // req_id mapping
    this._reqIdMap = {};
    this._nextReqId = 100;

    // Track active contract for result detection
    this._activeContractId = null;
    this._resultEmitted = false;
    this._pocPollInterval = null;

    // Candle storage: { symbol: { '5m': [...], '15m': [...] } }
    this.candles = {};

    // Heartbeat / keepalive
    this._pingInterval = null;
  }

  _reqId(symbol, tf) {
    const id = this._nextReqId++;
    this._reqIdMap[id] = { symbol, tf };
    return id;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const url = `wss://ws.derivws.com/websockets/v3?app_id=${this.appId}`;

      try {
        this.ws = new WebSocket(url);
      } catch (e) {
        console.error('[DERIV] WebSocket creation failed:', e.message);
        reject(e);
        return;
      }

      this.ws.on('open', () => {
        console.log('[DERIV] WebSocket connected');
        this.ws.send(JSON.stringify({ authorize: this.token }));

        // Start heartbeat — send ping every 30s to keep WS alive
        this._startHeartbeat();
      });

      this._msgCount = 0;
      this.ws.on('message', (data) => {
        try {
          const str = typeof data === 'string' ? data : data.toString();
          const msg = JSON.parse(str);
          this._msgCount++;
          if (this._msgCount <= 30 || this._msgCount % 100 === 0) {
            console.log(`[DERIV] msg #${this._msgCount}: ${msg.msg_type}`);
          }
          this._handleMessage(msg, resolve);
        } catch (e) {
          console.error('[DERIV] Parse error:', e.message);
        }
      });

      this.ws.on('close', (code, reason) => {
        console.log(`[DERIV] WebSocket closed (code=${code}, reason=${reason || 'none'})`);
        this.authorized = false;
        this._stopHeartbeat();
        this._stopPocPolling();
        this._reconnect();
      });

      this.ws.on('error', (err) => {
        console.error('[DERIV] WebSocket error:', err.message);
        // Don't reject on reconnect attempts
        if (this.reconnectCount === 0) {
          reject(err);
        }
      });

      // Timeout for initial connection only
      setTimeout(() => {
        if (!this.authorized && this.reconnectCount === 0) {
          reject(new Error('Auth timeout'));
        }
      }, 15000);
    });
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this._pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ ping: 1 }));
      }
    }, 30000);
  }

  _stopHeartbeat() {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
  }

  _handleMessage(msg, resolveConnect) {
    if (msg.error) {
      console.error('[DERIV] API Error:', msg.error.code, msg.error.message);
      if (msg.msg_type === 'buy') {
        this.emit('trade_error', msg.error);
      }
      return;
    }

    switch (msg.msg_type) {
      case 'authorize':
        this.authorized = true;
        this.balance = msg.authorize.balance;
        this.accountId = msg.authorize.loginid;
        this.currency = msg.authorize.currency;
        console.log(`[DERIV] Authorized: ${this.accountId} | Balance: $${this.balance}`);
        // Reset reconnect counter on successful auth
        this.reconnectCount = 0;
        this.reconnectDelay = 3000;
        this.ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
        this.ws.send(JSON.stringify({ transaction: 1, subscribe: 1 }));
        if (resolveConnect) resolveConnect();
        this.emit('authorized', msg.authorize);
        break;

      case 'candles':
        this._handleCandleHistory(msg);
        break;

      case 'ohlc':
        this._handleCandleUpdate(msg);
        break;

      case 'proposal':
        this._handleProposal(msg);
        break;

      case 'buy':
        this._handleBuy(msg);
        break;

      case 'proposal_open_contract':
        this._handleContractUpdate(msg);
        break;

      case 'balance':
        if (msg.balance) this.balance = msg.balance.balance;
        this.emit('balance', this.balance);
        break;

      case 'transaction':
        if (msg.transaction) {
          this.emit('transaction', msg.transaction);
        }
        break;

      case 'ping':
        // heartbeat response, ignore
        break;

      default:
        if (msg.ohlc) {
          this._handleCandleUpdate(msg);
        }
        break;
    }
  }

  // ============ CANDLE MANAGEMENT ============

  async subscribeCandles(symbol) {
    if (!this.candles[symbol]) {
      this.candles[symbol] = { '5m': [], '15m': [] };
    }

    for (const [tf, gran] of [['5m', 300], ['15m', 900]]) {
      this.ws.send(JSON.stringify({
        ticks_history: symbol,
        adjust_start_time: 1,
        count: 200,
        end: 'latest',
        granularity: gran,
        style: 'candles',
        subscribe: 1,
        req_id: this._reqId(symbol, tf)
      }));
    }

    console.log(`[DERIV] Subscribing to ${symbol} candles (5m + 15m)`);
  }

  _handleCandleHistory(msg) {
    const reqId = msg.req_id;
    const mapping = this._reqIdMap[reqId];
    if (!mapping) return;
    const { symbol, tf } = mapping;

    if (!this.candles[symbol]) this.candles[symbol] = { '5m': [], '15m': [] };

    if (msg.candles) {
      this.candles[symbol][tf] = msg.candles.map(c => ({
        open: parseFloat(c.open),
        high: parseFloat(c.high),
        low: parseFloat(c.low),
        close: parseFloat(c.close),
        epoch: c.epoch
      }));
      console.log(`[DERIV] Loaded ${msg.candles.length} ${tf} candles for ${symbol}`);
    }

    if (msg.subscription) {
      this.subscriptions[`${symbol}_${tf}`] = msg.subscription.id;
    }

    const data = this.candles[symbol];
    if (data['5m'].length > 0 && data['15m'].length > 0) {
      this.emit('candles_ready', symbol);
    }
  }

  _handleCandleUpdate(msg) {
    const ohlc = msg.ohlc;
    if (!ohlc) return;

    const symbol = ohlc.symbol;
    const gran = parseInt(ohlc.granularity);
    const tf = gran === 300 ? '5m' : gran === 900 ? '15m' : null;
    if (!tf || !this.candles[symbol]) return;

    const openTime = parseInt(ohlc.open_time) || Math.floor(parseInt(ohlc.epoch) / gran) * gran;

    const candle = {
      open: parseFloat(ohlc.open),
      high: parseFloat(ohlc.high),
      low: parseFloat(ohlc.low),
      close: parseFloat(ohlc.close),
      epoch: parseInt(ohlc.epoch),
      openTime: openTime
    };

    const candles = this.candles[symbol][tf];
    const last = candles.length > 0 ? candles[candles.length - 1] : null;
    const lastOpenTime = last ? (last.openTime || Math.floor(last.epoch / gran) * gran) : null;

    if (last && lastOpenTime === openTime) {
      candles[candles.length - 1] = candle;
    } else {
      candles.push(candle);
      if (candles.length > 250) candles.shift();

      if (tf === '5m' && candles.length >= 2) {
        const closedCandle = candles[candles.length - 2];
        console.log(`[CANDLE] ${symbol} 5m CLOSED | open_time=${closedCandle.openTime} | O:${closedCandle.open} H:${closedCandle.high} L:${closedCandle.low} C:${closedCandle.close}`);
        this.emit('candle_close', {
          symbol,
          candle: closedCandle,
          candles5m: candles.slice(0, -1),
          candles15m: this.candles[symbol]['15m'].slice(0, -1)
        });
      }
    }
  }

  // ============ TRADE EXECUTION ============

  async buyContract(symbol, direction, amount) {
    const contractType = direction === 'CALL' ? 'CALL' : 'PUT';

    return new Promise((resolve, reject) => {
      this.pendingBuy = { resolve, reject, amount };

      this.ws.send(JSON.stringify({
        proposal: 1,
        amount: amount,
        basis: 'stake',
        contract_type: contractType,
        currency: this.currency,
        duration: 5,
        duration_unit: 'm',
        symbol: symbol
      }));

      setTimeout(() => {
        if (this.pendingBuy) {
          this.pendingBuy = null;
          reject(new Error('Trade timeout'));
        }
      }, 30000);
    });
  }

  _handleProposal(msg) {
    if (!this.pendingBuy) return;

    const proposal = msg.proposal;
    console.log(`[DERIV] Proposal: stake=$${proposal.ask_price}, payout=$${proposal.payout}`);

    this.ws.send(JSON.stringify({
      buy: proposal.id,
      price: proposal.ask_price
    }));

    if (proposal.id) {
      this.ws.send(JSON.stringify({ forget: proposal.id }));
    }
  }

  _handleBuy(msg) {
    const buy = msg.buy;
    console.log(`[DERIV] ✅ Trade executed: contract_id=${buy.contract_id}, payout=$${buy.payout}`);

    this._activeContractId = buy.contract_id;
    this._resultEmitted = false;

    const pocReqId = this._nextReqId++;
    this.ws.send(JSON.stringify({
      proposal_open_contract: 1,
      contract_id: buy.contract_id,
      subscribe: 1,
      req_id: pocReqId
    }));
    console.log(`[DERIV] Subscribed to contract ${buy.contract_id} updates`);

    this._startPocPolling(buy.contract_id);

    if (this.pendingBuy) {
      this.pendingBuy.resolve({
        contractId: buy.contract_id,
        buyPrice: buy.buy_price,
        payout: buy.payout,
        transactionId: buy.transaction_id,
        balanceAfter: buy.balance_after,
        shortcode: buy.shortcode,
        longcode: buy.longcode
      });
      this.pendingBuy = null;
    }
  }

  _startPocPolling(contractId) {
    this._stopPocPolling();
    console.log(`[DERIV] Starting POC polling for contract ${contractId}`);

    this._pocPollInterval = setInterval(() => {
      if (this._resultEmitted) {
        this._stopPocPolling();
        return;
      }
      console.log(`[DERIV] Polling contract ${contractId} status...`);
      this.ws.send(JSON.stringify({
        proposal_open_contract: 1,
        contract_id: contractId,
        req_id: this._nextReqId++
      }));
    }, 30000);
  }

  _stopPocPolling() {
    if (this._pocPollInterval) {
      clearInterval(this._pocPollInterval);
      this._pocPollInterval = null;
    }
  }

  _handleContractUpdate(msg) {
    const contract = msg.proposal_open_contract;
    if (!contract) return;

    if (this._resultEmitted && contract.contract_id == this._activeContractId) return;

    const isSold = contract.is_sold === 1 || contract.is_sold === true;
    const status = contract.status;

    if (isSold && (status === 'won' || status === 'lost')) {
      const won = status === 'won';
      const sellPrice = parseFloat(contract.sell_price) || 0;
      const buyPrice = parseFloat(contract.buy_price) || 0;
      const profit = sellPrice - buyPrice;
      const balAfter = contract.balance_after || this.balance;

      console.log(`[DERIV] ${won ? '🟢 WIN' : '🔴 LOSS'}: profit=${profit.toFixed(2)}, sell=${sellPrice}, buy=${buyPrice}, balance=${balAfter}`);
      if (contract.balance_after) this.balance = contract.balance_after;

      this._resultEmitted = true;
      this._stopPocPolling();

      this.emit('contract_result', {
        contractId: contract.contract_id,
        won,
        profit,
        buyPrice: buyPrice,
        payout: parseFloat(contract.payout),
        balanceAfter: balAfter,
        entrySpot: contract.entry_spot_display_value,
        exitSpot: contract.exit_spot_display_value,
        symbol: contract.underlying
      });

      if (msg.subscription) {
        this.ws.send(JSON.stringify({ forget: msg.subscription.id }));
      }
    }
  }

  // ============ RECONNECTION (never give up) ============

  _reconnect() {
    if (this._reconnecting) return;
    this._reconnecting = true;

    this.reconnectCount++;

    // Exponential backoff with cap
    const delay = Math.min(this.reconnectDelay * Math.pow(1.5, Math.min(this.reconnectCount - 1, 10)), this.maxReconnectDelay);

    console.log(`[DERIV] Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt #${this.reconnectCount})`);

    setTimeout(async () => {
      this._reconnecting = false;
      try {
        await this.connect();
        // Re-subscribe to all symbols
        for (const symbol of Object.keys(this.candles)) {
          await this.subscribeCandles(symbol);
          await new Promise(r => setTimeout(r, 500));
        }
        console.log(`[DERIV] Reconnected successfully after ${this.reconnectCount} attempt(s)`);
        this.emit('reconnected');
      } catch (e) {
        console.error('[DERIV] Reconnect failed:', e.message);
        // Will retry via the close event handler
      }
    }, delay);
  }

  getBalance() { return this.balance; }
  getAccountId() { return this.accountId; }
  isDemo() { return this.accountId.startsWith('VRTC'); }
}

module.exports = DerivService;
