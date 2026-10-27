/* ═══ Центральный AI-конфиг HireLight ═══
   Ключ выдаёт владелец платформы (DeepSeek, OpenAI-совместимый API).
   ВНИМАНИЕ: в статической версии ключ виден в исходном коде страницы —
   для продакшена перенесите вызовы на сервер. */
window.HL_AI = {
  base: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  key: 'sk-5e05062d5ba74af9a4ec59db6657ff9a' // ключ платформы DeepSeek
};
