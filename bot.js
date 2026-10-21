// Orenix Game — бот-казино (уведомления). Node.js 18+, без зависимостей.
// Бот: рассылки, пополнения, выводы, статус открыт/закрыт. Игры — в мини-аппе.

const http = require('http');
const fs = require('fs');
const path = require('path');

// ---------- Конфиг (из .env / переменных окружения) ----------
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach(l => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  });
} catch (_) {}

const TOKEN = process.env.BOT_TOKEN;
const API_BASE = process.env.API_BASE || 'https://api.staticgram.top';
const MINIAPP_URL = process.env.MINIAPP_URL || '';
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const NOTIFY_SECRET = process.env.NOTIFY_SECRET || '';
const PORT = +(process.env.PORT || 3000);
const NAME = 'Orenix Game';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';          // секретный ключ (service_role / sb_secret_...), ТОЛЬКО на сервере
const DEFAULT_GIFT_VALUE = +(process.env.DEFAULT_GIFT_VALUE || 500); // цена NFT в звёздах, если подарка нет в gift_values.json
let GIFT_VALUES = {};
try { GIFT_VALUES = JSON.parse(fs.readFileSync(path.join(__dirname, 'gift_values.json'), 'utf8')); } catch (_) {}
const LOG_FILE = path.join(__dirname, 'business_updates.log');

if (!TOKEN) { console.error('Нет BOT_TOKEN в .env'); process.exit(1); }
if (!NOTIFY_SECRET) { console.error('Нет NOTIFY_SECRET в .env'); process.exit(1); }

// ---------- Хранилище ----------
const DB_FILE = path.join(__dirname, 'state.json');
let db = { open: true, users: {} };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; } catch (_) {}
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db));

// ---------- API мессенджера ----------
async function api(method, params = {}) {
  const r = await fetch(`${API_BASE}/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const j = await r.json().catch(() => ({}));
  if (j.ok === false) throw new Error(`${method}: ${j.description || r.status}`);
  return j.result !== undefined ? j.result : j;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function openKeyboard() {
  if (!MINIAPP_URL) return undefined;
  return { inline_keyboard: [[{ text: '🎰 Открыть Orenix Game', web_app: { url: MINIAPP_URL } }]] };
}

async function send(chat_id, text, withButton = true) {
  const params = { chat_id, text, parse_mode: 'HTML' };
  if (withButton) { const kb = openKeyboard(); if (kb) params.reply_markup = kb; }
  return api('sendMessage', params);
}

// ---------- Уведомления ----------
const fmtAmount = (amount, currency, nft) =>
  currency === 'nft' ? `🖼 NFT${nft ? ` «${esc(nft)}»` : ''}` : `⭐ ${esc(amount)} звёзд`;

const TEMPLATES = {
  deposit: d => `✅ <b>Пополнение зачислено</b>\n${fmtAmount(d.amount, d.currency, d.nft)}\nСпасибо, что играете в ${NAME}!`,
  withdraw_request: d => `🕓 <b>Заявка на вывод принята</b>\n${fmtAmount(d.amount, d.currency, d.nft)}\nОбычно это занимает немного времени.`,
  withdraw_done: d => `💸 <b>Вывод выполнен</b>\n${fmtAmount(d.amount, d.currency, d.nft)}\nСредства отправлены.`,
  withdraw_rejected: d => `❌ <b>Вывод отклонён</b>\n${fmtAmount(d.amount, d.currency, d.nft)}${d.reason ? `\nПричина: ${esc(d.reason)}` : ''}\nСредства возвращены на баланс.`,
  custom: d => esc(d.text || ''),
};

async function notify(user_id, type, data = {}) {
  const tpl = TEMPLATES[type];
  if (!tpl) throw new Error('unknown type');
  return send(user_id, tpl(data));
}

async function broadcast(text) {
  const ids = Object.keys(db.users);
  let ok = 0, fail = 0;
  for (const id of ids) {
    try { await send(id, text); ok++; } catch (_) { fail++; }
    await sleep(40); // ~25 сообщений/сек
  }
  return { total: ids.length, ok, fail };
}

async function setOpen(open, announce) {
  db.open = !!open; save();
  if (announce) {
    return broadcast(open
      ? `🟢 <b>${NAME} открыт!</b>\nМожно играть.`
      : `🔴 <b>${NAME} временно закрыт.</b>\nМы скоро вернёмся.`);
  }
}

// ---------- Команды бота ----------
const isAdmin = id => ADMIN_IDS.includes(String(id));

async function onMessage(msg) {
  const chat = msg.chat.id, from = msg.from ? msg.from.id : chat;
  const text = (msg.text || '').trim();
  if (!db.users[chat]) { db.users[chat] = { since: Date.now() }; save(); }

  const [cmd, ...rest] = text.split(/\s+/);
  const arg = rest.join(' ');
  const c = cmd.toLowerCase().replace(/@.*$/, '');

  if (isAdmin(from)) {
    if (c === '/open') { await send(chat, 'Открываю и рассылаю…', false); const r = await setOpen(true, true); return send(chat, `Готово: ${r.ok}/${r.total}`, false); }
    if (c === '/close') { await send(chat, 'Закрываю и рассылаю…', false); const r = await setOpen(false, true); return send(chat, `Готово: ${r.ok}/${r.total}`, false); }
    if (c === '/broadcast' && arg) { await send(chat, 'Рассылаю…', false); const r = await broadcast(esc(arg)); return send(chat, `Готово: ${r.ok}/${r.total}, ошибок ${r.fail}`, false); }
    if (c === '/stats') return send(chat, `Пользователей: ${Object.keys(db.users).length}\nСтатус: ${db.open ? 'открыт' : 'закрыт'}`, false);
  }

  if (c === '/status') return send(chat, db.open ? '🟢 Казино открыто' : '🔴 Казино закрыто');

  // /start и всё остальное
  if (!db.open) return send(chat, `🔴 <b>${NAME} сейчас закрыт.</b>\nМы сообщим, когда откроемся.`, false);
  return send(chat, `🎰 <b>Добро пожаловать в ${NAME}!</b>\nИграйте на ⭐ звёзды и 🖼 NFT.\nВсе игры — в мини-приложении. Здесь вы будете получать уведомления о пополнениях, выводах и новостях.`);
}

// ---------- Пополнения через бизнес-аккаунт (@OrenixGame) ----------
async function sbRpc(fn, args) {
  if (!SUPABASE_URL || !SB_KEY) throw new Error('не заданы SUPABASE_URL / SUPABASE_SERVICE_KEY');
  const headers = { 'Content-Type': 'application/json', apikey: SB_KEY };
  if (SB_KEY.startsWith('eyJ')) headers.Authorization = 'Bearer ' + SB_KEY;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`${fn}: ${(await r.text()).slice(0, 200)}`);
}
const tellAdmins = t => Promise.all(ADMIN_IDS.map(id => send(id, t, false).catch(() => {})));

async function onBusinessMessage(msg) {
  try { fs.appendFileSync(LOG_FILE, JSON.stringify({ t: new Date().toISOString(), msg }) + '\n'); } catch (_) {}  // сырой лог: по нему видно формат событий
  const from = msg.from && msg.from.id;
  if (!from) return;
  if (db.bizOwners && db.bizOwners[msg.business_connection_id] === from) return;   // свои сообщения владельца аккаунта
  const ug = msg.unique_gift;
  if (!ug || !ug.gift) return;                                                     // обычные сообщения игнорируем
  if (ug.origin && ug.origin !== 'transfer') return;                               // зачисляем только переданные подарки
  const base = ug.gift.base_name || String(ug.gift.name || 'Gift').replace(/-\d+$/, '');
  const name = ug.gift.number ? `${base} #${ug.gift.number}` : base;
  const value = +(GIFT_VALUES[base] || DEFAULT_GIFT_VALUE);
  const ref = `ug:${ug.gift.name || base}:${msg.chat && msg.chat.id}:${msg.message_id}`;
  try {
    await sbRpc('credit_nft', { p_tg: from, p_name: name, p_value: value, p_emoji: null, p_ref: ref });
    console.log('NFT зачислен:', from, name, value);
    await notify(from, 'deposit', { currency: 'nft', nft: name }).catch(() => {});
  } catch (e) {
    if (/duplicate|23505|deposits_ref_key/i.test(e.message)) return;               // это же событие уже зачислено
    console.error('credit_nft:', e.message);
    await tellAdmins(`⚠️ Не удалось зачислить подарок ${esc(name)} от ${from}:\n${esc(e.message)}`);
  }
}

async function poll() {
  let offset = 0;
  for (;;) {
    try {
      const updates = await api('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'business_connection', 'business_message', 'edited_business_message'] });
      for (const u of updates || []) {
        offset = u.update_id + 1;
        if (u.message) onMessage(u.message).catch(e => console.error('msg:', e.message));
        if (u.business_connection) {
          const bc = u.business_connection; db.bizOwners = db.bizOwners || {};
          if (bc.id && bc.user) { db.bizOwners[bc.id] = bc.user.id; save(); console.log('Бизнес-аккаунт подключён:', bc.user.username || bc.user.id); }
        }
        if (u.business_message) onBusinessMessage(u.business_message).catch(e => console.error('biz:', e.message));
      }
    } catch (e) { console.error('poll:', e.message); await sleep(3000); }
  }
}

// ---------- HTTP для мини-аппа/бэкенда ----------
// POST /notify    {user_id, type, amount, currency:"stars"|"nft", nft, reason, text}
// POST /broadcast {text}
// POST /status    {open: true|false, announce: true|false}
// Заголовок: x-secret: <NOTIFY_SECRET>
const server = http.createServer((req, res) => {
  const reply = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.method !== 'POST') return reply(405, { ok: false });
  if (req.headers['x-secret'] !== NOTIFY_SECRET) return reply(403, { ok: false, error: 'forbidden' });
  let body = '';
  req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
  req.on('end', async () => {
    try {
      const d = JSON.parse(body || '{}');
      if (req.url === '/notify') { await notify(d.user_id, d.type, d); return reply(200, { ok: true }); }
      if (req.url === '/broadcast') { return reply(200, { ok: true, ...(await broadcast(esc(d.text || ''))) }); }
      if (req.url === '/status') { await setOpen(d.open, d.announce); return reply(200, { ok: true, open: db.open }); }
      reply(404, { ok: false });
    } catch (e) { reply(400, { ok: false, error: e.message }); }
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`${NAME}: HTTP на 127.0.0.1:${PORT}`));
api('getMe').then(me => console.log('Бот:', me.username || me)).catch(e => console.error(e.message));
poll();
