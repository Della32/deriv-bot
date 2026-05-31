// ===== GESTAO DE BANCA VIRTUAL + PROTECAO =====
// Opera na conta demo (que tem ~$10k) mas trata a banca como $22 virtual,
// pra simular EXATAMENTE a realidade de R$100 + R$100/mes do usuario.

class RiskManager {
  constructor(db, cfg) {
    this.db = db;
    this.cfg = cfg;
    this._stmtGet = db.prepare('SELECT value FROM state WHERE key = ?');
    this._stmtSet = db.prepare("INSERT OR REPLACE INTO state (key, value, updated_at) VALUES (?, ?, datetime('now'))");
    this.load();
  }

  load() {
    const raw = this._stmtGet.get('mult_risk');
    if (raw) {
      this.s = JSON.parse(raw.value);
    } else {
      this.s = {
        virtualBalance: this.cfg.VIRTUAL_START,
        peakTotal: this.cfg.VIRTUAL_START,
        monthKey: this._month(),
        monthPeak: this.cfg.VIRTUAL_START,
        monthStopped: false,
        totalStopped: false,
        totalDeposited: this.cfg.VIRTUAL_START,
        nTrades: 0, wins: 0, losses: 0,
      };
      this.save();
    }
  }
  save() { this._stmtSet.run('mult_risk', JSON.stringify(this.s)); }
  _month() { const d = new Date(); return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0'); }
  _nextMonth() { const d = new Date(); d.setUTCMonth(d.getUTCMonth()+1); return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0'); }

  // virada de mes -> aporte virtual + reset travas
  rolloverMonth() {
    const now = this._month();
    if (this.s.monthKey !== now) {
      this.s.virtualBalance += this.cfg.MONTHLY_DEPOSIT;
      this.s.totalDeposited += this.cfg.MONTHLY_DEPOSIT;
      this.s.monthKey = now;
      this.s.monthPeak = this.s.virtualBalance;
      this.s.monthStopped = false;
      this.save();
      return `Novo mes ${now}: aporte +$${this.cfg.MONTHLY_DEPOSIT} (R$${(this.cfg.MONTHLY_DEPOSIT*this.cfg.CAMBIO).toFixed(0)}). Banca virtual: $${this.s.virtualBalance.toFixed(2)}`;
    }
    return null;
  }

  stake() { return Math.max(this.cfg.MIN_STAKE, +(this.s.virtualBalance * this.cfg.RISK_PCT).toFixed(2)); }

  // checa travas. retorna {blocked, reason}
  check() {
    if (this.s.totalStopped) return { blocked:true, reason:'STOP TOTAL (-40%) ativo. Aguardando revisao manual.' };
    if (this.s.virtualBalance > this.s.peakTotal) this.s.peakTotal = this.s.virtualBalance;
    if (this.s.virtualBalance > this.s.monthPeak) this.s.monthPeak = this.s.virtualBalance;

    const totalDD = 1 - this.s.virtualBalance / this.s.peakTotal;
    if (totalDD >= this.cfg.STOP_TOTAL_DD) {
      this.s.totalStopped = true; this.save();
      return { blocked:true, reason:`🛑 STOP TOTAL: caiu ${(totalDD*100).toFixed(0)}% do pico ($${this.s.peakTotal.toFixed(2)}→$${this.s.virtualBalance.toFixed(2)}). BOT PARADO.` };
    }
    const monthDD = 1 - this.s.virtualBalance / this.s.monthPeak;
    if (monthDD >= this.cfg.STOP_MONTH_DD) {
      this.s.monthStopped = true; this.save();
      return { blocked:true, reason:`⚠️ STOP MENSAL: caiu ${(monthDD*100).toFixed(0)}% do pico do mes. Parado ate ${this._nextMonth()}.` };
    }
    if (this.s.monthStopped) return { blocked:true, reason:'Stop mensal ja ativo. Aguardando proximo mes.' };
    return { blocked:false };
  }

  // aplica PnL de trade fechado (em USD, na escala da banca virtual)
  applyResult(pnlVirtual, won) {
    this.s.virtualBalance += pnlVirtual;
    this.s.nTrades++;
    if (won) this.s.wins++; else this.s.losses++;
    this.save();
  }

  summary() {
    const t = this.s.nTrades;
    const wr = t ? (this.s.wins/t*100).toFixed(1) : '0';
    const lucro = this.s.virtualBalance - this.s.totalDeposited;
    return { bal:this.s.virtualBalance, dep:this.s.totalDeposited, lucro, wr, t, w:this.s.wins, l:this.s.losses };
  }
}

module.exports = RiskManager;
