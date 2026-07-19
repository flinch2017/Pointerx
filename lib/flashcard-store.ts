export type Flashcard = {
  back: string;
  front: string;
  hint?: string;
  tag?: string;
};

export type FlashcardResult = {
  cards: Flashcard[];
  extractedCharacters: number;
  fileName: string;
  pageCount?: number;
  processedCharacters: number;
};

let latestFlashcards: FlashcardResult | null = null;

export function setLatestFlashcards(flashcards: FlashcardResult) {
  latestFlashcards = flashcards;
}

export function getLatestFlashcards() {
  return latestFlashcards;
}
