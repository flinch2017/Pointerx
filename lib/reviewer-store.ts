export type ReviewerResult = {
  extractedCharacters: number;
  fileName: string;
  pageCount?: number;
  processedCharacters: number;
  reviewer: string;
};

let latestReviewer: ReviewerResult | null = null;

export function setLatestReviewer(reviewer: ReviewerResult) {
  latestReviewer = reviewer;
}

export function getLatestReviewer() {
  return latestReviewer;
}
