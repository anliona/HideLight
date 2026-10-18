/* ═══ HireLight server — zero-dependency Node.js ═══
   Статика из ./public + REST API + JSON-файл БД (./data/db.json)
   + AI-скрининг через OpenAI-совместимый LLM API (или офлайн-фолбэк).

   Env: PORT (8780), LLM_API_KEY, LLM_BASE_URL (https://api.openai.com/v1),
        LLM_MODEL (gpt-4o-mini), PUBLIC_URL (для QR-кодов). */
'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8780;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

/* ────────── Журнал активности («следы» пользователей) ──────────
   Каждое обращение к серверу: время, IP, метод/путь, User-Agent,
   вошедший пользователь и роль. Отдельно — значимые события. */
const VISITS_FILE = path.join(DATA_DIR, 'visits.json');
let visits = [];
try { visits = JSON.parse(fs.readFileSync(VISITS_FILE, 'utf8')); } catch (e) {}

function saveVisits() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(VISITS_FILE, JSON.stringify(visits.slice(-5000)));
  } catch (e) { console.error('saveVisits error', e.message); }
}
function logVisit(req, res, pathname, user, started) {
  visits.push({
    ts: started || Date.now(),
    ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
        req.socket.remoteAddress || '',
    method: req.method,
    path: pathname,
    status: res.statusCode,
    ua: (req.headers['user-agent'] || '').slice(0, 200),
    user: user ? user.email : null,
    role: user ? user.role : null,
  });
  if (visits.length > 5000) visits = visits.slice(-5000);
  saveVisits();
}
function logEvent(type, detail, user) {
  visits.push({
    ts: Date.now(), event: type, detail: String(detail).slice(0, 160),
    user: user ? user.email : null, role: user ? user.role : null,
  });
  saveVisits();
}

/* ────────── БД (JSON-файл) ────────── */
let db = { users: {}, companies: {}, vacancies: {}, applications: {}, sessions: {}, ai: null };
try {
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  db = Object.assign(db, JSON.parse(raw));
} catch (e) { /* первый запуск */ }

let saveTimer = null;
function saveDB() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) { console.error('saveDB error', e.message); }
  }, 120);
}
function uid(p) { return p + '_' + crypto.randomBytes(8).toString('hex'); }

/* ────────── Пароли и сессии ────────── */
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return salt + ':' + hash;
}
function checkPassword(password, stored) {
  try {
    const [salt] = stored.split(':');
    return crypto.timingSafeEqual(
      Buffer.from(hashPassword(password, salt)),
      Buffer.from(stored)
    );
  } catch (e) { return false; }
}
function newSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = { userId, created: Date.now() };
  // чистка сессий старше 30 дней
  const cutoff = Date.now() - 30 * 86400000;
  for (const t of Object.keys(db.sessions)) {
    if (db.sessions[t].created < cutoff) delete db.sessions[t];
  }
  saveDB();
  return token;
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function getUser(req) {
  const token = parseCookies(req).hl_session;
  if (!token || !db.sessions[token]) return null;
  return db.users[db.sessions[token].userId] || null;
}

/* ────────── Ответы ────────── */
function json(res, status, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }, extraHeaders || {}));
  res.end(body);
}
function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie',
    'hl_session=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + 30 * 86400000);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'hl_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [], size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 1e6) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

/* ────────── AI: OpenAI-совместимый LLM ────────── */
function aiConfig() {
  if (db.ai && db.ai.key) return db.ai;
  if (process.env.LLM_API_KEY) {
    return { base: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
             model: process.env.LLM_MODEL || 'gpt-4o-mini', key: process.env.LLM_API_KEY };
  }
  return null;
}
function aiEnabled() { return !!(aiConfig() && aiConfig().key); }

function callLLM(messages, maxTokens) {
  return new Promise((resolve, reject) => {
    const cfg = aiConfig();
    const base = new URL(cfg.base);
    const payload = JSON.stringify({
      model: cfg.model,
      messages,
      temperature: 0.2,
      max_tokens: maxTokens || 900,
    });
    const req = https.request({
      hostname: base.hostname,
      port: base.port || 443,
      path: base.pathname.replace(/\/$/, '') + '/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.key,
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 45000,
    }, res => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (res.statusCode !== 200) return reject(new Error('LLM ' + res.statusCode + ': ' + (body.error && body.error.message || '')));
          resolve(body.choices[0].message.content);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('LLM timeout')); });
    req.write(payload);
    req.end();
  });
}

/* AI-скрининг одной заявки. Язык результатов — vacancy.lang. */
async function aiScreen(vacancy, company, application) {
  const langName = { ru: 'русском', zh: 'китайском', en: 'English' }[vacancy.lang] || 'русском';
  const sys = 'You are a precise hiring screener for small businesses. ' +
    'Answer ONLY with a valid JSON object, no markdown, no extra text.';
  const user =
    'VACANCY: ' + vacancy.title + ' at ' + (company.name || '') + ' (' + vacancy.district + ')' +
    (vacancy.salaryFrom ? ', salary from ' + vacancy.salaryFrom : '') + '\n' +
    'SCREENING RULES (owner-defined, one per line):\n' +
    vacancy.rules.map((r, i) => (i + 1) + '. ' + r).join('\n') + '\n' +
    (vacancy.reqLang && vacancy.reqLang !== 'any'
      ? 'REQUIRED LANGUAGE: the applicant must speak ' + vacancy.reqLang + '. Applicant declared languages: ' + (application.langs || []).join(', ') + '\n'
      : '') +
    'APPLICANT PROFILE (JSON):\n' +
    JSON.stringify({ name: application.name, yearsExperience: application.years,
      district: application.district, expectedSalary: application.salary,
      languages: application.langs, about: application.about }) + '\n\n' +
    'TASKS:\n' +
    '1. detectedLang: language code ("ru"|"zh"|"en") of the about text.\n' +
    '2. aboutTranslated: translate the about text into ' + langName + ' (keep meaning, fix nothing else).\n' +
    '3. languageOk: true/false against REQUIRED LANGUAGE (if any).\n' +
    '4. For EVERY screening rule return a verdict with a short reason in ' + langName + '.\n' +
    'Use only facts from the profile; if a rule cannot be verified, pass=false and say what is missing.\n' +
    'RESPOND with JSON only: {"detectedLang":"ru","aboutTranslated":"...","languageOk":true,' +
    '"languageReason":"...","verdicts":[{"rule":"...","pass":true,"reason":"..."}]}';

  const raw = await callLLM([
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ], 1200);

  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON in LLM reply');
  const parsed = JSON.parse(m[0]);
  const reasons = [];
  if (vacancy.reqLang && vacancy.reqLang !== 'any') {
    reasons.push({ s: parsed.languageOk ? 'ok' : 'bad', text: parsed.languageReason || 'language' });
  }
  (parsed.verdicts || []).forEach(v => {
    reasons.push({ s: v.pass ? 'ok' : 'bad', text: v.rule + ' — ' + v.reason });
  });
  const okN = reasons.filter(r => r.s === 'ok').length;
  const badN = reasons.filter(r => r.s === 'bad').length;
  const score = (okN + badN) ? Math.round(okN / (okN + badN) * 100) : 50;
  const level = score >= 75 ? 'green' : score >= 50 ? 'amber' : 'red';
  return {
    engine: 'ai',
    score, level,
    reasons,
    aboutTranslated: parsed.aboutTranslated || null,
    detectedLang: parsed.detectedLang || null,
    autoDeclined: level === 'red' && (okN + badN) >= 2,
  };
}

/* ────────── Офлайн-фолбэк: детерминированный движок правил ────────── */
const REASONS_T = {
  ru: {
    yearsOk: y => 'опыт ' + pluralRu(y) + ' — соответствует', yearsLow: (y, m) => 'опыт ' + pluralRu(y) + ' — меньше требуемого (от ' + m + ')',
    found: r => 'в анкете отмечено: «' + r + '»', missing: r => 'в анкете не найдено подтверждение: «' + r + '»',
    langOk: l => 'владеет языком: ' + l, langBad: l => 'не владеет требуемым языком',
    yearsWord: n => { const a = n % 10, b = n % 100;
      if (a === 1 && b !== 11) return n + ' год';
      if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return n + ' года';
      return n + ' лет'; },
  },
  zh: {
    yearsOk: y => '经验 ' + y + ' 年——符合', yearsLow: (y, m) => '经验 ' + y + ' 年——不足（至少 ' + m + ' 年）',
    found: r => '申请中已确认："' + r + '"', missing: r => '申请中未找到佐证："' + r + '"',
    langOk: l => '会要求的语言：' + l, langBad: l => '不会要求的语言',
    yearsWord: n => n + ' 年',
  },
  en: {
    yearsOk: y => y + (y === 1 ? ' year' : ' years') + ' of experience — matches', yearsLow: (y, m) => y + ' yrs — less than required (from ' + m + ')',
    found: r => 'confirmed in the application: "' + r + '"', missing: r => 'no confirmation found: "' + r + '"',
    langOk: l => 'knows the required language: ' + l, langBad: l => 'does not speak the required language',
    yearsWord: n => n + (n === 1 ? ' year' : ' years'),
  },
};
function pluralRu(n) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return n + ' год';
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return n + ' года';
  return n + ' лет';
}
const LANG_NAMES = { ru: { ru: 'Русский', zh: 'Китайский', en: 'Английский' },
                     zh: { ru: '俄语', zh: '中文', en: '英语' },
                     en: { ru: 'Russian', zh: 'Chinese', en: 'English' } };
const STOP = new Set(['можно', 'нужно', 'чтобы', 'только', 'обязательно', 'желательно', 'готовы', 'готов',
  'живёте', 'живете', 'работать', 'наличие', 'есть', 'будет', 'если', 'или', 'для']);
function tokens(t) {
  return String(t || '').toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/).filter(Boolean);
}
function kwMatch(kw, hay) {
  kw = kw.replace(/ё/g, 'е');
  if (kw.length < 4) return false;
  const kp = kw.slice(0, 5);
  return hay.some(t => t === kw || (t.length >= 5 && kw.length >= 5 && t.slice(0, 5) === kp) || (t.length < 5 && kw.length < 5 && t === kw));
}
function fallbackScreen(vacancy, company, application) {
  const T = REASONS_T[vacancy.lang] || REASONS_T.ru;
  const reasons = [];
  let ok = 0, bad = 0;
  if (vacancy.reqLang && vacancy.reqLang !== 'any') {
    const knows = (application.langs || []).includes(vacancy.reqLang);
    const lname = (LANG_NAMES[vacancy.lang] || {})[vacancy.reqLang] || vacancy.reqLang;
    reasons.push({ s: knows ? 'ok' : 'bad', text: knows ? T.langOk(lname) : T.langBad(lname) });
    knows ? ok++ : bad++;
  }
  const hay = tokens(application.about + ' ' + application.district);
  (vacancy.rules || []).forEach(rule => {
    const rl = String(rule).toLowerCase().replace(/ё/g, 'е');
    let m = rl.match(/от\s+(\d+)\s*(лет|года|год)/);
    if (m) {
      const min = +m[1], y = application.years || 0;
      if (y >= min) { reasons.push({ s: 'ok', text: T.yearsOk(y) }); ok++; }
      else { reasons.push({ s: 'bad', text: T.yearsLow(y, min) }); bad++; }
      return;
    }
    m = rl.match(/до\s+(\d+)\s*(лет|года|год)/);
    if (m) {
      const max = +m[1], y = application.years || 0;
      if (y <= max) { reasons.push({ s: 'ok', text: T.yearsOk(y) }); ok++; }
      else { reasons.push({ s: 'bad', text: T.yearsWord(y) + ' > ' + max }); bad++; }
      return;
    }
    const kws = tokens(rule).filter(w => w.length >= 4 && !STOP.has(w));
    if (!kws.length) { reasons.push({ s: 'neutral', text: rule }); return; }
    const hit = kws.some(kw => kwMatch(kw, hay));
    if (hit) { reasons.push({ s: 'ok', text: T.found(rule) }); ok++; }
    else { reasons.push({ s: 'bad', text: T.missing(rule) }); bad++; }
  });
  const score = (ok + bad) ? Math.round(ok / (ok + bad) * 100) : 50;
  const level = score >= 75 ? 'green' : score >= 50 ? 'amber' : 'red';
  return { engine: 'rules', score, level, reasons,
           aboutTranslated: null,
           detectedLang: null,
           autoDeclined: level === 'red' && (ok + bad) >= 2 };
}

/* ────────── Публичные проекции ────────── */
function publicVacancy(v, c) {
  return {
    id: v.id, title: v.title, company: (c && c.name) || '', companyDesc: (c && c.desc) || '',
    district: v.district, salaryFrom: v.salaryFrom || null, schedule: v.schedule || '',
    description: v.description || '', reqLang: v.reqLang || 'any', lang: v.lang || 'ru',
    createdAt: v.createdAt,
  };
}

/* ────────── Трекинг: тепловая карта ────────── */
if (!Array.isArray(db.events)) db.events = [];
const EVENTS_CAP = 20000;

/* ────────── API-роутер ────────── */
async function handleApi(req, res, pathname) {
  const method = req.method;
  const me = getUser(req);
  const send = (status, obj, hdr) => json(res, status, obj, hdr);

  /* публичные */
  if (method === 'POST' && pathname === '/api/track') {
    const b = await readBody(req);
    const events = Array.isArray(b.events) ? b.events.slice(0, 50) : [];
    for (const ev of events) {
      if (!ev || typeof ev !== 'object' || !ev.type) continue;
      db.events.push({
        type: String(ev.type).slice(0, 10),               // pv | click | scroll
        path: String(ev.path || '/').slice(0, 120),
        x: Math.round(+ev.x || 0),                        // % ширины, 0–100
        y: Math.round(+ev.y || 0),                        // документные px
        vw: Math.round(+ev.vw || 0), vh: Math.round(+ev.vh || 0),
        label: String(ev.label || '').slice(0, 60),
        sid: String(ev.sid || '').slice(0, 24),
        ts: Date.now(),
      });
    }
    while (db.events.length > EVENTS_CAP) db.events.shift();
    if (events.length) saveDB();
    return send(200, { ok: true });
  }
  if (method === 'GET' && pathname === '/api/heat/paths') {
    if (!me) return send(401, { error: 'auth' });
    const byPath = {};
    for (const ev of db.events) {
      if (!byPath[ev.path]) byPath[ev.path] = { path: ev.path, pv: 0, clicks: 0, sessions: new Set() };
      if (ev.type === 'pv') byPath[ev.path].pv++;
      if (ev.type === 'click') byPath[ev.path].clicks++;
      byPath[ev.path].sessions.add(ev.sid);
    }
    const list = Object.values(byPath).map(p => ({
      path: p.path, pv: p.pv, clicks: p.clicks, sessions: p.sessions.size,
    })).sort((a, b) => b.clicks - a.clicks);
    return send(200, { paths: list });
  }
  if (method === 'GET' && pathname === '/api/heat') {
    if (!me) return send(401, { error: 'auth' });
    const q = url.parse(req.url, true).query;
    const pathFilter = q.path;
    let events = db.events;
    if (pathFilter) events = events.filter(e => e.path === pathFilter);
    return send(200, {
      events: events.slice(-4000).map(e => ({
        type: e.type, x: e.x, y: e.y, vw: e.vw, label: e.label, sid: e.sid, ts: e.ts,
      })),
      total: events.length,
    });
  }

  if (method === 'GET' && pathname === '/api/config') {
    let proto = 'http', host = req.headers.host || ('127.0.0.1:' + PORT);
    const xf = req.headers['x-forwarded-proto'];
    if (xf) proto = String(xf).split(',')[0];
    return send(200, { base: (process.env.PUBLIC_URL || (proto + '://' + host)).replace(/\/$/, ''), ai: aiEnabled() });
  }
  if (method === 'POST' && pathname === '/api/register') {
    const b = await readBody(req);
    const email = String(b.email || '').trim().toLowerCase();
    const role = b.role === 'employer' ? 'employer' : 'seeker';
    if (!email || !b.password || String(b.password).length < 6 || !b.name) {
      return send(400, { error: 'fields' });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(400, { error: 'email' });
    const id = email; // email = ключ
    if (db.users[id]) return send(409, { error: 'exists' });
    db.users[id] = {
      id, email, role, name: String(b.name).trim().slice(0, 80),
      pass: hashPassword(b.password), createdAt: Date.now(),
    };
    if (role === 'employer') {
      db.companies[id] = { ownerId: id, name: String(b.name).trim().slice(0, 80), desc: '', city: '' };
    }
    const token = newSession(id);
    setSessionCookie(res, token);
    logEvent('register', role + ' ' + id, db.users[id]);
    return send(200, { me: { email: id, role, name: db.users[id].name } });
  }
  if (method === 'POST' && pathname === '/api/login') {
    const b = await readBody(req);
    const email = String(b.email || '').trim().toLowerCase();
    const u = db.users[email];
    if (!u || !checkPassword(b.password, u.pass)) return send(401, { error: 'creds' });
    const token = newSession(u.id);
    setSessionCookie(res, token);
    logEvent('login', u.role + ' ' + u.id, u);
    return send(200, { me: { email: u.email, role: u.role, name: u.name } });
  }
  if (method === 'POST' && pathname === '/api/logout') {
    const token = parseCookies(req).hl_session;
    if (token) { delete db.sessions[token]; saveDB(); }
    clearSessionCookie(res);
    return send(200, {});
  }
  if (method === 'GET' && pathname === '/api/me') {
    if (!me) return send(200, { me: null });
    return send(200, { me: { email: me.email, role: me.role, name: me.name } });
  }
  if (method === 'GET' && pathname === '/api/vacancies') {
    const list = Object.values(db.vacancies).map(v => publicVacancy(v, db.companies[v.ownerId]))
      .sort((a, b) => b.createdAt - a.createdAt);
    return send(200, { vacancies: list });
  }
  if (method === 'GET' && /^\/api\/vacancies\/[\w-]+$/.test(pathname)) {
    const id = pathname.split('/').pop();
    const v = db.vacancies[id];
    if (!v) return send(404, { error: 'notfound' });
    return send(200, { vacancy: publicVacancy(v, db.companies[v.ownerId]) });
  }

  /* работодатель */
  if (me && me.role === 'employer') {
    if (method === 'GET' && pathname === '/api/company') {
      return send(200, { company: db.companies[me.id] || null, ai: aiEnabled(), aiModel: aiConfig() ? aiConfig().model : null });
    }
    if (method === 'POST' && pathname === '/api/company') {
      const b = await readBody(req);
      db.companies[me.id] = {
        ownerId: me.id,
        name: String(b.name || me.name).slice(0, 100),
        desc: String(b.desc || '').slice(0, 1000),
        city: String(b.city || '').slice(0, 80),
      };
      saveDB();
      return send(200, { company: db.companies[me.id] });
    }
    if (method === 'POST' && pathname === '/api/ai') {
      const b = await readBody(req);
      if (b.disable) { db.ai = null; saveDB(); return send(200, { ai: false }); }
      if (!b.key || !b.base) return send(400, { error: 'fields' });
      db.ai = { base: String(b.base).replace(/\/$/, ''), model: String(b.model || 'gpt-4o-mini'), key: String(b.key) };
      logEvent('ai_connected', db.ai.model + ' @ ' + db.ai.base, me);
      saveDB();
      return send(200, { ai: true, model: db.ai.model });
    }
    if (method === 'GET' && pathname === '/api/my/vacancies') {
      const list = Object.values(db.vacancies).filter(v => v.ownerId === me.id)
        .sort((a, b) => b.createdAt - a.createdAt);
      return send(200, { vacancies: list });
    }
    if (method === 'POST' && pathname === '/api/vacancies') {
      const b = await readBody(req);
      const rules = (Array.isArray(b.rules) ? b.rules : String(b.rules || '').split('\n'))
        .map(s => String(s).trim()).filter(Boolean).slice(0, 12);
      if (!b.title || !b.district || !rules.length) return send(400, { error: 'fields' });
      const v = {
        id: uid('vac'), ownerId: me.id,
        title: String(b.title).slice(0, 100),
        district: String(b.district).slice(0, 100),
        salaryFrom: parseInt(b.salaryFrom, 10) || null,
        schedule: String(b.schedule || '').slice(0, 80),
        description: String(b.description || '').slice(0, 2000),
        reqLang: ['any', 'ru', 'zh', 'en'].includes(b.reqLang) ? b.reqLang : 'any',
        lang: ['ru', 'zh', 'en'].includes(b.lang) ? b.lang : 'ru',
        rules, createdAt: Date.now(),
      };
      db.vacancies[v.id] = v;
      saveDB();
      logEvent('vacancy_created', v.title + ' (' + v.district + ')', me);
      return send(200, { vacancy: v });
    }
    if (method === 'DELETE' && /^\/api\/vacancies\/[\w-]+$/.test(pathname)) {
      const id = pathname.split('/').pop();
      const v = db.vacancies[id];
      if (!v || v.ownerId !== me.id) return send(404, { error: 'notfound' });
      delete db.vacancies[id];
      for (const k of Object.keys(db.applications)) {
        if (db.applications[k].vacancyId === id) delete db.applications[k];
      }
      saveDB();
      return send(200, {});
    }
    if (method === 'GET' && /^\/api\/vacancies\/[\w-]+\/applicants$/.test(pathname)) {
      const id = pathname.split('/')[3];
      const v = db.vacancies[id];
      if (!v || v.ownerId !== me.id) return send(404, { error: 'notfound' });
      const list = Object.values(db.applications).filter(a => a.vacancyId === id)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(a => ({
          id: a.id, name: a.name, phone: a.phone, years: a.years, district: a.district,
          salary: a.salary, about: a.about, langs: a.langs, appLang: a.appLang,
          aboutTranslated: a.screening && a.screening.aboutTranslated,
          status: a.status, createdAt: a.createdAt,
          screening: { score: a.screening.score, level: a.screening.level,
                       reasons: a.screening.reasons, autoDeclined: a.screening.autoDeclined,
                       engine: a.screening.engine },
        }));
      return send(200, { applicants: list });
    }
    if (method === 'POST' && /^\/api\/applications\/[\w-]+\/decision$/.test(pathname)) {
      const id = pathname.split('/')[3];
      const a = db.applications[id];
      if (!a) return send(404, { error: 'notfound' });
      const v = db.vacancies[a.vacancyId];
      if (!v || v.ownerId !== me.id) return send(403, { error: 'forbidden' });
      const b = await readBody(req);
      a.status = b.decision === 'invite' ? 'invited' : 'declined';
      a.decidedAt = Date.now();
      logEvent('decision', a.status + ': ' + a.name, me);
      saveDB();
      return send(200, { status: a.status });
    }
  }

  /* соискатель + владелец заявки */
  if (me && me.role === 'seeker') {
    if (method === 'GET' && pathname === '/api/my/applications') {
      const list = Object.values(db.applications).filter(a => a.seekerId === me.id)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(a => {
          const v = db.vacancies[a.vacancyId];
          return {
            id: a.id, status: a.status, createdAt: a.createdAt,
            vacancy: v ? { id: v.id, title: v.title, company: (db.companies[v.ownerId] || {}).name || '', district: v.district } : null,
            screening: { score: a.screening.score, level: a.screening.level,
                         reasons: a.screening.reasons, engine: a.screening.engine },
          };
        });
      return send(200, { applications: list });
    }
  }
  if (me && method === 'POST' && pathname === '/api/applications') {
    if (me.role !== 'seeker') return send(403, { error: 'role' });
    const b = await readBody(req);
    const v = db.vacancies[b.vacancyId];
    if (!v) return send(404, { error: 'notfound' });
    // одна заявка на вакансию
    const dup = Object.values(db.applications).find(a => a.vacancyId === v.id && a.seekerId === me.id);
    if (dup) return send(409, { error: 'duplicate', applicationId: dup.id });
    const langs = (Array.isArray(b.langs) ? b.langs : []).filter(l => ['ru', 'zh', 'en'].includes(l));
    if (!b.name || !b.about || !b.phone || !langs.length) return send(400, { error: 'fields' });
    const application = {
      id: uid('app'), vacancyId: v.id, seekerId: me.id,
      name: String(b.name).slice(0, 80), phone: String(b.phone).slice(0, 40),
      years: parseInt(b.years, 10) || 0, district: String(b.district || '').slice(0, 100),
      salary: parseInt(b.salary, 10) || null,
      about: String(b.about).slice(0, 4000),
      langs, createdAt: Date.now(),
      status: 'new', screening: null,
    };
    // AI-скрининг (или фолбэк)
    try {
      if (aiEnabled()) application.screening = await aiScreen(v, db.companies[v.ownerId], application);
      else application.screening = fallbackScreen(v, db.companies[v.ownerId], application);
    } catch (e) {
      console.error('AI error, fallback:', e.message);
      application.screening = fallbackScreen(v, db.companies[v.ownerId], application);
      application.screening.aiError = e.message;
    }
      application.status = application.screening.autoDeclined ? 'declined' : 'new';
      db.applications[application.id] = application;
      saveDB();
      logEvent('application', v.title + ' ← ' + application.name + ' [' + application.screening.level + ']', me);
    return send(200, {
      applicationId: application.id,
      status: application.status,
      screening: { score: application.screening.score, level: application.screening.level,
                   aboutTranslated: application.screening.aboutTranslated },
    });
  }
  if (me && method === 'GET' && /^\/api\/applications\/[\w-]+$/.test(pathname)) {
    const a = db.applications[pathname.split('/').pop()];
    if (!a) return send(404, { error: 'notfound' });
    const v = db.vacancies[a.vacancyId];
    const isOwner = v && v.ownerId === me.id;
    if (a.seekerId !== me.id && !isOwner) return send(403, { error: 'forbidden' });
    return send(200, { application: { id: a.id, status: a.status, screening: a.screening } });
  }

  return send(404, { error: 'no route' });
}

/* ────────── Статика ────────── */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
function serveStatic(req, res, pathname) {
  let p = decodeURIComponent(pathname);
  if (p === '/' || p === '') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA: неизвестные пути → index.html
      fs.readFile(path.join(PUBLIC, 'index.html'), (e2, index) => {
        if (e2) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(index);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ────────── HTTP-сервер ────────── */
const server = http.createServer(async (req, res) => {
  const pathname = decodeURIComponent(url.parse(req.url).pathname);
  const started = Date.now();
  res.on('finish', () => {
    try { logVisit(req, res, pathname, getUser(req), started); } catch (e) {}
  });
  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
      return;
    }
    serveStatic(req, res, pathname);
  } catch (e) {
    console.error('ERR', e);
    if (!res.headersSent) json(res, 500, { error: 'internal', message: e.message });
  }
});

server.listen(PORT, () => {
  console.log('HireLight server: http://127.0.0.1:' + PORT);
  console.log('AI:', aiEnabled() ? 'ON (' + aiConfig().model + ')' : 'OFF (rules fallback)');
});
