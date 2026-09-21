/* Lingo Cards — Learning language registry (en / nb).
   Loaded before every consumer; exposed as window.LCLanguages.
   Holds only static descriptors: no DOM, no storage, no network. */
(function (global) {
  "use strict";

  const DATA_MODEL_VERSION = 2;
  const DEFAULT_LANGUAGE = "en";

  const LANGUAGES = [
    {
      code: "en",
      aiName: "English",
      i18nKey: "language.name.en",
      locale: "en-US",
      dictionary: true,
      dictionaryCode: "en",
      translatorCode: "en",
    },
    {
      code: "nb",
      aiName: "Norwegian Bokmål",
      i18nKey: "language.name.nb",
      locale: "nb-NO",
      dictionary: false,
      dictionaryCode: null,
      // The existing translator adapter speaks "no" for Norwegian.
      translatorCode: "no",
    },
  ];

  const byCode = new Map(LANGUAGES.map(item => [item.code, item]));
  const CODES = LANGUAGES.map(item => item.code);

  function isLanguageCode(value) {
    return typeof value === "string" && byCode.has(value);
  }

  function normalizeLanguageCode(value, fallback = DEFAULT_LANGUAGE) {
    if (isLanguageCode(value)) return value;
    return isLanguageCode(fallback) ? fallback : DEFAULT_LANGUAGE;
  }

  function getLanguage(code) {
    return byCode.get(normalizeLanguageCode(code)) || byCode.get(DEFAULT_LANGUAGE);
  }

  function listLanguages() {
    return LANGUAGES.map(item => ({ ...item }));
  }

  function emptyProfile() {
    return {
      activeDeckId: null,
      history: {},
      streak: { current: 0, lastDay: null },
      sessionReviewedIds: [],
      practiceDraft: null,
      studyResume: null,
    };
  }

  global.LCLanguages = {
    DATA_MODEL_VERSION,
    DEFAULT_LANGUAGE,
    CODES,
    isLanguageCode,
    normalizeLanguageCode,
    getLanguage,
    listLanguages,
    emptyProfile,
  };
})(typeof window !== "undefined" ? window : globalThis);
