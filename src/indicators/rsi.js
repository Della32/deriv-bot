/**
 * RSI - Relative Strength Index
 * Período: 9
 * 
 * DIAGNÓSTICO: RSI < 25 ou > 75 → 53.1% WR (melhor que 25-30/70-75 = 47.1%)
 * Usar thresholds apertados: 25/75
 */

function calculateRSI(closes, period = 9) {
  if (closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * RSI com série completa (pra detectar divergência)
 */
function calculateRSISeries(closes, period = 9) {
  if (closes.length < period + 1) return [];

  const series = [];
  let avgGain = 0;
  let avgLoss = 0;

  // Primeiro RSI
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;

  if (avgLoss === 0) series.push(100);
  else {
    const rs = avgGain / avgLoss;
    series.push(100 - (100 / (1 + rs)));
  }

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) series.push(100);
    else {
      const rs = avgGain / avgLoss;
      series.push(100 - (100 / (1 + rs)));
    }
  }

  return series;
}

/**
 * Sinal RSI com thresholds apertados
 * CALL: RSI < 25 (sobrevendido forte)
 * PUT:  RSI > 75 (sobrecomprado forte)
 * 
 * Também retorna "extended" pra RSI < 20 ou > 80 (extremo)
 */
function getRSISignal(closes, period = 9) {
  const rsi = calculateRSI(closes, period);
  if (rsi === null) return { signal: null, value: null, isExtreme: false };

  let signal = null;
  let isExtreme = false;

  if (rsi < 25) {
    signal = 'CALL';
    isExtreme = rsi < 20;
  } else if (rsi > 75) {
    signal = 'PUT';
    isExtreme = rsi > 80;
  }

  // RSI divergence check (bullish/bearish)
  const rsiSeries = calculateRSISeries(closes, period);
  let divergence = null;

  if (rsiSeries.length >= 10) {
    const recentRsi = rsiSeries.slice(-5);
    const recentCloses = closes.slice(-5);

    // Bullish divergence: price makes lower low, RSI makes higher low
    const priceDown = recentCloses[recentCloses.length - 1] < recentCloses[0];
    const rsiUp = recentRsi[recentRsi.length - 1] > recentRsi[0];
    if (priceDown && rsiUp && rsi < 35) divergence = 'CALL';

    // Bearish divergence: price makes higher high, RSI makes lower high
    const priceUp = recentCloses[recentCloses.length - 1] > recentCloses[0];
    const rsiDown = recentRsi[recentRsi.length - 1] < recentRsi[0];
    if (priceUp && rsiDown && rsi > 65) divergence = 'PUT';
  }

  return {
    signal,
    value: Math.round(rsi * 100) / 100,
    isExtreme,
    divergence
  };
}

module.exports = { calculateRSI, calculateRSISeries, getRSISignal };
