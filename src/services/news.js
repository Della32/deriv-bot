/**
 * News/Economic Calendar Filter
 * 
 * Consulta calendário econômico pra evitar operar durante notícias de alto impacto.
 * Notícias de alto impacto causam volatilidade imprevisível — estratégia de reversão
 * não funciona bem nesses momentos.
 * 
 * Fontes:
 *   1. ForexFactory API (scraping)
 *   2. Investing.com calendar
 *   3. Fallback: bloqueia horários conhecidos de news (NFP, FOMC, etc)
 * 
 * Regra: Bloquear 15 minutos antes e 15 minutos depois de notícia HIGH impact
 */

const https = require('https');
const http = require('http');

class NewsFilter {
  constructor() {
    // Cache de eventos do dia
    this.cache = {
      date: null,
      events: []
    };
    
    // Fallback: horários fixos de notícias recorrentes (UTC)
    // Estes são horários onde notícias de alto impacto frequentemente acontecem
    this.recurringHighImpact = [
      // NFP - primeira sexta-feira do mês, 12:30 UTC
      // FOMC - quartas específicas, 18:00 UTC
      // ECB - quintas específicas, 12:15 UTC
      // CPI - ~12:30 UTC
      // Estes são genéricos; o calendário real é mais preciso
    ];

    // Buffer em minutos antes/depois da notícia pra bloquear
    this.bufferMinutes = 15;
    
    // Last fetch time
    this.lastFetch = 0;
    this.fetchInterval = 4 * 60 * 60 * 1000; // 4 horas
  }

  /**
   * Busca eventos econômicos do dia
   */
  async fetchEvents() {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    
    // Se já temos cache do dia e não é hora de atualizar, usa cache
    if (this.cache.date === today && Date.now() - this.lastFetch < this.fetchInterval) {
      return this.cache.events;
    }

    try {
      // Tenta ForexFactory via nbb API (free)
      const events = await this.fetchFromForexFactory(today);
      if (events.length > 0) {
        this.cache = { date: today, events };
        this.lastFetch = Date.now();
        console.log(`📰 ${events.length} eventos econômicos carregados para ${today}`);
        return events;
      }
    } catch (err) {
      console.log(`⚠️ Erro ao buscar calendário: ${err.message}`);
    }

    // Fallback: usa horários fixos conhecidos
    return this.getStaticEvents(today);
  }

  /**
   * Tenta buscar de ForexFactory
   */
  async fetchFromForexFactory(date) {
    return new Promise((resolve, reject) => {
      // ForexFactory calendar URL (week view)
      const url = `https://nfs.faireconomy.media/ff_calendar_thisweek.json`;
      
      https.get(url, { timeout: 10000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const events = json
              .filter(e => {
                // Filtra apenas HIGH impact e moedas relevantes (USD, EUR)
                const isHighImpact = e.impact === 'High';
                const isRelevantCurrency = ['USD', 'EUR'].includes(e.country);
                const isToday = e.date && e.date.startsWith(date);
                return isHighImpact && isRelevantCurrency;
              })
              .map(e => ({
                title: e.title,
                currency: e.country,
                impact: e.impact,
                date: e.date,
                time: e.date // ISO string with time
              }));
            resolve(events);
          } catch (err) {
            reject(new Error('Parse error: ' + err.message));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Eventos estáticos conhecidos (fallback)
   * Horários comuns de notícias de alto impacto em UTC
   */
  getStaticEvents(date) {
    const day = new Date(date);
    const dayOfWeek = day.getUTCDay(); // 0=Sun, 1=Mon, etc
    
    const events = [];
    
    // Todos os dias úteis têm releases potenciais
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      // US data releases comuns: 12:30, 14:00, 18:00 UTC
      events.push(
        { title: 'US Data Release Window', currency: 'USD', impact: 'High', time: `${date}T12:30:00Z` },
        { title: 'US Secondary Release', currency: 'USD', impact: 'High', time: `${date}T14:00:00Z` }
      );
      
      // ECB/European data: 09:00, 10:00, 12:15 UTC
      events.push(
        { title: 'EU Data Release Window', currency: 'EUR', impact: 'High', time: `${date}T09:00:00Z` },
        { title: 'EU Secondary Release', currency: 'EUR', impact: 'High', time: `${date}T10:00:00Z` }
      );
    }
    
    // Quartas: FOMC possível
    if (dayOfWeek === 3) {
      events.push({ title: 'FOMC Window', currency: 'USD', impact: 'High', time: `${date}T18:00:00Z` });
    }
    
    // Primeira sexta do mês: NFP
    if (dayOfWeek === 5 && day.getUTCDate() <= 7) {
      events.push({ title: 'NFP (Non-Farm Payrolls)', currency: 'USD', impact: 'High', time: `${date}T12:30:00Z` });
    }

    return events;
  }

  /**
   * Verifica se é seguro operar agora
   * @param {number} now - epoch ms
   * @returns {object} { safe: boolean, reason: string, nextEvent: object|null }
   */
  async isSafeToTrade(now = Date.now()) {
    const events = await this.fetchEvents();
    
    if (events.length === 0) {
      return { safe: true, reason: 'Sem eventos', nextEvent: null };
    }

    const bufferMs = this.bufferMinutes * 60 * 1000;
    const currentTime = now;

    for (const event of events) {
      let eventTime;
      try {
        eventTime = new Date(event.time).getTime();
        if (isNaN(eventTime)) continue;
      } catch {
        continue;
      }

      const windowStart = eventTime - bufferMs;
      const windowEnd = eventTime + bufferMs;

      if (currentTime >= windowStart && currentTime <= windowEnd) {
        const minutesToEvent = Math.round((eventTime - currentTime) / 60000);
        return {
          safe: false,
          reason: `⚠️ ${event.title} (${event.currency}) ${minutesToEvent > 0 ? 'em ' + minutesToEvent + 'min' : 'há ' + Math.abs(minutesToEvent) + 'min'}`,
          nextEvent: event
        };
      }
    }

    // Find next upcoming event
    const upcoming = events
      .map(e => ({ ...e, epoch: new Date(e.time).getTime() }))
      .filter(e => !isNaN(e.epoch) && e.epoch > currentTime)
      .sort((a, b) => a.epoch - b.epoch);

    return {
      safe: true,
      reason: 'Sem notícia próxima',
      nextEvent: upcoming.length > 0 ? upcoming[0] : null
    };
  }

  /**
   * Versão síncrona pra backtest (usa cache)
   */
  isSafeToTradeSync(now = Date.now()) {
    // No backtest, vamos simplificar: usar apenas static events
    const date = new Date(now).toISOString().slice(0, 10);
    const events = this.getStaticEvents(date);
    
    const bufferMs = this.bufferMinutes * 60 * 1000;

    for (const event of events) {
      let eventTime;
      try {
        eventTime = new Date(event.time).getTime();
        if (isNaN(eventTime)) continue;
      } catch {
        continue;
      }

      const windowStart = eventTime - bufferMs;
      const windowEnd = eventTime + bufferMs;

      if (now >= windowStart && now <= windowEnd) {
        return { safe: false, reason: `${event.title} (${event.currency})` };
      }
    }

    return { safe: true, reason: 'OK' };
  }
}

module.exports = NewsFilter;
