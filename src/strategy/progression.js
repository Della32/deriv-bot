/**
 * Martingale Progression — shared across all symbols
 * Each loss bumps stake to recover losses + profit
 * Factor: 2.2x (covers 92% payout recovery)
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
}

module.exports = Progression;
