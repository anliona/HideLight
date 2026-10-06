/* HireLight i18n: ru / zh / en */
(function () {
  'use strict';

  var DICT = {
    ru: {
      'app.title': 'HireLight — AI-фильтр откликов для малого бизнеса',
      'nav.how': 'Как это работает',
      'nav.dash': 'Кабинет',
      'nav.create': 'Создать вакансию',

      'land.kicker': 'Для кофеен, салонов, розницы и сервисов',
      'land.h1': 'Отклики разбираются сами.<br>Вы выбираете людей.',
      'land.lead': 'Кандидаты пишут в WeChat фото резюме и голосовые. HireLight превращает их в структурированные анкеты, проверяет по правилам владельца и присылает вечером дайджест: топ-3 кандидата — с причинами, остальным — вежливый ответ уже отправлен.',
      'land.cta1': 'Создать вакансию — бесплатно',
      'land.cta2': 'Посмотреть демо-кабинет',
      'land.digestTitle': 'Дайджест за сегодня',
      'land.digest1sub': 'бариста, 3 года · Якиманка · смена с 7:00 — да',
      'land.digest2sub': 'студентка, вечера · без опыта — нужен инструктаж',
      'land.digest3sub': 'Химки · ранние смены невозможны · вежливый отказ отправлен',
      'land.digestFoot': 'Сформировано в 19:00 · по вашим правилам',
      'land.pain1b': '40 минут в день',
      'land.pain1': 'уходит на чтение нецелевых откликов в личном чате',
      'land.pain2b': '~50% кандидатов',
      'land.pain2': 'не получают никакого ответа и уходят к конкуренту',
      'land.pain3b': '10 разных форматов',
      'land.pain3': 'резюме: фото, голосовые, «а график какой?»',
      'land.howTitle': 'Как это работает',
      'land.step1t': 'Вакансия и правила',
      'land.step1d': 'Создайте вакансию и запишите требования обычными словами: «опыт от года», «только район центра», «студентам на вечера — да».',
      'land.step2t': 'Кандидаты по QR-коду',
      'land.step2d': 'Отклик — анкета на одну минуту: имя, опыт, район и пара слов о себе. Резюме фото — по желанию.',
      'land.step3t': 'Вечерний дайджест',
      'land.step3d': 'Каждый отклик разобран: подходит / частично / нет — с причинами. Топ-3 в дайджесте, остальным ответ уже ушёл.',
      'land.rulesTitle': 'Правила — вашими словами',
      'land.rulesText': 'Никаких настроек и конструкторов. Пишите так, как сказали бы знакомому: HireLight сверяет каждую анкету с этими правилами и объясняет решение по каждому пункту.',
      'land.chip1': 'опыт работы бариста от 1 года',
      'land.chip2': 'живёте или готовы работать в районе Якиманка',
      'land.chip3': 'смена с 7:00 — готовы',
      'land.chip4': 'студентам на вечерние смены — да',
      'land.ctaTitle': 'Первая вакансия — бесплатно',

      'create.h1': 'Новая вакансия',
      'create.lead': 'Заполните карточку и запишите требования обычными словами — именно по ним AI будет разбирать отклики.',
      'create.title': 'Должность *',
      'ph.create.title': 'Бариста',
      'create.company': 'Компания',
      'ph.create.company': 'Кофейня «Сова»',
      'create.district': 'Район / локация *',
      'ph.create.district': 'Москва, Якиманка',
      'create.salary': 'Зарплата от (₽/мес)',
      'create.schedule': 'График',
      'ph.create.schedule': '2/2, смены с 7:00',
      'create.desc': 'Коротко о вакансии',
      'ph.create.desc': 'Спешелти-кофе, дружная команда, обучение за счёт компании.',
      'create.rules': 'Правила отбора — каждое правило с новой строки *',
      'ph.create.rules': 'опыт работы бариста от 1 года\nживёте или готовы работать в районе Якиманка\nсмена с 7:00 — готовы\nстудентам на вечерние смены — да',
      'create.hint': 'Числа важны: «от 1 года», «до 30 лет», «зарплата от 60 000» — считаются автоматически.',
      'create.submit': 'Опубликовать и получить QR',
      'create.cancel': 'Отмена',

      'created.h1': 'Вакансия опубликована',
      'created.lead': 'Поделитесь ссылкой или QR-кодом — отклики появятся в кабинете сразу после отправки.',
      'created.open': 'Открыть страницу вакансии',
      'created.toDash': 'В кабинет',

      'apply.h2': 'Отклик — одна минута',
      'apply.name': 'Имя *',
      'ph.apply.name': 'Анна Соколова',
      'apply.phone': 'Телефон *',
      'ph.apply.phone': '+7 900 000-00-00',
      'apply.years': 'Опыт в этой работе (лет)',
      'apply.salary': 'Желаемая зарплата (₽/мес)',
      'apply.district': 'Район, где вам удобно работать',
      'ph.apply.district': 'Якиманка / центр',
      'apply.about': 'Пара слов о себе *',
      'ph.apply.about': 'Работаю бариста 3 года, последний год в спешелти-кофе на Якиманке. Ранние смены — без проблем, живу рядом.',
      'apply.resume': 'Фото или скан резюме (по желанию)',
      'apply.submit': 'Отправить отклик',

      'applied.okTitle': 'Отклик отправлен',
      'applied.okText': 'Спасибо! Ваша анкета разобрана и передана владельцу — обычно ответ приходит в течение дня.',
      'applied.noTitle': 'Отклик получен',
      'applied.noText': 'Спасибо за интерес! К сожалению, по этой вакансии мы не сможем вас пригласить — анкета не совпадает с ключевыми требованиями. Мы сохранили её, если подходящая вакансия появится позже.',
      'applied.whatsNext': 'Что дальше',
      'applied.nextText': 'Владелец получает разбор вашего отклика и отвечает в течение дня. Если опыт подходит — вам позвонят по указанному телефону.',
      'applied.home': 'На главную',

      'dash.h1': 'Кабинет владельца',
      'dash.reset': 'Сбросить демо-данные',
      'dash.fit': '{n} подходят',
      'dash.partial': '{n} частично',
      'dash.notfit': '{n} нет',
      'dash.newN': '{n} новых',
      'dash.back': '← Вакансии',
      'dash.digestTop': 'Дайджест за сегодня — топ {n} из {m}',
      'dash.empty': 'Пока нет активных откликов — поделитесь QR-кодом со страницы вакансии.',
      'dash.declinedHead': 'Отказы отправлены ({n}) — кандидатам ушёл вежливый ответ',

      'level.green': 'Рекомендуем',
      'level.amber': 'Частично',
      'level.red': 'Не подходит',

      'st.invited': 'Приглашён — ответ отправлен',
      'st.declined': 'Отказ отправлен',
      'c.invite': 'Пригласить',
      'c.decline': 'Отказать',
      'c.noexp': 'без опыта',
      'c.expects': 'ожидает {sum} ₽',
      'c.resumeAttached': 'резюме приложено',
      'misc.fromPerMonth': 'от {sum} ₽/мес',
      'misc.from': 'от {sum} ₽',

      'r.yearsOk': 'опыт {years} — соответствует («от {min}»)',
      'r.yearsLow': 'опыт {years} — меньше требуемого («от {min}»)',
      'r.yearsMaxOk': 'опыт {years} — в рамках («до {max}»)',
      'r.yearsMaxExceeded': 'опыт {years} — выше ограничения («до {max}»)',
      'r.salaryMissing': 'в анкете не указана желаемая зарплата — уточнить',
      'r.salaryOk': 'зарплатные ожидания ({sum}) — в вилке',
      'r.salaryLow': 'желаемая зарплата {sum} ниже вилки — обсудить',
      'r.keywordFound': 'в анкете отмечено: «{rule}»',
      'r.keywordMissing': 'в анкете не найдено подтверждение: «{rule}»',
      'r.manual': 'правило требует взгляда владельца',

      'footer.text': 'Демо-прототип HireLight · данные хранятся локально в вашем браузере · в продакшене разбор анкет выполняет LLM по API'
    },

    en: {
      'app.title': 'HireLight — AI screening for small-business hiring',
      'nav.how': 'How it works',
      'nav.dash': 'Dashboard',
      'nav.create': 'Post a job',

      'land.kicker': 'For cafés, salons, retail and services',
      'land.h1': 'Applications sort themselves.<br>You choose the people.',
      'land.lead': 'Candidates send resume photos and voice notes on WeChat. HireLight turns them into structured profiles, checks each one against the owner\u2019s rules, and delivers an evening digest: the top-3 candidates with reasons — everyone else already got a polite reply.',
      'land.cta1': 'Post a job — free',
      'land.cta2': 'View demo dashboard',
      'land.digestTitle': 'Today\u2019s digest',
      'land.digest1sub': 'barista, 3 yrs · Yakimanka · 7 AM shifts — yes',
      'land.digest2sub': 'student, evenings · no experience — needs training',
      'land.digest3sub': 'Khimki · no early shifts · polite rejection sent',
      'land.digestFoot': 'Generated at 19:00 · by your rules',
      'land.pain1b': '40 minutes a day',
      'land.pain1': 'spent reading irrelevant applications in your personal chat',
      'land.pain2b': '~50% of candidates',
      'land.pain2': 'never get any reply and go to a competitor',
      'land.pain3b': '10 different formats',
      'land.pain3': 'of resumes: photos, voice notes, \u201cwhat\u2019s the schedule?\u201d',
      'land.howTitle': 'How it works',
      'land.step1t': 'Job & rules',
      'land.step1d': 'Create a job and write requirements in plain words: \u201c1+ year of experience\u201d, \u201ccity center only\u201d, \u201cstudents for evenings \u2014 yes\u201d.',
      'land.step2t': 'Candidates via QR code',
      'land.step2d': 'Applying is a one-minute form: name, experience, area and a few words about yourself. Resume photo \u2014 optional.',
      'land.step3t': 'Evening digest',
      'land.step3d': 'Every application is reviewed: fit / partial / no \u2014 with reasons. Top-3 go into the digest, the rest are already answered.',
      'land.rulesTitle': 'Rules in your own words',
      'land.rulesText': 'No settings, no form builders. Write them like you would tell a friend: HireLight checks every application against these rules and explains the decision line by line.',
      'land.chip1': '1+ year of barista experience',
      'land.chip2': 'live or willing to work in Yakimanka area',
      'land.chip3': '7 AM shifts \u2014 OK',
      'land.chip4': 'students for evening shifts \u2014 yes',
      'land.ctaTitle': 'Your first job posting is free',

      'create.h1': 'New job posting',
      'create.lead': 'Fill in the card and write your requirements in plain words \u2014 this is exactly what the AI will screen applications against.',
      'create.title': 'Job title *',
      'ph.create.title': 'Barista',
      'create.company': 'Company',
      'ph.create.company': 'Owl Coffee',
      'create.district': 'Area / location *',
      'ph.create.district': 'Moscow, Yakimanka',
      'create.salary': 'Salary from (RUB/mo)',
      'create.schedule': 'Schedule',
      'ph.create.schedule': '2/2, shifts from 7 AM',
      'create.desc': 'Short description',
      'ph.create.desc': 'Specialty coffee, friendly team, paid training.',
      'create.rules': 'Screening rules \u2014 one per line *',
      'ph.create.rules': '1+ year of barista experience\nlives or ready to work in Yakimanka area\n7 AM shifts \u2014 OK\nstudents for evening shifts \u2014 yes',
      'create.hint': 'Numbers matter: \u201c1+ year\u201d, \u201cunder 30\u201d, \u201csalary from 60,000\u201d are parsed automatically.',
      'create.submit': 'Publish & get QR code',
      'create.cancel': 'Cancel',

      'created.h1': 'Job published',
      'created.lead': 'Share the link or QR code \u2014 applications appear in your dashboard right after submission.',
      'created.open': 'Open job page',
      'created.toDash': 'To dashboard',

      'apply.h2': 'Apply \u2014 one minute',
      'apply.name': 'Full name *',
      'ph.apply.name': 'Anna Sokolova',
      'apply.phone': 'Phone *',
      'ph.apply.phone': '+7 900 000-00-00',
      'apply.years': 'Experience in this role (years)',
      'apply.salary': 'Expected salary (RUB/mo)',
      'apply.district': 'Area convenient for you',
      'ph.apply.district': 'Yakimanka / city center',
      'apply.about': 'A few words about yourself *',
      'ph.apply.about': 'Barista for 3 years, last year in specialty coffee at Yakimanka. Early shifts are fine, I live nearby.',
      'apply.resume': 'Resume photo or scan (optional)',
      'apply.submit': 'Submit application',

      'applied.okTitle': 'Application sent',
      'applied.okText': 'Thanks! Your application was reviewed and passed to the owner \u2014 a reply usually arrives within a day.',
      'applied.noTitle': 'Application received',
      'applied.noText': 'Thanks for your interest! Unfortunately we will not be able to invite you for this role \u2014 your profile does not match the key requirements. We will keep it in case a matching role opens up.',
      'applied.whatsNext': 'What\u2019s next',
      'applied.nextText': 'The owner gets a breakdown of your application and replies within a day. If your experience fits, they will call the phone number you left.',
      'applied.home': 'Back to home',

      'dash.h1': 'Owner dashboard',
      'dash.reset': 'Reset demo data',
      'dash.fit': '{n} fit',
      'dash.partial': '{n} partial',
      'dash.notfit': '{n} no',
      'dash.newN': '{n} new',
      'dash.back': '\u2190 Jobs',
      'dash.digestTop': 'Today\u2019s digest \u2014 top {n} of {m}',
      'dash.empty': 'No active applications yet \u2014 share the QR code from the job page.',
      'dash.declinedHead': 'Rejections sent ({n}) \u2014 candidates received a polite reply',

      'level.green': 'Recommended',
      'level.amber': 'Partial',
      'level.red': 'Not a fit',

      'st.invited': 'Invited \u2014 reply sent',
      'st.declined': 'Rejection sent',
      'c.invite': 'Invite',
      'c.decline': 'Decline',
      'c.noexp': 'no experience',
      'c.expects': 'expects {sum} RUB',
      'c.resumeAttached': 'resume attached',
      'misc.fromPerMonth': 'from {sum} RUB/mo',
      'misc.from': 'from {sum} RUB',

      'r.yearsOk': '{years} of experience \u2014 matches (\u201cfrom {min}\u201d)',
      'r.yearsLow': '{years} of experience \u2014 less than required (\u201cfrom {min}\u201d)',
      'r.yearsMaxOk': '{years} of experience \u2014 within the limit (\u201cup to {max}\u201d)',
      'r.yearsMaxExceeded': '{years} of experience \u2014 above the limit (\u201cup to {max}\u201d)',
      'r.salaryMissing': 'expected salary not provided \u2014 to clarify',
      'r.salaryOk': 'salary expectation ({sum}) \u2014 within the range',
      'r.salaryLow': 'salary expectation {sum} is below the range \u2014 to discuss',
      'r.keywordFound': 'confirmed in the application: \u201c{rule}\u201d',
      'r.keywordMissing': 'no confirmation found: \u201c{rule}\u201d',
      'r.manual': 'this rule needs the owner\u2019s review',

      'footer.text': 'HireLight demo prototype \u00b7 data is stored locally in your browser \u00b7 in production, applications are reviewed by an LLM via API'
    },

    zh: {
      'app.title': 'HireLight — 小微企业招聘 AI 筛选',
      'nav.how': '产品原理',
      'nav.dash': '控制台',
      'nav.create': '发布职位',

      'land.kicker': '适用于咖啡馆、美发沙龙、零售与服务业',
      'land.h1': '申请自动筛选，<br>您只管选人。',
      'land.lead': '候选人通过微信发来简历照片和语音。HireLight 将其转换为结构化简历，按老板设定的规则逐一核对，并在晚上生成摘要：前三名候选人附理由，其余人已收到礼貌回复。',
      'land.cta1': '免费发布职位',
      'land.cta2': '查看演示控制台',
      'land.digestTitle': '今日摘要',
      'land.digest1sub': '咖啡师，3 年 · 雅基曼卡区 · 接受早 7 点班',
      'land.digest2sub': '学生，晚间 · 无经验——需带教',
      'land.digest3sub': '希姆基 · 无法上早班 · 已发送婉拒',
      'land.digestFoot': '19:00 生成 · 依据您的规则',
      'land.pain1b': '每天 40 分钟',
      'land.pain1': '耗在私聊里翻看不对口的申请',
      'land.pain2b': '约 50% 的候选人',
      'land.pain2': '得不到任何回复，转向竞争对手',
      'land.pain3b': '10 种不同格式',
      'land.pain3': '的简历：照片、语音，还有“班表是怎样的？”',
      'land.howTitle': '产品原理',
      'land.step1t': '职位与规则',
      'land.step1d': '创建职位，用大白话写下要求：“经验一年以上”“只限市中心”“学生可排晚班——可以”。',
      'land.step2t': '扫码投递',
      'land.step2d': '投递只需一分钟表单：姓名、经验、区域和几句自我介绍。简历照片可选。',
      'land.step3t': '晚间摘要',
      'land.step3d': '每份申请都被解析：合适 / 部分合适 / 不合适——附理由。前三名进入摘要，其余已自动回复。',
      'land.rulesTitle': '规则——用您自己的话',
      'land.rulesText': '无需任何配置和搭建工具。像跟朋友交代一样写下来：HireLight 逐一核对每份申请，并逐条解释判断依据。',
      'land.chip1': '咖啡师经验 1 年以上',
      'land.chip2': '住在雅基曼卡区或愿意前往',
      'land.chip3': '接受早 7 点班',
      'land.chip4': '学生可排晚班——可以',
      'land.ctaTitle': '首个职位免费发布',

      'create.h1': '新职位',
      'create.lead': '填写职位卡片，用大白话写下要求——AI 将据此筛选申请。',
      'create.title': '职位名称 *',
      'ph.create.title': '咖啡师',
      'create.company': '公司名称',
      'ph.create.company': '“猫头鹰”咖啡馆',
      'create.district': '区域 / 地址 *',
      'ph.create.district': '莫斯科 雅基曼卡',
      'create.salary': '月薪起（₽）',
      'create.schedule': '排班',
      'ph.create.schedule': '做二休二，早 7 点班',
      'create.desc': '职位简介',
      'ph.create.desc': '精品咖啡，团队友好，包培训。',
      'create.rules': '筛选规则——每行一条 *',
      'ph.create.rules': '咖啡师经验 1 年以上\n住在雅基曼卡区或愿意前往\n接受早 7 点班\n学生可排晚班——可以',
      'create.hint': '数字很重要：“1 年以上”“30 岁以下”“月薪 60000 起”会自动计算。',
      'create.submit': '发布并获取二维码',
      'create.cancel': '取消',

      'created.h1': '职位已发布',
      'created.lead': '分享链接或二维码——投递后会立即出现在控制台。',
      'created.open': '打开职位页面',
      'created.toDash': '返回控制台',

      'apply.h2': '投递——只需一分钟',
      'apply.name': '姓名 *',
      'ph.apply.name': '王小明',
      'apply.phone': '电话 *',
      'ph.apply.phone': '+7 900 000-00-00',
      'apply.years': '相关工作经验（年）',
      'apply.salary': '期望月薪（₽）',
      'apply.district': '您方便的工作区域',
      'ph.apply.district': '雅基曼卡 / 市中心',
      'apply.about': '自我介绍 *',
      'ph.apply.about': '做了 3 年咖啡师，最近一年在雅基曼卡的精品咖啡馆。早班没问题，住得近。',
      'apply.resume': '简历照片或扫描件（可选）',
      'apply.submit': '提交申请',

      'applied.okTitle': '已提交',
      'applied.okText': '感谢投递！您的申请已解析并转给老板——通常当天内回复。',
      'applied.noTitle': '已收到申请',
      'applied.noText': '感谢关注！很抱歉，您的申请与该职位的关键要求不符，无法邀请面试。我们会保留您的申请，以备日后有合适职位。',
      'applied.whatsNext': '接下来',
      'applied.nextText': '老板会查看您的申请解析并在一天内回复。若经验匹配，将致电您留下的电话。',
      'applied.home': '返回首页',

      'dash.h1': '老板控制台',
      'dash.reset': '重置演示数据',
      'dash.fit': '{n} 位合适',
      'dash.partial': '{n} 位部分合适',
      'dash.notfit': '{n} 位不合适',
      'dash.newN': '{n} 条新申请',
      'dash.back': '← 职位列表',
      'dash.digestTop': '今日摘要——{m} 位中的前 {n} 位',
      'dash.empty': '暂无有效申请——请从职位页面分享二维码。',
      'dash.declinedHead': '已发送拒绝（{n}）——候选人已收到礼貌回复',

      'level.green': '推荐',
      'level.amber': '部分合适',
      'level.red': '不合适',

      'st.invited': '已邀约——已回复',
      'st.declined': '已发送拒绝',
      'c.invite': '邀约',
      'c.decline': '婉拒',
      'c.noexp': '无经验',
      'c.expects': '期望 {sum} ₽',
      'c.resumeAttached': '已附简历',
      'misc.fromPerMonth': '{sum} ₽/月起',
      'misc.from': '{sum} ₽ 起',

      'r.yearsOk': '经验 {years}——符合（“至少 {min} 年”）',
      'r.yearsLow': '经验 {years}——不足（“至少 {min} 年”）',
      'r.yearsMaxOk': '经验 {years}——在限制内（“不超过 {max} 年”）',
      'r.yearsMaxExceeded': '经验 {years}——超出限制（“不超过 {max} 年”）',
      'r.salaryMissing': '未填写期望薪资——需确认',
      'r.salaryOk': '期望薪资（{sum}）——在范围内',
      'r.salaryLow': '期望薪资 {sum} 低于范围——需面谈',
      'r.keywordFound': '申请中已确认：“{rule}”',
      'r.keywordMissing': '申请中未找到佐证：“{rule}”',
      'r.manual': '该规则需老板亲自判断',

      'footer.text': 'HireLight 演示原型 · 数据仅存储在您的浏览器本地 · 生产环境中申请解析由 LLM API 完成'
    }
  };

  var LOCALES = { ru: 'ru-RU', en: 'en-GB', zh: 'zh-CN' };

  window.t = function (key, params) {
    var lang = getLang();
    var dict = DICT[lang] || DICT.ru;
    var s = dict[key] !== undefined ? dict[key] : (DICT.ru[key] !== undefined ? DICT.ru[key] : key);
    if (params) {
      Object.keys(params).forEach(function (p) {
        s = s.split('{' + p + '}').join(params[p]);
      });
    }
    return s;
  };

  window.getLang = function () {
    var l = null;
    try { l = localStorage.getItem('hirelight-lang'); } catch (e) {}
    return (l && DICT[l]) ? l : 'ru';
  };

  window.setLang = function (lang) {
    if (!DICT[lang]) return;
    try { localStorage.setItem('hirelight-lang', lang); } catch (e) {}
    document.documentElement.lang = lang;
    applyI18n();
    document.dispatchEvent(new CustomEvent('langchange'));
  };

  window.tLocale = function () { return LOCALES[getLang()] || 'ru-RU'; };

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(function (elm) {
      elm.textContent = window.t(elm.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (elm) {
      elm.innerHTML = window.t(elm.getAttribute('data-i18n-html'));
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(function (elm) {
      elm.setAttribute('placeholder', window.t(elm.getAttribute('data-i18n-ph')));
    });
    document.title = window.t('app.title');
    document.querySelectorAll('.lang-switch button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-lang') === getLang());
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.documentElement.lang = getLang();
    document.querySelectorAll('.lang-switch button').forEach(function (b) {
      b.addEventListener('click', function () { window.setLang(b.getAttribute('data-lang')); });
    });
    applyI18n();
  });

  window.HL_LOCALES = LOCALES;
})();
