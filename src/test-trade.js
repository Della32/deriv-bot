/**
 * Executa uma entrada de TESTE na demo — $10 em Rise/Fall 5min
 */
require('dotenv').config();
const WebSocket = require('ws');

const APP_ID = process.env.DERIV_APP_ID || '1089';
const TOKEN = process.env.DERIV_API_TOKEN;

async function executeTrade() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);
    
    ws.on('open', () => {
      console.log('  Conectado, autenticando...');
      ws.send(JSON.stringify({ authorize: TOKEN }));
    });

    let authorized = false;
    let contractId = null;

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());

      // Auth
      if (msg.authorize) {
        const a = msg.authorize;
        console.log(`  Conta: ${a.loginid} | Tipo: ${a.is_virtual ? 'DEMO ✅' : '⚠️ REAL'} | Saldo: $${a.balance}`);
        
        if (!a.is_virtual) {
          console.log('  ❌ CONTA REAL DETECTADA — ABORTANDO!');
          ws.close();
          return reject(new Error('Safety: conta real'));
        }

        authorized = true;
        const saldoAntes = a.balance;

        // Comprar contrato Rise (CALL) 5 minutos no GBP/USD
        console.log('\n  📤 Comprando: CALL GBP/USD | $10 | 5 minutos...');
        ws.send(JSON.stringify({
          buy: 1,
          price: 10,
          parameters: {
            contract_type: 'CALL',
            symbol: 'frxGBPUSD',
            duration: 5,
            duration_unit: 'm',
            currency: 'USD',
            amount: 10,
            basis: 'stake',
          }
        }));
      }

      // Buy response
      if (msg.buy) {
        const b = msg.buy;
        contractId = b.contract_id;
        console.log(`\n  ✅ TRADE EXECUTADO!`);
        console.log(`  Contract ID: ${b.contract_id}`);
        console.log(`  Preço pago: $${b.buy_price}`);
        console.log(`  Payout potencial: $${b.payout}`);
        console.log(`  Saldo após: $${b.balance_after}`);
        console.log(`\n  🔗 Link: https://app.deriv.com/contract/${b.contract_id}`);
        
        // Subscrever pra acompanhar resultado
        console.log('\n  ⏳ Aguardando resultado (5 min)...');
        ws.send(JSON.stringify({
          proposal_open_contract: 1,
          contract_id: b.contract_id,
          subscribe: 1
        }));
      }

      // Contract update
      if (msg.proposal_open_contract) {
        const c = msg.proposal_open_contract;
        if (c.is_sold) {
          const profit = c.profit;
          const won = profit > 0;
          console.log(`\n  ${'═'.repeat(40)}`);
          console.log(`  ${won ? '🟢 WIN!' : '🔴 LOSS'}`);
          console.log(`  Lucro/Perda: $${profit}`);
          console.log(`  Saldo final: $${c.balance_after || '?'}`);
          console.log(`  ${'═'.repeat(40)}`);
          ws.close();
          resolve({ won, profit, contractId });
        } else if (c.current_spot) {
          const pnl = c.profit >= 0 ? `+$${c.profit}` : `-$${Math.abs(c.profit)}`;
          process.stdout.write(`\r  📊 Preço: ${c.current_spot} | P&L: ${pnl}    `);
        }
      }

      // Error
      if (msg.error) {
        console.log(`\n  ❌ Erro: ${msg.error.message}`);
        ws.close();
        reject(new Error(msg.error.message));
      }
    });

    ws.on('error', reject);
    // Timeout 7 min (5 min trade + buffer)
    setTimeout(() => { ws.close(); reject(new Error('Timeout')); }, 420000);
  });
}

async function main() {
  console.log('═'.repeat(50));
  console.log('  🧪 TRADE DE TESTE — $10 CALL GBP/USD 5min');
  console.log('  Conta DEMO — dinheiro virtual');
  console.log('═'.repeat(50));
  
  try {
    const result = await executeTrade();
    console.log('\n  Teste concluído!');
  } catch (err) {
    console.log(`\n  Erro: ${err.message}`);
  }
}

main();
