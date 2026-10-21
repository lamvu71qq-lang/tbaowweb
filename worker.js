// Cloudflare Worker: nhận "ping" từ web khi khách gửi đơn -> báo Telegram ngay (không cần admin mở web).
// Chỉ cần 1 biến bí mật: FIREBASE_SA (toàn bộ nội dung file JSON service account của Firebase).
// Token bot + Chat ID lấy từ phần Telegram bạn đã cài trong tab Hệ thống.
const DB = 'https://bu-store-882fe-default-rtdb.asia-southeast1.firebasedatabase.app';
const API_KEY = 'AIzaSyD7jaDAoDexlm_Iizfj58bj2U5wNOyvNvs';
const KHO = { okvip: 'Kho Acc OkVip', abcvip: 'Kho Acc AbcVip', nohu: 'Kho Acc NOHU' };
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const fmt = n => Number(n || 0).toLocaleString('vi-VN') + 'đ', u6 = s => String(s).slice(0, 6).toUpperCase();
const b64u = x => btoa(typeof x === 'string' ? x : String.fromCharCode(...new Uint8Array(x))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let tok = { v: null, exp: 0 };
async function getToken(env) {
  if (tok.v && tok.exp > Date.now() + 60000) return tok.v;
  const sa = JSON.parse(env.FIREBASE_SA), now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + claim)));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + head + '.' + claim + '.' + sig });
  const j = await r.json(); if (!j.access_token) throw new Error('Không lấy được token Firebase');
  tok = { v: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tok.v;
}
const db = async (env, path, init = {}) => fetch(`${DB}/${path}.json`, { ...init, headers: { Authorization: 'Bearer ' + await getToken(env), 'Content-Type': 'application/json', ...(init.headers || {}) } });

// type -> [collection, bot, chủ đơn, điều kiện còn chờ, nội dung]
const who = r => `User: ${r.username}\nID web: ${u6(r.uid)}`;
const T = {
  topups: ['topups', 'b', r => r.uid, r => r.status === 'pending', r => `🧾 BẠN CÓ ĐƠN NẠP MỚI, VUI LÒNG XÁC NHẬN\n${who(r)}\nSố tiền: ${fmt(r.amount)}${r.note ? '\nND: ' + r.note : ''}\nẢnh chuyển khoản: ${r.hasBill ? 'có (đính kèm)' : 'không có'}`],
  sells: ['sells', 'b', r => r.uid, r => r.status === 'pending', r => `🏏 USER BÁN CẦU THỦ, VUI LÒNG XÁC NHẬN\n${who(r)}\nGhi chú: ${r.note}`],
  withdraws: ['withdraws', 'b', r => r.uid, r => r.status === 'pending', r => `💸 YÊU CẦU RÚT TIỀN\n${who(r)}\nSố tiền: ${fmt(r.amount)}\nNhận về: ${r.bankInfo}`],
  vas: ['vas', 'n', r => r.uid, r => r.status === 'pending', r => `🏦 YÊU CẦU TẠO VA ${r.bank}\n${who(r)}`],
  tickets: ['tickets', 'n', r => r.uid, r => r.status === 'open', r => `🆘 ${r.type === 'error' ? 'KHÁCH BÁO LỖI' : 'KHÁCH CẦN HỖ TRỢ'}\nTừ: ${r.username}\n${r.message}`],
  users: ['users', 'n', (r, id) => id, r => r.role === 'user' && r.status === 'pending', r => `👤 THÀNH VIÊN MỚI\nTên đăng nhập: ${r.username}\nĐang chờ admin duyệt.`],
  buy: ['shopAcc', 's', r => r.buyerUid, r => r.sold === true, r => `🛒 KHÁCH MUA ACC\nKhách: ${r.buyerName}\nAcc: ${r.name}\n${KHO[r.kho] || r.kho}\nGiá: ${fmt(r.price)}`],
};

async function send(tg, bot, text, bill) {
  const [t, chat] = bot === 'n' ? [tg.noticeToken, tg.chatId] : bot === 'b' ? [tg.bankToken || tg.shopToken, tg.bankChatId || tg.chatId] : [tg.shopToken, tg.chatId];
  if (!t || !chat) return false;
  if (bill) {
    const bin = atob(bill.split(',')[1]), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const f = new FormData(); f.append('chat_id', chat); f.append('caption', text.slice(0, 1000)); f.append('photo', new Blob([u], { type: 'image/jpeg' }), 'bill.jpg');
    return !!(await (await fetch(`https://api.telegram.org/bot${t}/sendPhoto`, { method: 'POST', body: f })).json()).ok;
  }
  return !!(await (await fetch(`https://api.telegram.org/bot${t}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }) })).json()).ok;
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const res = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method !== 'POST') return res({ ok: true });
    try {
      const { type, id } = await req.json(), cfg = T[type];
      if (!cfg || !/^[A-Za-z0-9_-]{1,60}$/.test(String(id))) return res({ error: 'bad request' }, 400);
      // 1) xác thực người gửi bằng ID token của Firebase
      const lk = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: (req.headers.get('authorization') || '').replace(/^Bearer /, '') }) })).json();
      const uid = lk.users && lk.users[0] && lk.users[0].localId; if (!uid) return res({ error: 'unauthorized' }, 401);
      // 2) đọc đơn từ database (nội dung lấy từ DB, không tin dữ liệu client gửi)
      const [coll, bot, owner, pending, text] = cfg, rec = await (await db(env, `${coll}/${id}`)).json();
      if (!rec || owner(rec, id) !== uid || !pending(rec)) return res({ skipped: 'not eligible' });
      const tg = await (await db(env, 'settings/telegram')).json(); if (!tg || !tg.enabled) return res({ skipped: 'telegram off' });
      // 3) giành quyền báo (chống báo trùng với trang admin)
      const path = type === 'buy' ? `shopNotified/${id}` : `${coll}/${id}/notified`;
      const g = await db(env, path, { headers: { 'X-Firebase-ETag': 'true' } }), et = g.headers.get('ETag');
      if ((await g.json()) === true) return res({ duplicate: true });
      if (!(await db(env, path, { method: 'PUT', body: 'true', headers: { 'if-match': et } })).ok) return res({ duplicate: true });
      // 4) gửi Telegram (kèm ảnh nếu có)
      const bill = rec.hasBill ? await (await db(env, `bills/${id}`)).json() : null;
      if (!(await send(tg, bot, text(rec), bill))) { await db(env, path, type === 'buy' ? { method: 'DELETE' } : { method: 'PUT', body: 'false' }); return res({ error: 'telegram failed' }, 502); }
      return res({ sent: true });
    } catch (e) { return res({ error: String(e.message || e) }, 500); }
  }
};
