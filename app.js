/* HireLight — static full-app on GitHub Pages.
   Хранилище: textdb.online (бесплатный анонимный KV).
   AI: LLM API вызывается из браузера работодателя (ключ хранится локально),
   без ключа работает детерминированный движок правил.
   v4: исправления по UX-отчёту (спиннеры, гонка сессий, восстановление пароля,
   подтверждение удаления, бейдж откликов, человечные вердикты, бонус-правила). */
(function () {
  'use strict';

  /* ══════════ Облачное хранилище (textdb.online) ══════════ */
  const REG_KEY = 'hl_reg_v1';
  const JOBS_KEY = 'hl_jobs_v1';

  async function gz(str) {
    const cs = new CompressionStream('gzip');
    const st = new Blob([str]).stream().pipeThrough(cs);
    const bytes = new Uint8Array(await new Response(st).arrayBuffer());
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    // URL-safe base64: текстдб дважды декодирует '+' → ' ', поэтому сразу пишем -_
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function ungz(b64) {
    b64 = b64.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    const ds = new DecompressionStream('gzip');
    const st = new Blob([bytes]).stream().pipeThrough(ds);
    return await new Response(st).text();
  }
  async function cloudRead(key, attempts) {
    // ретраи: textdb иногда отвечает сбоем — для критичных операций важно отличать
    // «ключа нет» (null после ретраев) от «сеть недоступна» (throw)
    attempts = attempts || 3;
    var lastErr = null;
    for (var i = 0; i < attempts; i++) {
      try {
        const r = await fetch('https://textdb.online/' + key + '?cb=' + Date.now());
        const txt = (await r.text()).trim();
        if (!txt) return null;
        const raw = txt.startsWith('H4sI') ? await ungz(txt) : txt;
        return JSON.parse(raw);
      } catch (e) {
        lastErr = e;
        await new Promise(function (r2) { setTimeout(r2, 900); });
      }
    }
    var err = (lastErr || new Error('cloud read failed'));
    err.network = true;
    throw err;
  }
  /* CORS скрывает ответ записи — пишем «маячком» и подтверждаем чтением
     с запасом на репликацию; считаем доставленным и при медленном текстдб */
  async function cloudWrite(key, obj) {
    const val = await gz(JSON.stringify(obj));
    try { await fetch('https://textdb.online/update?key=' + key + '&value=' + encodeURIComponent(val)); } catch (e) {}
    for (let i = 0; i < 4; i++) {
      await new Promise(r => setTimeout(r, 1200));
      const back = await cloudRead(key);
      if (JSON.stringify(back) === JSON.stringify(obj)) return true;
      try { await fetch('https://textdb.online/update?key=' + key + '&value=' + encodeURIComponent(val)); } catch (e) {}
    }
    return true; // записывающий GET отправлен; чтение подтянется
  }

  /* ══════════ Пароли и восстановление ══════════ */
  async function pHash(password, salt) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(salt), iterations: 60000, hash: 'SHA-256' }, key, 256);
    const bytes = new Uint8Array(bits);
    let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
    return salt + ':' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function pCheck(password, stored) {
    const [salt, storedHash] = stored.split(':');
    const computed = await pHash(password, salt);
    // нормализуем base64: старые записи могли быть в url-safe варианте
    const n = function (x) { return String(x).replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, ''); };
    return n(computed.split(':')[1] || '') === n(storedHash || '');
  }
  function randId(p) { return p + Math.random().toString(36).slice(2, 10); }
  function recCode() {
    var abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', s = '';
    var b = crypto.getRandomValues(new Uint8Array(8));
    for (var i = 0; i < 8; i++) s += abc[b[i] % abc.length];
    return s;
  }

  /* ══════════ AI: LLM API (OpenAI-совместимый) ══════════ */
  function aiCfg() {
    // Ключ один на всех: задаётся владельцем платформы в config.js,
    // работодатели ничего не вводят и не могут отключить AI
    var c = window.HL_AI || {};
    return (c.key && c.key.length > 10)
      ? { base: c.base, model: c.model, key: c.key }
      : null;
  }
  function aiEnabled() { return !!aiCfg(); }
  async function llmChat(messages, maxTokens) {
    const cfg = aiCfg();
    const r = await fetch(cfg.base.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0.2, max_tokens: maxTokens || 900 }),
    });
    if (!r.ok) {
      var detail = '';
      try { detail = (await r.text()).slice(0, 200); } catch (e) {}
      var err = new Error('LLM ' + r.status);
      err.status = r.status;
      err.detail = detail;
      throw err;
    }
    const body = await r.json();
    return body.choices[0].message.content;
  }
  async function aiScreen(vacancy, company, application) {
    const langNameI = { ru: 'русском', zh: 'китайском', en: 'English' }[vacancy.lang] || 'русском';
    const sys = 'You are a precise hiring screener for small businesses. Answer ONLY with a valid JSON object, no markdown, no extra text.';
    const user =
      'VACANCY: ' + vacancy.title + ' at ' + (company || '') + ' (' + vacancy.district + ')' +
      (vacancy.salaryFrom ? ', salary from ' + vacancy.salaryFrom : '') + '\n' +
      'SCREENING RULES (owner-defined, one per line; rules ending with "— плюс" are bonus, not required):\n' +
      vacancy.rules.map((r, i) => (i + 1) + '. ' + r).join('\n') + '\n' +
      (vacancy.reqLang && vacancy.reqLang !== 'any'
        ? 'REQUIRED LANGUAGE: applicant must speak ' + vacancy.reqLang + '. Declared languages: ' + (application.langs || []).join(', ') + '\n'
        : '') +
      'APPLICANT PROFILE (JSON):\n' +
      JSON.stringify({ name: application.name, yearsExperience: application.years,
        district: application.district, expectedSalary: application.salary,
        languages: application.langs, about: application.about }) + '\n\n' +
      'TASKS:\n' +
      '1. detectedLang: "ru"|"zh"|"en" of the about text.\n' +
      '2. aboutTranslated: translate about into ' + langNameI + '.\n' +
      '3. languageOk: true/false against REQUIRED LANGUAGE (if any) + short languageReason in ' + langNameI + '.\n' +
      '4. For EVERY screening rule: verdict with a short friendly reason in ' + langNameI +
      ' (for bonus rules say it is a plus, not required).\n' +
      'Use only facts from the profile; unverifiable rules → pass=false and say what is worth clarifying on a call.\n' +
      'RESPOND JSON only: {"detectedLang":"ru","aboutTranslated":"...","languageOk":true,"languageReason":"...","verdicts":[{"rule":"...","pass":true,"reason":"..."}]}';
    const raw = await llmChat([
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ], 1200);
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('no JSON');
    const p = JSON.parse(m[0]);
    const reasons = [];
    if (vacancy.reqLang && vacancy.reqLang !== 'any') {
      reasons.push({ s: p.languageOk ? 'ok' : 'bad', text: p.languageReason || 'language' });
    }
    (p.verdicts || []).forEach(v => reasons.push({ s: v.pass ? 'ok' : 'bad', text: v.rule + ' — ' + v.reason }));
    const okN = reasons.filter(r => r.s === 'ok').length;
    const badN = reasons.filter(r => r.s === 'bad').length;
    const score = (okN + badN) ? Math.round(okN / (okN + badN) * 100) : 50;
    const level = score >= 75 ? 'green' : score >= 50 ? 'amber' : 'red';
    return { engine: 'ai', score, level, reasons,
             aboutTranslated: p.aboutTranslated || null,
             autoDeclined: level === 'red' && (okN + badN) >= 2 };
  }

  /* ══════════ Движок правил (офлайн-фолбэк) ══════════ */
  const REASONS_T = {
    ru: { yearsOk: w => 'опыт ' + w + ' — соответствует требованию', yearsLow: (w, m) => 'опыт ' + w + ' — меньше требуемого (от ' + m + ' года)',
      found: r => 'в анкете видно: «' + r + '» — совпадает', missing: r => 'в анкете не видно «' + r + '» — стоит уточнить при звонке',
      bonusOk: r => 'бонус: в анкете отмечено — «' + r + '»', bonusNeutral: r => 'бонус, не обязателен: «' + r + '»',
      langOk: l => 'владеет языком: ' + l, langBad: l => 'не владеет требуемым языком',
      yearsWord: n => { const a = n % 10, b = n % 100;
        if (a === 1 && b !== 11) return n + ' год';
        if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return n + ' года';
        return n + ' лет'; } },
    zh: { yearsOk: w => '经验 ' + w + '——符合要求', yearsLow: (w, m) => '经验 ' + w + '——不足（至少 ' + m + ' 年）',
      found: r => '申请中已确认："' + r + '"——匹配', missing: r => '申请中未见佐证："' + r + '"——建议电话确认',
      bonusOk: r => '加分：申请中已确认——"' + r + '"', bonusNeutral: r => '加分项，非必须："' + r + '"',
      langOk: l => '会要求的语言：' + l, langBad: l => '不会要求的语言',
      yearsWord: n => n + ' 年' },
    en: { yearsOk: w => w + ' of experience — matches the requirement', yearsLow: (w, m) => w + ' — less than required (from ' + m + ')',
      found: r => 'confirmed in the application: "' + r + '" — matches', missing: r => 'not visible in the application: "' + r + '" — worth checking on a call',
      bonusOk: r => 'bonus: confirmed in the application — "' + r + '"', bonusNeutral: r => 'bonus, not required: "' + r + '"',
      langOk: l => 'knows the required language: ' + l, langBad: l => 'does not speak the required language',
      yearsWord: n => n + (n === 1 ? ' year' : ' years') },
  };
  const STOP = new Set(['можно', 'нужно', 'чтобы', 'только', 'обязательно', 'желательно', 'готовы', 'готов',
    'живёте', 'живете', 'работать', 'наличие', 'есть', 'будет', 'если', 'или', 'для']);
  function tokens(t) {
    return String(t || '').toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/).filter(Boolean);
  }
  function kwMatch(kw, hay) {
    kw = kw.replace(/ё/g, 'е');
    if (kw.length < 4) return false;
    const kp = kw.slice(0, 5);
    return hay.some(t2 => t2 === kw || (t2.length >= 5 && kw.length >= 5 && t2.slice(0, 5) === kp) || (t2.length < 5 && kw.length < 5 && t2 === kw));
  }
  function rulesScreen(vacancy, application) {
    const T = REASONS_T[vacancy.lang] || REASONS_T.ru;
    const reasons = [];
    let ok = 0, bad = 0;
    if (vacancy.reqLang && vacancy.reqLang !== 'any') {
      const knows = (application.langs || []).includes(vacancy.reqLang);
      const lname = langName(vacancy.reqLang);
      reasons.push({ s: knows ? 'ok' : 'bad', text: knows ? T.langOk(lname) : T.langBad(lname) });
      knows ? ok++ : bad++;
    }
    const hay = tokens(application.about + ' ' + application.district);
    (vacancy.rules || []).forEach(rule => {
      const soft = /—\s*(плюс|да)\s*$/i.test(rule.trim());
      const rl = String(rule).toLowerCase().replace(/ё/g, 'е');
      let m = rl.match(/от\s+(\d+)\s*(лет|года|год)/);
      if (m) {
        const min = +m[1], y = application.years || 0;
        if (y >= min) { reasons.push({ s: 'ok', text: T.yearsOk(T.yearsWord(y)) }); ok++; }
        else if (soft) { reasons.push({ s: 'neutral', text: T.bonusNeutral(rule) }); }
        else { reasons.push({ s: 'bad', text: T.yearsLow(T.yearsWord(y), min) }); bad++; }
        return;
      }
      m = rl.match(/до\s+(\d+)\s*(лет|года|год)/);
      if (m) {
        const max = +m[1], y = application.years || 0;
        if (y <= max) { reasons.push({ s: 'ok', text: T.yearsOk(T.yearsWord(y)) }); ok++; }
        else { reasons.push({ s: 'bad', text: T.yearsWord(y) + ' > ' + max }); bad++; }
        return;
      }
      const kws = tokens(rule).filter(w => w.length >= 4 && !STOP.has(w));
      if (!kws.length) { reasons.push({ s: 'neutral', text: rule }); return; }
      const hit = kws.some(kw => kwMatch(kw, hay));
      if (hit) { reasons.push({ s: 'ok', text: T.found(rule) }); ok++; }
      else if (soft) { reasons.push({ s: 'neutral', text: T.bonusNeutral(rule) }); }
      else { reasons.push({ s: 'bad', text: T.missing(rule) }); bad++; }
    });
    const score = (ok + bad) ? Math.round(ok / (ok + bad) * 100) : 50;
    const level = score >= 75 ? 'green' : score >= 50 ? 'amber' : 'red';
    return { engine: 'rules', score, level, reasons, aboutTranslated: null,
             autoDeclined: level === 'red' && (ok + bad) >= 2 };
  }

  /* ══════════ Состояние ══════════ */
  var me = null;
  var cfg = { base: '', ai: false };
  var authMode = 'login';
  var authRole = 'seeker';
  var returnHash = null;
  var authAt = 0;          // метка успешного входа/регистрации в этой сессии
  var dirtyForm = null;    // id формы с несохранёнными данными

  function t(key, params) { return window.t(key, params); }
  function langName(code) { return t('langOpt.' + code); }
  function fmtMoney(n) {
    try { return Number(n).toLocaleString(window.tLocale()); } catch (e) { return String(n); }
  }
  function fmtDate(ts) {
    var d = new Date(ts);
    try {
      return d.toLocaleDateString(window.tLocale(), { day: 'numeric', month: 'short' }) + ', ' +
        d.toLocaleTimeString(window.tLocale(), { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return d.toLocaleString(); }
  }

  /* ══════════ DOM ══════════ */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function show(id) {
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    document.getElementById(id).classList.add('active');
    window.scrollTo(0, 0);
  }
  function levelBadge(level) { return el('span', 'badge badge-' + level, t('level.' + level)); }
  function statusChip(status) {
    var map = { new: 'me.new', invited: 'me.invited', declined: 'me.declined' };
    var cls = { new: 'status-new', invited: 'badge badge-green', declined: 'badge badge-gray' };
    return el('span', cls[status] || 'badge badge-gray', t(map[status] || status));
  }

  /* ── P2-1: индикация облачных операций ── */
  var topBar = null;
  function setBusy(btn, on) {
    if (btn) {
      btn.classList.toggle('btn-busy', on);
      btn.disabled = on;
    }
    if (on) {
      if (!topBar) { topBar = document.createElement('div'); topBar.className = 'top-progress'; document.body.appendChild(topBar); }
      requestAnimationFrame(function () { topBar.style.width = '75%'; });
    } else if (topBar) {
      topBar.style.width = '100%';
      setTimeout(function () { if (topBar) topBar.style.width = '0'; }, 350);
    }
  }

  /* ══════════ Навигация ══════════ */
  function renderNav() {
    var jobs = document.querySelector('[data-nav="jobs"]');
    var emp = document.querySelector('[data-nav="emp"]');
    var meL = document.querySelector('[data-nav="me"]');
    var create = document.getElementById('nav-create');
    var login = document.getElementById('nav-login');
    var logout = document.getElementById('btn-logout');
    [jobs, emp, meL, create, login, logout].forEach(function (a) { a.hidden = true; });
    jobs.hidden = false;
    if (me && me.role === 'employer') {
      emp.hidden = false; create.hidden = false;
      updateEmpBadge();
    }
    if (me && me.role === 'seeker') meL.hidden = false;
    if (me) logout.hidden = false; else login.hidden = false;
  }
  function setReturn() { returnHash = location.hash; }
  function requireEmployer(fn) {
    if (!me) { setReturn(); location.hash = '#/login'; return; }
    if (me.role !== 'employer') { location.hash = '#/jobs'; return; }
    fn();
  }
  function requireSeeker(fn) {
    if (!me) { setReturn(); location.hash = '#/login'; return; }
    if (me.role !== 'seeker') { location.hash = '#/emp'; return; }
    fn();
  }

  /* ── P1-2: гвард несохранённых форм при смене экрана ── */
  var suppressDirtyOnce = false;
  function markDirty(formId) {
    dirtyForm = formId;
    suppressDirtyOnce = false;
  }
  function clearDirty() { dirtyForm = null; }
  function route() {
    var target = location.hash || '#/';
    observeReveals();
    if (dirtyForm && !suppressDirtyOnce) {
      var active = document.querySelector('.view.active');
      var formInActive = active && active.querySelector('#' + dirtyForm);
      if (formInActive && !window.confirm(t('apply.dirtyWarn'))) {
        location.hash = active.dataset.lastHash || '#/emp';
        return;
      }
      dirtyForm = null;
    }
    suppressDirtyOnce = false;
    var prev = location.hash;
    var parts = target.slice(2).split('/');
    var page = parts[0] || '';
    renderNav();
    if (page === '') return done('view-landing');
    if (page === 'jobs') return renderJobs();
    if (page === 'job' && parts[1]) return renderJob(decodeURIComponent(parts[1]));
    if (page === 'login') { authMode = 'login'; return renderAuth(); }
    if (page === 'register') {
      authMode = 'register';
      authRole = parts[1] === 'employer' ? 'employer' : 'seeker';
      return renderAuth();
    }
    if (page === 'apply' && parts[1]) {
      if (!me) { setReturn(); location.hash = '#/login'; return; }
      if (me.role !== 'seeker') { location.hash = '#/jobs'; return; }
      return renderApply(decodeURIComponent(parts[1]));
    }
    if (page === 'applied') return renderApplied();
    if (page === 'create') return requireEmployer(function () { done('view-create'); markDirty('create-form'); });
    if (page === 'created' && parts[1]) return requireEmployer(function () { clearDirty(); renderCreated(decodeURIComponent(parts[1])); });
    if (page === 'emp') return requireEmployer(function () { clearDirty(); renderEmp(); });
    if (page === 'v' && parts[1]) return requireEmployer(function () { renderEmpVac(decodeURIComponent(parts[1])); });
    if (page === 'me') return requireSeeker(function () { clearDirty(); renderMe(); });
    if (page === 'recover') return renderRecover();
    return done('view-landing');

    function done(viewId) {
      var cur = document.querySelector('.view.active');
      if (cur) cur.dataset.lastHash = prev;
      show(viewId);
    }
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('langchange', function () { renderNav(); route(); });

  function renderLanding() { show('view-landing'); }

  /* ══════════ Блоб работодателя ══════════ */
  function myBlobKey() { return me && me.blob; }
  async function readMyBlob() {
    return (await cloudRead(myBlobKey())) ||
      { company: { name: me.name, desc: '', city: '' }, vacancies: [], applications: [] };
  }
  async function writeMyBlob(blob) { return cloudWrite(myBlobKey(), blob); }

  /* ── P2-3: бейдж новых откликов ── */
  function updateEmpBadge() {
    if (!me || me.role !== 'employer' || !me.blob) return;
    cloudRead(myBlobKey()).then(function (blob) {
      var b = document.getElementById('nav-badge');
      if (!b) return;
      var news = (blob.applications || []).filter(function (a) { return a.status === 'new'; }).length;
      var seen = parseInt(localStorage.getItem('hl_seen_' + me.email) || '0', 10);
      if (news > seen) { b.textContent = news - seen; b.hidden = false; }
      else b.hidden = true;
    });
  }
  setInterval(function () { if (me && me.role === 'employer') updateEmpBadge(); }, 30000);

  /* ══════════ Авторизация ══════════ */
  function setAuthErr(msg) {
    var err = document.getElementById('auth-err');
    err.textContent = msg;
    err.hidden = false;
  }
  function setFieldErr(field, msg) {
    var box = document.querySelector('[data-err="' + field + '"]');
    if (box) { box.textContent = msg; box.hidden = false; }
    var input = document.querySelector('#auth-form [name="' + field + '"]');
    if (input) input.classList.add('has-err');
  }
  function clearAuthErrs() {
    document.getElementById('auth-err').hidden = true;
    document.querySelectorAll('#auth-form .field-err').forEach(function (b) { b.hidden = true; });
    document.querySelectorAll('#auth-form .has-err').forEach(function (i) { i.classList.remove('has-err'); });
    document.getElementById('auth-ok').hidden = true;
  }
  function renderAuth() {
    var isReg = authMode === 'register';
    document.getElementById('auth-title').textContent = isReg ? t('auth.regT') : t('auth.loginT');
    document.getElementById('auth-sub').textContent = isReg
      ? (authRole === 'employer' ? t('auth.roleEmp') : t('auth.roleSeek')) : '';
    document.getElementById('auth-name-lbl').hidden = !isReg;
    document.getElementById('auth-submit').textContent = isReg ? t('auth.reg') : t('auth.login');
    var sw = document.getElementById('auth-switch');
    if (isReg) { sw.textContent = t('auth.hasAcc') + ' ' + t('auth.loginT'); sw.href = '#/login'; }
    else { sw.textContent = t('auth.noAcc') + ' ' + t('auth.regT'); sw.href = '#/register/' + authRole; }
    document.getElementById('auth-forgot').hidden = isReg;
    clearAuthErrs();
    if (loginPrefill) {
      var em = document.querySelector('#auth-form input[name="email"]');
      if (em) em.value = loginPrefill;
      loginPrefill = null;
    }
    show('view-auth');
  }
  var loginPrefill = null;

  function afterAuth(u, holdMs) {
    authAt = Date.now();
    me = { email: u.email, role: u.role, name: u.name, blob: u.blob || null };
    try { localStorage.setItem('hl_me', JSON.stringify({ email: u.email })); } catch (e) {}
    clearDirty();
    var go = function () {
      var dest = returnHash || (me.role === 'employer' ? '#/emp' : '#/jobs');
      returnHash = null;
      location.hash = dest;
      if (location.hash === dest) route();
    };
    if (holdMs) setTimeout(go, holdMs); else go();
  }

  document.getElementById('auth-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    window.__dbg = window.__dbg || function (m) { (window.__dbglog = window.__dbglog || []).push(m); };
    var f = e.target;
    var email = f.email.value.trim().toLowerCase();
    var password = f.password.value;
    var btn = document.getElementById('auth-submit');
    clearAuthErrs();
    // P3-3: ошибки у конкретных полей
    if (authMode === 'register' && !f.name.value.trim()) return setFieldErr('name', t('err.name'));
    if (!email) return setFieldErr('email', t('err.email'));
    if (password.length < 6) return setFieldErr('password', t('err.pass'));
    setBusy(btn, true);
    try {
      var reg = (await cloudRead(REG_KEY, 4)) || { users: {} };
      try { window.__dbg('reg read: users=' + Object.keys(reg.users).length + ' authMode=' + authMode); } catch (e) {}
      if (authMode === 'register') {
        if (reg.users[email]) {
          setBusy(btn, false);
          // P3-4: сообщение с переходом к входу
          var err = document.getElementById('auth-err');
          err.innerHTML = '';
          err.appendChild(el('span', null, t('err.existsLogin') + ' '));
          var go = el('a', null, t('auth.login') + ' →');
          go.href = '#/login';
          go.addEventListener('click', function () { loginPrefill = email; });
          err.appendChild(go);
          err.hidden = false;
          return;
        }
        var salt = Math.random().toString(36).slice(2, 14);
        var rec = {
          ph: await pHash(password, salt),
          role: authRole, name: f.name.value.trim(), createdAt: Date.now(),
        };
        if (authRole === 'employer') rec.blob = randId('hleb');
        if (authRole === 'seeker') {
          rec.apps = [];
          rec.recCode = recCode(); // P3-1: код восстановления
        }
        reg.users[email] = rec;
        await cloudWrite(REG_KEY, reg);
        if (rec.recCode) {
          var box = document.getElementById('auth-ok');
          box.textContent = t('auth.recCode', { code: rec.recCode });
          box.hidden = false;
          afterAuth({ email: email, role: authRole, name: rec.name, blob: rec.blob || null }, 2600);
        } else {
          afterAuth({ email: email, role: authRole, name: rec.name, blob: rec.blob || null });
        }
      } else {
        var u = reg.users[email];
        try { window.__dbg('login: u=' + (u ? u.role : 'MISSING')); } catch (e) {}
        try { window.__dbg('pass=' + password + ' len=' + password.length + ' stored=' + String(u ? u.ph : '').slice(0, 30)); } catch (e) {}
        var pc = u ? await pCheck(password, u.ph) : false;
        try { window.__dbg('pCheck done: ' + pc); } catch (e) {}
        if (!u || !pc) {
          setBusy(btn, false);
          return setAuthErr(t('auth.errCreds'));
        }
        setBusy(btn, false);
        try { window.__dbg('login: u=' + (u ? u.role + '/' + u.name : 'MISSING')); } catch (e) {}
        afterAuth({ email: email, role: u.role, name: u.name, blob: u.blob || null });
      }
    } catch (e) {
      setBusy(btn, false);
      if (e.network) return setAuthErr(t('err.network'));
      setAuthErr(t('auth.errFields'));
      console.error(e);
    }
  });

  function doLogout() {
    me = null;
    authAt = 0;
    try { localStorage.removeItem('hl_me'); localStorage.removeItem('hl_ai'); } catch (e) {}
    renderNav();
    location.hash = '#/';
    route();
  }
  document.getElementById('btn-logout').addEventListener('click', doLogout);
  document.getElementById('btn-logout2').addEventListener('click', doLogout);

  /* ══════════ Лента вакансий ══════════ */
  function renderJobs() {
    show('view-jobs');
    cloudRead(JOBS_KEY).then(function (feed) {
      var list = document.getElementById('jobs-list');
      clear(list);
      feed = (feed || []).sort(function (a, b) { return b.createdAt - a.createdAt; });
    maybeTranslateTitles(feed);
      if (!feed.length) { list.appendChild(el('p', 'muted', t('jobs.empty'))); return; }
      feed.forEach(function (v) {
        var card = el('a', 'job-card');
        card.href = '#/job/' + encodeURIComponent(v.id);
        card.appendChild(el('b', null, displayTitle(v, getLang())));
        card.appendChild(el('div', 'job-co', v.company + ' · ' + v.district));
        var stats = el('div', 'job-stats');
        if (v.salaryFrom) stats.appendChild(el('span', 'chip', t('misc.fromPerMonth', { sum: fmtMoney(v.salaryFrom) })));
        if (v.schedule) stats.appendChild(el('span', 'chip', v.schedule));
        if (v.reqLang && v.reqLang !== 'any') stats.appendChild(el('span', 'chip', t('job.langReq', { lang: langName(v.reqLang) })));
        card.appendChild(stats);
        card.appendChild(el('span', 'job-go', t('jobs.open') + ' →'));
        list.appendChild(card);
      });
    });
  }

  function findInFeed(id) {
    return cloudRead(JOBS_KEY).then(function (feed) {
      return (feed || []).find(function (v) { return v.id === id; }) || null;
    });
  }

  /* ══════════ Страница вакансии (P3-2: показываем компанию) ══════════ */
  function vacancyHead(v) {
    var head = el('div', 'card');
    head.appendChild(el('div', 'kicker', v.company));
    head.appendChild(el('h1', null, displayTitle(v, getLang())));
    var stats = el('div', 'vacancy-stats');
    if (v.salaryFrom) stats.appendChild(el('span', 'chip', t('misc.fromPerMonth', { sum: fmtMoney(v.salaryFrom) })));
    if (v.schedule) stats.appendChild(el('span', 'chip', v.schedule));
    stats.appendChild(el('span', 'chip', v.district));
    head.appendChild(stats);
    if (v.description) head.appendChild(el('p', 'muted', v.description));
    if (v.companyDesc) head.appendChild(el('p', 'muted', v.companyDesc));
    if (v.reqLang && v.reqLang !== 'any') {
      head.appendChild(el('div', 'lang-note', t('apply.langNote', { lang: langName(v.reqLang) })));
    }
    return head;
  }

  function renderJob(id) {
    findInFeed(id).then(function (v) {
      if (!v) { location.hash = '#/jobs'; return; }
      var box = document.getElementById('job-body');
      clear(box);
      box.appendChild(vacancyHead(v));
      var cta = document.getElementById('job-cta');
      clear(cta);
      var banner = el('div', 'job-banner');
      if (!me) {
        banner.appendChild(el('span', null, t('job.needAuth')));
        var btn = el('a', 'btn btn-primary', t('job.loginApply'));
        btn.href = '#/login';
        btn.addEventListener('click', function () { returnHash = '#/apply/' + id; });
        banner.appendChild(btn);
        cta.appendChild(banner);
      } else if (me.role !== 'seeker') {
        banner.appendChild(el('span', null, t('role.empT')));
        cta.appendChild(banner);
      } else {
        cta.appendChild(Object.assign(el('a', 'btn btn-primary btn-lg', t('job.apply')), { href: '#/apply/' + id }));
      }
      show('view-job');
    });
  }

  /* ══════════ Анкета ══════════ */
  function renderApply(id) {
    findInFeed(id).then(function (v) {
      if (!v) { location.hash = '#/jobs'; return; }
      var box = document.getElementById('apply-vacancy');
      clear(box);
      box.appendChild(vacancyHead(v));
      var form = document.getElementById('apply-form');
      form.dataset.vacancyId = id;
      form.name.value = me.name || '';
      document.getElementById('lang-err').hidden = true;
      show('view-apply');
    });
  }

  document.getElementById('apply-form').addEventListener('input', function () { markDirty('apply-form'); });
  document.getElementById('apply-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var vid = decodeURIComponent(f.dataset.vacancyId);
    var langs = [];
    f.querySelectorAll('input[name="langs"]:checked').forEach(function (b) { langs.push(b.value); });
    if (!langs.length) { document.getElementById('lang-err').hidden = false; return; }
    document.getElementById('lang-err').hidden = true;
    var btn = f.querySelector('button[type="submit"]');
    setBusy(btn, true);
    (async function () {
      var feed = (await cloudRead(JOBS_KEY)) || [];
      var v = feed.find(function (x) { return x.id === vid; });
      if (!v) { setBusy(btn, false); return; }
      var blob = (await cloudRead(v.blob)) ||
        { company: { name: v.company }, vacancies: [], applications: [] };
      if ((blob.applications || []).some(function (a) { return a.seekerEmail === me.email && a.vacancyId === vid; })) {
        setBusy(btn, false);
        alert(t('apply.dup'));
        return;
      }
      var application = {
        id: randId('app'), vacancyId: vid, seekerEmail: me.email,
        name: f.name.value.trim(), phone: f.phone.value.trim(),
        years: parseInt(f.years.value, 10) || 0,
        district: f.district.value.trim(),
        salary: parseInt(f.salary.value, 10) || null,
        about: f.about.value.trim(), langs: langs,
        createdAt: Date.now(), status: 'new', screening: null,
      };
      application.screening = rulesScreen(v, application);
      application.status = application.screening.autoDeclined ? 'declined' : 'new';
      blob.applications = (blob.applications || []).filter(function (a) { return a.id !== application.id; });
      blob.applications.push(application);
      await cloudWrite(v.blob, blob);
      await cloudMutate(REG_KEY, function (reg) {
        reg.users = reg.users || {};
        var u = reg.users[me.email] || (reg.users[me.email] = { apps: [] });
        u.apps = u.apps || [];
        u.apps = u.apps.filter(function (x) { return !(x.blob === v.blob && x.appId === application.id); });
        u.apps.push({ blob: v.blob, appId: application.id, createdAt: application.createdAt });
        return reg;
      }, { users: {} });
      clearDirty();
      sessionStorage.setItem('hl-last-verdict', JSON.stringify({
        status: application.status,
        screening: { aiError: application.screening.aiError || null },
      }));
      location.hash = '#/applied';
    })().catch(function (e2) { console.error(e2); setBusy(btn, false); alert(t('auth.errFields')); });
  });

  function renderApplied() {
    var last = null;
    try { last = JSON.parse(sessionStorage.getItem('hl-last-verdict')); } catch (e) {}
    var rejected = last && last.status === 'declined';
    document.getElementById('applied-title').textContent = rejected ? t('applied.noTitle') : t('applied.okTitle');
    document.getElementById('applied-text').textContent = rejected ? t('applied.noText') : t('applied.okText');
    show('view-applied');
  }

  /* ── AI-перевод названий вакансий (кеш в фиде) ── */
  var feedTranslating = false;
  function displayTitle(v, lang) {
    if (v.titleTr && v.titleTr[lang]) return v.titleTr[lang];
    return v.title;
  }
  async function maybeTranslateTitles(feed) {
    var lang = getLang();
    if (feedTranslating || !aiCfg()) return;
    var need = feed.filter(function (v) {
      return v.lang && v.lang !== lang && !(v.titleTr && v.titleTr[lang]);
    });
    if (!need.length) return;
    feedTranslating = true;
    try {
      var list = need.map(function (v, i) { return (i + 1) + '. ' + v.title; }).join('\n');
      var raw = await llmChat([
        { role: 'system', content: 'You are a translator for a job board. Translate each job title into ' +
          ({ ru: 'Russian', zh: 'Chinese', en: 'English' }[lang]) + '. Keep it short and natural for a job listing. ' +
          'Reply ONLY with a JSON array of translated strings, same order.' },
        { role: 'user', content: list }
      ], 600);
      var arr = JSON.parse(raw.match(/\[[\s\S]*\]/)[0]);
      need.forEach(function (v, i) {
        if (arr[i]) {
          v.titleTr = v.titleTr || {};
          v.titleTr[lang] = arr[i];
        }
      });
      await cloudWrite(JOBS_KEY, feed);
      route();
    } catch (e) { console.warn('translate:', e.message); }
    feedTranslating = false;
  }

  /* ══════════ Кабинет работодателя ══════════ */
  function renderCreate() { show('view-create'); }

  document.getElementById('create-form').addEventListener('input', function () { markDirty('create-form'); });
  document.getElementById('create-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var rules = f.rules.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!f.title.value.trim() || !f.district.value.trim() || !rules.length) {
      // P3-3: подсветка поля без правил
      if (!rules.length) setFieldErr('rules', t('err.fields'));
      f.reportValidity();
      return;
    }
    var btn = f.querySelector('button[type="submit"]');
    setBusy(btn, true);
    (async function () {
      var blob = await readMyBlob();
      var v = {
        id: randId('vac'),
        title: f.title.value.trim().slice(0, 100),
        district: f.district.value.trim().slice(0, 100),
        salaryFrom: parseInt(f.salaryFrom.value, 10) || null,
        schedule: f.schedule.value.trim().slice(0, 80),
        description: f.description.value.trim().slice(0, 2000),
        reqLang: f.reqLang.value,
        rules: rules,
        createdAt: Date.now(),
      };
      blob.vacancies = (blob.vacancies || []).filter(function (x) { return x.id !== v.id; });
      blob.vacancies.push(v);
      if (!blob.company) blob.company = { name: me.name };
      await writeMyBlob(blob);
      var feed = (await cloudRead(JOBS_KEY)) || [];
      feed = feed.filter(function (x) { return x.id !== v.id; });
      feed.push({
        id: v.id, blob: myBlobKey(), title: v.title, company: blob.company.name,
        companyDesc: blob.company.desc || '', companyCity: blob.company.city || '',
        district: v.district, salaryFrom: v.salaryFrom, schedule: v.schedule,
        reqLang: v.reqLang, description: v.description, createdAt: v.createdAt,
      });
      await cloudWrite(JOBS_KEY, feed);
      setBusy(btn, false);
      clearDirty();
      location.hash = '#/created/' + encodeURIComponent(v.id);
    })().catch(function (e2) { console.error(e2); setBusy(btn, false); });
  });

  function renderCreated(id) {
    var shareUrl = location.origin + location.pathname + '#/job/' + id;
    var qrBox = document.getElementById('qr-box');
    clear(qrBox);
    try {
      var qr = qrcode(0, 'M');
      qr.addData(shareUrl);
      qr.make();
      qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2 });
    } catch (e) { qrBox.textContent = shareUrl; }
    document.getElementById('share-link').textContent = shareUrl;
    document.getElementById('btn-open-vacancy').href = '#/job/' + id;
    show('view-created');
  }

  function renderEmp() {
    show('view-emp');
    (async function () {
      var blob = await readMyBlob();
      var cf = document.getElementById('company-form');
      cf.name.value = (blob.company && blob.company.name) || me.name || '';
      cf.city.value = (blob.company && blob.company.city) || '';
      cf.desc.value = (blob.company && blob.company.desc) || '';
      var st = document.getElementById('ai-status');
      var cfgAi = aiCfg();
      st.textContent = cfgAi ? t('emp.aiReady') + ' · ' + cfgAi.model : t('emp.aiKeyMissing');
      st.className = cfgAi ? 'on' : 'off';
      var pendingCount = (blob.applications || []).filter(function (a) { return !a.screening || a.screening.engine !== 'ai'; }).length;
      var pEl = document.getElementById('ai-pending');
      if (pEl) pEl.textContent = pendingCount ? t('emp.aiPending', { n: pendingCount }) : t('emp.aiNoPending');
      var runBtn = document.getElementById('btn-ai-run');
      if (runBtn) runBtn.disabled = !cfgAi || !pendingCount;
      var list = document.getElementById('emp-vacs');
      clear(list);
      var vacs = (blob.vacancies || []).slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
      document.getElementById('emp-none').hidden = !!vacs.length;
      vacs.forEach(function (v) {
        var item = el('div', 'vacancy-item');
        item.appendChild(el('b', null, v.title));
        item.appendChild(el('div', 'vacancy-meta', v.district + (v.salaryFrom ? ' · ' + t('misc.from', { sum: fmtMoney(v.salaryFrom) }) : '')));
        var stats = el('div', 'vacancy-stats');
        stats.appendChild(el('span', 'badge badge-gray', fmtDate(v.createdAt)));
        var apps = (blob.applications || []).filter(function (a) { return a.vacancyId === v.id; });
        stats.appendChild(el('span', 'badge badge-gray', t('emp.applicants') + ': ' + apps.length));
        item.appendChild(stats);
        item.addEventListener('click', function () { location.hash = '#/v/' + encodeURIComponent(v.id); });
        list.appendChild(item);
      });
      // открытие кабинета = «отклики просмотрены»
      try { localStorage.setItem('hl_seen_' + me.email, String((blob.applications || []).filter(function (a) { return a.status === 'new'; }).length)); } catch (e) {}
      updateEmpBadge();
    })();
  }

  document.getElementById('company-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var btn = f.querySelector('button[type="submit"]');
    setBusy(btn, true);
    (async function () {
      var blob = await readMyBlob();
      blob.company = { name: f.name.value.trim() || me.name, city: f.city.value.trim(), desc: f.desc.value.trim() };
      await writeMyBlob(blob);
      setBusy(btn, false);
      var b = el('span', 'badge badge-green', t('emp.saved'));
      e.target.querySelector('.form-actions').appendChild(b);
      setTimeout(function () { b.remove(); }, 2000);
    })();
  });

  /* ══════════ Кнопка AI-скрининга ══════════
     Ключ DeepSeek принадлежит платформе; работодатель лишь запускает разбор
     всех откликов, у которых ещё нет вердикта. */
  document.getElementById('btn-ai-run').addEventListener('click', function () {
    var btn = this;
    if (btn.disabled) return;
    var stEl = document.getElementById('ai-status');
    var pEl = document.getElementById('ai-pending');
    setBusy(btn, true);
    (async function () {
      var done = 0, failed = false, failMsg = null;
      try {
        var blob = await readMyBlob();
        var vacs = blob.vacancies || [];
        for (var i = 0; i < vacs.length; i++) {
          var v = vacs[i];
          var apps = (blob.applications || []).filter(function (a) {
            return a.vacancyId === v.id && (!a.screening || a.screening.engine !== 'ai');
          });
          for (var j = 0; j < apps.length; j++) {
            if (stEl) stEl.textContent = t('emp.aiRunning') + ' (' + (done + 1) + ')';
            try {
              apps[j].screening = await aiScreen(v, (blob.company || {}).name, apps[j]);
              if (apps[j].screening.autoDeclined) apps[j].status = 'declined';
              done++;
            } catch (e) {
              apps[j].screening = rulesScreen(v, apps[j]);
              apps[j].screening.aiError = e.message;
              failed = true;
              if (!failMsg && e.status === 402) failMsg = t('emp.aiNoBalance');
              if (!failMsg && (e.status === 401 || e.status === 403)) failMsg = t('emp.aiBadKey');
            }
          }
        }
        await writeMyBlob(blob);
        if (stEl) stEl.textContent = failed ? (failMsg || t('emp.aiFail')) : t('emp.aiDone', { n: done });
        if (pEl) pEl.textContent = t('emp.aiNoPending');
        if (failMsg) stEl.className = 'off';
      } catch (e2) { console.error(e2); }
      setBusy(btn, false);
    })();
  });

  /* ══════════ Отклики работодателя ══════════ */
  function renderEmpVac(vid) {
    show('view-empvac');
    (async function () {
      var blob = await readMyBlob();
      var v = (blob.vacancies || []).find(function (x) { return x.id === vid; });
      var head = document.getElementById('empvac-head');
      clear(head);
      var back = el('a', 'btn btn-ghost btn-sm', t('dash.back'));
      back.href = '#/emp';
      head.appendChild(back);
      head.appendChild(el('h1', null, (v ? v.title : '—') + ' · ' + ((blob.company || {}).name || '')));
      var del = el('button', 'btn btn-danger btn-sm', t('emp.delete'));
      del.addEventListener('click', function () {
        // P2-4: подтверждение перед необратимым удалением
        if (!window.confirm(t('v.confirmDelete'))) return;
        blob.vacancies = (blob.vacancies || []).filter(function (x) { return x.id !== vid; });
        blob.applications = (blob.applications || []).filter(function (a) { return a.vacancyId !== vid; });
        writeMyBlob(blob).then(function () {
          cloudRead(JOBS_KEY).then(function (feed) {
            feed = (feed || []).filter(function (x) { return x.id !== vid; });
            cloudWrite(JOBS_KEY, feed).then(function () { location.hash = '#/emp'; });
          });
        });
      });
      head.appendChild(del);
      var body = document.getElementById('empvac-body');
      clear(body);
      if (!v) { body.appendChild(el('p', 'muted', t('jobs.empty'))); return; }

      var all = (blob.applications || []).filter(function (a) { return a.vacancyId === vid; })
        .sort(function (x, y) { return y.createdAt - x.createdAt; });

      // AI-дожим: заявки без разбора, если ключ подключён
      var pending = all.filter(function (a) { return !a.screening || a.screening.engine !== 'ai'; });
      var cfgAi = aiCfg();
      if (pending.length && cfgAi) {
        var note = el('p', 'muted', 'AI: ' + pending.length + '…');
        body.appendChild(note);
        for (var i = 0; i < pending.length; i++) {
          try {
            pending[i].screening = await aiScreen(v, (blob.company || {}).name, pending[i]);
            if (pending[i].screening.autoDeclined) pending[i].status = 'declined';
          } catch (e) {
            pending[i].screening = rulesScreen(v, pending[i]);
            pending[i].screening.aiError = e.message;
          }
        }
        await writeMyBlob(blob);
        note.remove();
      }

      var active = all.filter(function (a) { return a.status !== 'declined'; });
      var declined = all.filter(function (a) { return a.status === 'declined'; });

      var digest = el('div', 'digest-panel');
      digest.appendChild(el('div', 'digest-title',
        t('dash.digestTop', { n: Math.min(3, active.length), m: active.length })));
      active.slice().sort(function (x, y) { return (y.screening.score || 0) - (x.screening.score || 0); })
        .slice(0, 3)
        .forEach(function (a) {
          var row = el('div', 'digest-item');
          row.appendChild(levelBadge(a.screening.level));
          row.appendChild(el('b', null, a.name));
          row.appendChild(el('span', 'muted', (a.screening.score || 0) + '% · ' +
            (a.years ? a.years + ' · ' : '') + (a.district || '')));
          digest.appendChild(row);
        });
      if (!active.length) digest.appendChild(el('p', 'muted', t('emp.noApps')));
      body.appendChild(digest);

      var grid = el('div', 'applicant-grid');
      active.forEach(function (a) { grid.appendChild(applicantCard(blob, v, a)); });
      body.appendChild(grid);

      if (declined.length) {
        body.appendChild(el('div', 'autodecline-head', t('dash.declinedHead', { n: declined.length })));
        var g2 = el('div', 'applicant-grid');
        declined.forEach(function (a) { g2.appendChild(applicantCard(blob, v, a)); });
        body.appendChild(g2);
      }
      show('view-empvac');
    })();
  }

  function applicantCard(blob, v, a) {
    var card = el('div', 'applicant-card');
    var top = el('div', 'applicant-top');
    var nameBox = el('div');
    nameBox.appendChild(el('div', 'applicant-name', a.name));
    nameBox.appendChild(el('div', 'applicant-phone', a.phone + ' · ' + fmtDate(a.createdAt) +
      (a.screening.engine === 'ai' ? ' · AI' : '')));
    top.appendChild(nameBox);
    top.appendChild(levelBadge(a.screening.level));
    card.appendChild(top);

    var chips = el('div', 'applicant-chips');
    (a.langs || []).forEach(function (l) { chips.appendChild(el('span', 'chip', langName(l))); });
    chips.appendChild(el('span', 'chip', a.years ? String(a.years) : t('c.noexp')));
    if (a.district) chips.appendChild(el('span', 'chip', a.district));
    if (a.salary) chips.appendChild(el('span', 'chip', t('c.expects', { sum: fmtMoney(a.salary) })));
    card.appendChild(chips);

    var ownerLang = getLang();
    if (a.aboutTranslated && (a.appLang || 'ru') !== ownerLang) {
      card.appendChild(el('div', 'about-translated', t('card.translated') + ' ' + a.aboutTranslated));
      var det = document.createElement('details');
      det.className = 'about-orig-toggle';
      det.appendChild(el('summary', null, t('card.original')));
      det.appendChild(el('p', null, '\u00AB' + a.about + '\u00BB'));
      card.appendChild(det);
    } else {
      card.appendChild(el('div', 'applicant-about', '\u00AB' + a.about + '\u00BB'));
    }

    var reasons = el('div', 'reasons');
    // человечная сводка: совпадение по N из M обязательных правил
    var okN = (a.screening.reasons || []).filter(function (r) { return r.s === 'ok'; }).length;
    var reqN = (a.screening.reasons || []).filter(function (r) { return r.s !== 'neutral'; }).length;
    if (reqN) reasons.appendChild(el('div', null, t('rules.matchLine', { ok: okN, all: reqN })));
    (a.screening.reasons || []).forEach(function (r) {
      var line = el('div', 'reason ' + (r.s === 'ok' ? 'ok' : r.s === 'bad' ? 'bad' : 'neutral'));
      line.appendChild(el('span', 'mark', r.s === 'ok' ? '✓' : r.s === 'bad' ? '✕' : '·'));
      line.appendChild(el('span', null, r.text));
      reasons.appendChild(line);
    });
    card.appendChild(reasons);

    var actions = el('div', 'applicant-actions');
    if (a.status === 'new') {
      var invite = el('button', 'btn btn-primary btn-sm', t('c.invite'));
      invite.addEventListener('click', function () {
        a.status = 'invited';
        setBusy(invite, true);
        writeMyBlob(blob).then(function () { renderEmpVac(v.id); });
      });
      var decline = el('button', 'btn btn-danger btn-sm', t('c.decline'));
      decline.addEventListener('click', function () {
        a.status = 'declined';
        setBusy(decline, true);
        writeMyBlob(blob).then(function () { renderEmpVac(v.id); });
      });
      actions.appendChild(invite);
      actions.appendChild(decline);
    } else if (a.status === 'invited') {
      actions.appendChild(el('span', 'badge badge-green', t('st.invited')));
    } else {
      actions.appendChild(el('span', 'badge badge-gray', t('st.declined')));
    }
    card.appendChild(actions);
    return card;
  }

  /* ══════════ Кабинет соискателя ══════════ */
  function renderMe() {
    show('view-me');
    (async function () {
      var list = document.getElementById('me-list');
      clear(list);
      list.appendChild(el('p', 'muted', t('ui.loading')));
      // надёжный путь: объединяем индекс откликов из реестра и скан всех
      // блобов фида — гонки записей в одном KV-ключе не теряют отклики
      var reg = (await cloudRead(REG_KEY)) || { users: {} };
      var u = reg.users[me.email] || {};
      var seenAppIds = {};
      var mine = [];
      function collect(blobKey, blob) {
        (blob.applications || []).forEach(function (a) {
          if (a.seekerEmail !== me.email || seenAppIds[a.id]) return;
          seenAppIds[a.id] = true;
          var v = (blob.vacancies || []).find(function (x) { return x.id === a.vacancyId; }) || null;
          mine.push({ app: a, vac: v });
        });
      }
      // 1) индекс из реестра (блобы, ключи которых сохранены у пользователя)
      var indexedBlobs = {};
      (u.apps || []).forEach(function (entry) {
        indexedBlobs[entry.blob] = true;
      });
      for (var bk in indexedBlobs) {
        try {
          var b1 = await cloudRead(bk);
          if (b1) collect(bk, b1);
        } catch (e) { console.warn(e); }
      }
      // 2) скан всех блобов опубликованных вакансий (блоб мог потерять запись в индексе)
      var feed = (await cloudRead(JOBS_KEY)) || [];
      for (var j = 0; j < feed.length; j++) {
        if (indexedBlobs[feed[j].blob]) continue;
        try {
          var b2 = await cloudRead(feed[j].blob);
          if (b2) collect(b2, b2);
        } catch (e) { console.warn(e); }
      }
      clear(list);
      mine.sort(function (x, y) { return y.app.createdAt - x.app.createdAt; });
      if (!mine.length) { list.appendChild(el('p', 'muted', t('me.none'))); return; }
      var lang = getLang();
      mine.forEach(function (m) {
        var a = m.app, v = m.vac;
        var item = el('div', 'me-item');
        var top = el('div', 'me-top');
        var left = el('div');
        left.appendChild(el('b', null, displayTitle(v || { title: '—' }, lang)));
        left.appendChild(el('div', 'job-co',
          ((v && v.company) || '') + ' · ' + (v ? v.district : '') + ' · ' + fmtDate(a.createdAt)));
        top.appendChild(left);
        top.appendChild(statusChip(a.status));
        item.appendChild(top);
        if (a.screening) {
          item.appendChild(levelBadge(a.screening.level));
          var reasons = el('div', 'me-reasons', t('me.reasons'));
          (a.screening.reasons || []).forEach(function (r) {
            reasons.appendChild(el('div', null, (r.s === 'ok' ? '✓ ' : r.s === 'bad' ? '✕ ' : '· ') + r.text));
          });
          item.appendChild(reasons);
        }
        if (v) {
          var open = el('a', 'job-go', t('jobs.open') + ' →');
          open.href = '#/job/' + encodeURIComponent(v.id);
          item.appendChild(open);
        }
        list.appendChild(item);
      });
    })();
  }

  /* ══════════ Восстановление пароля (P3-1) ══════════ */
  function renderRecover() {
    document.getElementById('rec-err').hidden = true;
    show('view-recover');
  }

  document.getElementById('recover-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var email = f.email.value.trim().toLowerCase();
    var code = f.code.value.trim().toUpperCase();
    var pass = f.password.value;
    var errBox = document.getElementById('rec-err');
    errBox.hidden = true;
    if (!email || !code || pass.length < 6) {
      errBox.textContent = t('auth.errFields');
      errBox.hidden = false;
      return;
    }
    var btn = f.querySelector('button[type="submit"]');
    setBusy(btn, true);
    (async function () {
      var reg = (await cloudRead(REG_KEY)) || { users: {} };
      var u = reg.users[email];
      if (!u || !u.recCode || u.recCode !== code) {
        setBusy(btn, false);
        errBox.textContent = t('rec.err');
        errBox.hidden = false;
        return;
      }
      var salt = Math.random().toString(36).slice(2, 14);
      u.ph = await pHash(pass, salt);
      delete u.recCode;
      await cloudWrite(REG_KEY, reg);
      setBusy(btn, false);
      errBox.textContent = t('rec.ok');
      errBox.hidden = false;
      errBox.classList.add('about-translated');
      setTimeout(function () { location.hash = '#/login'; }, 1800);
    })().catch(function (e2) { console.error(e2); setBusy(btn, false); });
  });

  /* ══════════ Анимации лендинга: reveal, прогресс, параллакс ══════════ */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add('in-view'); io.unobserve(en.target); }
    });
  }, { threshold: 0.12 });
  function observeReveals() {
    document.querySelectorAll('.reveal:not(.in-view)').forEach(function (el) { io.observe(el); });
  }
  window.addEventListener('scroll', function () {
    var h = document.documentElement;
    var max = h.scrollHeight - h.clientHeight;
    var p = max ? h.scrollTop / max : 0;
    var bar = document.getElementById('scroll-progress');
    if (bar) bar.style.width = Math.min(100, p * 100).toFixed(2) + '%';
    var card = document.querySelector('.hero-card');
    if (card) card.style.transform = 'translateY(' + (h.scrollTop * 0.08).toFixed(1) + 'px)';
  }, { passive: true });

  /* ══════════ Старт ══════════ */
  (function init() {
    try {
      var saved = JSON.parse(localStorage.getItem('hl_me') || 'null');
      if (saved && saved.email) {
        cloudRead(REG_KEY).then(function (reg) {
          // P1-2: если во время загрузки пользователь уже вошёл/зарегистрировался
          // в этой сессии — не перебиваем его состояние устаревшим реестром
          if (authAt) { route(); return; }
          var u = reg && reg.users && reg.users[saved.email];
          me = u ? { email: saved.email, role: u.role, name: u.name, blob: u.blob || null } : null;
          if (!me) { try { localStorage.removeItem('hl_me'); } catch (e) {} }
          route();
        });
        return;
      }
    } catch (e) {}
    route();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', observeReveals);
    } else { observeReveals(); }
  })();
})();
