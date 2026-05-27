import sqlite3
import json

conn = sqlite3.connect('/home/user/deriv-bot/data/bot.db')
conn.row_factory = sqlite3.Row
c = conn.cursor()

trades = c.execute("SELECT * FROM trades ORDER BY id").fetchall()
state = c.execute("SELECT value FROM bot_state WHERE key='progression'").fetchone()

total = len(trades)
wins = sum(1 for t in trades if t['won'] == 1)
losses = total - wins
profit = sum(t['profit'] for t in trades)
win_rate = (wins/total*100) if total > 0 else 0

# Balance tracking
balance_start = 10000.0  # initial demo
last_balance = trades[-1]['balance_after'] if trades and trades[-1]['balance_after'] else None

# Progression state
prog = json.loads(state['value']) if state else {}

# Streaks
max_win_streak = 0
max_loss_streak = 0
cur_win = 0
cur_loss = 0
for t in trades:
    if t['won'] == 1:
        cur_win += 1
        cur_loss = 0
        max_win_streak = max(max_win_streak, cur_win)
    else:
        cur_loss += 1
        cur_win = 0
        max_loss_streak = max(max_loss_streak, cur_loss)

# Current streak
cur_streak_type = None
cur_streak_count = 0
for t in reversed(list(trades)):
    if cur_streak_type is None:
        cur_streak_type = 'WIN' if t['won'] == 1 else 'LOSS'
        cur_streak_count = 1
    elif (t['won'] == 1 and cur_streak_type == 'WIN') or (t['won'] == 0 and cur_streak_type == 'LOSS'):
        cur_streak_count += 1
    else:
        break

print("=" * 55)
print("  📊 RELATÓRIO BOT DERIV v2.0 — CONTA DEMO")
print("  📅 Período: 26/05/2026 ~ 27/05/2026")
print("=" * 55)
print()
print("━━━ RESUMO GERAL ━━━")
print(f"  Total de trades:     {total}")
print(f"  ✅ Wins:              {wins}")
print(f"  ❌ Losses:            {losses}")
print(f"  📈 Taxa de acerto:   {win_rate:.1f}%")
print(f"  💰 Lucro total:      ${profit:+.2f}")
print(f"  💵 Último balance:   ${last_balance:.2f}" if last_balance else "  💵 Último balance:   N/A")
print(f"  🔄 Balance inicial:  $10,000.00")
print(f"  📊 Rendimento:       {((last_balance - balance_start) / balance_start * 100):.2f}%" if last_balance else "")
print()
print("━━━ STREAKS ━━━")
print(f"  🔥 Maior sequência WIN:   {max_win_streak}")
print(f"  💀 Maior sequência LOSS:  {max_loss_streak}")
print(f"  ▶️  Sequência atual:       {cur_streak_count}x {cur_streak_type}")
print()

# By day
print("━━━ POR DIA ━━━")
days = {}
for t in trades:
    d = t['timestamp'][:10]
    if d not in days:
        days[d] = {'w': 0, 'l': 0, 'p': 0}
    if t['won'] == 1:
        days[d]['w'] += 1
    else:
        days[d]['l'] += 1
    days[d]['p'] += t['profit']

for d, v in sorted(days.items()):
    total_d = v['w'] + v['l']
    wr = v['w']/total_d*100 if total_d > 0 else 0
    print(f"  {d}: {v['w']}W / {v['l']}L ({wr:.0f}%) — ${v['p']:+.2f}")
print()

# By symbol
print("━━━ POR ATIVO ━━━")
symbols = {}
for t in trades:
    s = t['symbol']
    if s not in symbols:
        symbols[s] = {'w': 0, 'l': 0, 'p': 0}
    if t['won'] == 1:
        symbols[s]['w'] += 1
    else:
        symbols[s]['l'] += 1
    symbols[s]['p'] += t['profit']

for s, v in sorted(symbols.items(), key=lambda x: -x[1]['p']):
    total_s = v['w'] + v['l']
    emoji = "🟢" if v['p'] > 0 else "🔴"
    print(f"  {emoji} {s}: {v['w']}W / {v['l']}L — ${v['p']:+.2f}")
print()

# By strategy
print("━━━ POR ESTRATÉGIA ━━━")
strats = {}
for t in trades:
    s = t['strategy']
    if s not in strats:
        strats[s] = {'w': 0, 'l': 0, 'p': 0}
    if t['won'] == 1:
        strats[s]['w'] += 1
    else:
        strats[s]['l'] += 1
    strats[s]['p'] += t['profit']

for s, v in sorted(strats.items(), key=lambda x: -x[1]['p']):
    total_s = v['w'] + v['l']
    wr = v['w']/total_s*100 if total_s > 0 else 0
    emoji = "🟢" if v['p'] > 0 else "🔴"
    print(f"  {emoji} {s}: {v['w']}W / {v['l']}L ({wr:.0f}%) — ${v['p']:+.2f}")
print()

# By progression level
print("━━━ PROGRESSÃO (MARTINGALE) ━━━")
levels = {}
for t in trades:
    l = t['level']
    if l not in levels:
        levels[l] = {'w': 0, 'l': 0, 'p': 0, 'stakes': []}
    if t['won'] == 1:
        levels[l]['w'] += 1
    else:
        levels[l]['l'] += 1
    levels[l]['p'] += t['profit']
    levels[l]['stakes'].append(t['stake'])

for l in sorted(levels.keys()):
    v = levels[l]
    total_l = v['w'] + v['l']
    avg_stake = sum(v['stakes']) / len(v['stakes'])
    emoji = "🟢" if v['p'] > 0 else "🔴"
    print(f"  {emoji} Nível {l}: {v['w']}W / {v['l']}L — stake médio ${avg_stake:.2f} — ${v['p']:+.2f}")

prog_level = prog.get('currentLevel', 0)
print(f"\n  ▶️  Nível atual da progressão: {prog_level}")
print()

# Individual trades
print("━━━ HISTÓRICO COMPLETO ━━━")
print(f"  {'#':<3} {'Hora':<8} {'Ativo':<7} {'Dir':<5} {'Stake':>7} {'Lucro':>8} {'Res':>4} {'Nv':>3} {'Estratégia'}")
print(f"  {'─'*3} {'─'*8} {'─'*7} {'─'*5} {'─'*7} {'─'*8} {'─'*4} {'─'*3} {'─'*20}")
for t in trades:
    hora = t['timestamp'][11:19] if t['timestamp'] else '?'
    res = "✅" if t['won'] == 1 else "❌"
    print(f"  {t['id']:<3} {hora:<8} {t['symbol']:<7} {t['direction']:<5} ${t['stake']:>6.2f} ${t['profit']:>+7.2f} {res:>4} {t['level']:>3} {t['strategy']}")

print()
print("=" * 55)
print(f"  🤖 Bot ONLINE no Render — uptime ativo")
print(f"  💰 Balance atual: ~${last_balance:.2f}" if last_balance else "")
print(f"  📈 Lucro acumulado: ${profit:+.2f}")
print("=" * 55)

conn.close()
