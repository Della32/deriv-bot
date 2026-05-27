/**
 * ATR - Average True Range
 * Período: 14
 * Usado como filtro de volatilidade
 */

function calculateATR(candles, period = 14) {
  if (candles.length < period + 1) return null;

  const trueRanges = [];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }

  if (trueRanges.length < period) return null;

  // Primeiro ATR: média simples
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Suavização (Wilder's)
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  return Math.round(atr * 1000000) / 1000000;
}

/**
 * Verifica se ATR está muito baixo (mercado sem movimento)
 * Threshold padrão: 0.0003 pra EUR/USD
 */
function isLowVolatility(candles, period = 14, threshold = 0.0003) {
  const atr = calculateATR(candles, period);
  if (atr === null) return { isLow: false, atr: null };

  return {
    isLow: atr < threshold,
    atr
  };
}

module.exports = { calculateATR, isLowVolatility };
