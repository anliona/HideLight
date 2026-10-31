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
  /* чтение-изменение-запись общего ключа. При сетевом сбое чтения НЕ пишем
     вслепую: иначе одно пользовательское действие могло бы затереть весь
     реестр значением, собранным из отката. */
  async function cloudMutate(key, fn, fb) {
    var cur = await cloudRead(key);
    if (!cur) cur = fb ? JSON.parse(JSON.stringify(fb)) : {};
    var next = fn(cur) || cur;
    await cloudWrite(key, next);
    return next;
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

  /* ══════════ Google AI Studio (Gemini) ══════════ */
  function gemCfg() {
    return (window.HL_GEMINI && window.HL_GEMINI.key) ? window.HL_GEMINI : null;
  }
  // JSON-режим Gemini: responseMimeType гарантирует валидный JSON,
  // thinkingBudget:0 отключает внутренние «раздумья» ради скорости
  async function geminiJSON(model, parts, sys, maxTokens) {
    const cfg = gemCfg();
    const body = {
      contents: [{ role: 'user', parts: parts }],
      systemInstruction: { parts: [{ text: sys }] },
      generationConfig: {
        responseMimeType: 'application/json', temperature: 0.2,
        maxOutputTokens: maxTokens || 2048,
        thinkingConfig: { thinkingBudget: 0 },
      },
    };
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' +
      model + ':generateContent?key=' + encodeURIComponent(cfg.key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      var err = new Error('GEMINI ' + r.status);
      err.status = r.status;
      try { err.detail = (await r.text()).slice(0, 200); } catch (e) {}
      // всплески нагрузки (503) бывают короткими — одна повторная попытка
      if (r.status === 503) {
        await new Promise(function (r2) { setTimeout(r2, 2500); });
        return geminiJSON(model, parts, sys, maxTokens);
      }
      throw err;
    }
    const j = await r.json();
    const cand = (j.candidates || [])[0];
    if (!cand || !cand.content || !cand.content.parts || !cand.content.parts.length) {
      throw new Error('GEMINI empty response');
    }
    return cand.content.parts.map(function (p) { return p.text || ''; }).join('');
  }
  // порядок провайдеров: Gemini first (по умолчанию) или DeepSeek first
  function geminiFirst() {
    return gemCfg() && (!window.HL_GEMINI.priority || window.HL_GEMINI.priority === 'first');
  }
  // единый роутер текстовых запросов: Gemini → DeepSeek (или наоборот)
  function aiChatRaw(sys, user, maxTok) {
    if (!gemCfg()) return llmChat([{ role: 'system', content: sys }, { role: 'user', content: user }], maxTok || 900);
    if (geminiFirst()) {
      return geminiJSON(gemCfg().sttModel || 'gemini-2.5-flash', [{ text: user }], sys, maxTok || 2048)
        .catch(function (e) {
          console.warn('gemini chat', e.status || e.message);
          return llmChat([{ role: 'system', content: sys }, { role: 'user', content: user }], maxTok || 900);
        });
    }
    return llmChat([{ role: 'system', content: sys }, { role: 'user', content: user }], maxTok || 900)
      .catch(function (e) {
        console.warn('deepseek chat', e.status || e.message);
        return geminiJSON(gemCfg().sttModel || 'gemini-2.5-flash', [{ text: user }], sys, maxTok || 2048);
      });
  }
  // PCM 24кГц от Gemini-TTS → WAV (data-URL)
  function pcmToWavB64(b64, sampleRate) {
    var bin = atob(b64), len = bin.length;
    var buf = new ArrayBuffer(44 + len);
    var v = new DataView(buf);
    function ws(off, str) { for (var i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); }
    ws(0, 'RIFF'); v.setUint32(4, 36 + len, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    ws(36, 'data'); v.setUint32(40, len, true);
    for (var i2 = 0; i2 < len; i2++) v.setUint8(44 + i2, bin.charCodeAt(i2));
    var bytes = new Uint8Array(buf), s2 = '';
    for (var i3 = 0; i3 < bytes.length; i3++) s2 += String.fromCharCode(bytes[i3]);
    return btoa(s2);
  }
  var _gemAudio = null;
  async function geminiSpeak(text) {
    const cfg = gemCfg();
    const body = {
      contents: [{ role: 'user', parts: [{ text: text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: cfg.voiceName || 'Kore' } } },
      },
    };
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' +
      (cfg.ttsModel || 'gemini-2.5-flash-preview-tts') + ':generateContent?key=' + encodeURIComponent(cfg.key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      var err = new Error('GEMINI TTS ' + r.status);
      err.status = r.status;
      throw err;
    }
    const j = await r.json();
    const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
    var pd = null;
    for (var i = 0; i < parts.length; i++) if (parts[i].inlineData) { pd = parts[i].inlineData; break; }
    if (!pd || !pd.data) throw new Error('GEMINI TTS: no audio');
    // новые TTS-модели отдают готовый WAV — не перекодируем
    var src = /wav/i.test(pd.mimeType || '')
      ? 'data:audio/wav;base64,' + pd.data
      : 'data:audio/wav;base64,' + pcmToWavB64(pd.data, (/rate=(\d+)/.exec(pd.mimeType || '') || [])[1] || 24000);
    if (_gemAudio) { try { _gemAudio.pause(); } catch (e) {} }
    _gemAudio = new Audio(src);
    await _gemAudio.play();
  }
  // запись ответа → текст
  async function geminiTranscribe(b64, mime) {
    const cfg = gemCfg();
    const out = await geminiJSON(cfg.sttModel || 'gemini-2.5-flash', [
      { inlineData: { mimeType: mime || 'audio/webm', data: b64 } },
      { text: 'Transcribe this audio recording verbatim, in the language actually spoken. ' +
        'If it is silence or noise, reply with an empty text. Reply JSON {"text":"..."}' },
    ], 'You are a speech-to-text engine. Output only the requested JSON.', 512);
    try { return (JSON.parse(out).text || '').trim(); } catch (e) { return ''; }
  }
  async function aiScreenDeep(vacancy, company, application) {
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
        languages: application.langs, about: application.about,
        voiceInterview: (application.interview && application.interview.items || [])
          .filter(function (x) { return x.a; })
          .map(function (x, i) { return { q: x.q, a: x.a }; }) }) + '\n\n' +
      (application.interview ? 'A voice interview transcript is included in the profile (voiceInterview). ' +
        'Base your verdicts on the whole picture: the written profile AND the interview answers.\n' : '') +
      'TASKS:\n' +
      '1. detectedLang: "ru"|"zh"|"en" of the about text.\n' +
      '2. aboutTranslated: translate the about text into ALL THREE languages: {"ru":"...","zh":"...","en":"..."}.\n' +
      '3. languageOk: true/false against REQUIRED LANGUAGE (if any).\n' +
      '4. For EVERY screening rule: verdict pass true/false and a short friendly reason in ALL THREE languages: ' +
      '{"ru":"...","zh":"...","en":"..."}. For bonus rules say it is a plus, not required.\n' +
      'Use only facts from the profile; unverifiable rules → pass=false and say what is worth clarifying on a call.\n' +
      'RESPOND JSON only: {"detectedLang":"ru","aboutTranslated":{"ru":"...","zh":"...","en":"..."},' +
      '"languageOk":true,"languageReason":{"ru":"...","zh":"...","en":"..."},' +
      '"verdicts":[{"rule":"<original rule>","pass":true,"reason":{"ru":"...","zh":"...","en":"..."}}]}';
    const raw = await llmChat([
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ], 1400);
    return parseScreenJSON(vacancy, raw);
  }
  // общий парсер ответа семантического скрининга (Gemini и DeepSeek)
  function parseScreenJSON(vacancy, raw) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('no JSON');
    const p = JSON.parse(m[0]);
    function tri(x) {
      if (x && typeof x === 'object') return { ru: x.ru || '', zh: x.zh || '', en: x.en || '' };
      return { ru: x || '', zh: x || '', en: x || '' };
    }
    var reasons = [];
    if (vacancy.reqLang && vacancy.reqLang !== 'any') {
      var lr = tri(p.languageReason);
      reasons.push({ s: p.languageOk ? 'ok' : 'bad', ru: lr.ru, zh: lr.zh, en: lr.en });
    }
    (p.verdicts || []).forEach(function (v) {
      var rr = tri(v.reason);
      reasons.push({ s: v.pass ? 'ok' : 'bad', ru: rr.ru, zh: rr.zh, en: rr.en, rule: v.rule || '' });
    });
    const okN = reasons.filter(r => r.s === 'ok').length;
    const badN = reasons.filter(r => r.s === 'bad').length;
    const score = (okN + badN) ? Math.round(okN / (okN + badN) * 100) : 50;
    const level = score >= 75 ? 'green' : score >= 50 ? 'amber' : 'red';
    var at = p.aboutTranslated;
    var atObj = (at && typeof at === 'object') ? { ru: at.ru || '', zh: at.zh || '', en: at.en || '' } : null;
    return { engine: 'ai', score, level, reasons,
             aboutTranslated: atObj,
             autoDeclined: level === 'red' && (okN + badN) >= 2 };
  }
  /* Семантический скрининг через Gemini: сравнивает СМЫСЛ ответа и правила,
     а не совпадение слов. «Стаж 3 года» = «нахожусь в сфере 3 года». */
  async function geminiScreen(vacancy, company, application) {
    const sys = 'You are a precise hiring screener for small businesses. ' +
      'Judge by MEANING, never by exact word matches. Reply ONLY with the requested JSON object.';
    var profile = { name: application.name, yearsExperience: application.years,
      district: application.district, expectedSalary: application.salary,
      salaryCurrency: application.salCur, languages: application.langs, about: application.about };
    var iv = ((application.interview || {}).items || []).filter(function (x) { return x.a; });
    if (iv.length) profile.voiceInterview = iv.map(function (x) { return { question: x.q, answer: x.a }; });
    const user =
      'VACANCY: ' + vacancy.title + ' at ' + (company || '') + ' (' + vacancy.district + ')' +
      (vacancy.salaryFrom ? ', salary from ' + vacancy.salaryFrom : '') + '\n' +
      'SCREENING RULES (owner-defined, one per line; rules ending with "— плюс" are bonus, not required):\n' +
      vacancy.rules.map((r, i) => (i + 1) + '. ' + r).join('\n') + '\n' +
      (vacancy.reqLang && vacancy.reqLang !== 'any'
        ? 'REQUIRED LANGUAGE: applicant must speak ' + vacancy.reqLang + '. Declared languages: ' + (application.langs || []).join(', ') + '\n'
        : '') +
      'APPLICANT PROFILE (JSON):\n' + JSON.stringify(profile) + '\n\n' +
      'SEMANTIC MATCHING RULES:\n' +
      '- The applicant may phrase things differently from the rule: synonyms, other word order, colloquialisms, another language. Compare MEANING. Example: rule "стаж работы 3 года" and answer "нахожусь в данной сфере 3 года" state the same fact → pass=true.\n' +
      '- Extract facts from BOTH the written profile AND the voice interview answers (the transcript is the richer source).\n' +
      '- pass=false ONLY when the meaning is genuinely missing or contradicts the rule; then the reason says what is worth clarifying on a call.\n' +
      '- Numbers still matter: "от 3 лет" requires at least 3 years of real experience.\n\n' +
      'TASKS:\n' +
      '1. detectedLang: "ru"|"zh"|"en" of the about text.\n' +
      '2. aboutTranslated: translate the about text into ALL THREE languages: {"ru":"...","zh":"...","en":"..."}.\n' +
      '3. languageOk: true/false against REQUIRED LANGUAGE (if any).\n' +
      '4. For EVERY screening rule: verdict pass true/false and a short friendly reason in ALL THREE languages: {"ru":"...","zh":"...","en":"..."}. For bonus rules say it is a plus, not required.\n' +
      'RESPOND JSON only: {"detectedLang":"ru","aboutTranslated":{"ru":"...","zh":"...","en":"..."},' +
      '"languageOk":true,"languageReason":{"ru":"...","zh":"...","en":"..."},' +
      '"verdicts":[{"rule":"<original rule>","pass":true,"reason":{"ru":"...","zh":"...","en":"..."}}]}';
    const raw = await geminiJSON(gemCfg().sttModel || 'gemini-2.5-flash', [{ text: user }], sys, 4096);
    return parseScreenJSON(vacancy, raw);
  }
  /* Роутер скрининга: Gemini (если есть ключ) → DeepSeek. Вызывающий код
     при полном провале откатывается на офлайн-движок правил. */
  async function aiScreen(vacancy, company, application) {
    if (!gemCfg()) return aiScreenDeep(vacancy, company, application);
    if (geminiFirst()) {
      try { return await geminiScreen(vacancy, company, application); }
      catch (e) { console.warn('gemini screen', e.status || e.message); }
      return aiScreenDeep(vacancy, company, application);
    }
    try { return await aiScreenDeep(vacancy, company, application); }
    catch (e) { console.warn('deepseek screen', e.status || e.message); }
    return geminiScreen(vacancy, company, application);
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
    // причины триязычны {s,ru,zh,en} — язык выбирается при показе (reasonText)
    const reasons = [];
    let ok = 0, bad = 0;
    const push = (s, mk) => reasons.push({ s, ru: mk(REASONS_T.ru), zh: mk(REASONS_T.zh), en: mk(REASONS_T.en) });
    if (vacancy.reqLang && vacancy.reqLang !== 'any') {
      const knows = (application.langs || []).includes(vacancy.reqLang);
      const lname = langName(vacancy.reqLang);
      push(knows ? 'ok' : 'bad', T => knows ? T.langOk(lname) : T.langBad(lname));
      knows ? ok++ : bad++;
    }
    const hay = tokens(application.about + ' ' + application.district);
    (vacancy.rules || []).forEach(rule => {
      const soft = /—\s*(плюс|да|готовы|готов|готова)\s*$/i.test(rule.trim());
      const rl = String(rule).toLowerCase().replace(/ё/g, 'е');
      let m = rl.match(/от\s+(\d+)\s*(лет|года|год)/);
      if (m) {
        const min = +m[1], y = application.years || 0;
        if (y >= min) { push('ok', T => T.yearsOk(T.yearsWord(y))); ok++; }
        else if (soft) { push('neutral', T => T.bonusNeutral(rule)); }
        else { push('bad', T => T.yearsLow(T.yearsWord(y), min)); bad++; }
        return;
      }
      m = rl.match(/до\s+(\d+)\s*(лет|года|год)/);
      if (m) {
        const max = +m[1], y = application.years || 0;
        if (y <= max) { push('ok', T => T.yearsOk(T.yearsWord(y))); ok++; }
        else { push('bad', T => T.yearsWord(y) + ' > ' + max); bad++; }
        return;
      }
      const kws = tokens(rule).filter(w => w.length >= 4 && !STOP.has(w));
      if (!kws.length) { push('neutral', () => rule); return; }
      const hit = kws.some(kw => kwMatch(kw, hay));
      if (hit) { push('ok', T => T.found(rule)); ok++; }
      else if (soft) { push('neutral', T => T.bonusNeutral(rule)); }
      else { push('bad', T => T.missing(rule)); bad++; }
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
  var CUR_SYM = { RUB: '₽', USD: '$', EUR: '€', CNY: '¥' };
  function fmtMoney(n) {
    try { return Number(n).toLocaleString(window.tLocale()); } catch (e) { return String(n); }
  }
  function money(amount, cur) {
    cur = cur || 'RUB';
    var sym = CUR_SYM[cur] || '';
    var num = fmtMoney(amount);
    if (cur === 'RUB') return num + ' ' + sym;
    if (cur === 'CNY') return sym + num;
    return sym + num;
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
  // причина вердикта: новые скрининги триязычны {s,ru,zh,en},
  // старые (до локализации) хранили готовый текст в r.text
  function reasonText(r, lang) {
    if (!r) return '';
    return r[lang] || r.ru || r.text || r.en || r.zh || '';
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
          setBusy(btn, false);
          afterAuth({ email: email, role: authRole, name: rec.name, blob: rec.blob || null }, 2600);
        } else {
          setBusy(btn, false);
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
        if (v.salaryFrom) stats.appendChild(el('span', 'chip', money(v.salaryFrom, v.cur)));
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
    if (v.salaryFrom) stats.appendChild(el('span', 'chip', t('misc.from', { sum: money(v.salaryFrom, v.cur) })));
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
      window.__hl_interview = null;
      var vs = document.getElementById('voice-status');
      if (vs) { vs.hidden = true; vs.innerHTML = ''; }
      show('view-apply');
    });
  }

  document.getElementById('apply-form').addEventListener('input', function () { markDirty('apply-form'); });
  /* Скрининг на стороне соискателя при отправке анкеты:
     сначала семантический AI (Gemini → DeepSeek), при сбое — офлайн-правила. */
  async function screenApplication(v, application) {
    // старые вакансии в ленте без rules — достаём правила из блоба работодателя
    var vac = v;
    if (!(vac.rules || []).length && vac.blob) {
      try {
        var blob = await cloudRead(vac.blob);
        var bv = blob && (blob.vacancies || []).find(function (x) { return x.id === vac.id; });
        if (bv && (bv.rules || []).length) vac = Object.assign({}, vac, bv);
      } catch (e) { console.warn('rules from blob', e); }
    }
    try {
      const timeout = new Promise(function (_, rej) {
        setTimeout(function () { rej(new Error('screen timeout')); }, 45000);
      });
      return await Promise.race([aiScreen(vac, vac.company || '', application), timeout]);
    } catch (e) {
      console.warn('semantic screen failed, fallback to rules', e);
      return rulesScreen(vac, application);
    }
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
        salCur: f.salCur.value,
        about: f.about.value.trim(), langs: langs,
        createdAt: Date.now(), status: 'new', screening: null,
        interview: window.__hl_interview || null,
      };
      application.screening = await screenApplication(v, application);
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

  /* ══════════ Голосовое AI-интервью соискателя ══════════
     AI озвучивает вопрос (speechSynthesis), ответ — push-to-talk:
     зажал кнопку → идёт запись/распознавание, отпустил → стоп.
     Расшифровку анализирует DeepSeek: триязычное резюме + вердикт.
     Если распознавания нет — печатный режим (тот же анализ). */
  var VOICE_QS = {
    ru: [
      'Расскажите коротко о вашем опыте работы в этой сфере.',
      'Какой график работы вам удобен? Есть ли ограничения по сменам или времени?',
      'Какие у вас сильные стороны и что вы умеете лучше всего?',
      'Почему вам интересна эта работа?',
    ],
    zh: [
      '请简单介绍一下您在这一行业的工作经验。',
      '什么样的工作时间安排对您合适？对班次或时间有限制吗？',
      '您的主要优势是什么？您最擅长什么？',
      '为什么这份工作让您感兴趣？',
    ],
    en: [
      'Tell us briefly about your experience in this field.',
      'What work schedule suits you? Any limits on shifts or hours?',
      'What are your strengths and what are you best at?',
      'Why does this job interest you?',
    ],
  };
  var REC_LANG = { ru: 'ru-RU', zh: 'zh-CN', en: 'en-US' };

  function voiceQS() { return VOICE_QS[getLang()] || VOICE_QS.ru; }

  function voicePickLang() {
    try {
      var want = { ru: 'ru', zh: 'zh', en: 'en' }[getLang()] || 'ru';
      var vs = speechSynthesis.getVoices() || [];
      for (var i = 0; i < vs.length; i++) if (vs[i].lang && vs[i].lang.toLowerCase().indexOf(want) === 0) return vs[i];
    } catch (e) {}
    return null;
  }
  function browserSpeak(text) {
    try {
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = REC_LANG[getLang()] || 'ru-RU';
      var v = voicePickLang();
      if (v) u.voice = v;
      u.rate = 1;
      speechSynthesis.speak(u);
    } catch (e) { console.warn('tts', e); }
  }
  // озвучка вопроса: голос AI Studio (Gemini-TTS), при сбое — браузерный синтез
  function voiceSpeak(text) {
    if (gemCfg()) {
      geminiSpeak(text).catch(function (e) {
        console.warn('gemini tts', e.status || e.message);
        browserSpeak(text);
      });
      return;
    }
    browserSpeak(text);
  }
  function voiceStop() { try { speechSynthesis.cancel(); } catch (e) {} }

  function interviewAnalyze(items, lang) {
    var spoken = items.filter(function (x) { return x.a; });
    if (!spoken.length || (!gemCfg() && !aiCfg().key)) {
      return Promise.resolve({ engine: 'local', lang: lang, items: items,
        summary: null, verdict: null });
    }
    var sys = 'You are a concise, friendly hiring assistant. Answer ONLY with a valid JSON object, no markdown.';
    var user =
      'An AI voice interview was conducted with a job applicant. Questions were asked aloud; answers are transcribed below.\n' +
      'TRANSCRIPT:\n' +
      spoken.map(function (x, i) { return (i + 1) + '. Q: ' + x.q + '\n   A: ' + x.a; }).join('\n') + '\n\n' +
      'TASKS:\n' +
      '1. summary: 2-3 friendly sentences about the candidate IN ALL THREE languages {"ru","zh","en"} — experience, strengths, anything notable or concerning. Base it ONLY on what was actually said.\n' +
      '2. verdict: fit score 0-100, level "green"|"amber"|"red" (green=strong, amber=worth a call, red=weak fit), and 2-4 short bullet reasons in ALL THREE languages.\n' +
      'RESPOND JSON only: {"summary":{"ru":"...","zh":"...","en":"..."},"verdict":{"score":75,"level":"amber","reasons":[{"s":"ok","ru":"...","zh":"...","en":"..."}]}}';
    return aiChatRaw(sys, user, 2048)
      .then(function (raw) {
        var m = raw.match(/\{[\s\S]*\}/);
        if (!m) throw new Error('no JSON');
        var p = JSON.parse(m[0]);
        function tri(x) { return x && typeof x === 'object' ? { ru: x.ru || '', zh: x.zh || '', en: x.en || '' } : { ru: x || '', zh: x || '', en: x || '' }; }
        var sm = tri(p.summary);
        var vd = p.verdict && typeof p.verdict === 'object' ? {
          score: parseInt(p.verdict.score, 10) || 0,
          level: ['green', 'amber', 'red'].indexOf(p.verdict.level) >= 0 ? p.verdict.level : 'amber',
          reasons: (p.verdict.reasons || []).map(function (r) {
            var t3 = tri(r);
            return { s: r.s === 'ok' ? 'ok' : 'bad', ru: t3.ru, zh: t3.zh, en: t3.en };
          }),
        } : null;
        return { engine: 'ai', lang: lang, items: items, summary: sm, verdict: vd };
      })
      .catch(function (e) {
        console.warn('interview analyze', e);
        return { engine: 'local', lang: lang, items: items, summary: null, verdict: null, aiError: e.status || null };
      });
  }

  function openVoiceInterview() {
    var old = document.getElementById('voice-modal');
    if (old) old.remove();
    voiceStop();
    var qs = voiceQS();
    var items = qs.map(function (q) { return { q: q, a: '' }; });
    var idx = 0;
    var done = false;
    var started = false;
    var recInst = null, recActive = false, finalText = '', interimText = '', committed = false;
    var canRec = !!(window.SpeechRecognition || window.webkitSpeechRecognition) && !!window.speechSynthesis;
    // gemini = запись в файл + распознавание моделью AI Studio;
    // web = живое браузерное распознавание; typed = печать
    var mode = gemCfg() ? 'gemini' : (canRec ? 'web' : 'typed');
    var micStream = null, mediaRec = null, recChunks = [];

    var overlay = el('div', 'qr-modal');
    overlay.id = 'voice-modal';
    var card = el('div', 'qr-modal-card voice-modal-card');
    var close = el('button', 'qr-modal-close', '×');
    close.addEventListener('click', closeModal);
    card.appendChild(close);
    var body = el('div', 'voice-body');
    card.appendChild(body);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    function closeModal() {
      done = true;
      stopRec();
      stopGemRec();
      releaseMic();
      voiceStop();
      overlay.remove();
    }
    function releaseMic() {
      if (micStream) {
        try { micStream.getTracks().forEach(function (tr) { tr.stop(); }); } catch (e) {}
        micStream = null;
      }
    }

    function draw() {
      clear(body);
      if (idx === 0 && !items[0].a && finalText === '' && !started) return drawIntro();
      if (idx >= qs.length) return drawProcessing();
      drawQuestion();
    }

    function drawIntro() {
      body.appendChild(el('div', 'qr-title', t('voice.modalTitle')));
      body.appendChild(el('p', 'voice-intro', t('voice.intro')));
      var b = el('button', 'btn btn-primary', t('voice.start'));
      b.addEventListener('click', function () {
        started = true;
        if (mode === 'gemini') requestMic();
        voiceSpeak(qs[idx]);
        draw();
      });
      var row = el('div', 'voice-row');
      row.appendChild(b);
      body.appendChild(row);
    }

    function drawQuestion() {
      body.appendChild(el('div', 'voice-qnum', t('voice.qOf', { n: idx + 1, all: qs.length })));
      var qrow = el('div', 'voice-row');
      qrow.style.alignItems = 'center';
      qrow.appendChild(Object.assign(el('div', 'voice-qtext', qs[idx]), { style: 'flex:1;margin:0;' }));
      var rep = el('button', 'btn btn-ghost btn-sm', t('voice.repeat'));
      rep.addEventListener('click', function () { voiceSpeak(qs[idx]); });
      qrow.appendChild(rep);
      body.appendChild(qrow);

      var answer = items[idx].a;
      if (!committed && answer) committed = true;
      var nextB = null;

      if (mode === 'gemini' || canRec) {
        var hold = el('button', 'voice-hold');
        hold.type = 'button';
        hold.appendChild(el('span', 'dot'));
        var holdLbl = el('span', null, t('voice.hold'));
        hold.appendChild(holdLbl);
        var live = el('div', 'voice-live');
        body.appendChild(hold);
        body.appendChild(live);

        hold.addEventListener('pointerdown', function (ev) {
          ev.preventDefault();
          if (recActive) return;
          if (mode === 'gemini') startGemRec(hold, live, holdLbl);
          else startRec(hold, live, holdLbl);
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (evn) {
          hold.addEventListener(evn, function () {
            if (mode === 'gemini') stopGemRec(hold, live, holdLbl);
            else stopRec(hold, live, holdLbl);
          });
        });
        // страховка: палец «съехал» за пределы кнопки
        hold.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      } else {
        body.appendChild(el('p', 'voice-live', t('voice.typeNote')));
        var ta = el('textarea', 'voice-typed');
        ta.value = items[idx].a || '';
        ta.addEventListener('input', function () {
          items[idx].a = ta.value.trim();
          if (nextB) nextB.disabled = !(items[idx].a && items[idx].a.length > 1);
        });
        body.appendChild(ta);
      }

      var row = el('div', 'voice-row');
      if (committed && items[idx].a) {
        var ansBox = el('div', 'voice-ans');
        ansBox.appendChild(el('b', null, t('voice.said')));
        ansBox.appendChild(el('div', 'qa-a', items[idx].a));
        body.appendChild(ansBox);
        var redo = el('button', 'btn btn-ghost btn-sm', t('voice.rerecord'));
        redo.addEventListener('click', function () {
          committed = false; finalText = ''; interimText = ''; items[idx].a = '';
          draw();
        });
        row.appendChild(redo);
      }
      var skip = el('button', 'btn btn-ghost btn-sm', t('voice.skip'));
      skip.addEventListener('click', function () { items[idx].a = ''; next(); });
      nextB = el('button', 'btn btn-primary btn-sm', t('voice.next'));
      nextB.disabled = !(items[idx].a && items[idx].a.length > 1);
      nextB.addEventListener('click', next);
      row.appendChild(skip);
      row.appendChild(nextB);
      body.appendChild(row);
    }

    function startRec(hold, live, lbl) {
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      finalText = ''; interimText = '';
      recInst = new SR();
      recInst.lang = REC_LANG[getLang()] || 'ru-RU';
      recInst.interimResults = true;
      recInst.continuous = true;
      recInst.onresult = function (ev) {
        interimText = '';
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          if (ev.results[i].isFinal) finalText += ev.results[i][0].transcript + ' ';
          else interimText += ev.results[i][0].transcript;
        }
        if (live) live.textContent = (finalText + ' ' + interimText).trim();
      };
      recInst.onerror = function (ev) {
        console.warn('rec', ev.error);
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
          canRec = false; // микроразрешение нет — печатный режим
          stopRec(hold, live, lbl);
          draw();
        }
      };
      try { recInst.start(); recActive = true; } catch (e) { recActive = false; }
      if (hold) hold.classList.add('rec');
      if (lbl) lbl.textContent = t('voice.recording');
    }

    function stopRec(hold, live, lbl) {
      if (!recActive) return;
      recActive = false;
      try { recInst && recInst.stop(); } catch (e) {}
      if (hold) hold.classList.remove('rec');
      if (lbl) lbl.textContent = t('voice.hold');
      // финальные результаты распознавания приходят с задержкой — короткая пауза
      var myIdx = idx;
      setTimeout(function () {
        if (done || myIdx !== idx || committed) return;
        var a = (finalText || interimText || '').trim();
        if (a) { items[myIdx].a = a; committed = true; draw(); }
      }, 700);
    }

    /* ── Режим AI Studio: запись в буфер → транскрибация моделью ── */
    function requestMic() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        mode = canRec ? 'web' : 'typed';
        return;
      }
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (st) {
        micStream = st;
      }).catch(function (e) {
        console.warn('mic denied', e);
        mode = canRec ? 'web' : 'typed';
        if (started && !done && idx < qs.length) draw();
      });
    }
    function startGemRec(hold, live, lbl) {
      if (!micStream) { requestMic(); if (!micStream) return; }
      var mime = '';
      try {
        if (window.MediaRecorder && MediaRecorder.isTypeSupported &&
            MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mime = 'audio/webm;codecs=opus';
      } catch (e) {}
      try {
        recChunks = [];
        mediaRec = new MediaRecorder(micStream, mime ? { mimeType: mime } : undefined);
      } catch (e) {
        console.warn('MediaRecorder', e);
        mode = canRec ? 'web' : 'typed';
        draw();
        return;
      }
      var myIdx = idx;
      mediaRec.ondataavailable = function (ev) { if (ev.data && ev.data.size) recChunks.push(ev.data); };
      mediaRec.onstop = function () {
        var mtype = (mediaRec && mediaRec.mimeType) || mime || 'audio/webm';
        var blob = new Blob(recChunks, { type: mtype });
        recChunks = [];
        if (!blob.size || done || myIdx !== idx) return;
        var fr = new FileReader();
        fr.onload = function () {
          if (done || myIdx !== idx) return;
          var b64 = String(fr.result).split(',')[1] || '';
          if (!b64) return;
          if (live) live.textContent = t('voice.recognizing');
          geminiTranscribe(b64, mtype).then(function (txt) {
            commitVoice(txt, myIdx, live);
          }).catch(function (e) {
            console.warn('gemini stt', e.status || e.message);
            // Gemini недоступен — откат на браузерное распознавание или печать
            mode = canRec ? 'web' : 'typed';
            draw();
          });
        };
        fr.readAsDataURL(blob);
      };
      mediaRec.start();
      recActive = true;
      if (hold) hold.classList.add('rec');
      if (lbl) lbl.textContent = t('voice.recording');
      if (live) live.textContent = t('voice.recording');
    }
    function stopGemRec(hold, live, lbl) {
      if (!recActive) return;
      recActive = false;
      try { mediaRec.stop(); } catch (e) {}
      if (hold) hold.classList.remove('rec');
      if (lbl) lbl.textContent = t('voice.hold');
    }
    function commitVoice(txt, myIdx, live) {
      if (done || myIdx !== idx) return;
      var a = (txt || '').trim();
      if (a) {
        items[myIdx].a = a;
        committed = true;
        draw();
      } else if (live) {
        live.textContent = t('voice.typeNote');
      }
    }

    function next() {
      stopRec();
      stopGemRec();
      committed = false; finalText = ''; interimText = '';
      idx++;
      if (idx >= qs.length) return drawProcessing();
      voiceSpeak(qs[idx]);
      draw();
    }

    function drawProcessing() {
      clear(body);
      body.appendChild(el('div', 'voice-qnum', t('voice.processing')));
      var sp = el('div', 'voice-processing', '⏳');
      sp.style.fontSize = '34px';
      body.appendChild(sp);
      interviewAnalyze(items, getLang()).then(function (res) {
        if (done) return;
        window.__hl_interview = res;
        updateVoiceStatus();
        prefillAbout(res);
        drawDone(res);
      });
    }

    function drawDone(res) {
      clear(body);
      body.appendChild(el('div', 'qr-title', t('voice.doneTitle')));
      body.appendChild(el('p', 'voice-intro', t('voice.doneText')));
      var b = el('button', 'btn btn-primary', t('voice.close'));
      b.addEventListener('click', closeModal);
      var row = el('div', 'voice-row');
      row.appendChild(b);
      body.appendChild(row);
    }

    draw();
  }

  function updateVoiceStatus() {
    var vs = document.getElementById('voice-status');
    if (!vs) return;
    clear(vs);
    vs.hidden = false;
    vs.appendChild(el('span', null, t('voice.doneBadge')));
    var again = el('a', null, t('voice.again'));
    again.addEventListener('click', function (e) { e.preventDefault(); openVoiceInterview(); });
    vs.appendChild(again);
  }

  function prefillAbout(res) {
    var form = document.getElementById('apply-form');
    if (!form || !form.about) return;
    if (form.about.value.trim()) return; // рукописный текст не трогаем
    var text = (res.items || []).filter(function (x) { return x.a; })
      .map(function (x) { return x.a; }).join(' ').slice(0, 700);
    if (text) form.about.value = text;
  }

  document.getElementById('voice-start').addEventListener('click', openVoiceInterview);

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
      var raw = await aiChatRaw('You are a translator for a job board. Translate each job title into ' +
        ({ ru: 'Russian', zh: 'Chinese', en: 'English' }[lang]) + '. Keep it short and natural for a job listing. ' +
        'Reply ONLY with a JSON array of translated strings, same order.', list, 1024);
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
        cur: f.cur.value,
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
        id: v.id, blob: myBlobKey(), title: v.title, company: (blob.company && blob.company.name) || me.name,
        companyDesc: blob.company.desc || '', companyCity: blob.company.city || '',
        district: v.district, salaryFrom: v.salaryFrom, cur: v.cur || 'RUB',
        schedule: v.schedule, reqLang: v.reqLang, description: v.description, createdAt: v.createdAt,
        rules: v.rules,
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
      var chat = document.getElementById('ai-chat');
      if (chat) {
        clear(chat);
        var screenedApps = (blob.applications || []).filter(function (a) { return a.screening; })
          .sort(function (x, y) { return y.createdAt - x.createdAt; }).slice(0, 8);
        if (screenedApps.length) {
          chat.hidden = false;
          screenedApps.forEach(function (a) {
            aiChatAdd('bot', a.name, (a.screening.score || 0) + '% · ' + t('level.' + a.screening.level));
          });
        }
      }
      var list = document.getElementById('emp-vacs');
      clear(list);
      var vacs = (blob.vacancies || []).slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
      document.getElementById('emp-none').hidden = !!vacs.length;
      vacs.forEach(function (v) {
        var item = el('div', 'vacancy-item');
        item.appendChild(el('b', null, v.title));
        item.appendChild(el('div', 'vacancy-meta', v.district + (v.salaryFrom ? ' · ' + money(v.salaryFrom, v.cur) : '')));
        var stats = el('div', 'vacancy-stats');
        stats.appendChild(el('span', 'badge badge-gray', fmtDate(v.createdAt)));
        var apps = (blob.applications || []).filter(function (a) { return a.vacancyId === v.id; });
        stats.appendChild(el('span', 'badge badge-gray', t('emp.applicants') + ': ' + apps.length));
        item.appendChild(stats);
        var row = el('div', 'vacancy-actions');
        var qrBtn = el('button', 'qr-btn-card', t('emp.qrBtn'));
        qrBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          openQrModal(v);
        });
        row.appendChild(qrBtn);
        item.appendChild(row);
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

  /* ── QR-код вакансии: модалка с кодом, ссылкой и скачиванием ── */
  function qrSvgDataUrl(text) {
    var qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    var svg = qr.createSvgTag({ cellSize: 6, margin: 2 });
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function openQrModal(v) {
    var shareUrl = location.origin + location.pathname + '#/job/' + v.id;
    var old = document.getElementById('qr-share-modal');
    if (old) old.remove();
    var overlay = el('div', 'qr-modal');
    overlay.id = 'qr-share-modal';
    var card = el('div', 'qr-modal-card');
    var close = el('button', 'qr-modal-close', '×');
    close.addEventListener('click', function () { overlay.remove(); });
    card.appendChild(close);
    card.appendChild(el('div', 'qr-title', v.title));
    card.appendChild(el('div', 'qr-sub', (v.company || me.name || '') + ' · ' + (v.district || '')));
    var body = el('div', 'qr-modal-body');
    var imgBox = el('div', 'qr-img-box');
    var img = el('img');
    img.src = qrSvgDataUrl(shareUrl);
    img.width = 148; img.height = 148;
    img.alt = 'QR';
    imgBox.appendChild(img);
    body.appendChild(imgBox);
    var side = el('div', 'qr-modal-side');
    var linkLine = el('div', 'qr-link-line', shareUrl);
    side.appendChild(linkLine);
    var actions = el('div', 'qr-modal-actions');
    var copyBtn = el('button', 'btn btn-primary btn-sm', t('qr.copyLink'));
    copyBtn.addEventListener('click', function () {
      function done() {
        copyBtn.textContent = t('qr.copied');
        setTimeout(function () { copyBtn.textContent = t('qr.copyLink'); }, 1800);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareUrl).then(done, function () { fallbackCopy(shareUrl); done(); });
      } else { fallbackCopy(shareUrl); done(); }
    });
    actions.appendChild(copyBtn);
    var dl = el('button', 'btn btn-ghost btn-sm', t('qr.download'));
    dl.addEventListener('click', function () {
      var img2 = new Image();
      img2.onload = function () {
        var c = document.createElement('canvas');
        var scale = 4;
        c.width = 148 * scale; c.height = 148 * scale;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img2, 0, 0, c.width, c.height);
        var a = document.createElement('a');
        a.download = 'QR-' + v.title.replace(/[^\w\u0400-\u04FF-]+/g, '_') + '.png';
        a.href = c.toDataURL('image/png');
        a.click();
      };
      img2.src = img.src;
    });
    actions.appendChild(dl);
    side.appendChild(actions);
    body.appendChild(side);
    card.appendChild(body);
    overlay.appendChild(card);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
  }

  /* ── Чат AI-скрининга (без ввода вопросов — только лента) ── */
  function aiChatBox() { return document.getElementById('ai-chat'); }
  function aiChatAdd(kind, who, text) {
    var box = aiChatBox();
    if (!box) return;
    box.hidden = false;
    var m = el('div', 'ai-msg ' + kind);
    if (who) m.appendChild(el('span', 'who', who));
    m.appendChild(el('div', null, text));
    box.appendChild(m);
    box.scrollTop = box.scrollHeight;
    return m;
  }
  function aiChatReset() {
    var box = aiChatBox();
    if (!box) return;
    clear(box);
    box.hidden = false;
  }

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
    if (a.salary) chips.appendChild(el('span', 'chip', t('c.expects', { sum: money(a.salary, a.salCur) })));
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

    // голосовое AI-интервью: резюме + вердикт + расшифровка
    if (a.interview) {
      var iv = el('div', 'interview-block');
      var ivh = el('div', 'interview-head', '🎙 ' + t('card.interview'));
      if (a.interview.verdict) {
        ivh.appendChild(levelBadge(a.interview.verdict.level));
        ivh.appendChild(el('span', 'muted', (a.interview.verdict.score || 0) + '%'));
      }
      iv.appendChild(ivh);
      var ivLang = getLang();
      if (a.interview.summary) {
        var sm = a.interview.summary;
        iv.appendChild(el('div', 'interview-summary', sm[ivLang] || sm.ru || sm.en || ''));
      } else if (!a.interview.verdict) {
        iv.appendChild(el('div', 'interview-summary muted', t('card.noVerdict')));
      }
      var ivr = el('div', 'reasons');
      ((a.interview.verdict || {}).reasons || []).forEach(function (r) {
        var line = el('div', 'reason ' + (r.s === 'ok' ? 'ok' : 'bad'));
        line.appendChild(el('span', 'mark', r.s === 'ok' ? '✓' : '✕'));
        line.appendChild(el('span', null, reasonText(r, ivLang)));
        ivr.appendChild(line);
      });
      if (ivr.children.length) iv.appendChild(ivr);
      var spoken = (a.interview.items || []).filter(function (x) { return x.a; });
      if (spoken.length) {
        var det = document.createElement('details');
        det.appendChild(el('summary', null, t('voice.transcript')));
        spoken.forEach(function (x) {
          var qa = el('div', 'qa');
          qa.appendChild(el('b', null, x.q));
          qa.appendChild(el('div', 'qa-a', '«' + x.a + '»'));
          det.appendChild(qa);
        });
        iv.appendChild(det);
      }
      card.appendChild(iv);
    }

    var reasons = el('div', 'reasons');
    // человечная сводка: совпадение по N из M обязательных правил
    var okN = (a.screening.reasons || []).filter(function (r) { return r.s === 'ok'; }).length;
    var reqN = (a.screening.reasons || []).filter(function (r) { return r.s !== 'neutral'; }).length;
    if (reqN) reasons.appendChild(el('div', null, t('rules.matchLine', { ok: okN, all: reqN })));
    var vLang = getLang();
    (a.screening.reasons || []).forEach(function (r) {
      var line = el('div', 'reason ' + (r.s === 'ok' ? 'ok' : r.s === 'bad' ? 'bad' : 'neutral'));
      line.appendChild(el('span', 'mark', r.s === 'ok' ? '✓' : r.s === 'bad' ? '✕' : '·'));
      line.appendChild(el('span', null, reasonText(r, vLang)));
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
