/**
 * Reporter — Relatórios horários automáticos
 */

class Reporter {
  constructor(telegram, db, progression) {
    this.telegram = telegram;
    this.db = db;
    this.progression = progression;
    this.hourlyTimer = null;
    this.lastHourOps = 0;
    this.hourlyAssetStats = {};
    this.hourlyLevelStats = {};
    this.hourlyProfit = 0;
  }

  /**
   * Inicia relatório horário automático
   */
  start() {
    // A cada hora
    this.hourlyTimer = setInterval(() => {
      this.sendHourlyReport();
    }, 60 * 60 * 1000);

    console.log('[REPORTER] Relatórios horários ativados');
  }

  /**
   * Registra operação pra stats horários
   */
  recordOperation(asset, level, won) {
    // Asset stats
    if (!this.hourlyAssetStats[asset]) {
      this.hourlyAssetStats[asset] = { wins: 0, losses: 0 };
    }
    if (won) this.hourlyAssetStats[asset].wins++;
    else this.hourlyAssetStats[asset].losses++;

    // Level stats (só wins)
    if (won) {
      const levelKey = level.toString();
      this.hourlyLevelStats[levelKey] = (this.hourlyLevelStats[levelKey] || 0) + 1;
    }

    this.lastHourOps++;
  }

  /**
   * Envia relatório horário
   */
  async sendHourlyReport() {
    if (this.lastHourOps === 0) {
      console.log('[REPORTER] Nenhuma operação na última hora, pulando relatório');
      return;
    }

    const stats = this.progression.getStats();
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    const period = `${hourAgo.getUTCHours().toString().padStart(2, '0')}:00 - ${now.getUTCHours().toString().padStart(2, '0')}:00 UTC`;

    const banca = 150 + stats.dailyProfit; // Banca inicial + lucro do dia

    await this.telegram.sendHourlyReport(
      period,
      this.lastHourOps,
      {
        wins: stats.wins,
        losses: stats.losses,
        winRate: stats.winRate,
        hourlyProfit: this.hourlyProfit,
        dailyProfit: stats.dailyProfit
      },
      this.hourlyAssetStats,
      this.hourlyLevelStats,
      banca
    );

    // Reset contadores horários
    this.lastHourOps = 0;
    this.hourlyAssetStats = {};
    this.hourlyLevelStats = {};
    this.hourlyProfit = 0;
  }

  stop() {
    if (this.hourlyTimer) {
      clearInterval(this.hourlyTimer);
      this.hourlyTimer = null;
    }
  }
}

module.exports = Reporter;
