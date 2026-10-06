/* HireLight — демо-прототип (без бэкенда; данные в localStorage) */
(function () {
  'use strict';

  /* ────────── Хранилище ────────── */
  var DB_KEY = 'hirelight-db-v2'; // v2: причины правил структурированы для i18n

  function loadDB() {
    try { return JSON.parse(localStorage.getItem(DB_KEY)); } catch (e) { return null; }
  }
  function saveDB() { localStorage.setItem(DB_KEY, JSON.stringify(db)); }

  var db = loadDB();

  function uid(prefix) {
    return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ────────── Тексты и локали ────────── */
  function t(key, params) { return window.t(key, params); }

  function fmtMoney(n) {
    try { return n.toLocaleString(window.tLocale()); } catch (e) { return String(n); }
  }
  function fmtDate(ts) {
    var d = new Date(ts);
    try {
      return d.toLocaleDateString(window.tLocale(), { day: 'numeric', month: 'short' }) + ', ' +
        d.toLocaleTimeString(window.tLocale(), { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return d.toLocaleString(); }
  }
  function yearsWord(n) { // «3 года» / '3 years' / '3 年'
    var lang = window.getLang();
    if (lang === 'zh') return n + ' 年';
    if (lang === 'en') return n === 1 ? '1 year' : n + ' years';
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return n + ' год';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return n + ' года';
    return n + ' лет';
  }
  function expPhrase(years) { // «3 года опыта» / '3 years of experience' / '3 年经验'
    if (!years) return t('c.noexp');
    var lang = window.getLang();
    if (lang === 'zh') return years + ' 年经验';
    if (lang === 'en') return yearsWord(years) + ' of experience';
    return yearsWord(years) + ' опыта';
  }

  /* ────────── Демо-данные ────────── */
  function seed() {
    var v = {
      id: 'v-demo-barista',
      title: 'Бариста',
      company: 'Кофейня «Сова»',
      district: 'Москва, Якиманка',
      salaryFrom: 60000,
      schedule: '2/2, смены с 7:00',
      description: 'Спешелти-кофе, дружная команда, обучение за счёт компании.',
      rules: [
        'опыт работы бариста от 1 года',
        'живёте или готовы работать в районе Якиманка',
        'смена с 7:00 — готовы',
        'студентам на вечерние смены — да'
      ],
      createdAt: Date.now() - 86400000 * 3
    };
    var people = [
      { name: 'Анна Соколова', phone: '+7 916 220-14-08', years: 3, district: 'Якиманка', salary: 65000,
        about: 'Работаю бариста 3 года, последний год — в спешелти-кофе на Якиманке. Ранние смены без проблем, живу в десяти минутах.', status: 'new' },
      { name: 'Ольга Ежова', phone: '+7 903 118-72-55', years: 1, district: 'Замоскворечье, готова к Якиманке', salary: 60000,
        about: 'Год работы бариста в кафе у Парка культуры. Готова к сменам с 7 утра, добираюсь пешком.', status: 'new' },
      { name: 'Игорь Петров', phone: '+7 926 540-31-19', years: 2, district: 'Таганка', salary: 70000,
        about: '2 года бариста в веган-кафе на Таганке, готов ездить в центр, утренние смены привычны.', status: 'invited' },
      { name: 'Марина Ким', phone: '+7 999 204-86-30', years: 0, district: 'Якиманка', salary: 55000,
        about: 'Студентка, могу работать вечерами на неполный день. Опыта в кофе нет, но быстро учусь, живу на Якиманке.', status: 'new' },
      { name: 'Ксения Лаврова', phone: '+7 925 771-09-64', years: 2, district: 'Беляево', salary: 68000,
        about: 'Работала баристой 2 года, сейчас ищу ближе к дому. Ранние подъёмы даются тяжело, но постараюсь.', status: 'new' },
      { name: 'Павел Гусев', phone: '+7 968 330-45-72', years: 0, district: 'Якиманка', salary: 60000,
        about: 'Опыта бариста нет, окончил курсы за 6 месяцев до этого работал в доставке. Живу рядом, готов к любым сменам.', status: 'new' },
      { name: 'Дмитрий Волков', phone: '+7 911 402-88-21', years: 5, district: 'Химки', salary: 80000,
        about: 'Бариста с опытом 5 лет в сетевых кофеенах. Живу в Химках, до центра добираться час, рано начинать работу не смогу.', status: 'declined' },
      { name: 'Сергей Нилов', phone: '+7 905 617-23-40', years: 4, district: 'Центр', salary: 75000,
        about: '4 года опыта, работал в центре. Не работаю рано утром, только после полудня.', status: 'declined' }
    ];
    db = { vacancies: {}, applicants: {} };
    db.vacancies[v.id] = v;
    people.forEach(function (p) {
      var a = {
        id: uid('a'),
        vacancyId: v.id,
        name: p.name, phone: p.phone,
        years: p.years, district: p.district, salary: p.salary,
        about: p.about, resumeThumb: null,
        createdAt: Date.now() - Math.floor(Math.random() * 86400000)
      };
      a.screening = screenApplicant(v, a);
      a.status = a.screening.autoDeclined ? 'declined' : p.status;
      db.applicants[a.id] = a;
    });
    saveDB();
  }

  /* ────────── Движок скрининга ──────────
     В продакшене вместо evaluateRule() — вызов LLM по API
     (например, GPT-4o-mini): текст правила + текст анкеты →
     JSON {pass, reason}. Логика ниже — офлайн-имитация для демо.
     Причины возвращаются структурой {s, k, p} и переводятся при показе. */

  var STOP = new Set(['можно', 'нужно', 'чтобы', 'только', 'обязательно', 'желательно', 'готовы', 'готов',
    'живёте', 'живете', 'работать', 'наличие', 'есть', 'будет', 'если', 'или', 'для']);

  function tokens(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .split(/[^a-zа-я0-9]+/)
      .filter(Boolean);
  }

  function keywordMatch(keyword, hayTokens) {
    var k = keyword.replace(/ё/g, 'е');
    if (k.length < 4) return false;
    var kp = k.slice(0, 5);
    for (var i = 0; i < hayTokens.length; i++) {
      var tk = hayTokens[i];
      if (tk === k) return true;
      if (tk.length >= 5 && k.length >= 5 && tk.slice(0, 5) === kp) return true;
      if (tk.length < 5 && k.length < 5 && tk === k) return true;
    }
    return false;
  }

  function evalRule(rule, a) {
    var r = String(rule).toLowerCase().replace(/ё/g, 'е');

    var m = r.match(/от\s+(\d+)\s*(лет|года|год)/);
    if (m) {
      var minY = parseInt(m[1], 10);
      return (a.years || 0) >= minY
        ? { s: 'ok', k: 'yearsOk', p: { yn: a.years || 0, min: minY } }
        : { s: 'bad', k: 'yearsLow', p: { yn: a.years || 0, min: minY } };
    }
    m = r.match(/до\s+(\d+)\s*(лет|года|год)/);
    if (m) {
      var maxY = parseInt(m[1], 10);
      return (a.years || 0) <= maxY
        ? { s: 'ok', k: 'yearsMaxOk', p: { yn: a.years || 0, max: maxY } }
        : { s: 'bad', k: 'yearsMaxExceeded', p: { yn: a.years || 0, max: maxY } };
    }
    m = r.match(/зарплата\s+от\s+(\d+)/) || r.match(/от\s+([\d\s]{4,})\s*(руб|₽)/);
    if (m) {
      var minS = parseInt(String(m[1]).replace(/\s/g, ''), 10);
      if (!a.salary) return { s: 'neutral', k: 'salaryMissing' };
      return a.salary >= minS
        ? { s: 'ok', k: 'salaryOk', p: { sum: a.salary } }
        : { s: 'bad', k: 'salaryLow', p: { sum: a.salary } };
    }

    var keywords = tokens(rule).filter(function (w) { return w.length >= 4 && !STOP.has(w); });
    if (!keywords.length) return { s: 'neutral', k: 'manual' };

    var hay = tokens(a.about + ' ' + a.district);
    for (var i = 0; i < keywords.length; i++) {
      if (keywordMatch(keywords[i], hay)) return { s: 'ok', k: 'keywordFound', p: { rule: rule } };
    }
    return { s: 'bad', k: 'keywordMissing', p: { rule: rule } };
  }

  function reasonText(res) {
    var p = {};
    Object.keys(res.p || {}).forEach(function (k) { p[k] = res.p[k]; });
    if (typeof p.yn !== 'undefined') { p.years = yearsWord(p.yn); delete p.yn; }
    if (typeof p.sum === 'number') p.sum = fmtMoney(p.sum);
    return t('r.' + res.k, p);
  }

  function screenApplicant(vacancy, a) {
    var reasons = [], ok = 0, bad = 0;
    vacancy.rules.forEach(function (rule) {
      var res = evalRule(rule, a);
      reasons.push(res);
      if (res.s === 'ok') ok++;
      else if (res.s === 'bad') bad++;
    });
    var score = (ok + bad) ? ok / (ok + bad) : 0.5;
    var level = score >= 0.75 ? 'green' : score >= 0.5 ? 'amber' : 'red';
    return {
      score: Math.round(score * 100),
      level: level,
      reasons: reasons,
      autoDeclined: level === 'red' && (ok + bad) >= 2
    };
  }

  /* ────────── Утилиты DOM ────────── */
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
  function levelBadge(level) {
    return el('span', 'badge badge-' + level, t('level.' + level));
  }

  /* ────────── Роутер ────────── */
  function route() {
    var hash = location.hash || '#/';
    var parts = hash.slice(2).split('/');
    var page = parts[0] || '';
    if (page === '') renderLanding();
    else if (page === 'create') show('view-create');
    else if (page === 'created' && parts[1]) renderCreated(parts[1]);
    else if (page === 'apply' && parts[1]) renderApply(parts[1]);
    else if (page === 'applied' && parts[1]) renderApplied(parts[1]);
    else if (page === 'dashboard') renderDashboard();
    else if (page === 'vacancy' && parts[1]) renderVacancyDetail(parts[1]);
    else renderLanding();
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('langchange', route);

  /* ────────── Лендинг ────────── */
  function renderLanding() { show('view-landing'); }

  /* ────────── Создание вакансии ────────── */
  document.getElementById('create-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var title = f.title.value.trim();
    var district = f.district.value.trim();
    var rules = f.rules.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!title || !district || !rules.length) {
      f.reportValidity();
      return;
    }
    var v = {
      id: uid('v'),
      title: title,
      company: f.company.value.trim() || '—',
      district: district,
      salaryFrom: parseInt(f.salaryFrom.value, 10) || null,
      schedule: f.schedule.value.trim(),
      description: f.description.value.trim(),
      rules: rules,
      createdAt: Date.now()
    };
    db.vacancies[v.id] = v;
    saveDB();
    f.reset();
    location.hash = '#/created/' + v.id;
  });

  function renderCreated(id) {
    var v = db.vacancies[id];
    if (!v) { location.hash = '#/create'; return; }
    var shareUrl = location.href.split('#')[0] + '#/apply/' + v.id;
    var qrBox = document.getElementById('qr-box');
    clear(qrBox);
    try {
      var qr = qrcode(0, 'M');
      qr.addData(shareUrl);
      qr.make();
      qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2 });
    } catch (e) {
      qrBox.textContent = 'QR: ' + shareUrl;
    }
    document.getElementById('share-link').textContent = shareUrl;
    document.getElementById('btn-open-vacancy').href = '#/apply/' + v.id;
    show('view-created');
  }

  /* ────────── Страница вакансии + отклик ────────── */
  function renderApply(id) {
    var v = db.vacancies[id];
    if (!v) { location.hash = '#/'; return; }
    var box = document.getElementById('apply-vacancy');
    clear(box);
    var head = el('div', 'card');
    head.style.marginBottom = '16px';
    head.appendChild(el('div', 'kicker', v.company));
    head.appendChild(el('h1', null, v.title));
    var meta = el('div', 'vacancy-stats');
    if (v.salaryFrom) meta.appendChild(el('span', 'chip', t('misc.fromPerMonth', { sum: fmtMoney(v.salaryFrom) })));
    if (v.schedule) meta.appendChild(el('span', 'chip', v.schedule));
    meta.appendChild(el('span', 'chip', v.district));
    head.appendChild(meta);
    if (v.description) head.appendChild(el('p', 'muted', v.description));
    box.appendChild(head);

    var form = document.getElementById('apply-form');
    form.dataset.vacancyId = id;
    var thumb = document.getElementById('resume-thumb');
    thumb.hidden = true;
    thumb.removeAttribute('src');
    show('view-apply');
  }

  function resizeImage(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 220, scale = Math.min(1, max / Math.max(img.width, img.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        cb(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  var pendingThumb = null;
  document.getElementById('apply-form').addEventListener('change', function (e) {
    if (e.target.name !== 'resume' || !e.target.files.length) return;
    resizeImage(e.target.files[0], function (dataUrl) {
      pendingThumb = dataUrl;
      var thumb = document.getElementById('resume-thumb');
      thumb.src = dataUrl;
      thumb.hidden = false;
    });
  });

  document.getElementById('apply-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var vid = f.dataset.vacancyId;
    var v = db.vacancies[vid];
    if (!v) return;
    var name = f.name.value.trim(), about = f.about.value.trim();
    if (!name || !about || !f.phone.value.trim()) { f.reportValidity(); return; }

    var a = {
      id: uid('a'),
      vacancyId: vid,
      name: name,
      phone: f.phone.value.trim(),
      years: f.years.value === '' ? null : parseInt(f.years.value, 10),
      district: f.district.value.trim(),
      salary: f.salary.value === '' ? null : parseInt(f.salary.value, 10),
      about: about,
      resumeThumb: pendingThumb,
      createdAt: Date.now()
    };
    a.screening = screenApplicant(v, a);
    a.status = a.screening.autoDeclined ? 'declined' : 'new';
    db.applicants[a.id] = a;
    saveDB();
    pendingThumb = null;
    f.reset();
    document.getElementById('resume-thumb').hidden = true;
    location.hash = '#/applied/' + a.id;
  });

  function renderApplied(aid) {
    var a = db.applicants[aid];
    if (!a) { location.hash = '#/'; return; }
    var declined = a.status === 'declined';
    document.getElementById('applied-title').textContent =
      t(declined ? 'applied.noTitle' : 'applied.okTitle');
    document.getElementById('applied-text').textContent =
      t(declined ? 'applied.noText' : 'applied.okText');
    show('view-applied');
  }

  /* ────────── Кабинет ────────── */
  function renderDashboard() {
    document.getElementById('vacancy-list').style.display = 'grid';
    var list = document.getElementById('vacancy-list');
    clear(list);
    Object.keys(db.vacancies).forEach(function (vid) {
      var v = db.vacancies[vid];
      var apprs = applicantsOf(vid);
      var counts = { green: 0, amber: 0, red: 0, newCount: 0 };
      apprs.forEach(function (a) {
        counts[a.screening.level]++;
        if (a.status === 'new') counts.newCount++;
      });
      var item = el('div', 'vacancy-item');
      item.appendChild(el('b', null, v.title + (v.company ? ' · ' + v.company : '')));
      var metaParts = [v.district];
      if (v.salaryFrom) metaParts.push(t('misc.from', { sum: fmtMoney(v.salaryFrom) }));
      item.appendChild(el('div', 'vacancy-meta', metaParts.join(' · ')));
      var stats = el('div', 'vacancy-stats');
      stats.appendChild(el('span', 'badge badge-green', t('dash.fit', { n: counts.green })));
      stats.appendChild(el('span', 'badge badge-amber', t('dash.partial', { n: counts.amber })));
      stats.appendChild(el('span', 'badge badge-red', t('dash.notfit', { n: counts.red })));
      if (counts.newCount) stats.appendChild(el('span', 'badge badge-gray', t('dash.newN', { n: counts.newCount })));
      item.appendChild(stats);
      item.addEventListener('click', function () { location.hash = '#/vacancy/' + vid; });
      list.appendChild(item);
    });
    clear(document.getElementById('vacancy-detail'));
    show('view-dashboard');
  }

  function applicantsOf(vid) {
    return Object.keys(db.applicants).map(function (k) { return db.applicants[k]; })
      .filter(function (a) { return a.vacancyId === vid; })
      .sort(function (x, y) { return y.createdAt - x.createdAt; });
  }

  function renderVacancyDetail(vid) {
    var v = db.vacancies[vid];
    if (!v) { location.hash = '#/dashboard'; return; }
    document.getElementById('vacancy-list').style.display = 'none';
    var detail = document.getElementById('vacancy-detail');
    clear(detail);

    var head = el('div', 'detail-head');
    var back = el('a', 'btn btn-ghost btn-sm', t('dash.back'));
    back.href = '#/dashboard';
    head.appendChild(back);
    head.appendChild(el('h1', null, v.title + ' · ' + v.company));
    detail.appendChild(head);

    var all = applicantsOf(vid);
    var active = all.filter(function (a) { return a.status !== 'declined'; });
    var declined = all.filter(function (a) { return a.status === 'declined'; });

    /* дайджест топ-3 */
    var digest = el('div', 'digest-panel');
    digest.appendChild(el('div', 'digest-title',
      t('dash.digestTop', { n: Math.min(3, active.length), m: active.length })));
    active.slice().sort(function (x, y) { return y.screening.score - x.screening.score; })
      .slice(0, 3)
      .forEach(function (a) {
        var row = el('div', 'digest-item');
        row.appendChild(levelBadge(a.screening.level));
        row.appendChild(el('b', null, a.name));
        row.appendChild(el('span', 'muted', a.screening.score + '% · ' +
          expPhrase(a.years) + ' · ' + (a.district || '')));
        digest.appendChild(row);
      });
    if (!active.length) digest.appendChild(el('p', 'muted', t('dash.empty')));
    detail.appendChild(digest);

    /* карточки кандидатов */
    var grid = el('div', 'applicant-grid');
    active.forEach(function (a) { grid.appendChild(applicantCard(v, a)); });
    detail.appendChild(grid);

    if (declined.length) {
      detail.appendChild(el('div', 'autodecline-head',
        t('dash.declinedHead', { n: declined.length })));
      var g2 = el('div', 'applicant-grid');
      declined.forEach(function (a) { g2.appendChild(applicantCard(v, a)); });
      detail.appendChild(g2);
    }
    show('view-dashboard');
  }

  function applicantCard(v, a) {
    var card = el('div', 'applicant-card');
    var top = el('div', 'applicant-top');
    var nameBox = el('div');
    nameBox.appendChild(el('div', 'applicant-name', a.name));
    nameBox.appendChild(el('div', 'applicant-phone', a.phone + ' · ' + fmtDate(a.createdAt)));
    top.appendChild(nameBox);
    top.appendChild(levelBadge(a.screening.level));
    card.appendChild(top);

    var chips = el('div', 'applicant-chips');
    chips.appendChild(el('span', 'chip', a.years ? yearsWord(a.years) : t('c.noexp')));
    if (a.district) chips.appendChild(el('span', 'chip', a.district));
    if (a.salary) chips.appendChild(el('span', 'chip', t('c.expects', { sum: fmtMoney(a.salary) })));
    card.appendChild(chips);

    if (a.resumeThumb) {
      var res = el('div', 'applicant-resume');
      var img = el('img');
      img.src = a.resumeThumb;
      img.alt = 'Resume';
      res.appendChild(img);
      res.appendChild(el('span', 'muted', t('c.resumeAttached')));
      card.appendChild(res);
    }

    card.appendChild(el('div', 'applicant-about', '«' + a.about + '»'));

    var reasons = el('div', 'reasons');
    a.screening.reasons.forEach(function (r) {
      var line = el('div', 'reason ' + (r.s === 'ok' ? 'ok' : r.s === 'bad' ? 'bad' : 'neutral'));
      line.appendChild(el('span', 'mark', r.s === 'ok' ? '✓' : r.s === 'bad' ? '✕' : '·'));
      line.appendChild(el('span', null, reasonText(r)));
      reasons.appendChild(line);
    });
    card.appendChild(reasons);

    var actions = el('div', 'applicant-actions');
    if (a.status === 'new') {
      var invite = el('button', 'btn btn-primary btn-sm', t('c.invite'));
      invite.addEventListener('click', function () {
        a.status = 'invited'; saveDB();
        renderVacancyDetail(v.id);
      });
      var decline = el('button', 'btn btn-danger btn-sm', t('c.decline'));
      decline.addEventListener('click', function () {
        a.status = 'declined'; saveDB();
        renderVacancyDetail(v.id);
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

  /* ────────── Сброс демо ────────── */
  document.getElementById('btn-reset').addEventListener('click', function () {
    localStorage.removeItem(DB_KEY);
    seed();
    renderDashboard();
  });

  /* ────────── Старт ────────── */
  if (!db || !db.vacancies || !Object.keys(db.vacancies).length) seed();
  route();
})();
