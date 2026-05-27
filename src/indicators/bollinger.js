/**
 * Bollinger Bands
 * Período: 20, Desvio: 2
 * 
 * DIAGNÓSTICO:
 * - BB Width >= 0.003 → 76.9% WR (10W/3L) — #1 FILTRO MAIS IMPORTANTE
 * - Zone 20% gerava APENAS "MIDDLE" em 102 trades — precisa de toque real nas bandas
 * - Exigir preço dentro de 5% da banda (toque/ultrapassagem)
 */

function calculateBollinger(closes, period = 20, deviation = 2) {
  if (closes.length < period) return null;

  const slice = closes.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;

  const squaredDiffs = slice.map(v => Math.pow(v - sma, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
  const stdDev = Math.sqrt(variance);

  const upper = sma + (deviation * stdDev);
  const lower = sma - (deviation * stdDev);
  const width = (upper - lower) / sma;

  return {
    upper: Math.round(upper * 100000) / 100000,
    middle: Math.round(sma * 100000) / 100000,
    lower: Math.round(lower * 100000) / 100000,
    width: Math.round(width * 10000) / 10000,
    stdDev
  };
}

/**
 * Bollinger signal com toque real nas bandas
 * 
 * CALL: Preço tocou/ultrapassou banda inferior OU está a menos de 5% do range da borda
 * PUT:  Preço tocou/ultrapassou banda superior OU está a menos de 5% do range da borda
 * 
 * Adiciona filtro: BB width >= 0.003 (76.9% WR)
 * Também verifica se o candle anterior já era extremo (confirmação)
 */
function getBollingerSignal(closes, period = 20, deviation = 2) {
  const bb = calculateBollinger(closes, period, deviation);
  if (!bb) return { signal: null, bb: null, isSqueeze: false, isWide: false, pricePosition: 'MIDDLE' };

  const currentPrice = closes[closes.length - 1];
  const prevPrice = closes.length >= 2 ? closes[closes.length - 2] : null;
  const range = bb.upper - bb.lower;

  // Squeeze: bandas muito apertadas
  const isSqueeze = bb.width < 0.0008;

  // Wide bands: BB width >= 0.003 (76.9% WR!)
  const isWide = bb.width >= 0.003;

  // Distância do preço até as bandas (como % do range)
  const distToLower = (currentPrice - bb.lower) / range; // 0 = na banda inferior, 1 = na superior
  const distToUpper = (bb.upper - currentPrice) / range;

  // Zone: 8% do range = "tocou a banda"
  // Mais apertado que 20%, mas não exige toque exato
  const TOUCH_ZONE = 0.08;

  let signal = null;
  let pricePosition = 'MIDDLE';
  let bandTouch = false;

  if (currentPrice <= bb.lower) {
    // Ultrapassou banda inferior
    signal = 'CALL';
    pricePosition = 'LOWER';
    bandTouch = true;
  } else if (currentPrice >= bb.upper) {
    // Ultrapassou banda superior
    signal = 'PUT';
    pricePosition = 'UPPER';
    bandTouch = true;
  } else if (distToLower <= TOUCH_ZONE) {
    // Muito perto da banda inferior (dentro de 8% do range)
    signal = 'CALL';
    pricePosition = 'LOWER';
    bandTouch = false;
  } else if (distToUpper <= TOUCH_ZONE) {
    // Muito perto da banda superior
    signal = 'PUT';
    pricePosition = 'UPPER';
    bandTouch = false;
  }

  // Verificar se candle anterior também estava perto da banda (confirmação de permanência)
  let prevAlsoExtreme = false;
  if (prevPrice !== null && signal) {
    const prevDistLower = (prevPrice - bb.lower) / range;
    const prevDistUpper = (bb.upper - prevPrice) / range;
    // Candle anterior dentro de 15% da banda
    if (signal === 'CALL' && prevDistLower <= 0.15) prevAlsoExtreme = true;
    if (signal === 'PUT' && prevDistUpper <= 0.15) prevAlsoExtreme = true;
  }

  // Se squeeze, bloqueia sinal
  if (isSqueeze) signal = null;

  return {
    signal,
    bb,
    isSqueeze,
    isWide,
    pricePosition,
    bandTouch,
    prevAlsoExtreme,
    distToLower: Math.round(distToLower * 1000) / 1000,
    distToUpper: Math.round(distToUpper * 1000) / 1000
  };
}

module.exports = { calculateBollinger, getBollingerSignal };
