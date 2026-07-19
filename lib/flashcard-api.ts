import { getDefaultReviewerApiUrl } from '@/lib/network';
import { FlashcardResult } from '@/lib/flashcard-store';
import { PdfUploadAsset, ReviewerProgress, MAX_PDF_BYTES, uploadPdfJob } from '@/lib/reviewer-api';

export { MAX_PDF_BYTES };
export type FlashcardProgress = ReviewerProgress;

const FLASHCARD_API_URL =
  process.env.EXPO_PUBLIC_REVIEWER_API_URL ?? getDefaultReviewerApiUrl();

type FlashcardJob = {
  error?: string | null;
  id: string;
  percent: number;
  result?: FlashcardResult | null;
  state: 'queued' | 'running' | 'complete' | 'failed';
  status: string;
};

function getUserFacingFlashcardError(error: string | undefined, status: number) {
  if (!error) {
    return `Learning material service returned ${status}`;
  }

  return error
    .replace(/Ollama/gi, 'Pointerx AI')
    .replace(/localhost:\d+/gi, 'the learning material service')
    .replace(/empty reviewer/gi, 'empty response');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapJobPercent(percent: number) {
  return Math.min(100, Math.max(15, Math.round(15 + percent * 0.85)));
}

async function getFlashcardJob(jobId: string) {
  const response = await fetch(`${FLASHCARD_API_URL}/api/flashcards/jobs/${jobId}`);
  const data = (await response.json().catch(() => ({}))) as Partial<FlashcardJob> & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(getUserFacingFlashcardError(data.error, response.status));
  }

  if (!data.id || !data.state || typeof data.percent !== 'number' || !data.status) {
    throw new Error('Learning material service returned an incomplete progress update.');
  }

  return data as FlashcardJob;
}

async function pollFlashcardJob(
  jobId: string,
  onProgressChange: (progress: FlashcardProgress) => void,
) {
  const deadline = Date.now() + 10 * 60 * 1000;

  while (Date.now() < deadline) {
    const job = await getFlashcardJob(jobId);

    onProgressChange({
      percent: mapJobPercent(job.percent),
      status: job.status,
    });

    if (job.state === 'complete') {
      if (!job.result) {
        throw new Error('Learning material service finished without flashcards.');
      }

      return job.result;
    }

    if (job.state === 'failed') {
      throw new Error(getUserFacingFlashcardError(job.error ?? undefined, 500));
    }

    await sleep(900);
  }

  throw new Error('Flashcard generation took too long. Try a shorter PDF first.');
}

export async function generateFlashcardsFromText(
  source: { sourceName: string; sourceText: string },
  onProgressChange: (progress: FlashcardProgress) => void,
): Promise<FlashcardResult> {
  onProgressChange({ percent: 1, status: 'Preparing flashcards...' });

  const response = await fetch(`${FLASHCARD_API_URL}/api/flashcards/text/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(source),
  });
  const data = (await response.json().catch(() => ({}))) as Partial<FlashcardJob> & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(getUserFacingFlashcardError(data.error, response.status));
  }

  if (!data.id) {
    throw new Error('Learning material service did not start progress tracking.');
  }

  onProgressChange({
    percent: mapJobPercent(data.percent ?? 1),
    status: data.status ?? 'Preparing flashcards...',
  });

  return pollFlashcardJob(data.id, onProgressChange);
}

export async function generateFlashcardsFromUrl(
  source: { sourceName?: string; sourceUrl: string },
  onProgressChange: (progress: FlashcardProgress) => void,
): Promise<FlashcardResult> {
  onProgressChange({ percent: 1, status: 'Opening link...' });

  const response = await fetch(`${FLASHCARD_API_URL}/api/flashcards/url/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(source),
  });
  const data = (await response.json().catch(() => ({}))) as Partial<FlashcardJob> & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(getUserFacingFlashcardError(data.error, response.status));
  }

  if (!data.id) {
    throw new Error('Learning material service did not start progress tracking.');
  }

  onProgressChange({
    percent: mapJobPercent(data.percent ?? 1),
    status: data.status ?? 'Opening link...',
  });

  return pollFlashcardJob(data.id, onProgressChange);
}

export async function uploadPdfForFlashcards(
  asset: PdfUploadAsset,
  onProgressChange: (progress: FlashcardProgress) => void,
): Promise<FlashcardResult> {
  const data = await uploadPdfJob({
    asset,
    endpoint: `${FLASHCARD_API_URL}/api/flashcards/jobs`,
    getErrorMessage: getUserFacingFlashcardError,
    onProgressChange,
    timeoutMessage: 'Flashcard generation took too long. Try a shorter PDF first.',
  });

  if (!data.id) {
    throw new Error('Learning material service did not start progress tracking.');
  }

  onProgressChange({
    percent: mapJobPercent(data.percent ?? 1),
    status: data.status ?? 'Preparing flashcards...',
  });

  return pollFlashcardJob(data.id, onProgressChange);
}
