/* ═══ Центральный AI-конфиг HireLight ═══
   Ключ выдаёт владелец платформы (DeepSeek, OpenAI-совместимый API).
   ВНИМАНИЕ: в статической версии ключ виден в исходном коде страницы —
   для продакшена перенесите вызовы на сервер. */
window.HL_AI = {
  base: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  key: 'sk-f55c872ca91e44de98b78f5a43721875' // ключ платформы DeepSeek
};
