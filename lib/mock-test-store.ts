export type MockQuestion = {
  answerIndex: number;
  choices: string[];
  explanation?: string;
  question: string;
  topic?: string;
};

export type MockTestResult = {
  extractedCharacters: number;
  fileName: string;
  pageCount?: number;
  processedCharacters: number;
  questions: MockQuestion[];
};

let latestMockTest: MockTestResult | null = null;

export function setLatestMockTest(mockTest: MockTestResult) {
  latestMockTest = mockTest;
}

export function getLatestMockTest() {
  return latestMockTest;
}
