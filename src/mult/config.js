// ===== CONFIG DO BOT MULTIPLIER (Ouro+Prata, estrategia validada) =====
module.exports = {
  WS_URL: `wss://ws.derivws.com/websockets/v3?app_id=${process.env.DERIV_APP_ID || 1089}`,
  TOKEN: process.env.DERIV_TOKEN || 'apdZ8m2GEvMgHDg',

  ASSETS: ['frxXAUUSD', 'frxXAGUSD'],
  NAME: { frxXAUUSD: 'Ouro', frxXAGUSD: 'Prata' },
  GRANULARITY: 3600,             // H1

  // estrategia
  MIN_CONFLUENCE: 5,             // min 5 de 7 indicadores
  SL_ATR_MULT: 2,               // stop = 2x ATR
  RR: 2,                        // TP = 2x risco (R:R 1:2)
  MULTIPLIER: parseInt(process.env.MULTIPLIER || '0') || null, // definido apos mercado abrir; null = auto menor

  // banca virtual (simula R$100 + R$100/mes; ignora os ~$10k da demo)
  VIRTUAL_START: 22,
  RISK_PCT: 0.05,              // 5% da banca virtual por trade
  MIN_STAKE: 1,
  MONTHLY_DEPOSIT: 22,

  // protecao
  STOP_MONTH_DD: 0.25,
  STOP_TOTAL_DD: 0.40,
  MAX_OPEN_PER_ASSET: 1,

  CAMBIO: 4.55,

  TG_TOKEN: process.env.TG_BOT_TOKEN || '8580195488:AAHcHcUVwgrzZiQBAztVsjRgcL965qXMoX8',
  TG_CHAT: process.env.TG_CHAT_ID || '-1003957633197',
};
