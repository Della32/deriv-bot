/**
 * Martingale Progression — shared across all symbols
 * Each loss bumps stake to recover losses + profit
 * Factor: 2.2x (covers 92% payout recovery)
 * v2.1 — SQLite persistence: survives restarts
 */

class Progression {
  constructor(baseStake = 5.00) {
    this.baseStake = baseStake;
    this.currentLevel = 0;
    this.maxLevel = 6;
    this.totalLost = 0;
    this.targetProfit = baseStake; // minimum profit per sequence
    this.payout = 0.92; // 92% payout rate
  }

  getNextStake() {
    if (this.currentLevel === 0) return this.baseStake;
    // Formula: (total_lost + target_profit) / payout
    return Math.ceil(((this.totalLost + this.targetProfit) / this.payout) * 100) / 100;
  }

  advance(lostAmount) {
    this.totalLost += lostAmount;
    this.currentLevel++;
    console.log(`[PROG] Level ${this.currentLevel}: lost $${this.totalLost.toFixed(2)}, next stake: $${this.getNextStake().toFixed(2)}`);
  }

  reset() {
    this.currentLevel = 0;
    this.totalLost = 0;
  }

  hardReset() {
    this.reset();
    console.log('[PROG] Hard reset to level 0');
  }

  getStatus() {
    return {
      level: this.currentLevel,
      totalLost: this.totalLost,
      nextStake: this.getNextStake(),
      maxLevel: this.maxLevel
    };
  }

  // ===== PERSISTENCE =====

  /**
   * Serialize state to a JSON-safe object
   */
  toJSON() {
    return {
      currentLevel: this.currentLevel,
      totalLost: this.totalLost,
      baseStake: this.baseStake,
      maxLevel: this.maxLevel
    };
  }

  /**
   * Restore state from a parsed JSON object
   */
  fromJSON(data) {
    if (!data) return;
    if (typeof data.currentLevel === 'number') this.currentLevel = data.currentLevel;
    if (typeof data.totalLost === 'number') this.totalLost = data.totalLost;
    if (typeof data.baseStake === 'number') this.baseStake = data.baseStake;
    if (typeof data.maxLevel === 'number') this.maxLevel = data.maxLevel;
    console.log(`[PROG] Restored: Level ${this.currentLevel}, totalLost $${this.totalLost.toFixed(2)}, next stake $${this.getNextStake().toFixed(2)}`);
  }
}

module.exports = Progression;
