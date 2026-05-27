/**
 * Chart Pattern Analyzer v3.0
 * 
 * Detects the following patterns from price action:
 * 
 * BULLISH (CALL):
 *   1. Bullish Flag — uptrend + flag consolidation + breakout above flag high
 *   2. Symmetrical Triangle (Bullish) — higher lows + lower highs in uptrend, breakout up
 *   3. Ascending Triangle — flat resistance + rising support, breakout up
 *   4. Double Bottom — W pattern, price breaks neckline
 *   5. Cup and Handle — rounded bottom + small pullback + breakout
 *   6. Hammer / Bullish Engulfing — candlestick reversal patterns at support
 *   7. Rounding Bottom — gradual shift from down to up
 *   8. Triple Bottom — three touches of support + breakout
 * 
 * BEARISH (PUT):
 *   1. Bearish Flag — downtrend + flag consolidation + breakout below flag low
 *   2. Symmetrical Triangle (Bearish) — in downtrend, breakout down
 *   3. Descending Triangle — flat support + falling resistance, breakout down
 *   4. Double Top — M pattern, price breaks neckline
 *   5. Inverse Cup and Handle — rounded top + small pullback + breakdown
 *   6. Shooting Star / Hanging Man / Bearish Engulfing — candlestick at resistance
 *   7. Rounding Top — gradual shift from up to down
 *   8. Head and Shoulders — classic reversal
 *   9. Continuation Wedge (Bearish) — rising wedge in downtrend
 * 
 * Entry rule: pattern formed + breakout confirmed + retest (when possible)
 * Uses 5m candles for patterns, 15m for trend context
 */

class ChartPatternAnalyzer {
  constructor() {
    this.minCandles = 20; // need at least 20 candles for pattern detection
  }

  /**
   * Main analysis — returns signal or null
   */
  analyze(symbol, candles5m, candles15m) {
    if (!candles5m || candles5m.length < this.minCandles) return null;

    const closes = candles5m.map(c => c.close);
    const highs = candles5m.map(c => c.high);
    const lows = candles5m.map(c => c.low);
    const opens = candles5m.map(c => c.open);

    // Get recent candles for pattern detection (last 30-50 candles)
    const lookback = Math.min(candles5m.length, 50);
    const recent = candles5m.slice(-lookback);

    // Determine overall trend from 15m candles
    const trend15m = this._getTrend(candles15m);

    // Blocked strategies (backtest-proven losers)
    const BLOCKED = ['double_bottom', 'sym_triangle_bull', 'inv_cup_handle'];

    // Try each pattern detector — return first strong signal
    const detectors = [
      () => this._detectDoubleTopBottom(recent, symbol),
      () => this._detectHeadAndShoulders(recent, symbol),
      () => this._detectTriangle(recent, symbol, trend15m),
      () => this._detectFlag(recent, symbol, trend15m),
      () => this._detectWedge(recent, symbol, trend15m),
      () => this._detectCupAndHandle(recent, symbol),
      () => this._detectCandlestickPatterns(recent, symbol, trend15m),
      () => this._detectTripleTopBottom(recent, symbol),
      () => this._detectRounding(recent, symbol),
    ];

    for (const detect of detectors) {
      const signal = detect();
      if (signal && !BLOCKED.includes(signal.strategy)) return signal;
    }

    return null;
  }

  // ============================================================
  // TREND DETECTION
  // ============================================================

  _getTrend(candles) {
    if (!candles || candles.length < 5) return 'neutral';
    const recent = candles.slice(-10);
    const firstHalf = recent.slice(0, 5);
    const secondHalf = recent.slice(5);
    const avgFirst = firstHalf.reduce((s, c) => s + c.close, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, c) => s + c.close, 0) / secondHalf.length;
    const diff = (avgSecond - avgFirst) / avgFirst;
    if (diff > 0.001) return 'up';
    if (diff < -0.001) return 'down';
    return 'neutral';
  }

  _getLocalTrend(candles, count = 10) {
    if (candles.length < count) return 'neutral';
    const segment = candles.slice(-count);
    const first = segment.slice(0, Math.floor(count / 2));
    const second = segment.slice(Math.floor(count / 2));
    const avgF = first.reduce((s, c) => s + c.close, 0) / first.length;
    const avgS = second.reduce((s, c) => s + c.close, 0) / second.length;
    const diff = (avgS - avgF) / avgF;
    if (diff > 0.0008) return 'up';
    if (diff < -0.0008) return 'down';
    return 'neutral';
  }

  // ============================================================
  // PIVOT POINTS (Swing Highs & Lows)
  // ============================================================

  _findPivots(candles, leftBars = 3, rightBars = 3) {
    const pivotHighs = [];
    const pivotLows = [];

    for (let i = leftBars; i < candles.length - rightBars; i++) {
      let isHigh = true;
      let isLow = true;

      for (let j = i - leftBars; j <= i + rightBars; j++) {
        if (j === i) continue;
        if (candles[j].high >= candles[i].high) isHigh = false;
        if (candles[j].low <= candles[i].low) isLow = false;
      }

      if (isHigh) pivotHighs.push({ index: i, price: candles[i].high, candle: candles[i] });
      if (isLow) pivotLows.push({ index: i, price: candles[i].low, candle: candles[i] });
    }

    return { pivotHighs, pivotLows };
  }

  // ============================================================
  // 1. DOUBLE TOP / DOUBLE BOTTOM
  // ============================================================

  _detectDoubleTopBottom(candles, symbol) {
    const { pivotHighs, pivotLows } = this._findPivots(candles, 3, 2);
    const last = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];

    // Double Top (M pattern) — BEARISH
    if (pivotHighs.length >= 2) {
      const top1 = pivotHighs[pivotHighs.length - 2];
      const top2 = pivotHighs[pivotHighs.length - 1];

      // Tops should be close in price (within 0.3%)
      const tolerance = top1.price * 0.003;
      if (Math.abs(top1.price - top2.price) < tolerance && top2.index - top1.index >= 4) {
        // Find neckline (lowest point between the two tops)
        let neckline = Infinity;
        for (let i = top1.index; i <= top2.index; i++) {
          if (candles[i].low < neckline) neckline = candles[i].low;
        }

        // Price must break below neckline
        if (last.close < neckline && prevCandle.close >= neckline) {
          return {
            symbol,
            direction: 'PUT',
            strategy: 'double_top',
            confidence: 0.75,
            details: `Double Top (M) — neckline quebrada @ ${neckline.toFixed(4)}`
          };
        }
      }
    }

    // Double Bottom (W pattern) — BULLISH
    if (pivotLows.length >= 2) {
      const bot1 = pivotLows[pivotLows.length - 2];
      const bot2 = pivotLows[pivotLows.length - 1];

      const tolerance = bot1.price * 0.003;
      if (Math.abs(bot1.price - bot2.price) < tolerance && bot2.index - bot1.index >= 4) {
        let neckline = -Infinity;
        for (let i = bot1.index; i <= bot2.index; i++) {
          if (candles[i].high > neckline) neckline = candles[i].high;
        }

        if (last.close > neckline && prevCandle.close <= neckline) {
          return {
            symbol,
            direction: 'CALL',
            strategy: 'double_bottom',
            confidence: 0.75,
            details: `Double Bottom (W) — neckline rompida @ ${neckline.toFixed(4)}`
          };
        }
      }
    }

    return null;
  }

  // ============================================================
  // 2. HEAD AND SHOULDERS (+ Inverse)
  // ============================================================

  _detectHeadAndShoulders(candles, symbol) {
    const { pivotHighs, pivotLows } = this._findPivots(candles, 3, 2);
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];

    // Head and Shoulders — BEARISH
    if (pivotHighs.length >= 3) {
      const h = pivotHighs.slice(-3);
      const leftShoulder = h[0];
      const head = h[1];
      const rightShoulder = h[2];

      // Head must be higher than both shoulders
      if (head.price > leftShoulder.price && head.price > rightShoulder.price) {
        // Shoulders should be roughly equal (within 0.5%)
        const shoulderTol = leftShoulder.price * 0.005;
        if (Math.abs(leftShoulder.price - rightShoulder.price) < shoulderTol) {
          // Find neckline — lowest points between shoulders
          let neckLeft = Infinity, neckRight = Infinity;
          for (let i = leftShoulder.index; i <= head.index; i++) {
            if (candles[i].low < neckLeft) neckLeft = candles[i].low;
          }
          for (let i = head.index; i <= rightShoulder.index; i++) {
            if (candles[i].low < neckRight) neckRight = candles[i].low;
          }
          const neckline = Math.max(neckLeft, neckRight);

          if (last.close < neckline && prev.close >= neckline) {
            return {
              symbol,
              direction: 'PUT',
              strategy: 'head_shoulders',
              confidence: 0.80,
              details: `Head & Shoulders — neckline quebrada @ ${neckline.toFixed(4)}`
            };
          }
        }
      }
    }

    // Inverse Head and Shoulders — BULLISH
    if (pivotLows.length >= 3) {
      const l = pivotLows.slice(-3);
      const leftShoulder = l[0];
      const head = l[1];
      const rightShoulder = l[2];

      if (head.price < leftShoulder.price && head.price < rightShoulder.price) {
        const shoulderTol = leftShoulder.price * 0.005;
        if (Math.abs(leftShoulder.price - rightShoulder.price) < shoulderTol) {
          let neckLeft = -Infinity, neckRight = -Infinity;
          for (let i = leftShoulder.index; i <= head.index; i++) {
            if (candles[i].high > neckLeft) neckLeft = candles[i].high;
          }
          for (let i = head.index; i <= rightShoulder.index; i++) {
            if (candles[i].high > neckRight) neckRight = candles[i].high;
          }
          const neckline = Math.min(neckLeft, neckRight);

          if (last.close > neckline && prev.close <= neckline) {
            return {
              symbol,
              direction: 'CALL',
              strategy: 'inv_head_shoulders',
              confidence: 0.80,
              details: `Inv Head & Shoulders — neckline rompida @ ${neckline.toFixed(4)}`
            };
          }
        }
      }
    }

    return null;
  }

  // ============================================================
  // 3. TRIANGLES (Symmetrical, Ascending, Descending)
  // ============================================================

  _detectTriangle(candles, symbol, trend15m) {
    const { pivotHighs, pivotLows } = this._findPivots(candles, 2, 2);
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];

    if (pivotHighs.length < 2 || pivotLows.length < 2) return null;

    const recentHighs = pivotHighs.slice(-3);
    const recentLows = pivotLows.slice(-3);

    // Calculate slopes
    const highSlope = this._slope(recentHighs);
    const lowSlope = this._slope(recentLows);

    const lastHigh = recentHighs[recentHighs.length - 1].price;
    const lastLow = recentLows[recentLows.length - 1].price;

    // Symmetrical Triangle: highs going down, lows going up (converging)
    if (highSlope < -0.00005 && lowSlope > 0.00005) {
      // Breakout direction
      if (last.close > lastHigh && prev.close <= lastHigh) {
        return {
          symbol,
          direction: 'CALL',
          strategy: 'sym_triangle_bull',
          confidence: 0.70,
          details: `Triângulo Simétrico — breakout p/ cima @ ${lastHigh.toFixed(4)}`
        };
      }
      if (last.close < lastLow && prev.close >= lastLow) {
        return {
          symbol,
          direction: 'PUT',
          strategy: 'sym_triangle_bear',
          confidence: 0.70,
          details: `Triângulo Simétrico — breakout p/ baixo @ ${lastLow.toFixed(4)}`
        };
      }
    }

    // Ascending Triangle: flat highs, rising lows → BULLISH
    if (Math.abs(highSlope) < 0.00003 && lowSlope > 0.00005) {
      const resistance = recentHighs.reduce((s, p) => s + p.price, 0) / recentHighs.length;
      if (last.close > resistance && prev.close <= resistance) {
        return {
          symbol,
          direction: 'CALL',
          strategy: 'asc_triangle',
          confidence: 0.75,
          details: `Triângulo Ascendente — resistência rompida @ ${resistance.toFixed(4)}`
        };
      }
    }

    // Descending Triangle: flat lows, falling highs → BEARISH
    if (highSlope < -0.00005 && Math.abs(lowSlope) < 0.00003) {
      const support = recentLows.reduce((s, p) => s + p.price, 0) / recentLows.length;
      if (last.close < support && prev.close >= support) {
        return {
          symbol,
          direction: 'PUT',
          strategy: 'desc_triangle',
          confidence: 0.75,
          details: `Triângulo Descendente — suporte quebrado @ ${support.toFixed(4)}`
        };
      }
    }

    return null;
  }

  _slope(pivots) {
    if (pivots.length < 2) return 0;
    const first = pivots[0];
    const last = pivots[pivots.length - 1];
    const indexDiff = last.index - first.index;
    if (indexDiff === 0) return 0;
    return (last.price - first.price) / first.price / indexDiff;
  }

  // ============================================================
  // 4. FLAG (Bullish & Bearish)
  // ============================================================

  _detectFlag(candles, symbol, trend15m) {
    if (candles.length < 20) return null;

    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];

    // Look for flag pattern: strong impulse move + small consolidation channel

    // Check last 15-20 candles for impulse + flag
    const segment = candles.slice(-20);

    // Find the strongest impulse in first half
    let maxMove = 0;
    let impulseDir = null;
    let impulseEnd = 0;

    for (let i = 0; i < 12; i++) {
      for (let j = i + 3; j < i + 8 && j < segment.length; j++) {
        const move = (segment[j].close - segment[i].close) / segment[i].close;
        if (Math.abs(move) > Math.abs(maxMove)) {
          maxMove = move;
          impulseDir = move > 0 ? 'up' : 'down';
          impulseEnd = j;
        }
      }
    }

    if (Math.abs(maxMove) < 0.002) return null; // Need meaningful impulse (0.2%)
    if (impulseEnd >= segment.length - 3) return null; // Need room for flag

    // Flag is the consolidation after impulse
    const flagCandles = segment.slice(impulseEnd);
    if (flagCandles.length < 3) return null;

    const flagHighs = flagCandles.map(c => c.high);
    const flagLows = flagCandles.map(c => c.low);
    const flagRange = Math.max(...flagHighs) - Math.min(...flagLows);
    const impulseRange = Math.abs(segment[impulseEnd].close - segment[0].close);

    // Flag should be smaller than impulse (consolidation)
    if (flagRange > impulseRange * 0.6) return null;

    // Bullish Flag: impulse up, flag slightly down or sideways, breakout above flag high
    if (impulseDir === 'up') {
      const flagHigh = Math.max(...flagHighs);
      if (last.close > flagHigh && prev.close <= flagHigh) {
        return {
          symbol,
          direction: 'CALL',
          strategy: 'bull_flag',
          confidence: 0.72,
          details: `Flag Bullish — breakout acima da bandeira @ ${flagHigh.toFixed(4)}`
        };
      }
    }

    // Bearish Flag: impulse down, flag slightly up or sideways, breakout below flag low
    if (impulseDir === 'down') {
      const flagLow = Math.min(...flagLows);
      if (last.close < flagLow && prev.close >= flagLow) {
        return {
          symbol,
          direction: 'PUT',
          strategy: 'bear_flag',
          confidence: 0.72,
          details: `Flag Bearish — breakout abaixo da bandeira @ ${flagLow.toFixed(4)}`
        };
      }
    }

    return null;
  }

  // ============================================================
  // 5. WEDGE (Rising/Falling — Continuation)
  // ============================================================

  _detectWedge(candles, symbol, trend15m) {
    const { pivotHighs, pivotLows } = this._findPivots(candles, 2, 2);
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];

    if (pivotHighs.length < 2 || pivotLows.length < 2) return null;

    const recentHighs = pivotHighs.slice(-3);
    const recentLows = pivotLows.slice(-3);

    const highSlope = this._slope(recentHighs);
    const lowSlope = this._slope(recentLows);

    // Rising Wedge (both slopes up, converging) — BEARISH
    // Highs rising slower than lows, or both rising but converging
    if (highSlope > 0.00002 && lowSlope > 0.00002 && lowSlope > highSlope * 0.5) {
      const lastLow = recentLows[recentLows.length - 1].price;
      // Breakout below support line
      if (last.close < lastLow && prev.close >= lastLow) {
        return {
          symbol,
          direction: 'PUT',
          strategy: 'rising_wedge',
          confidence: 0.70,
          details: `Rising Wedge — breakout p/ baixo @ ${lastLow.toFixed(4)}`
        };
      }
    }

    // Falling Wedge (both slopes down, converging) — BULLISH
    if (highSlope < -0.00002 && lowSlope < -0.00002 && highSlope < lowSlope * 0.5) {
      const lastHigh = recentHighs[recentHighs.length - 1].price;
      if (last.close > lastHigh && prev.close <= lastHigh) {
        return {
          symbol,
          direction: 'CALL',
          strategy: 'falling_wedge',
          confidence: 0.70,
          details: `Falling Wedge — breakout p/ cima @ ${lastHigh.toFixed(4)}`
        };
      }
    }

    return null;
  }

  // ============================================================
  // 6. CUP AND HANDLE (+ Inverse)
  // ============================================================

  _detectCupAndHandle(candles, symbol) {
    if (candles.length < 25) return null;

    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];

    // Cup and Handle: U-shape then small pullback then breakout
    // Look at last 25 candles
    const seg = candles.slice(-25);
    const closes = seg.map(c => c.close);

    // Find the minimum in the middle area (cup bottom)
    const midStart = 5;
    const midEnd = 18;
    let minIdx = midStart;
    for (let i = midStart; i <= midEnd; i++) {
      if (closes[i] < closes[minIdx]) minIdx = i;
    }

    // Cup: price at start and end should be similar and higher than bottom
    const leftRim = closes[0];
    const rightRim = closes[midEnd];
    const cupBottom = closes[minIdx];

    const rimAvg = (leftRim + rightRim) / 2;
    const cupDepth = (rimAvg - cupBottom) / rimAvg;

    if (cupDepth > 0.002 && cupDepth < 0.02) {
      // Rims should be close in price
      const rimDiff = Math.abs(leftRim - rightRim) / rimAvg;
      if (rimDiff < 0.005) {
        // Handle: small pullback after right rim (last few candles)
        const handleCandles = seg.slice(midEnd);
        if (handleCandles.length >= 3) {
          const handleLow = Math.min(...handleCandles.map(c => c.low));
          const handleHigh = Math.max(leftRim, rightRim);

          // Handle should not go below cup midpoint
          if (handleLow > cupBottom + (rimAvg - cupBottom) * 0.5) {
            // Breakout above rim
            if (last.close > handleHigh && prev.close <= handleHigh) {
              return {
                symbol,
                direction: 'CALL',
                strategy: 'cup_handle',
                confidence: 0.75,
                details: `Cup & Handle — breakout @ ${handleHigh.toFixed(4)}`
              };
            }
          }
        }
      }
    }

    // Inverse Cup and Handle — BEARISH
    let maxIdx = midStart;
    for (let i = midStart; i <= midEnd; i++) {
      if (closes[i] > closes[maxIdx]) maxIdx = i;
    }

    const cupTop = closes[maxIdx];
    const invCupDepth = (cupTop - rimAvg) / rimAvg;

    if (invCupDepth > 0.002 && invCupDepth < 0.02) {
      const rimDiff = Math.abs(leftRim - rightRim) / rimAvg;
      if (rimDiff < 0.005) {
        const handleCandles = seg.slice(midEnd);
        if (handleCandles.length >= 3) {
          const handleHigh = Math.max(...handleCandles.map(c => c.high));
          const handleLow = Math.min(leftRim, rightRim);

          if (handleHigh < cupTop - (cupTop - rimAvg) * 0.5) {
            if (last.close < handleLow && prev.close >= handleLow) {
              return {
                symbol,
                direction: 'PUT',
                strategy: 'inv_cup_handle',
                confidence: 0.75,
                details: `Inv Cup & Handle — breakdown @ ${handleLow.toFixed(4)}`
              };
            }
          }
        }
      }
    }

    return null;
  }

  // ============================================================
  // 7. CANDLESTICK PATTERNS (Hammer, Shooting Star, Engulfing, Hanging Man)
  // ============================================================

  _detectCandlestickPatterns(candles, symbol, trend15m) {
    if (candles.length < 10) return null;

    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const localTrend = this._getLocalTrend(candles, 10);

    const body = Math.abs(last.close - last.open);
    const range = last.high - last.low;
    const upperWick = last.high - Math.max(last.open, last.close);
    const lowerWick = Math.min(last.open, last.close) - last.low;
    const isBullish = last.close > last.open;

    if (range === 0) return null;
    const bodyRatio = body / range;

    // Hammer — bullish reversal at bottom of downtrend
    // Small body at top, long lower wick (2x+ body), little upper wick
    if (localTrend === 'down' && lowerWick > body * 2 && upperWick < body * 0.5 && bodyRatio < 0.35) {
      // Confirmation: next candle should be bullish (use current as "next" since prev is the hammer candidate)
      // Actually check if prev candle is hammer and current confirms
      const pBody = Math.abs(prev.close - prev.open);
      const pRange = prev.high - prev.low;
      const pLowerWick = Math.min(prev.open, prev.close) - prev.low;
      const pUpperWick = prev.high - Math.max(prev.open, prev.close);

      if (pRange > 0 && pLowerWick > pBody * 2 && pUpperWick < pBody * 0.5 && isBullish) {
        return {
          symbol,
          direction: 'CALL',
          strategy: 'hammer',
          confidence: 0.65,
          details: `Hammer + confirmação bullish — reversão de fundo`
        };
      }
    }

    // Shooting Star — bearish reversal at top of uptrend
    // Small body at bottom, long upper wick (2x+ body), little lower wick
    if (localTrend === 'up') {
      const pBody = Math.abs(prev.close - prev.open);
      const pRange = prev.high - prev.low;
      const pUpperWick = prev.high - Math.max(prev.open, prev.close);
      const pLowerWick = Math.min(prev.open, prev.close) - prev.low;

      if (pRange > 0 && pUpperWick > pBody * 2 && pLowerWick < pBody * 0.5 && !isBullish) {
        return {
          symbol,
          direction: 'PUT',
          strategy: 'shooting_star',
          confidence: 0.65,
          details: `Shooting Star + confirmação bearish — reversão de topo`
        };
      }
    }

    // Hanging Man — bearish, same shape as hammer but at top of uptrend
    if (localTrend === 'up') {
      const pBody = Math.abs(prev.close - prev.open);
      const pRange = prev.high - prev.low;
      const pLowerWick = Math.min(prev.open, prev.close) - prev.low;
      const pUpperWick = prev.high - Math.max(prev.open, prev.close);

      if (pRange > 0 && pLowerWick > pBody * 2 && pUpperWick < pBody * 0.5 && !isBullish) {
        return {
          symbol,
          direction: 'PUT',
          strategy: 'hanging_man',
          confidence: 0.63,
          details: `Hanging Man + confirmação bearish — topo`
        };
      }
    }

    // Bullish Engulfing — big bullish candle engulfs previous bearish
    if (localTrend === 'down' && isBullish && prev.close < prev.open) {
      if (last.open <= prev.close && last.close >= prev.open && body > Math.abs(prev.close - prev.open) * 1.3) {
        return {
          symbol,
          direction: 'CALL',
          strategy: 'bull_engulfing',
          confidence: 0.68,
          details: `Bullish Engulfing — reversão de fundo`
        };
      }
    }

    // Bearish Engulfing — big bearish candle engulfs previous bullish
    if (localTrend === 'up' && !isBullish && prev.close > prev.open) {
      if (last.open >= prev.close && last.close <= prev.open && body > Math.abs(prev.close - prev.open) * 1.3) {
        return {
          symbol,
          direction: 'PUT',
          strategy: 'bear_engulfing',
          confidence: 0.68,
          details: `Bearish Engulfing — reversão de topo`
        };
      }
    }

    return null;
  }

  // ============================================================
  // 8. TRIPLE TOP / TRIPLE BOTTOM
  // ============================================================

  _detectTripleTopBottom(candles, symbol) {
    const { pivotHighs, pivotLows } = this._findPivots(candles, 3, 2);
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];

    // Triple Top — BEARISH
    if (pivotHighs.length >= 3) {
      const tops = pivotHighs.slice(-3);
      const avgTop = tops.reduce((s, p) => s + p.price, 0) / 3;
      const maxDev = Math.max(...tops.map(p => Math.abs(p.price - avgTop)));

      // All three tops within 0.3% of each other
      if (maxDev / avgTop < 0.003) {
        // Find support between tops
        let support = Infinity;
        for (let i = tops[0].index; i <= tops[2].index; i++) {
          if (candles[i].low < support) support = candles[i].low;
        }

        if (last.close < support && prev.close >= support) {
          return {
            symbol,
            direction: 'PUT',
            strategy: 'triple_top',
            confidence: 0.78,
            details: `Triple Top — suporte quebrado @ ${support.toFixed(4)}`
          };
        }
      }
    }

    // Triple Bottom — BULLISH
    if (pivotLows.length >= 3) {
      const bots = pivotLows.slice(-3);
      const avgBot = bots.reduce((s, p) => s + p.price, 0) / 3;
      const maxDev = Math.max(...bots.map(p => Math.abs(p.price - avgBot)));

      if (maxDev / avgBot < 0.003) {
        let resistance = -Infinity;
        for (let i = bots[0].index; i <= bots[2].index; i++) {
          if (candles[i].high > resistance) resistance = candles[i].high;
        }

        if (last.close > resistance && prev.close <= resistance) {
          return {
            symbol,
            direction: 'CALL',
            strategy: 'triple_bottom',
            confidence: 0.78,
            details: `Triple Bottom — resistência rompida @ ${resistance.toFixed(4)}`
          };
        }
      }
    }

    return null;
  }

  // ============================================================
  // 9. ROUNDING TOP / BOTTOM
  // ============================================================

  _detectRounding(candles, symbol) {
    if (candles.length < 20) return null;

    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const seg = candles.slice(-20);
    const closes = seg.map(c => c.close);

    // Rounding Bottom: U-shape — first half declining, second half rising
    const mid = Math.floor(closes.length / 2);
    const firstHalf = closes.slice(0, mid);
    const secondHalf = closes.slice(mid);

    const firstSlope = (firstHalf[firstHalf.length - 1] - firstHalf[0]) / firstHalf[0];
    const secondSlope = (secondHalf[secondHalf.length - 1] - secondHalf[0]) / secondHalf[0];

    // Rounding Bottom: first half goes down, second half goes up
    if (firstSlope < -0.001 && secondSlope > 0.001) {
      const resistance = Math.max(closes[0], closes[closes.length - 2]);
      if (last.close > resistance && prev.close <= resistance) {
        return {
          symbol,
          direction: 'CALL',
          strategy: 'rounding_bottom',
          confidence: 0.68,
          details: `Rounding Bottom — breakout @ ${resistance.toFixed(4)}`
        };
      }
    }

    // Rounding Top: inverted U-shape
    if (firstSlope > 0.001 && secondSlope < -0.001) {
      const support = Math.min(closes[0], closes[closes.length - 2]);
      if (last.close < support && prev.close >= support) {
        return {
          symbol,
          direction: 'PUT',
          strategy: 'rounding_top',
          confidence: 0.68,
          details: `Rounding Top — breakdown @ ${support.toFixed(4)}`
        };
      }
    }

    return null;
  }

  // ============================================================
  // 10. SUPPORT/RESISTANCE BREAKOUT (Strategy 6 — Consolidation)
  // ============================================================

  _detectConsolidationBreakout(candles, symbol) {
    if (candles.length < 15) return null;

    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];

    // Look for range-bound price (consolidation)
    const range = candles.slice(-12, -1); // exclude current
    const highs = range.map(c => c.high);
    const lows = range.map(c => c.low);

    const maxHigh = Math.max(...highs);
    const minLow = Math.min(...lows);
    const rangeSize = (maxHigh - minLow) / minLow;

    // Consolidation: range should be tight (< 0.5%)
    if (rangeSize > 0.005) return null;

    // Count touches near resistance and support
    const tolerance = (maxHigh - minLow) * 0.15;
    let resTouches = 0, supTouches = 0;

    for (const c of range) {
      if (c.high >= maxHigh - tolerance) resTouches++;
      if (c.low <= minLow + tolerance) supTouches++;
    }

    // Need at least 2 touches each for valid range
    if (resTouches < 2 || supTouches < 2) return null;

    // Breakout above resistance
    if (last.close > maxHigh && prev.close <= maxHigh) {
      return {
        symbol,
        direction: 'CALL',
        strategy: 'range_breakout',
        confidence: 0.70,
        details: `Consolidação — breakout acima @ ${maxHigh.toFixed(4)}`
      };
    }

    // Breakdown below support
    if (last.close < minLow && prev.close >= minLow) {
      return {
        symbol,
        direction: 'PUT',
        strategy: 'range_breakdown',
        confidence: 0.70,
        details: `Consolidação — breakdown abaixo @ ${minLow.toFixed(4)}`
      };
    }

    return null;
  }
}

module.exports = ChartPatternAnalyzer;
