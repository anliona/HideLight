# HideLight / HireLight (招人快筛)

AI-фильтр откликов для найма в малом бизнесе · AI screening for small-business hiring · 小微企业招聘 AI 筛选

Владелец бизнеса публикует вакансию с правилами отбора обычными словами и делится QR-кодом.
Кандидаты заполняют минутную анкету, а AI проверяет каждого по правилам и присылает
владельцу вечерний дайджест: топ-3 кандидата с причинами, остальным — вежливый ответ.

The owner posts a job with screening rules in plain words and shares a QR code.
Applicants fill a one-minute form; AI checks everyone against the rules and sends
the owner an evening digest — top-3 candidates with reasons, the rest politely answered.

## Запуск / Run

```bash
python3 -m http.server 8765
# → http://127.0.0.1:8765
```

Статический прототип без бэкенда, данные хранятся в localStorage.
Static demo prototype, no backend — data lives in your browser's localStorage.

## Языки / Languages

Русский · 中文 · English — переключатель в шапке / switcher in the header / 切换按钮在页面顶部。

## Как устроено / How it works

- `app.js` — маршруты, вакансии/отклики, локальный движок правил (демо).
- `i18n.js` — словарь RU/ZH/EN.
- В продакшене локальный движок заменяется вызовом LLM по API — место помечено
  в `screenApplicant()` / In production the rule engine is replaced by an LLM API call (see `screenApplicant()`).
