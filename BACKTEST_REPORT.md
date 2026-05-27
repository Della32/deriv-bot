# 📊 BACKTEST COMPLETO — 17 dias de dados reais

## Período: 10/05/2026 → 27/05/2026 (17.4 dias)
**5 ativos OTC** | **5min candles** | **5min expiry** | **Stake $5 + Martingale**

---

## RESUMO GERAL

| Métrica | Valor |
|---------|-------|
| Total de trades | 4,568 |
| Wins | 2,313 (50.6%) |
| Losses | 2,255 |
| **Lucro total** | **+$1,317.19** |
| Balance final | $11,317.19 |
| ROI | 13.17% |
| Max Drawdown | $1,877.66 (15%) |
| Trades/dia | ~262 |
| Dias verdes | 11/18 (61%) |
| Lucro médio/dia | +$73.18 |
| Profit Factor | 1.04 |
| Maior win streak | 10 |
| Maior loss streak | 10 |

---

## TOP ESTRATÉGIAS (lucro)

| # | Estratégia | Trades | Win Rate | Lucro |
|---|-----------|--------|----------|-------|
| 1 | rounding_bottom | 564 | 50.9% | +$643 |
| 2 | rounding_top | 625 | 51.0% | +$491 |
| 3 | bear_engulfing | 261 | 51.7% | +$478 |
| 4 | head_shoulders | 126 | 55.6% | +$454 |
| 5 | hanging_man | 81 | 60.5% | +$417 |
| 6 | shooting_star | 85 | 54.1% | +$372 |
| 7 | rising_wedge | 197 | 48.2% | +$271 |
| 8 | bull_engulfing | 324 | 53.4% | +$243 |

## ESTRATÉGIAS NEGATIVAS (evitar)

| Estratégia | Trades | Win Rate | Lucro |
|-----------|--------|----------|-------|
| double_bottom | 703 | 48.5% | -$1,829 |
| sym_triangle_bull | 50 | 34.0% | -$424 |
| inv_cup_handle | 89 | 46.1% | -$336 |

---

## MELHOR ATIVO

| Ativo | Trades | Win Rate | Lucro |
|-------|--------|----------|-------|
| **R_25** | 893 | 51.2% | **+$1,865** |
| R_100 | 968 | 49.7% | +$312 |
| R_50 | 1,021 | 50.2% | -$72 |
| R_10 | 719 | 51.2% | -$207 |
| R_75 | 967 | 51.1% | -$580 |

---

## MARTINGALE (por nível)

| Nível | Trades | Win Rate | Lucro |
|-------|--------|----------|-------|
| 0 | 2,339 | 50.4% | -$386 |
| 1 | 1,160 | 49.3% | -$671 |
| 2 | 588 | 52.4% | +$76 |
| 3 | 280 | 50.4% | -$439 |
| **4** | **139** | **55.4%** | **+$874** |
| **5** | **62** | **59.7%** | **+$1,864** |

> O lucro vem dos níveis altos da progressão. O martingale recupera as perdas dos níveis baixos.

---

## CONCLUSÃO

✅ **LUCRATIVO** — +$1,317 em 17 dias (+13% ROI)
⚠️ **MAS COM RESSALVAS:**

1. **Profit Factor 1.04** — margem muito apertada, qualquer mudança de mercado pode virar negativo
2. **Drawdown de $1,878** — 15% do capital, aceitável mas precisa de estômago
3. **O lucro depende MUITO do martingale** — sem martingale a estratégia base é ~50/50
4. **3 estratégias são tóxicas** — double_bottom (-$1,829), sym_triangle_bull (-$425), inv_cup_handle (-$336)
5. **R_25 carrega o bot** — se tirar R_25, fica bem mais fraco

### RECOMENDAÇÕES:
- **Desativar** double_bottom, sym_triangle_bull, inv_cup_handle
- **Focar em** R_25 e R_100
- Considerar aumentar stake base para $10 com banca de $10K+
- Limitar max nível martingale a 5 (já está)
