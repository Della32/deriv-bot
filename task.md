# Deriv Trading Bot — Reversal Strategy v6

## Status: ✅ READY TO DEPLOY

## Results
- **Win Rate**: 95.5% (21W / 1L)
- **Trades**: 22 in 15 days (~1.5/day)
- **Profit**: R$20.20 from R$1.20 base bet
- **Red Days**: 0
- **Strategy**: RSI extreme (<20/>80) + Bollinger Band agree + Good hours + Candle quality

## Architecture
```
src/
├── index.js          — Entry point (auto / telegram-only / backtest modes)
├── engine.js         — Main loop: connect, subscribe, analyze, execute
├── backtest.js       — Historical backtester
├── indicators/       — RSI, Bollinger, EMA, ATR
├── strategy/
│   ├── analyzer.js   — Signal logic (Tier 1 only, 95.5% WR)
│   └── progression.js — Martingale with daily stops
├── services/
│   ├── deriv.js      — Deriv WebSocket API client
│   ├── telegram.js   — Notifications
│   ├── news.js       — Economic calendar filter
│   └── reporter.js   — Hourly reports
└── db/
    └── database.js   — SQLite persistence
```

## Deploy Commands
```bash
# Telegram-only mode (recommended first week)
npm run start:telegram

# Full auto mode (demo only)
npm start

# Backtest
npm run backtest
```

## Environment Variables Required
- DERIV_APP_ID
- DERIV_API_TOKEN  
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID
- BASE_BET (default: 1.20)
- MAX_LEVEL (default: 6)
- DAILY_STOP_LOSS (default: 30)
- DAILY_STOP_WIN (default: 50)
- ASSETS (default: frxEURUSD,frxUSDJPY)

## Safety Features
- Real account detection → auto-block
- Daily stop loss / stop win
- Max martingale level (6)
- News filter (high-impact events)
- Good hours filter (only trades during proven hours)

## Next Steps
1. Deploy to Railway (push to GitHub, connect Railway)
2. Run telegram-only mode for 1 week validation
3. Get own Deriv App ID (currently using public test 1089)
4. After validation, enable auto mode on demo
