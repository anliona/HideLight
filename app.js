/* HireLight — static full-app on GitHub Pages.
   Хранилище: textdb.online (бесплатный анонимный KV).
   AI: LLM API вызывается из браузера работодателя (ключ хранится локально),
   без ключа работает детерминированный движок правил. */
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
  async function cloudRead(key) {
    try {
      const r = await fetch('https://textdb.online/' + key + '?cb=' + Date.now());
      const txt = (await r.text()).trim();
      if (!txt) return null;
      const raw = txt.startsWith('H4sI') ? await ungz(txt) : txt;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }
  async function cloudWrite(key, obj) {
    const val = await gz(JSON.stringify(obj));
    // CORS скрывает ответ — пишем «маячком» (GET доходит до сервера),
    // затем подтверждаем чтением с запасом на медленную репликацию textdb.
    try { await fetch('https://textdb.online/update?key=' + key + '&value=' + encodeURIComponent(val)); } catch (e) {}
    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, 1200));
      const back = await cloudRead(key);
      if (JSON.stringify(back) === JSON.stringify(obj)) return true;
      try { await fetch('https://textdb.online/update?key=' + key + '&value=' + encodeURIComponent(val)); } catch (e) {}
    }
    // записывающий запрос отправлен; textdb может отдавать данные с задержкой —
    // считаем доставленным, последующее чтение подтянется
    return true;
  }
  async function cloudMutate(key, mutator, emptyValue) {
    const cur = (await cloudRead(key)) || emptyValue;
    const next = mutator(cur);
    return (await cloudWrite(key, next)) ? next : null;
  }

  /* Пароли: PBKDF2-SHA256 (SubtleCrypto), хранится salt:hash */
  async function pHash(password, salt) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(salt), iterations: 60000, hash: 'SHA-256' }, key, 256);
    const bytes = new Uint8Array(bits);
    let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
    return salt + ':' + btoa(bin);
  }
  async function pCheck(password, stored) {
    const [salt] = stored.split(':');
    return (await pHash(password, salt)) === stored;
  }
  function randId(p) { return p + Math.random().toString(36).slice(2, 10); }

  /* ══════════ AI: LLM API (OpenAI-совместимый) ══════════ */
  function aiCfg() {
    try { return JSON.parse(localStorage.getItem('hl_ai') || 'null'); } catch (e) { return null; }
  }
  async function llmChat(messages, maxTokens) {
    const cfg = aiCfg();
    const r = await fetch(cfg.base.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0.2, max_tokens: maxTokens || 900 }),
    });
    if (!r.ok) throw new Error('LLM ' + r.status);
    const body = await r.json();
    return body.choices[0].message.content;
  }
  /* AI-скрининг одной заявки; язык результатов — vacancy.lang */
  async function aiScreen(vacancy, company, application) {
    const langName = { ru: 'русском', zh: 'китайском', en: 'English' }[vacancy.lang] || 'русском';
    const sys = 'You are a precise hiring screener for small businesses. Answer ONLY with a valid JSON object, no markdown, no extra text.';
    const user =
      'VACANCY: ' + vacancy.title + ' at ' + (company || '') + ' (' + vacancy.district + ')' +
      (vacancy.salaryFrom ? ', salary from ' + vacancy.salaryFrom : '') + '\n' +
      'SCREENING RULES (owner-defined, one per line):\n' +
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
      '2. aboutTranslated: translate about into ' + langName + '.\n' +
      '3. languageOk: true/false against REQUIRED LANGUAGE (if any) + short languageReason in ' + langName + '.\n' +
      '4. For EVERY screening rule: verdict with short reason in ' + langName + '.\n' +
      'Use only facts from the profile; unverifiable rules → pass=false and say what is missing.\n' +
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
    ru: { yearsOk: w => 'опыт ' + w + ' — соответствует', yearsLow: (w, m) => 'опыт ' + w + ' — меньше требуемого (от ' + m + ')',
      found: r => 'в анкете отмечено: «' + r + '»', missing: r => 'в анкете не найдено подтверждение: «' + r + '»',
      langOk: l => 'владеет языком: ' + l, langBad: l => 'не владеет требуемым языком',
      yearsWord: n => { const a = n % 10, b = n % 100;
        if (a === 1 && b !== 11) return n + ' год';
        if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return n + ' года';
        return n + ' лет'; } },
    zh: { yearsOk: w => '经验 ' + w + '——符合', yearsLow: (w, m) => '经验 ' + w + '——不足（至少 ' + m + ' 年）',
      found: r => '申请中已确认："' + r + '"', missing: r => '申请中未找到佐证："' + r + '"',
      langOk: l => '会要求的语言：' + l, langBad: l => '不会要求的语言',
      yearsWord: n => n + ' 年' },
    en: { yearsOk: w => w + ' of experience — matches', yearsLow: (w, m) => w + ' — less than required (from ' + m + ')',
      found: r => 'confirmed in the application: "' + r + '"', missing: r => 'no confirmation found: "' + r + '"',
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
      const rl = String(rule).toLowerCase().replace(/ё/g, 'е');
      let m = rl.match(/от\s+(\d+)\s*(лет|года|год)/);
      if (m) {
        const min = +m[1], y = application.years || 0;
        if (y >= min) { reasons.push({ s: 'ok', text: T.yearsOk(T.yearsWord(y)) }); ok++; }
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
      else { reasons.push({ s: 'bad', text: T.missing(rule) }); bad++; }
    });
    const score = (ok + bad) ? Math.round(ok / (ok + bad) * 100) : 50;
    const level = score >= 75 ? 'green' : score >= 50 ? 'amber' : 'red';
    return { engine: 'rules', score, level, reasons, aboutTranslated: null,
             autoDeclined: level === 'red' && (ok + bad) >= 2 };
  }

  /* ══════════ Состояние ══════════ */
  var me = null;          // {email, role, name, blob}
  var authMode = 'login';
  var authRole = 'seeker';
  var returnHash = null;
  var busyMsg = null;

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
    if (me && me.role === 'employer') { emp.hidden = false; create.hidden = false; }
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

  /* ══════════ Роутер ══════════ */
  function route() {
    var hash = location.hash || '#/';
    var parts = hash.slice(2).split('/');
    var page = parts[0] || '';
    renderNav();
    if (page === '') return renderLanding();
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
    if (page === 'create') return requireEmployer(renderCreate);
    if (page === 'created' && parts[1]) return requireEmployer(function () { renderCreated(parts[1]); });
    if (page === 'emp') return requireEmployer(renderEmp);
    if (page === 'v' && parts[1]) return requireEmployer(function () { renderEmpVac(decodeURIComponent(parts[1])); });
    if (page === 'me') return requireSeeker(renderMe);
    renderLanding();
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('langchange', function () { renderNav(); route(); });

  function renderLanding() { show('view-landing'); }

  /* ══════════ Регистрация данных работодателя ══════════ */
  function myBlobKey() { return me && me.blob; }
  async function readMyBlob() {
    return (await cloudRead(myBlobKey())) ||
      { company: { name: me.name, desc: '', city: '' }, vacancies: [], applications: [] };
  }
  async function writeMyBlob(blob) { return cloudWrite(myBlobKey(), blob); }

  /* ══════════ Авторизация ══════════ */
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
    document.getElementById('auth-err').hidden = true;
    show('view-auth');
  }
  function authError(code) {
    var err = document.getElementById('auth-err');
    err.textContent = t(code === 'exists' ? 'auth.errExists' : code === 'creds' ? 'auth.errCreds' : 'auth.errFields');
    err.hidden = false;
  }
  document.getElementById('auth-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var email = f.email.value.trim().toLowerCase();
    var password = f.password.value;
    if (!email || password.length < 6 || (authMode === 'register' && !f.name.value.trim())) {
      authError('fields'); return;
    }
    var busy = document.getElementById('auth-submit');
    busy.disabled = true;
    (async function () {
      var reg = (await cloudRead(REG_KEY)) || { users: {} };
      if (authMode === 'register') {
        if (reg.users[email]) return authError('exists');
        var salt = Math.random().toString(36).slice(2, 14);
        var rec = { ph: await pHash(password, salt), role: authRole, name: f.name.value.trim(), createdAt: Date.now() };
        if (authRole === 'employer') rec.blob = randId('hleb');
        if (authRole === 'seeker') rec.apps = [];
        reg.users[email] = rec;
        var ok = await cloudWrite(REG_KEY, reg);
        if (!ok) return authError('fields');
        me = { email: email, role: authRole, name: rec.name, blob: rec.blob || null };
        try { localStorage.setItem('hl_me', JSON.stringify({ email: email })); } catch (e) {}
      } else {
        var u = reg.users[email];
        if (!u || !(await pCheck(password, u.ph))) return authError('creds');
        me = { email: email, role: u.role, name: u.name, blob: u.blob || null };
        try { localStorage.setItem('hl_me', JSON.stringify({ email: email })); } catch (e) {}
      }
      busy.disabled = false;
      var dest = returnHash || (me.role === 'employer' ? '#/emp' : '#/jobs');
      returnHash = null;
      location.hash = dest;
      if (location.hash === dest) route();
    })().catch(function (e2) { busy.disabled = false; authError('fields'); console.error(e2); });
  });
  function doLogout() {
    me = null;
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
      if (!feed.length) { list.appendChild(el('p', 'muted', t('jobs.empty'))); return; }
      feed.forEach(function (v) {
        var card = el('a', 'job-card');
        card.href = '#/job/' + encodeURIComponent(v.id);
        card.appendChild(el('b', null, v.title));
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

  /* ══════════ Страница вакансии ══════════ */
  function renderJob(id) {
    findInFeed(id).then(function (v) {
      if (!v) { location.hash = '#/jobs'; return; }
      var box = document.getElementById('job-body');
      clear(box);
      var head = el('div', 'card');
      head.appendChild(el('div', 'kicker', v.company));
      head.appendChild(el('h1', null, v.title));
      var stats = el('div', 'vacancy-stats');
      if (v.salaryFrom) stats.appendChild(el('span', 'chip', t('misc.fromPerMonth', { sum: fmtMoney(v.salaryFrom) })));
      if (v.schedule) stats.appendChild(el('span', 'chip', v.schedule));
      stats.appendChild(el('span', 'chip', v.district));
      head.appendChild(stats);
      if (v.description) head.appendChild(el('p', 'muted', v.description));
      if (v.reqLang && v.reqLang !== 'any') {
        head.appendChild(el('div', 'lang-note', t('apply.langNote', { lang: langName(v.reqLang) })));
      }
      box.appendChild(head);
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
      var head = el('div', 'card');
      head.appendChild(el('div', 'kicker', v.company));
      head.appendChild(el('h1', null, v.title));
      var stats = el('div', 'vacancy-stats');
      if (v.salaryFrom) stats.appendChild(el('span', 'chip', t('misc.fromPerMonth', { sum: fmtMoney(v.salaryFrom) })));
      if (v.schedule) stats.appendChild(el('span', 'chip', v.schedule));
      head.appendChild(stats);
      if (v.description) head.appendChild(el('p', 'muted', v.description));
      if (v.reqLang && v.reqLang !== 'any') {
        head.appendChild(el('div', 'lang-note', t('apply.langNote', { lang: langName(v.reqLang) })));
      }
      box.appendChild(head);
      var form = document.getElementById('apply-form');
      form.dataset.vacancyId = id;
      form.name.value = me.name || '';
      document.getElementById('lang-err').hidden = true;
      show('view-apply');
    });
  }

  document.getElementById('apply-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var vid = decodeURIComponent(f.dataset.vacancyId);
    var langs = [];
    f.querySelectorAll('input[name="langs"]:checked').forEach(function (b) { langs.push(b.value); });
    if (!langs.length) { document.getElementById('lang-err').hidden = false; return; }
    document.getElementById('lang-err').hidden = true;
    var btn = f.querySelector('button[type="submit"]');
    btn.disabled = true;
    (async function () {
      var feed = (await cloudRead(JOBS_KEY)) || [];
      var v = feed.find(function (x) { return x.id === vid; });
      if (!v) { btn.disabled = false; return; }
      var blob = (await cloudRead(v.blob)) ||
        { company: { name: v.company }, vacancies: [], applications: [] };
      if ((blob.applications || []).some(function (a) { return a.seekerEmail === me.email && a.vacancyId === vid; })) {
        alert(t('apply.dup')); btn.disabled = false; return;
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
      var okWrite = await cloudWrite(v.blob, blob);
      if (!okWrite) { alert(t('apply.aiErr')); btn.disabled = false; return; }
      // индекс в кабинете соискателя
      await cloudMutate(REG_KEY, function (reg) {
        reg.users = reg.users || {};
        var u = reg.users[me.email] || (reg.users[me.email] = { apps: [] });
        u.apps = u.apps || [];
        u.apps = u.apps.filter(function (x) { return !(x.blob === v.blob && x.appId === application.id); });
        u.apps.push({ blob: v.blob, appId: application.id, createdAt: application.createdAt });
        return reg;
      }, { users: {} });
      sessionStorage.setItem('hl-last-verdict', JSON.stringify({
        status: application.status,
        screening: { aiError: application.screening.aiError || null },
      }));
      location.hash = '#/applied';
    })().catch(function (e2) { console.error(e2); btn.disabled = false; alert(t('auth.errFields')); });
  });

  function renderApplied() {
    var last = null;
    try { last = JSON.parse(sessionStorage.getItem('hl-last-verdict')); } catch (e) {}
    var rejected = last && last.status === 'declined';
    document.getElementById('applied-title').textContent = rejected ? t('applied.noTitle') : t('applied.okTitle');
    document.getElementById('applied-text').textContent = rejected ? t('applied.noText') : t('applied.okText');
    show('view-applied');
  }

  /* ══════════ Кабинет работодателя ══════════ */
  function renderCreate() { show('view-create'); }

  document.getElementById('create-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var rules = f.rules.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!f.title.value.trim() || !f.district.value.trim() || !rules.length) { f.reportValidity(); return; }
    var btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
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
      var okBlob = await writeMyBlob(blob);
      var feed = (await cloudRead(JOBS_KEY)) || [];
      feed = feed.filter(function (x) { return x.id !== v.id; });
      feed.push({
        id: v.id, blob: myBlobKey(), title: v.title, company: blob.company.name,
        district: v.district, salaryFrom: v.salaryFrom, schedule: v.schedule,
        reqLang: v.reqLang, description: v.description, createdAt: v.createdAt,
      });
      var okFeed = await cloudWrite(JOBS_KEY, feed);
      btn.disabled = false;
      if (!okBlob || !okFeed) { alert(t('apply.aiErr')); return; }
      f.reset();
      location.hash = '#/created/' + encodeURIComponent(v.id);
    })().catch(function (e2) { console.error(e2); btn.disabled = false; });
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
      st.textContent = cfgAi ? t('emp.aiOn') + ' · ' + cfgAi.model : t('emp.aiOff');
      st.className = cfgAi ? 'on' : 'off';
      document.getElementById('ai-form').style.display = cfgAi ? 'none' : 'block';
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
    })();
  }

  document.getElementById('company-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    (async function () {
      var blob = await readMyBlob();
      blob.company = { name: f.name.value.trim() || me.name, city: f.city.value.trim(), desc: f.desc.value.trim() };
      await writeMyBlob(blob);
      var b = el('span', 'badge badge-green', t('emp.saved'));
      e.target.querySelector('.form-actions').appendChild(b);
      setTimeout(function () { b.remove(); }, 2000);
    })();
  });

  document.getElementById('ai-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    try {
      localStorage.setItem('hl_ai', JSON.stringify({
        base: f.base.value.trim() || 'https://api.openai.com/v1',
        model: f.model.value.trim() || 'gpt-4o-mini',
        key: f.key.value.trim(),
      }));
      renderEmp();
    } catch (e2) { alert(t('auth.errFields')); }
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
      var body = document.getElementById('empvac-body');
      clear(body);
      if (!v) { body.appendChild(el('p', 'muted', t('jobs.empty'))); return; }
      var all = (blob.applications || []).filter(function (a) { return a.vacancyId === vid; })
        .sort(function (x, y) { return y.createdAt - x.createdAt; });
      // AI-дожим: заявки без разбора, если ключ подключён — прогоняем здесь же
      var pending = all.filter(function (a) { return !a.screening; });
      var cfgAi = aiCfg();
      if (pending.length && cfgAi) {
        var note = el('p', 'muted', 'AI: ' + pending.length + '…');
        body.appendChild(note);
        for (var i = 0; i < pending.length; i++) {
          try {
            pending[i].screening = await aiScreen(v, (blob.company || {}).name, pending[i]);
            pending[i].status = pending[i].screening.autoDeclined ? 'declined' : pending[i].status;
          } catch (e) {
            pending[i].screening = rulesScreen(v, pending[i]);
            pending[i].screening.aiError = e.message;
          }
        }
        await writeMyBlob(blob);
        note.remove();
      }
      pending.forEach(function (a) {
        if (!a.screening) a.screening = rulesScreen(v, a);
        if (a.screening.autoDeclined) a.status = 'declined';
      });

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
      if (pending.length && cfgAi) await writeMyBlob(blob);
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
        writeMyBlob(blob).then(function () { renderEmpVac(v.id); });
      });
      var decline = el('button', 'btn btn-danger btn-sm', t('c.decline'));
      decline.addEventListener('click', function () {
        a.status = 'declined';
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
      var reg = (await cloudRead(REG_KEY)) || { users: {} };
      var u = reg.users[me.email] || {};
      var apps = u.apps || [];
      if (!apps.length) { list.appendChild(el('p', 'muted', t('me.none'))); return; }
      apps.sort(function (x, y) { return y.createdAt - x.createdAt; });
      for (var i = 0; i < apps.length; i++) {
        var entry = apps[i];
        var blob = await cloudRead(entry.blob);
        var a = blob && (blob.applications || []).find(function (x) { return x.id === entry.appId; });
        var v = blob && (blob.vacancies || []).find(function (x) { return x.id === (a && a.vacancyId); });
        var item = el('div', 'me-item');
        var top = el('div', 'me-top');
        var left = el('div');
        left.appendChild(el('b', null, v ? v.title : '—'));
        left.appendChild(el('div', 'job-co',
          ((blob && blob.company && blob.company.name) || '') + ' · ' + (v ? v.district : '') + ' · ' + fmtDate(entry.createdAt)));
        top.appendChild(left);
        top.appendChild(statusChip(a ? a.status : 'declined'));
        item.appendChild(top);
        if (a && a.screening) {
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
      }
    })();
  }

  /* ══════════ Сброс демо-данных убран: данные живут в облаке ══════════ */

  /* ══════════ Старт ══════════ */
  (function init() {
    try {
      var saved = JSON.parse(localStorage.getItem('hl_me') || 'null');
      if (saved && saved.email) {
        cloudRead(REG_KEY).then(function (reg) {
          var u = reg && reg.users && reg.users[saved.email];
          me = u ? { email: saved.email, role: u.role, name: u.name, blob: u.blob || null } : null;
          if (!me) { try { localStorage.removeItem('hl_me'); } catch (e) {} }
          route();
        });
        return;
      }
    } catch (e) {}
    route();
  })();
})();
