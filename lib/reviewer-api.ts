import { getDefaultReviewerApiUrl } from '@/lib/network';
import { ReviewerResult } from '@/lib/reviewer-store';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

export const REVIEWER_API_URL =
  process.env.EXPO_PUBLIC_REVIEWER_API_URL ?? getDefaultReviewerApiUrl();

export const MAX_PDF_BYTES = 25 * 1024 * 1024;

export type ReviewerProgress = {
  percent: number;
  status: string;
};

type ReviewerJob = {
  error?: string | null;
  id: string;
  percent: number;
  result?: ReviewerResult | null;
  state: 'queued' | 'running' | 'complete' | 'failed';
  status: string;
};

export type PdfUploadAsset = {
  file?: File;
  mimeType?: string;
  name: string;
  uri: string;
};

type PdfUploadJob = {
  error?: string | null;
  id?: string;
  percent?: number;
  status?: string;
};

type PdfUploadOptions = {
  asset: PdfUploadAsset;
  endpoint: string;
  getErrorMessage: (error: string | undefined, status: number) => string;
  onProgressChange: (progress: ReviewerProgress) => void;
  timeoutMessage: string;
};

function getUserFacingReviewerError(error: string | undefined, status: number) {
  if (!error) {
    return `Reviewer service returned ${status}`;
  }

  return error
    .replace(/Ollama/gi, 'Pointerx AI')
    .replace(/localhost:\d+/gi, 'the reviewer service');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapJobPercent(percent: number) {
  return Math.min(100, Math.max(15, Math.round(15 + percent * 0.85)));
}

async function getReviewerJob(jobId: string) {
  const response = await fetch(`${REVIEWER_API_URL}/api/reviewer/jobs/${jobId}`);
  const data = (await response.json().catch(() => ({}))) as Partial<ReviewerJob> & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(getUserFacingReviewerError(data.error, response.status));
  }

  if (!data.id || !data.state || typeof data.percent !== 'number' || !data.status) {
    throw new Error('Reviewer service returned an incomplete progress update.');
  }

  return data as ReviewerJob;
}

async function pollReviewerJob(
  jobId: string,
  onProgressChange: (progress: ReviewerProgress) => void,
) {
  const deadline = Date.now() + 10 * 60 * 1000;

  while (Date.now() < deadline) {
    const job = await getReviewerJob(jobId);

    onProgressChange({
      percent: mapJobPercent(job.percent),
      status: job.status,
    });

    if (job.state === 'complete') {
      if (!job.result) {
        throw new Error('Reviewer service finished without a reviewer.');
      }

      return job.result;
    }

    if (job.state === 'failed') {
      throw new Error(getUserFacingReviewerError(job.error ?? undefined, 500));
    }

    await sleep(900);
  }

  throw new Error('Reviewer generation took too long. Try a shorter PDF first.');
}

export function createPdfFormData(asset: PdfUploadAsset) {
  const formData = new FormData();

  if (Platform.OS === 'web' && asset.file) {
    formData.append('file', asset.file, asset.name);
  } else {
    formData.append('file', {
      name: asset.name,
      type: asset.mimeType ?? 'application/pdf',
      uri: asset.uri,
    } as unknown as Blob);
  }

  return formData;
}

function parsePdfUploadResponse(body: string) {
  try {
    return JSON.parse(body || '{}') as PdfUploadJob;
  } catch {
    throw new Error('Learning material service returned an unreadable response.');
  }
}

function uploadPdfJobWithFormData({
  asset,
  endpoint,
  getErrorMessage,
  onProgressChange,
  timeoutMessage,
}: PdfUploadOptions): Promise<PdfUploadJob> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open('POST', endpoint);
    xhr.timeout = 2 * 60 * 1000;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgressChange({
          percent: Math.min(15, Math.max(1, Math.round(percent * 0.15))),
          status: `Uploading PDF... ${percent}%`,
        });
      }
    };

    xhr.onloadstart = () => {
      onProgressChange({ percent: 1, status: 'Uploading PDF...' });
    };

    xhr.onload = () => {
      try {
        const data = parsePdfUploadResponse(xhr.responseText);

        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(getErrorMessage(data.error ?? undefined, xhr.status)));
          return;
        }

        resolve(data);
      } catch (error) {
        reject(error);
      }
    };

    xhr.onerror = () => reject(new Error('Network request failed'));
    xhr.ontimeout = () => reject(new Error(timeoutMessage));

    xhr.send(createPdfFormData(asset));
    onProgressChange({ percent: 1, status: 'Uploading PDF...' });
  });
}

export async function uploadPdfJob({
  asset,
  endpoint,
  getErrorMessage,
  onProgressChange,
  timeoutMessage,
}: PdfUploadOptions): Promise<PdfUploadJob> {
  if (Platform.OS === 'web') {
    return uploadPdfJobWithFormData({
      asset,
      endpoint,
      getErrorMessage,
      onProgressChange,
      timeoutMessage,
    });
  }

  onProgressChange({ percent: 1, status: 'Uploading PDF...' });

  const uploadTask = FileSystem.createUploadTask(
    endpoint,
    asset.uri,
    {
      fieldName: 'file',
      httpMethod: 'POST',
      mimeType: asset.mimeType ?? 'application/pdf',
      parameters: {
        originalName: asset.name,
      },
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    },
    (progress) => {
      const expectedBytes = progress.totalBytesExpectedToSend;

      if (expectedBytes > 0) {
        const percent = Math.round((progress.totalBytesSent / expectedBytes) * 100);
        onProgressChange({
          percent: Math.min(15, Math.max(1, Math.round(percent * 0.15))),
          status: `Uploading PDF... ${percent}%`,
        });
      }
    },
  );

  const result = await uploadTask.uploadAsync();

  if (!result) {
    throw new Error(timeoutMessage);
  }

  const data = parsePdfUploadResponse(result.body);

  if (result.status < 200 || result.status >= 300) {
    throw new Error(getErrorMessage(data.error ?? undefined, result.status));
  }

  return data;
}

export async function generateReviewerFromText(
  source: { sourceName: string; sourceText: string },
  onProgressChange: (progress: ReviewerProgress) => void,
): Promise<ReviewerResult> {
  onProgressChange({ percent: 1, status: 'Preparing reviewer...' });

  const response = await fetch(`${REVIEWER_API_URL}/api/reviewer/text/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(source),
  });
  const data = (await response.json().catch(() => ({}))) as Partial<ReviewerJob> & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(getUserFacingReviewerError(data.error, response.status));
  }

  if (!data.id) {
    throw new Error('Reviewer service did not start progress tracking.');
  }

  onProgressChange({
    percent: mapJobPercent(data.percent ?? 1),
    status: data.status ?? 'Preparing reviewer...',
  });

  return pollReviewerJob(data.id, onProgressChange);
}

export async function uploadPdfForReviewer(
  asset: PdfUploadAsset,
  onProgressChange: (progress: ReviewerProgress) => void,
): Promise<ReviewerResult> {
  const data = await uploadPdfJob({
    asset,
    endpoint: `${REVIEWER_API_URL}/api/reviewer/jobs`,
    getErrorMessage: getUserFacingReviewerError,
    onProgressChange,
    timeoutMessage: 'Reviewer generation took too long. Try a shorter PDF first.',
  });

  if (!data.id) {
    throw new Error('Reviewer service did not start progress tracking.');
  }

  onProgressChange({
    percent: mapJobPercent(data.percent ?? 1),
    status: data.status ?? 'Preparing reviewer...',
  });

  return pollReviewerJob(data.id, onProgressChange);
}
