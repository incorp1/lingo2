const AT = 1750000000000;

function createLegacySnapshot() {
  const cards = [
    {
      id: "legacy-review", deckId: "legacy-deck", type: "basic",
      front: "house", back: "дом", example: "[haʊs]",
      exampleSentence: "This house is old.", exampleTranslation: "Этот дом старый.",
      exampleTargetTerm: "house", hint: "жилище", cloze: "", info: "Исходная информация о слове.",
      state: "review", step: 0, ease: 245, interval: 12, due: AT + 86400000,
      reps: 9, lapses: 2, createdAt: AT - 864000000, updatedAt: AT,
      lastReview: AT - 86400000, linkedCardId: "legacy-suspended",
      fsrs: { S: 12.75, D: 5.25, lastReview: AT - 86400000 },
      difficultyCache: {
        version: 1, score: 42, streakCount: 1, streakWeight: 1.5,
        problemSince: AT - 86400000, lastProblemAt: AT - 86400000,
        recent: [{ grade: 1, at: AT - 86400000 }], calculatedAt: AT,
      },
    },
    {
      id: "legacy-suspended", deckId: "legacy-deck", type: "basic",
      front: "gift", back: "подарок", example: "", exampleSentence: "A gift for you.",
      exampleTranslation: "Подарок для тебя.", exampleTargetTerm: "gift",
      hint: "", cloze: "", info: "Информация приостановленной карточки.",
      state: "suspended", suspendedFrom: "review", step: 0, ease: 250,
      interval: 8, due: AT + 43200000, reps: 5, lapses: 1,
      createdAt: AT - 864000000, updatedAt: AT, lastReview: AT - 172800000,
      linkedCardId: "legacy-review", fsrs: { S: 8.5, D: 4.5, lastReview: AT - 172800000 },
    },
  ];
  const practiceDraft = {
    step: "run", period: "last", selectedIds: [cards[0].id], deckId: "legacy-deck",
    count: "8", level: "A2", format: "story", words: [{ front: "house", back: "дом" }],
    payload: {
      title: "The house", text: "This house is old.",
      glossary: [{ word: "house", meaning: "дом" }],
      questions: [{ q: "What is old?", hint: "Назовите предмет." }],
    },
    answers: ["The house is"], feedback: null, revision: 2, practiceDays: 7, updatedAt: AT,
  };
  return {
    state: {
      decks: [{ id: "legacy-deck", name: "Основная", desc: "Исходная колода", direction: "forward", createdAt: AT - 864000000 }],
      cards, activeDeckId: "legacy-deck",
      settings: {
        language: "ru", aiTargetLang: "ru", aiMode: "off", aiProvider: "openai", aiKey: "",
        algorithm: "fsrs", startingEase: 250, theme: "auto", ttsRate: 0.85,
        studyCardModes: ["word", "sentence"], studyCardFronts: ["english", "local"],
        practiceHistory: [{
          id: "legacy-practice", at: AT - 3600000, title: "The gift", text: "This is a gift.",
          glossary: [{ word: "gift", meaning: "подарок" }], words: ["gift"],
          answers: ["A gift."], feedback: { score: 1, total: 1, summary: "Верно." },
        }],
      },
      history: { "2025-06-15": { reviewed: 9, again: 2, hard: 1, good: 5, easy: 1 } },
      streak: { current: 7, lastDay: "2025-06-15" }, sessionReviewedIds: [cards[0].id],
      studyCycles: {
        [cards[0].id]: {
          variants: [{ mode: "word", front: "english" }, { mode: "sentence", front: "local" }, { mode: "word", front: "local" }],
          index: 1, grades: [1], updatedAt: AT,
        },
      },
      practiceDraft: structuredClone(practiceDraft), revision: 0, updatedAt: AT,
    },
    reviewEvents: [{ id: "legacy-event", cardId: cards[0].id, deckId: "legacy-deck", grade: 1, state: "review", due: cards[0].due, at: AT - 86400000 }],
    practiceDraft,
  };
}

module.exports = { AT, createLegacySnapshot };
