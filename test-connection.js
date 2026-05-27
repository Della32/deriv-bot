/**
 * Teste rápido de conexão — Deriv + Telegram
 */
require('dotenv').config();
const fetch = require('node-fetch');
const WebSocket = require('ws');

async function testTelegram() {
  console.log('\n=== TESTANDO TELEGRAM ===');
  try {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: '🤖 <b>Teste de conexão</b>\n\nBot de trading conectado com sucesso!\nAguardando configuração completa...',
        parse_mode: 'HTML'
      })
    });
    const data = await res.json();
    if (data.ok) {
      console.log('✅ Telegram OK! Mensagem enviada.');
    } else {
      console.log('❌ Telegram ERRO:', data.description);
    }
  } catch (err) {
    console.log('❌ Telegram ERRO:', err.message);
  }
}

async function testDeriv() {
  console.log('\n=== TESTANDO DERIV ===');
  return new Promise((resolve) => {
    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${process.env.DERIV_APP_ID}`);
    
    const timeout = setTimeout(() => {
      console.log('❌ Deriv TIMEOUT');
      ws.close();
      resolve();
    }, 15000);

    ws.on('open', () => {
      console.log('✅ WebSocket conectado!');
      
      // Tenta autorizar
      ws.send(JSON.stringify({ authorize: process.env.DERIV_API_TOKEN }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      
      if (msg.msg_type === 'authorize') {
        if (msg.error) {
          console.log('❌ Autenticação ERRO:', msg.error.message);
        } else {
          const isDemo = msg.authorize.is_virtual === 1;
          console.log(`✅ Autenticado!`);
          console.log(`   Conta: ${isDemo ? 'DEMO ✅' : 'REAL ⚠️'}`);
          console.log(`   Login: ${msg.authorize.loginid}`);
          console.log(`   Saldo: ${msg.authorize.currency} ${msg.authorize.balance}`);
          console.log(`   Email: ${msg.authorize.email}`);
        }
        clearTimeout(timeout);
        ws.close();
        resolve();
      }
    });

    ws.on('error', (err) => {
      console.log('❌ WebSocket ERRO:', err.message);
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function main() {
  console.log('🔍 Testando conexões...');
  console.log(`   APP_ID: ${process.env.DERIV_APP_ID}`);
  console.log(`   TOKEN: ${process.env.DERIV_API_TOKEN?.substring(0, 5)}...`);
  console.log(`   CHAT_ID: ${process.env.TELEGRAM_CHAT_ID}`);
  
  await testTelegram();
  await testDeriv();
  
  console.log('\n=== TESTE CONCLUÍDO ===\n');
}

main();
