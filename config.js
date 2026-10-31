/* ═══ Центральный AI-конфиг HireLight ═══
   Ключ выдаёт владелец платформы (DeepSeek, OpenAI-совместимый API).
   ВНИМАНИЕ: в статической версии ключ виден в исходном коде страницы —
   для продакшена перенесите вызовы на сервер. */
window.HL_AI = {
  base: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  key: 'sk-5e05062d5ba74af9a4ec59db6657ff9a' // ключ платформы DeepSeek
};

// Google AI Studio (Gemini): семантический AI-скрининг «по смыслу»,
// озвучка вопросов и распознавание голосовых ответов.
// Вставьте бесплатный ключ из aistudio.google.com — приложение сразу
// переключится на него (без ключа работает встроенный голос + правила).
window.HL_GEMINI = {
  key: '',
  sttModel: 'gemini-3.8-flash',             // анализ текста + распознавание записей
  ttsModel: 'gemini-3.8-flash-tts', // голос AI-интервью
  voiceName: 'Kore',                         // Kore / Puck / Charon / Aoede ...
  priority: 'first'  // 'first' = Gemini прежде DeepSeek; 'second' = DeepSeek прежде Gemini
                     // (для аудитории из Китая ставьте 'second': Gemini без VPN там недоступен)
};
