/* Lingo Cards — AI card generation and quick lookups.
   Free Dictionary API + optional LLM enrichment via user's own key
   (OpenAI / Google Gemini / xAI Grok).
*/
(function () {
  const DICT_URL = (w, code = "en") =>
    `https://api.dictionaryapi.dev/api/v2/entries/${encodeURIComponent(code)}/${encodeURIComponent(w)}`;

  // Learning-language descriptor helpers. The registry is the single source of
  // truth: it decides whether the free dictionary supports the language and
  // which code the existing translator adapter expects (nb -> "no").
  function learningLanguage(code) {
    const registry = (typeof window !== "undefined" ? window : globalThis).LCLanguages;
    return registry?.getLanguage ? registry.getLanguage(code) : null;
  }

  function learningAiName(code, fallback = "English") {
    return learningLanguage(code)?.aiName || fallback;
  }

  function dictionaryCodeFor(code) {
    const lang = learningLanguage(code);
    if (!lang) return code === "en" || !code ? "en" : null;
    return lang.dictionary ? (lang.dictionaryCode || lang.code) : null;
  }

  function translatorCodeFor(code, fallback = "en") {
    const normalized = String(code || "").trim().toLowerCase();
    if (!normalized) return fallback;
    // ВАЖНО: реестр LCLanguages описывает только языки ОБУЧЕНИЯ (en, nb).
    // Его `getLanguage()` для неизвестного кода молча возвращает язык по
    // умолчанию (English). Из-за этого код интерфейса "ru" превращался в
    // translatorCode "en", и перевод норвежского приходил на английском.
    // Поэтому подменяем код только для кодов, реально описанных в реестре.
    const registry = (typeof window !== "undefined" ? window : globalThis).LCLanguages;
    const known = registry?.isLanguageCode ? registry.isLanguageCode(normalized) : false;
    if (!known) return normalized;
    const lang = learningLanguage(normalized);
    return lang?.translatorCode || normalized;
  }
  const DEFAULT_TIMEOUT_MS = 30000;
  // Вспомогательные бесплатные источники (словарь и переводчик) не должны
  // задерживать генерацию карточки: они запускаются параллельно с LLM через
  // Promise.allSettled, поэтому зависший на 30 секунд переводчик раньше
  // растягивал всю генерацию до таймаута даже при мгновенном ответе модели.
  const AUX_TIMEOUT_MS = 9000;

  // Урезает окно ожидания для второстепенного запроса, не выходя за общий
  // дедлайн операции.
  function auxTimeout(options = {}, ms = AUX_TIMEOUT_MS) {
    const cap = Date.now() + ms;
    const deadlineAt = Number.isFinite(options.deadlineAt) ? Math.min(options.deadlineAt, cap) : cap;
    const timeoutMs = Math.min(Math.max(1, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS), ms);
    return { ...options, timeoutMs, deadlineAt };
  }

  function abortError(reason = "cancelled") {
    return new DOMException(reason, "AbortError");
  }

  function timeoutError() {
    const error = new Error("Request timed out");
    error.name = "TimeoutError";
    return error;
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : abortError(String(signal.reason || "cancelled"));
  }

  function remainingTime(options = {}) {
    const timeoutMs = Math.max(1, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
    if (!Number.isFinite(options.deadlineAt)) return timeoutMs;
    return Math.min(timeoutMs, Math.floor(options.deadlineAt - Date.now()));
  }

  async function fetchWithTimeout(url, init = {}, options = {}) {
    const externalSignal = options.signal;
    throwIfAborted(externalSignal);
    const remaining = remainingTime(options);
    if (remaining <= 0) throw timeoutError();
    const controller = new AbortController();
    const onAbort = () => controller.abort(externalSignal.reason || abortError());
    externalSignal?.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(timeoutError());
    }, remaining);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      // Safari 15 (iPhone 7) ignores the `AbortController.abort(reason)`
      // argument, so `signal.reason` cannot tell a timeout from a real
      // cancellation. Without this explicit flag an expired request surfaced as
      // an AbortError and callers kept showing an endless "loading" state.
      if (timedOut) throw timeoutError();
      if (controller.signal.aborted) throw controller.signal.reason instanceof Error ? controller.signal.reason : abortError();
      throw error;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onAbort);
    }
  }

  const QUICK_TRANSLATE_URLS = {
    // The source language is passed explicitly instead of letting the service
    // auto-detect it: short Norwegian words ("hus", "gate", "vind") are
    // routinely detected as English/Danish/German, so a long-press "Перевод"
    // returned a translation of the wrong language. The learning language is
    // always known, so there is no reason to let the service guess it.
    google: ({ text, source, target }) =>
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(source || "auto")}&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`,
    mymemory: ({ text, source, target }) =>
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(source)}|${encodeURIComponent(target)}`,
  };

  const PROVIDER_DEFAULTS = {
    openai: { model: "gpt-4o-mini", label: "OpenAI · GPT-4o mini" },
    google: { model: "gemini-2.0-flash", label: "Google · Gemini 2.0 Flash" },
    xai: { model: "grok-3-mini", label: "xAI · Grok 3 Mini" },
  };

  const MODEL_CATALOG = {
    openai: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o"],
    google: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash", "gemini-1.5-pro"],
    xai: ["grok-3-mini", "grok-3", "grok-2-latest"],
  };

  const SYSTEM_PROMPT = `You are a vocabulary card generator for language learners.
Output ONLY valid JSON. No prose, no markdown, no code fences.`;

  let lastRateInfo = null;

  function userPrompt(word, targetLang, sourceLang) {
    return `Generate a vocabulary card for the EXACT word/phrase: "${word}"
Source language (the language being learned): ${sourceLang || "English"}
Translate into: ${targetLang}

STRICT RULES:
- The word "${word}" belongs to ${sourceLang || "English"}. Never treat it as a word of another language.
- Every field MUST describe the EXACT word/phrase "${word}" — never a different word.
- "example" MUST be ONE natural ${sourceLang || "English"} sentence that literally contains "${word}".
- "exampleTranslation" MUST NOT be empty: always translate your example sentence into ${targetLang}.
- "exampleTargetTerm" MUST be the exact word or phrase as it appears in "exampleTranslation" that corresponds to the vocabulary word "${word}". Preserve its exact spelling and capitalization from the translated sentence. It must not be a definition or a list of alternatives.

Return ONLY JSON with these exact keys (use empty string/array if truly not applicable):
{
  "translation": "natural translation into ${targetLang}, comma-separate variants",
  "ipa":         "IPA transcription of the ${sourceLang || "English"} word as pronounced in ${sourceLang || "English"}, wrapped in slashes (e.g. /ˈwɜːrd/). NEVER give an English reading of a non-English word.",
  "example":     "ONE natural example sentence using \"${word}\", in ${sourceLang || "English"}",
  "exampleTranslation": "the example sentence translated into ${targetLang}",
  "exampleTargetTerm": "the exact translated word or phrase in exampleTranslation corresponding to ${word}",
  "synonyms":    ["2-4 synonyms in ${sourceLang || "English"}"]
}`;
  }

  // The word-info prompt is written for a concrete learning language: the
  // hard-coded "английские слова" wording produced English explanations even
  // for Norwegian cards, so the language name is injected instead.
  function wordInfoSystemPrompt(learnedName) {
    return `Ты объясняешь слова языка ${learnedName} русскоязычным студентам, которые знают перевод, но не понимают "суть" и оттенки слова. Все примеры давай на языке ${learnedName}. Отвечай только валидным JSON.`;
  }

  function wordInfoPrompt(word, learnedName) {
    return `${WORD_INFO_PROMPT_PREFIX.replace(/английские слова/g, `слова языка ${learnedName}`).replace(/на английском/g, `на языке ${learnedName}`)}"${word}" (язык слова: ${learnedName})${WORD_INFO_PROMPT_SUFFIX}`;
  }

  const WORD_INFO_SYSTEM_PROMPT = `Ты объясняешь английские слова русскоязычным студентам, которые знают перевод, но не понимают "суть" и оттенки слова. Отвечай только валидным JSON.`;

  const WORD_INFO_PROMPT_PREFIX = `Ты объясняешь английские слова русскоязычным студентам, которые знают перевод, но не понимают "суть" и оттенки слова. Твоя задача — не дать словарное определение, а объяснить слово так, чтобы стало интуитивно понятно, когда и почему носитель языка выбирает именно это слово.

Правила ответа:
1. Начни с сути одним предложением — на что похоже это слово, какой у него "характер" (формальное/разговорное, нейтральное/эмоциональное, редкое/частое).
2. Если у слова есть более простой синоним — покажи разницу через прямое сравнение ("X — это по сути Y, но более формальный/сильный/редкий вариант").
3. Разбей смысловые оттенки по пунктам, если их несколько — не сваливай всё в один абзац.
4. На каждый оттенок дай короткий пример на английском с переводом на русский.
5. Если есть устойчивые выражения с этим словом — упомяни их отдельно.
6. Заверши мыслью, которая помогает "не думать" в следующий раз — простое правило или мысленная замена ("если видишь X, мысленно заменяй на Y — смысл почти не изменится").
7. Пиши разговорно и по-доброму, как объяснял бы друг, а не как учебник. Без канцелярита, без длинных вводных фраз, без "данное слово используется в следующих случаях".
8. Не давай избыточных грамматических пояснений, если вопрос не про грамматику — фокус на смысле и ощущении слова.
9. Формат: используй списки/нумерацию для оттенков значения, но не превращай ответ в сухую таблицу — между пунктами должна чувствоваться живая интонация.
10. После объяснения сути слова добавь блок "Похожие слова" — перечисли 2-5 слов, близких по смыслу или часто путаемых с этим словом.
11. Для каждого похожего слова объясни разницу максимально конкретно, а не общими словами. Указывай, чем именно они отличаются:
    - силой/степенью уверенности или интенсивности (например, "maybe" — 50/50, "probably" — скорее да, "possibly" — теоретически возможно, но не обязательно вероятно)
    - формальностью/разговорностью
    - грамматической ролью (прилагательное/наречие/существительное — если это меняет способ употребления)
    - типичным контекстом употребления (разговорная речь / деловой стиль / письменный текст)
12. На каждое похожее слово дай короткий контрастный пример — в идеале одна и та же ситуация, но с разными словами, чтобы стала видна разница на практике. Например:
    - "Maybe I'll come" — вообще не знаю, действительно 50/50, расслабленно
    - "I'll probably come" — скорее приду, уже почти решил
    - "It's possible I'll come" — теоретически не исключено, но звучит более сдержанно/формально, как будто есть препятствия
13. Если различие в основном стилистическое (формальное/неформальное), а не смысловое — прямо скажи об этом, не выдумывай смысловых различий, которых нет.
14. Если синонимов нет или слово уникально по смыслу — блок "Похожие слова" можно пропустить, не притягивай слова искусственно.

ОБЪЯСНИ СЛОВО `;

  const WORD_INFO_PROMPT_SUFFIX = `.

Верни ТОЛЬКО JSON в таком виде (без пояснений вокруг):
{"info":"<твоё объяснение обычным текстом: переносы строк как \\n, списки как пункты через \\n- , кавычки внутри текста экранируй>"}`;

  function parsePromptList(value, settingName) {
    const items = String(value || "")
      .split(";")
      .map(item => item.trim())
      .filter(Boolean);
    if (!items.length) throw new Error(`Missing ${settingName} setting`);
    return items;
  }

  function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  function batchExamplesPrompt(cards, targetLang, promptOptions) {
    const topics = parsePromptList(promptOptions?.topics, "example topics");
    const situations = parsePromptList(promptOptions?.situations, "example situations");
    const styles = parsePromptList(promptOptions?.styles, "example styles");
    const learned = promptOptions?.learningLangName || "English";
    const items = (cards || []).map(card => ({
      id: String(card.id || ""),
      word: String(card.front || "").trim(),
      translation: String(card.back || "").trim(),
      topic: randomItem(topics),
      situation: randomItem(situations),
      style: randomItem(styles),
    }));
    return `Replace the example sentences for these vocabulary cards.
Learning language of the cards: ${learned}.
Target translation language: ${targetLang}.

STRICT RULES:
- Return exactly one item for every input id, in the same order.
- "example" must be ONE natural ${learned} sentence that literally contains the exact ${learned} word/phrase from "word".
- Build each sentence around that item's assigned "topic" and "situation", and write it in the assigned "style".
- Make the examples varied and specific; avoid generic textbook sentences and repeated sentence patterns.
- Keep sarcastic or humorous examples natural, harmless, and appropriate for language learners.
- "exampleTranslation" must be a natural translation of that sentence into ${targetLang} and must not be empty.
- "exampleTargetTerm" must be copied verbatim from "exampleTranslation" and identify the exact word or phrase that translates the card's "front" term in that sentence.
- Do not return a dictionary definition or multiple alternatives in "exampleTargetTerm".
- Use the supplied translation to choose the intended meaning when possible.
- Do not change the word or translation.

INPUT:
${JSON.stringify(items)}

Return ONLY JSON in this exact shape:
{"items":[{"id":"input id","example":"one English sentence","exampleTranslation":"translated sentence","exampleTargetTerm":"exact translated word or phrase copied from exampleTranslation"}]}`;
  }

  function setLastRateInfo(provider, model, headers) {
    const flat = {};
    if (headers?.forEach) {
      headers.forEach((value, name) => {
        const lower = String(name).toLowerCase();
        if (lower.includes("ratelimit") || lower.includes("x-ratelimit")) {
          flat[lower] = String(value);
        }
      });
    }
    lastRateInfo = { provider, model, at: Date.now(), headers: flat };
    window.LCAi.lastRateInfo = lastRateInfo;
  }

  function uniqueStrings(values) {
    return [...new Set((values || []).map(v => String(v || "").trim()).filter(Boolean))];
  }

  function extractJSON(text) {
    const stripped = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    if (stripped.startsWith("{")) return stripped;
    const m = stripped.match(/\{[\s\S]*\}/);
    return m ? m[0] : stripped;
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Ответ модели иногда приходит обрезанным или с "хвостом" после JSON
  // (особенно у маленьких моделей на норвежских словах). Строгий JSON.parse в
  // таком случае бросал ошибку, и карточка не заполнялась вообще. Поэтому при
  // неудачном разборе поля вытаскиваются по отдельности из сырого текста.
  function parseModelJson(text) {
    const raw = String(text || "");
    const json = extractJSON(raw);
    try {
      const parsed = JSON.parse(json);
      if (parsed && typeof parsed === "object") return parsed;
    } catch { /* fall through to lenient extraction */ }

    const out = {};
    const readString = (keyPattern) => {
      const m = json.match(new RegExp(`"${keyPattern}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
      if (!m) return "";
      try {
        return JSON.parse(`"${m[1]}"`);
      } catch {
        return m[1];
      }
    };
    for (const key of ["translation", "ipa", "example", "exampleTranslation", "example_translation", "exampleTargetTerm", "example_target_term", "info", "text"]) {
      const value = readString(key);
      if (value) out[key] = value;
    }
    const synonyms = json.match(/"synonyms"\s*:\s*\[([^\]]*)\]/);
    if (synonyms) {
      out.synonyms = synonyms[1]
        .split(",")
        .map(part => part.trim().replace(/^"|"$/g, "").trim())
        .filter(Boolean);
    }
    const itemsBlock = json.match(/"items"\s*:\s*\[([\s\S]*)/);
    if (itemsBlock) {
      const items = [];
      const objectRe = /\{(?:[^{}]|\\.)*\}/g;
      let match;
      while ((match = objectRe.exec(itemsBlock[1]))) {
        try {
          items.push(JSON.parse(match[0]));
        } catch { /* skip malformed item */ }
      }
      if (items.length) out.items = items;
    }
    if (!Object.keys(out).length) throw new Error("Malformed AI JSON response");
    return out;
  }

  function parseRetryAfter(value) {
    const raw = String(value || "").trim();
    if (!raw) return 0;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
    const at = Date.parse(raw);
    return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
  }

  async function responseError(response) {
    const body = await response.text().catch(() => "");
    const error = new Error(`HTTP ${response.status}${body ? `: ${body}` : ""}`);
    error.status = response.status;
    error.retryAfterMs = parseRetryAfter(response.headers?.get?.("retry-after"));
    return error;
  }

  function isChatModel(provider, id, metadata = {}) {
    const model = String(id || "").trim().toLowerCase();
    if (!model) return false;
    if (provider === "google") {
      const methods = metadata.supportedGenerationMethods || metadata.supported_generation_methods;
      return Array.isArray(methods) ? methods.includes("generateContent") : /^gemini-/.test(model);
    }
    if (/(?:^|[-_.])(image|images|embedding|embeddings|audio|tts|transcri(?:be|ption)|speech|whisper|dall-e|moderation|realtime|sora)(?:$|[-_.])/.test(model)) return false;
    if (provider === "openai") return /^(?:gpt-|chatgpt-|o\d|codex)/.test(model) || model.startsWith("ft:gpt-");
    if (provider === "xai") return /^grok-/.test(model);
    return false;
  }

  function isTranslationDiagnostic(text, data) {
    const value = String(text || "").trim();
    const status = Number(data?.responseStatus);
    if (Number.isFinite(status) && status !== 200) return true;
    if (String(data?.responseDetails || "").trim()) return true;
    return /^(?:MYMEMORY WARNING|NO QUERY SPECIFIED|INVALID (?:SOURCE|TARGET|LANGUAGE)|PLEASE SELECT TWO DISTINCT LANGUAGES|QUERY LENGTH LIMIT EXCEEDED|USAGE LIMIT REACHED|TOO MANY REQUESTS|AUTHENTICATION FAILED|ERROR\b)/i.test(value);
  }

  // Does a string look like a plausible IPA transcription rather than prose
  // or a value copied from another word? Used to reject bad model output.
  function looksLikeIPA(s) {
    const v = String(s || "").trim();
    if (!v) return false;
    if (v.length > 60) return false;
    // Must contain at least one IPA-typical phonetic symbol. Norwegian adds
    // ʉ, ɖ, ɭ, ɳ, ʈ, ɕ, ʂ, ɾ, ʁ and the tone marks ˧ ˨ ˩ — without them valid
    // nb transcriptions like /ˈhʉːs/ were silently rejected and the hint
    // stayed empty (or fell back to an English dictionary reading).
    if (!/[ˈˌəɪʊɛɔæʌθðʃʒŋɑɒːiuʉɖɭɳʈɕʂɾʁø̜yœɡ˧˨˩]/i.test(v) && !/^\/.*\/$/.test(v)) return false;
    // Reject anything with letters from the UI/translation languages bleeding in
    // (Cyrillic) or sentence-like punctuation.
    if (/[\u0400-\u04FF]/.test(v)) return false;
    if (/[.,;!?]/.test(v)) return false;
    return true;
  }

  function cleanIPA(s) {
    let v = String(s || "").trim();
    if (!v) return "";
    // Keep only the bracketed/slashed portion when extra prose sneaks in.
    const m = v.match(/[\/\[][^\/\]]+[\/\]]/);
    if (m) v = m[0];
    return looksLikeIPA(v) ? v : "";
  }

  // Retry a network-bound async fn on rate-limit / transient server errors.
  // The fn must throw an Error whose message includes the HTTP status so we
  // can decide whether to retry.
  async function withRetry(fn, { attempts = 3, baseDelay = 700, signal, timeoutMs = DEFAULT_TIMEOUT_MS, deadlineAt } = {}) {
    let lastErr;
    const deadline = Number.isFinite(deadlineAt) ? deadlineAt : Date.now() + Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
    for (let i = 0; i < attempts; i++) {
      throwIfAborted(signal);
      if (Date.now() >= deadline) throw timeoutError();
      try {
        return await fn({ deadlineAt: deadline, timeoutMs });
      } catch (e) {
        if (e?.name === "AbortError") throw e;
        lastErr = e;
        const msg = String(e?.message || e || "");
        const status = String(e?.status || (msg.match(/HTTP (\d{3})/) || [])[1] || "");
        const retriable = status === "429" || (status && status[0] === "5") || /network|fetch|timeout/i.test(msg);
        if (!retriable || i === attempts - 1) throw e;
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw timeoutError();
        const backoff = baseDelay * Math.pow(2, i) + Math.floor(Math.random() * 300);
        const wait = Math.max(backoff, Number(e?.retryAfterMs) || 0);
        if (wait >= remaining) throw e;
        await new Promise((resolve, reject) => {
          let settled = false;
          const cleanup = () => signal?.removeEventListener("abort", onAbort);
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
          }, wait);
          const onAbort = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            cleanup();
            reject(signal?.reason instanceof Error ? signal.reason : abortError());
          };
          signal?.addEventListener("abort", onAbort, { once: true });
          if (signal?.aborted) onAbort();
        });
      }
    }
    throw lastErr;
  }

  function normalize(obj) {
    obj = obj || {};
    const arr = v => Array.isArray(v) ? v.map(String).filter(Boolean) : (v ? String(v).split(/[,;]\s*/) : []);
    return {
      back: String(obj.translation || "").trim(),
      ipa: String(obj.ipa || "").trim(),
      example: String(obj.example || "").trim(),
      exampleTranslation: String(obj.exampleTranslation || obj.example_translation || "").trim(),
      exampleTargetTerm: String(obj.exampleTargetTerm || obj.example_target_term || "").trim(),
      synonyms: arr(obj.synonyms),
    };
  }

  async function callDictionary(word, options = {}) {
    // Never query the English endpoint for another learning language: for
    // unsupported languages we simply have no dictionary data and leave the
    // fields empty instead of silently returning English facts.
    const dictCode = dictionaryCodeFor(options.learningLanguage);
    if (!dictCode) return null;
    try {
      const r = await fetchWithTimeout(DICT_URL(word.trim().toLowerCase(), dictCode), {}, options);
      if (!r.ok) return null;
      const data = await r.json();
      const entry = data[0];
      if (!entry) return null;
      const meanings = entry.meanings || [];
      const firstDef = meanings[0]?.definitions?.[0];
      const phonetic = entry.phonetic || entry.phonetics?.find(p => p.text)?.text || "";
      const example = meanings.flatMap(m => m.definitions || []).find(d => d.example)?.example || "";
      return { ipa: phonetic, example };
    } catch (error) {
      if (error?.name === "AbortError" || error?.name === "TimeoutError") throw error;
      return null;
    }
  }

  async function quickTranslate(text, targetLangCode, options = {}) {
    throwIfAborted(options.signal);
    const target = translatorCodeFor((targetLangCode || "uk").trim().toLowerCase() || "uk", "uk");
    // The source is the learning language when supplied; "nb" is mapped to the
    // translator's own "no" code inside the adapter, no new service is added.
    const sourceLang = translatorCodeFor(
      String(options.sourceLangCode || options.learningLanguage || "en").trim().toLowerCase() || "en",
      "en"
    );
    const source = String(text || "").trim();
    if (!source) return "";
    if (sourceLang === target) return source;

    const providers = ["google", "mymemory"];
    for (const provider of providers) {
      const url = QUICK_TRANSLATE_URLS[provider]({ text: source, source: sourceLang, target });
      try {
        const r = await fetchWithTimeout(url, {}, options);
        if (!r.ok) continue;
        const data = await r.json();
        if (provider === "google") {
          const chunks = Array.isArray(data?.[0]) ? data[0] : [];
          const translated = chunks.map(chunk => chunk?.[0] || "").join("").trim();
          if (translated) return translated;
        } else {
          const translated = String(data?.responseData?.translatedText || "").trim();
          if (translated && !isTranslationDiagnostic(translated, data)) return translated;
        }
      } catch (error) {
        if (error?.name === "AbortError" || error?.name === "TimeoutError") throw error;
        continue;
      }
    }
    return "";
  }

  async function quickLookup(word, targetLangCode, options = {}) {
    throwIfAborted(options.signal);
    word = String(word || "").trim();
    if (!word) throw new Error("empty");
    const [dict, translation] = await Promise.all([
      callDictionary(word, options),
      quickTranslate(word, targetLangCode, {
        ...options,
        sourceLangCode: options.sourceLangCode || options.learningLanguage || "en",
      }),
    ]);
    return normalize({
      translation,
      ipa: cleanIPA(dict?.ipa) || "",
      example: dict?.example || "",
      exampleTranslation: "",
      synonyms: [],
    });
  }

  async function fetchModelCatalog(provider, key, options = {}) {
    const urls = {
      openai: "https://api.openai.com/v1/models",
      google: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key || "")}`,
      xai: "https://api.x.ai/v1/models",
    };
    const url = urls[provider];
    if (!url) throw new Error("Unsupported AI provider");

    const headers = { "Content-Type": "application/json" };
    if (provider === "openai" || provider === "xai") headers["Authorization"] = `Bearer ${key || ""}`;

    const r = await fetchWithTimeout(url, { headers }, options);
    if (!r.ok) throw await responseError(r);
    const data = await r.json();
    const ids = [];
    if (Array.isArray(data?.data)) {
      for (const item of data.data) {
        const id = item?.id || item?.name;
        if (id && isChatModel(provider, id, item)) ids.push(id);
      }
    }
    if (Array.isArray(data?.models)) {
      for (const item of data.models) {
        const id = String(item?.name || item?.id || "").replace(/^models\//, "");
        if (id && isChatModel(provider, id, item)) ids.push(id);
      }
    }
    const models = uniqueStrings(ids);
    if (!models.length) throw new Error("No compatible chat models were returned by the provider");
    return models;
  }

  async function callLLM(provider, model, key, word, targetLang, sourceLang, options = {}) {
    if (!key) throw new Error("Missing API key");
    const prompt = userPrompt(word, targetLang, sourceLang);
    return withRetry(attemptOptions =>
      chatJson(provider, model || PROVIDER_DEFAULTS[provider]?.model, key, SYSTEM_PROMPT, prompt, 0.4, { ...options, ...attemptOptions }),
      { signal: options.signal, timeoutMs: options.timeoutMs, deadlineAt: options.deadlineAt }
    );
  }

  async function chatJson(provider, model, key, systemPrompt, userPrompt, temperature = 0.4, options = {}) {
    throwIfAborted(options.signal);
    if (!key) throw new Error("Missing API key");
    if (!PROVIDER_DEFAULTS[provider]) throw new Error("Unsupported AI provider");
    if (provider === "google") return callGoogle(model, key, systemPrompt, userPrompt, temperature, options);
    const url = provider === "xai"
      ? "https://api.x.ai/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions";
    return callOpenAICompatible(provider, url, model, key, systemPrompt, userPrompt, temperature, options);
  }

  async function callOpenAICompatible(provider, url, model, key, systemPrompt, userPrompt, temperature, options = {}) {
    const r = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature,
      }),
    }, options);
    setLastRateInfo(provider, model, r.headers);
    if (!r.ok) throw await responseError(r);
    const data = await r.json();
    const text = data.choices?.[0]?.message?.content || "";
    return parseModelJson(text);
  }

  async function callGoogle(model, key, systemPrompt, userPrompt, temperature, options = {}) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const r = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature },
      }),
    }, options);
    setLastRateInfo("google", model, r.headers);
    if (!r.ok) throw await responseError(r);
    const data = await r.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return parseModelJson(text);
  }

  async function generate(word, opts = {}) {
    throwIfAborted(opts.signal);
    word = String(word || "").trim();
    if (!word) throw new Error("empty");
    const { mode = "off", provider, key, model, targetLang, sourceLang, targetLangCode, learningLanguage: learnCode } = opts || {};
    if (mode === "off") throw new Error("disabled");
    const learnedName = sourceLang || learningAiName(learnCode);
    const requestOptions = {
      ...opts,
      learningLanguage: learnCode,
      sourceLangCode: opts.sourceLangCode || learnCode || "en",
      deadlineAt: Number.isFinite(opts.deadlineAt)
        ? opts.deadlineAt
        : Date.now() + Math.max(1, Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS),
    };

    const results = await Promise.allSettled([
      callDictionary(word, auxTimeout(requestOptions)),
      mode === "ai" ? callLLM(provider, model || PROVIDER_DEFAULTS[provider]?.model,
                              key, word, targetLang, learnedName, requestOptions) : Promise.resolve(null),
      quickTranslate(word, targetLangCode || "uk", auxTimeout(requestOptions)),
    ]);
    throwIfAborted(opts.signal);

    const dict = results[0].status === "fulfilled" ? results[0].value : null;
    const translation = results[2].status === "fulfilled" ? String(results[2].value || "").trim() : "";
    let ai = null;
    if (results[1].status === "fulfilled" && results[1].value) ai = normalize(results[1].value);
    else if (results[1].status === "rejected") {
      if (!dict && !translation) throw results[1].reason || new Error("AI failed");
    }

    // IPA: prefer the AI's, then the dictionary's — but only if it actually
    // looks like a transcription of THIS word (cleanIPA drops foreign/garbage).
    const ipa = cleanIPA(ai?.ipa) || cleanIPA(dict?.ipa) || "";

    // Example: prefer the AI's natural sentence, else the dictionary example.
    const example = (ai?.example || dict?.example || "").trim();

    // Example translation must never be empty when we have an example. If the
    // model omitted it (or we only have a dictionary example), translate it
    // ourselves via the free translator into the target language.
    let exampleTranslation = (ai?.exampleTranslation || "").trim();
    if (example && !exampleTranslation) {
      try {
        exampleTranslation = (await quickTranslate(example, targetLangCode || "uk", auxTimeout(requestOptions))).trim();
      } catch { /* leave empty on failure */ }
    }

    // Перевод самого слова: если модель его не вернула (частый случай для
    // норвежского, когда JSON приходит неполным), берём результат бесплатного
    // переводчика, а не оставляем поле пустым.
    let back = (ai?.back || "").trim() || translation;
    if (!back) {
      try {
        back = (await quickTranslate(word, targetLangCode || "uk", auxTimeout(requestOptions))).trim();
      } catch { /* leave empty on failure */ }
    }

    const output = {
      back,
      ipa,
      example,
      exampleTranslation,
      exampleTargetTerm: String(ai?.exampleTargetTerm || "").trim(),
      synonyms: Array.isArray(ai?.synonyms) ? ai.synonyms : [],
    };
    const hasData = [output.back, output.ipa, output.example, output.exampleTranslation]
      .some(value => String(value || "").trim()) || output.synonyms.length > 0;
    if (!hasData) {
      const timedOut = results.find(result => result.status === "rejected" && result.reason?.name === "TimeoutError");
      if (timedOut) throw timedOut.reason;
      throw new Error("No card data found. Check your connection and try again");
    }
    return output;
  }

  async function generateWordInfo(card, opts = {}) {
    throwIfAborted(opts.signal);
    const word = String(card?.front || "").trim();
    if (!word) throw new Error("Missing word");
    const { provider, key, model, temperature } = opts || {};
    if (!key) throw new Error("Missing API key");
    const selectedModel = model || PROVIDER_DEFAULTS[provider]?.model;
    const modelTemperature = Number(temperature);
    const temperatureValue = Number.isFinite(modelTemperature) && modelTemperature >= 0 && modelTemperature <= 2
      ? modelTemperature
      : 0.4;
    const learnedName = opts.learningLangName || learningAiName(opts.learningLanguage);
    const raw = await withRetry(attemptOptions => chatJson(
      provider,
      selectedModel,
      key,
      wordInfoSystemPrompt(learnedName),
      wordInfoPrompt(word, learnedName),
      temperatureValue,
      { ...opts, ...attemptOptions }
    ), {
      attempts: Number.isFinite(opts.retryAttempts) ? Math.max(1, opts.retryAttempts) : 3,
      signal: opts.signal,
      timeoutMs: opts.timeoutMs,
      deadlineAt: opts.deadlineAt,
    });
    const info = String(raw?.info || raw?.text || "").trim();
    if (!info) throw new Error("Empty word info response");
    return info;
  }

  async function generateExamplesBatch(cards, opts = {}) {
    throwIfAborted(opts.signal);
    const items = (cards || [])
      .map(card => ({ id: String(card.id || ""), front: String(card.front || "").trim(), back: String(card.back || "").trim() }))
      .filter(card => card.id && card.front)
      .slice(0, 20);
    if (!items.length) return [];
    const { provider, key, model, targetLang, topics, situations, styles, temperature } = opts || {};
    if (!key) throw new Error("Missing API key");
    const selectedModel = model || PROVIDER_DEFAULTS[provider]?.model;
    const modelTemperature = Number(temperature);
    if (!Number.isFinite(modelTemperature) || modelTemperature < 0 || modelTemperature > 2) {
      throw new Error("Invalid example temperature setting");
    }
    const raw = await withRetry(attemptOptions => chatJson(
      provider,
      selectedModel,
      key,
      SYSTEM_PROMPT,
      batchExamplesPrompt(items, targetLang || "the interface language", {
        topics,
        situations,
        styles,
        learningLangName: opts.learningLangName || learningAiName(opts.learningLanguage),
      }),
      modelTemperature,
      { ...opts, ...attemptOptions }
    ), {
      attempts: Number.isFinite(opts.retryAttempts) ? Math.max(1, opts.retryAttempts) : 3,
      signal: opts.signal,
      timeoutMs: opts.timeoutMs,
      deadlineAt: opts.deadlineAt,
    });
    const output = Array.isArray(raw?.items) ? raw.items : [];
    const byId = new Map(output.map(item => [String(item?.id || ""), item]));
    return items.map(card => {
      const item = byId.get(card.id) || {};
      const example = String(item.example || "").trim();
      const exampleTranslation = String(item.exampleTranslation || item.example_translation || "").trim();
      const exampleTargetTerm = String(item.exampleTargetTerm || item.example_target_term || "").trim();
      const exactTerm = String(card.front || "").trim().toLocaleLowerCase();
      if (!example.toLocaleLowerCase().includes(exactTerm)) return { id: card.id, example: "", exampleTranslation: "", exampleTargetTerm: "" };
      return { id: card.id, example, exampleTranslation, exampleTargetTerm };
    }).filter(item => item.example && item.exampleTranslation);
  }

  window.LCAi = {
    generate,
    generateWordInfo,
    generateExamplesBatch,
    PROVIDER_DEFAULTS,
    MODEL_CATALOG,
    fetchModelCatalog,
    quickTranslate,
    quickLookup,
    chatJson,
    lastRateInfo,
  };
})();
