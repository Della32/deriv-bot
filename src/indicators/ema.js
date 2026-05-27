/**
 * EMA - Exponential Moving Average
 * 
 * DIAGNÓSTICO:
 * - Gap shrinking signal = 49% WR (coin flip) — REMOVIDO
 * - EMA cross exato = 0 trades no período — muito raro
 * - EMA agora é APENAS filtro de tendência, NÃO gera sinais
 * 
 * Uso: Confirmar que reversão RSI+BB está na direção certa
 * - CALL válido se preço < EMA13 (reversão de baixa pra alta)
 * - PUT válido se preço > EMA13 (reversão de alta pra baixa)
 */

function calculateEMA(closes, period) {
  if (closes.length < period) return null;

  const multiplier = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < closes.length; i++) {
    ema = (closes[i] - ema) * multiplier + ema;
  }

  return ema;
}

function calculateEMASeries(closes, period) {
  if (closes.length < period) return [];

  const multiplier = 2 / (period + 1);
  const series = [];

  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  series.push(ema);

  for (let i = period; i < closes.length; i++) {
    ema = (closes[i] - ema) * multiplier + ema;
    series.push(ema);
  }

  return series;
}

/**
 * EMA como filtro de tendência (NÃO gera sinais)
 * 
 * Retorna contexto de tendência para confirmar sinais RSI+BB:
 * - trendBias: 'CALL' se preço < EMA13 (provável reversão pra cima)
 *              'PUT' se preço > EMA13 (provável reversão pra baixo)
 * - momentum: velocidade da EMA (rápida vs lenta)
 * - gapSize: distância do preço à EMA13 (quanto mais longe, mais esticado)
 */
function getEMATrendContext(closes) {
  const ema5 = calculateEMA(closes, 5);
  const ema13 = calculateEMA(closes, 13);
  const ema50 = calculateEMA(closes, 50);

  if (ema5 === null || ema13 === null) {
    return { trendBias: null, ema5: null, ema13: null, ema50: null, gapSize: null, isStretched: false };
  }

  const currentPrice = closes[closes.length - 1];

  // Tendência: preço em relação à EMA13
  // Se preço está ABAIXO da EMA13, está "esticado pra baixo" → CALL (reversão pra cima)
  // Se preço está ACIMA da EMA13, está "esticado pra cima" → PUT (reversão pra baixo)
  let trendBias = null;
  const gapToEma13 = currentPrice - ema13;
  const gapSize = Math.abs(gapToEma13);

  if (currentPrice < ema13) trendBias = 'CALL';
  else if (currentPrice > ema13) trendBias = 'PUT';

  // "Esticado": preço está longe da EMA13 (> 0.0005 pra EUR/USD)
  const isStretched = gapSize > 0.0005;

  // EMA5 vs EMA13 momentum
  const ema5AboveEma13 = ema5 > ema13;

  return {
    trendBias,
    ema5: Math.round(ema5 * 100000) / 100000,
    ema13: Math.round(ema13 * 100000) / 100000,
    ema50: ema50 ? Math.round(ema50 * 100000) / 100000 : null,
    gapSize: Math.round(gapSize * 100000) / 100000,
    gapToEma13: Math.round(gapToEma13 * 100000) / 100000,
    isStretched,
    ema5AboveEma13
  };
}

module.exports = { calculateEMA, calculateEMASeries, getEMATrendContext };
