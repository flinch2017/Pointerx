import { getDefaultReviewerApiUrl } from '@/lib/network';
import { MockTestResult } from '@/lib/mock-test-store';
import { PdfUploadAsset, ReviewerProgress, MAX_PDF_BYTES, uploadPdfJob } from '@/lib/reviewer-api';

export { MAX_PDF_BYTES };
export type MockTestProgress = ReviewerProgress;

const MOCK_TEST_API_URL =
  process.env.EXPO_PUBLIC_REVIEWER_API_URL ?? getDefaultReviewerApiUrl();

type MockTestJob = {
  error?: string | null;
  id: string;
  percent: number;
  result?: MockTestResult | null;
  state: 'queued' | 'running' | 'complete' | 'failed';
  status: string;
};

function getUserFacingMockTestError(error: string | undefined, status: number) {
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

async function getMockTestJob(jobId: string) {
  const response = await fetch(`${MOCK_TEST_API_URL}/api/mock-tests/jobs/${jobId}`);
  const data = (await response.json().catch(() => ({}))) as Partial<MockTestJob> & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(getUserFacingMockTestError(data.error, response.status));
  }

  if (!data.id || !data.state || typeof data.percent !== 'number' || !data.status) {
    throw new Error('Learning material service returned an incomplete progress update.');
  }

  return data as MockTestJob;
}

async function pollMockTestJob(
  jobId: string,
  onProgressChange: (progress: MockTestProgress) => void,
) {
  const deadline = Date.now() + 10 * 60 * 1000;

  while (Date.now() < deadline) {
    const job = await getMockTestJob(jobId);

    onProgressChange({
      percent: mapJobPercent(job.percent),
      status: job.status,
    });

    if (job.state === 'complete') {
      if (!job.result) {
        throw new Error('Learning material service finished without a mock test.');
      }

      return job.result;
    }

    if (job.state === 'failed') {
      throw new Error(getUserFacingMockTestError(job.error ?? undefined, 500));
    }

    await sleep(900);
  }

  throw new Error('Mock test generation took too long. Try a shorter PDF first.');
}

export async function generateMockTestFromText(
  source: { sourceName: string; sourceText: string },
  onProgressChange: (progress: MockTestProgress) => void,
): Promise<MockTestResult> {
  onProgressChange({ percent: 1, status: 'Preparing mock test...' });

  const response = await fetch(`${MOCK_TEST_API_URL}/api/mock-tests/text/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(source),
  });
  const data = (await response.json().catch(() => ({}))) as Partial<MockTestJob> & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(getUserFacingMockTestError(data.error, response.status));
  }

  if (!data.id) {
    throw new Error('Learning material service did not start progress tracking.');
  }

  onProgressChange({
    percent: mapJobPercent(data.percent ?? 1),
    status: data.status ?? 'Preparing mock test...',
  });

  return pollMockTestJob(data.id, onProgressChange);
}

export async function generateMockTestFromUrl(
  source: { sourceName?: string; sourceUrl: string },
  onProgressChange: (progress: MockTestProgress) => void,
): Promise<MockTestResult> {
  onProgressChange({ percent: 1, status: 'Opening link...' });

  const response = await fetch(`${MOCK_TEST_API_URL}/api/mock-tests/url/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(source),
  });
  const data = (await response.json().catch(() => ({}))) as Partial<MockTestJob> & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(getUserFacingMockTestError(data.error, response.status));
  }

  if (!data.id) {
    throw new Error('Learning material service did not start progress tracking.');
  }

  onProgressChange({
    percent: mapJobPercent(data.percent ?? 1),
    status: data.status ?? 'Opening link...',
  });

  return pollMockTestJob(data.id, onProgressChange);
}

export async function uploadPdfForMockTest(
  asset: PdfUploadAsset,
  onProgressChange: (progress: MockTestProgress) => void,
): Promise<MockTestResult> {
  const data = await uploadPdfJob({
    asset,
    endpoint: `${MOCK_TEST_API_URL}/api/mock-tests/jobs`,
    getErrorMessage: getUserFacingMockTestError,
    onProgressChange,
    timeoutMessage: 'Mock test generation took too long. Try a shorter PDF first.',
  });

  if (!data.id) {
    throw new Error('Learning material service did not start progress tracking.');
  }

  onProgressChange({
    percent: mapJobPercent(data.percent ?? 1),
    status: data.status ?? 'Preparing mock test...',
  });

  return pollMockTestJob(data.id, onProgressChange);
}
