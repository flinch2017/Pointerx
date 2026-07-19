const cors = require('cors');
const { randomUUID } = require('crypto');
const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');

const app = express();
const upload = multer({
  limits: {
    fileSize: Number(process.env.REVIEWER_MAX_FILE_BYTES ?? 25 * 1024 * 1024),
  },
  storage: multer.memoryStorage(),
});

const PORT = Number(process.env.PORT ?? process.env.REVIEWER_SERVER_PORT ?? 3333);
const AI_PROVIDER = String(process.env.POINTERX_AI_PROVIDER ?? process.env.AI_PROVIDER ?? '')
  .trim()
  .toLowerCase();
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? process.env.EXPO_PUBLIC_OLLAMA_MODEL ?? 'llama3.2';
const OPENROUTER_API_KEY =
  process.env.OPENROUTER_API_KEY ?? process.env.EXPO_PUBLIC_OPENROUTER_API_KEY;
const OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL ??
  process.env.EXPO_PUBLIC_OPENROUTER_MODEL ??
  'mistralai/mistral-7b-instruct:free';
const OPENROUTER_APP_TITLE = process.env.OPENROUTER_APP_TITLE ?? 'Pointerx';
const OPENROUTER_APP_URL = process.env.OPENROUTER_APP_URL;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? process.env.EXPO_PUBLIC_GEMINI_API_KEY;
const GEMINI_MODEL =
  process.env.GEMINI_MODEL ?? process.env.EXPO_PUBLIC_GEMINI_MODEL ?? 'gemini-3.5-flash';
const MAX_CHUNKS = Number(process.env.REVIEWER_MAX_CHUNKS ?? 3);
const CHUNK_SIZE = Number(process.env.REVIEWER_CHUNK_SIZE ?? 8000);
const FLASHCARD_MAX_CARDS = Number(process.env.FLASHCARD_MAX_CARDS ?? 24);
const MOCK_TEST_MAX_QUESTIONS = Number(process.env.MOCK_TEST_MAX_QUESTIONS ?? 15);
const TEXT_SOURCE_MAX_CHARACTERS = Number(process.env.TEXT_SOURCE_MAX_CHARACTERS ?? 24000);
const URL_SOURCE_MAX_BYTES = Number(process.env.URL_SOURCE_MAX_BYTES ?? 10 * 1024 * 1024);
const URL_FETCH_TIMEOUT_MS = Number(process.env.URL_FETCH_TIMEOUT_MS ?? 30000);
const JOB_TTL_MS = 30 * 60 * 1000;
const reviewerJobs = new Map();
const flashcardJobs = new Map();
const mockTestJobs = new Map();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

function cleanText(text) {
  return text
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function chunkText(text, chunkSize) {
  const chunks = [];
  let cursor = 0;

  while (cursor < text.length) {
    const nextCursor = Math.min(cursor + chunkSize, text.length);
    const paragraphBreak = text.lastIndexOf('\n\n', nextCursor);
    const end = paragraphBreak > cursor + chunkSize * 0.6 ? paragraphBreak : nextCursor;

    chunks.push(text.slice(cursor, end).trim());
    cursor = end;
  }

  return chunks.filter(Boolean);
}

function getTextSourceFromRequest(request) {
  const sourceText = cleanText(String(request.body?.sourceText ?? ''));
  const sourceName = cleanText(String(request.body?.sourceName ?? 'Chat source')) || 'Chat source';

  if (sourceText.length < 80) {
    const error = new Error('Pointerx needs a longer chat answer before creating learning material.');
    error.statusCode = 422;
    throw error;
  }

  return {
    omittedCharacters: Math.max(0, sourceText.length - TEXT_SOURCE_MAX_CHARACTERS),
    sourceName,
    sourceText: sourceText.slice(0, TEXT_SOURCE_MAX_CHARACTERS),
    totalCharacters: sourceText.length,
  };
}

function parseSourceUrl(value) {
  const rawUrl = String(value ?? '').trim();
  const urlText = rawUrl.startsWith('www.') ? `https://${rawUrl}` : rawUrl;

  try {
    const sourceUrl = new URL(urlText);

    if (sourceUrl.protocol !== 'http:' && sourceUrl.protocol !== 'https:') {
      throw new Error('Only http and https links are supported.');
    }

    return sourceUrl;
  } catch {
    const error = new Error('Pointerx needs a valid link to create learning material.');
    error.statusCode = 400;
    throw error;
  }
}

function getUrlFromRequest(request) {
  return parseSourceUrl(request.body?.sourceUrl).toString();
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getUrlSourceName(sourceUrl) {
  const url = parseSourceUrl(sourceUrl);
  const segments = url.pathname.split('/').filter(Boolean);
  const rawName = segments.at(-1) ?? '';
  const decodedName = rawName ? safeDecodeURIComponent(rawName).replace(/\.[a-z0-9]+$/i, '') : '';

  return cleanText(decodedName || url.hostname || 'Link source');
}

function decodeHtmlEntities(text) {
  const namedEntities = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };

  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
    const normalizedCode = code.toLowerCase();

    if (normalizedCode.startsWith('#x')) {
      return String.fromCodePoint(Number.parseInt(normalizedCode.slice(2), 16));
    }

    if (normalizedCode.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(normalizedCode.slice(1), 10));
    }

    return namedEntities[normalizedCode] ?? entity;
  });
}

function getHtmlTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  return match ? cleanText(decodeHtmlEntities(match[1].replace(/<[^>]+>/g, ' '))) : '';
}

function htmlToText(html) {
  return cleanText(
    decodeHtmlEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<\/(article|aside|blockquote|br|dd|div|dt|h[1-6]|li|main|p|section|td|th|tr)>/gi, '\n')
        .replace(/<[^>]+>/g, ' '),
    ),
  );
}

function createTextSource(sourceName, sourceText, shortSourceMessage) {
  const cleanedText = cleanText(sourceText);

  if (cleanedText.length < 80) {
    const error = new Error(shortSourceMessage);
    error.statusCode = 422;
    throw error;
  }

  return {
    omittedCharacters: Math.max(0, cleanedText.length - TEXT_SOURCE_MAX_CHARACTERS),
    sourceName: cleanText(sourceName) || 'Link source',
    sourceText: cleanedText.slice(0, TEXT_SOURCE_MAX_CHARACTERS),
    totalCharacters: cleanedText.length,
  };
}

async function fetchUrlSource(sourceUrl, onProgress = () => {}) {
  const url = parseSourceUrl(sourceUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT_MS);

  onProgress({ percent: 8, state: 'running', status: 'Opening link...' });

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'text/html,application/pdf,text/plain;q=0.9,*/*;q=0.8',
        'User-Agent': 'Pointerx/1.0 learning-material-generator',
      },
      signal: controller.signal,
    });

    onProgress({ percent: 16, state: 'running', status: 'Reading link content...' });

    if (!response.ok) {
      const error = new Error(`Pointerx could not open this link. The site returned ${response.status}.`);
      error.statusCode = response.status;
      throw error;
    }

    const contentLength = Number(response.headers.get('content-length') ?? 0);

    if (contentLength > URL_SOURCE_MAX_BYTES) {
      const error = new Error('This link is too large to process. Try a shorter article or a PDF under 10 MB.');
      error.statusCode = 413;
      throw error;
    }

    const arrayBuffer = await response.arrayBuffer();

    if (arrayBuffer.byteLength > URL_SOURCE_MAX_BYTES) {
      const error = new Error('This link is too large to process. Try a shorter article or a PDF under 10 MB.');
      error.statusCode = 413;
      throw error;
    }

    const buffer = Buffer.from(arrayBuffer);
    const contentType = response.headers.get('content-type') ?? '';
    const isPdf = contentType.includes('application/pdf') || url.pathname.toLowerCase().endsWith('.pdf');

    onProgress({ percent: 24, state: 'running', status: isPdf ? 'Extracting linked PDF...' : 'Extracting article text...' });

    if (isPdf) {
      const parsed = await pdfParse(buffer);

      return createTextSource(
        getUrlSourceName(url.toString()),
        parsed.text ?? '',
        'Pointerx could not extract enough text from this linked PDF.',
      );
    }

    const html = buffer.toString('utf8');
    const title = getHtmlTitle(html) || getUrlSourceName(url.toString());

    return createTextSource(
      title,
      htmlToText(html),
      'Pointerx could not extract enough study text from this link.',
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      const timeoutError = new Error('Pointerx took too long to open this link. Try another source.');
      timeoutError.statusCode = 408;
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function mapUrlGenerationProgress(progress) {
  return {
    ...progress,
    percent: Math.min(96, 30 + Math.round(progress.percent * 0.66)),
    status: progress.status.replace(/chat source/gi, 'link'),
  };
}

function createReviewerJob(fileName) {
  const now = Date.now();
  const job = {
    createdAt: now,
    error: null,
    fileName,
    id: randomUUID(),
    percent: 1,
    result: null,
    state: 'queued',
    status: 'Preparing PDF...',
    updatedAt: now,
  };

  reviewerJobs.set(job.id, job);
  return job;
}

function updateReviewerJob(jobId, update) {
  const job = reviewerJobs.get(jobId);

  if (!job) {
    return;
  }

  Object.assign(job, update, { updatedAt: Date.now() });
}

function serializeReviewerJob(job) {
  return {
    error: job.error,
    fileName: job.fileName,
    id: job.id,
    percent: job.percent,
    result: job.result,
    state: job.state,
    status: job.status,
  };
}

function createFlashcardJob(fileName) {
  const now = Date.now();
  const job = {
    createdAt: now,
    error: null,
    fileName,
    id: randomUUID(),
    percent: 1,
    result: null,
    state: 'queued',
    status: 'Preparing PDF...',
    updatedAt: now,
  };

  flashcardJobs.set(job.id, job);
  return job;
}

function updateFlashcardJob(jobId, update) {
  const job = flashcardJobs.get(jobId);

  if (!job) {
    return;
  }

  Object.assign(job, update, { updatedAt: Date.now() });
}

function serializeFlashcardJob(job) {
  return {
    error: job.error,
    fileName: job.fileName,
    id: job.id,
    percent: job.percent,
    result: job.result,
    state: job.state,
    status: job.status,
  };
}

function createMockTestJob(fileName) {
  const now = Date.now();
  const job = {
    createdAt: now,
    error: null,
    fileName,
    id: randomUUID(),
    percent: 1,
    result: null,
    state: 'queued',
    status: 'Preparing PDF...',
    updatedAt: now,
  };

  mockTestJobs.set(job.id, job);
  return job;
}

function updateMockTestJob(jobId, update) {
  const job = mockTestJobs.get(jobId);

  if (!job) {
    return;
  }

  Object.assign(job, update, { updatedAt: Date.now() });
}

function serializeMockTestJob(job) {
  return {
    error: job.error,
    fileName: job.fileName,
    id: job.id,
    percent: job.percent,
    result: job.result,
    state: job.state,
    status: job.status,
  };
}

setInterval(() => {
  const expiresBefore = Date.now() - JOB_TTL_MS;

  for (const [jobId, job] of reviewerJobs.entries()) {
    if (job.updatedAt < expiresBefore) {
      reviewerJobs.delete(jobId);
    }
  }

  for (const [jobId, job] of flashcardJobs.entries()) {
    if (job.updatedAt < expiresBefore) {
      flashcardJobs.delete(jobId);
    }
  }

  for (const [jobId, job] of mockTestJobs.entries()) {
    if (job.updatedAt < expiresBefore) {
      mockTestJobs.delete(jobId);
    }
  }
}, 5 * 60 * 1000);

function getActiveAiProvider() {
  if (AI_PROVIDER) {
    return AI_PROVIDER;
  }

  if (OPENROUTER_API_KEY) {
    return 'openrouter';
  }

  if (GEMINI_API_KEY) {
    return 'gemini';
  }

  return 'ollama';
}

function getActiveAiModel() {
  const provider = getActiveAiProvider();

  if (provider === 'openrouter') {
    return OPENROUTER_MODEL;
  }

  if (provider === 'gemini') {
    return GEMINI_MODEL;
  }

  return OLLAMA_MODEL;
}

function getProviderTemperature(options) {
  return typeof options.temperature === 'number' ? options.temperature : 0.25;
}

async function askOllama(messages, options = {}) {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      options: {
        temperature: 0.25,
        ...options,
      },
      messages,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status}`);
  }

  const data = await response.json();
  const content = data && data.message && data.message.content;

  if (!content || !content.trim()) {
    throw new Error('Ollama returned an empty reviewer');
  }

  return content.trim();
}

async function askOpenRouter(messages, options = {}) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OpenRouter API key is missing.');
  }

  const headers = {
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'X-OpenRouter-Title': OPENROUTER_APP_TITLE,
  };

  if (OPENROUTER_APP_URL) {
    headers['HTTP-Referer'] = OPENROUTER_APP_URL;
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      max_tokens: Number(process.env.OPENROUTER_MAX_TOKENS ?? 4096),
      messages,
      model: OPENROUTER_MODEL,
      stream: false,
      temperature: getProviderTemperature(options),
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.error?.message ?? data?.message ?? `OpenRouter returned ${response.status}`;
    throw new Error(message);
  }

  const content = data?.choices?.[0]?.message?.content;

  if (!content || !content.trim()) {
    throw new Error('OpenRouter returned an empty response.');
  }

  return content.trim();
}

function getGeminiContents(messages) {
  const contents = [];

  for (const message of messages) {
    if (message.role === 'system') {
      continue;
    }

    const text = String(message.content ?? '').trim();

    if (!text) {
      continue;
    }

    const role = message.role === 'assistant' ? 'model' : 'user';
    const lastContent = contents[contents.length - 1];

    if (lastContent?.role === role) {
      lastContent.parts[0].text += `\n\n${text}`;
      continue;
    }

    contents.push({
      parts: [{ text }],
      role,
    });
  }

  return contents;
}

function getGeminiSystemInstruction(messages) {
  const text = messages
    .filter((message) => message.role === 'system')
    .map((message) => String(message.content ?? '').trim())
    .filter(Boolean)
    .join('\n\n');

  return text ? { parts: [{ text }] } : undefined;
}

async function askGemini(messages, options = {}) {
  if (!GEMINI_API_KEY) {
    throw new Error('Gemini API key is missing.');
  }

  const modelPath = GEMINI_MODEL.startsWith('models/') ? GEMINI_MODEL : `models/${GEMINI_MODEL}`;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: getGeminiContents(messages),
        generationConfig: {
          maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS ?? 4096),
          temperature: getProviderTemperature(options),
        },
        system_instruction: getGeminiSystemInstruction(messages),
      }),
    },
  );

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.error?.message ?? `Gemini returned ${response.status}`;
    throw new Error(message);
  }

  const content =
    data?.candidates
      ?.flatMap((candidate) => candidate.content?.parts?.map((part) => part.text ?? '') ?? [])
      .join('') ?? '';

  if (!content.trim()) {
    throw new Error('Gemini returned an empty response.');
  }

  return content.trim();
}

async function askAi(messages, options = {}) {
  const provider = getActiveAiProvider();

  if (provider === 'openrouter') {
    return askOpenRouter(messages, options);
  }

  if (provider === 'gemini') {
    return askGemini(messages, options);
  }

  return askOllama(messages, options);
}

async function summarizeChunk(chunk, index, total) {
  return askAi([
    {
      role: 'system',
      content:
        'You are Pointerx, an AI reviewing assistant. Extract reviewer-worthy study notes from PDF text. Use only the provided text.',
    },
    {
      role: 'user',
      content: `PDF section ${index + 1} of ${total}:\n\n${chunk}\n\nCreate concise study notes with headings, key terms, important facts, and likely exam cues.`,
    },
  ]);
}

async function createReviewerFromNotes(fileName, notes, omittedCharacters) {
  const omissionNote =
    omittedCharacters > 0
      ? `\n\nNote: ${omittedCharacters.toLocaleString()} characters were not processed because the PDF is large.`
      : '';

  return askAi([
    {
      role: 'system',
      content:
        'You are Pointerx, an AI reviewing assistant. Create polished reviewers for students. Be accurate, structured, and practical.',
    },
    {
      role: 'user',
      content: `Create a complete reviewer from this PDF extraction for "${fileName}". Use this exact structure:

# Reviewer
## Quick Overview
## High-Yield Concepts
## Key Terms
## Processes / Steps
## Common Confusions
## Must-Review Checklist

Keep it study-ready and do not invent facts outside the notes.
${omissionNote}

Notes:
${notes}`,
    },
  ]);
}

async function createReviewerFromPdfText(fileName, text, omittedCharacters) {
  const omissionNote =
    omittedCharacters > 0
      ? `\n\nNote: ${omittedCharacters.toLocaleString()} characters were not processed because the PDF is large.`
      : '';

  return askAi([
    {
      role: 'system',
      content:
        'You are Pointerx, an AI reviewing assistant. Create polished reviewers for students. Use only the provided PDF text.',
    },
    {
      role: 'user',
      content: `Create a complete reviewer from this PDF text. The file name "${fileName}" is only a label; do not infer or invent any content from the file name. Use this exact structure:

# Reviewer
## Quick Overview
## High-Yield Concepts
## Key Terms
## Processes / Steps
## Common Confusions
## Must-Review Checklist

Keep it study-ready and do not invent facts outside the PDF text.
${omissionNote}

PDF text:
${text}`,
    },
  ]);
}

function extractJsonArray(text, contentName = 'generated content') {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1] : text;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Pointerx could not format the ${contentName}.`);
  }

  return JSON.parse(candidate.slice(start, end + 1));
}

function normalizeFlashcards(rawCards) {
  if (!Array.isArray(rawCards)) {
    throw new Error('Pointerx could not format the generated flashcards.');
  }

  const seen = new Set();
  const cards = [];

  for (const rawCard of rawCards) {
    const front = String(rawCard.front ?? rawCard.question ?? '').trim();
    const back = String(rawCard.back ?? rawCard.answer ?? '').trim();

    if (!front || !back) {
      continue;
    }

    const key = front.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    cards.push({
      back,
      front,
      hint: String(rawCard.hint ?? '').trim(),
      tag: String(rawCard.tag ?? rawCard.category ?? 'General').trim() || 'General',
    });
  }

  return cards.slice(0, FLASHCARD_MAX_CARDS);
}

async function createFlashcardsFromPdfText(fileName, text, targetCount, omittedCharacters) {
  const omissionNote =
    omittedCharacters > 0
      ? `\n\nNote: ${omittedCharacters.toLocaleString()} characters were not processed because the PDF is large.`
      : '';
  const response = await askAi([
    {
      role: 'system',
      content:
        'You are Pointerx, an AI reviewing assistant. Create accurate active-recall flashcards from PDF text. Use only the provided text. Return JSON only.',
    },
    {
      role: 'user',
      content: `Create ${targetCount} study flashcards from the PDF text. The file name "${fileName}" is only a label; do not infer or invent any content from the file name.

Return only a JSON array. Each item must use this shape:
{"front":"question or cue","back":"answer or explanation","hint":"short clue","tag":"topic"}

Make cards exam-focused, concise, and varied. Do not invent facts outside the PDF text.
${omissionNote}

PDF text:
${text}`,
    },
  ]);

  return normalizeFlashcards(extractJsonArray(response, 'generated flashcards'));
}

async function createFlashcardsFromChunk(chunk, index, total, targetCount) {
  const response = await askAi([
    {
      role: 'system',
      content:
        'You are Pointerx, an AI reviewing assistant. Create accurate active-recall flashcards from PDF text. Use only the provided text. Return JSON only.',
    },
    {
      role: 'user',
      content: `PDF section ${index + 1} of ${total}:

${chunk}

Create ${targetCount} study flashcards from this section.
Return only a JSON array. Each item must use this shape:
{"front":"question or cue","back":"answer or explanation","hint":"short clue","tag":"topic"}`,
    },
  ]);

  return normalizeFlashcards(extractJsonArray(response, 'generated flashcards'));
}

function normalizeAnswerText(value) {
  return String(value ?? '')
    .replace(/^[A-D](?:\.|\)|:)?\s*/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getChoiceIndexFromLetter(value, choices) {
  const text = String(value ?? '').trim();
  const directLetterMatch = text.match(/^[A-D](?:\.|\)|:|\s|$)/i);
  const explanationLetterMatch = text.match(
    /\b(?:correct\s+)?(?:answer|choice|option)\s*(?:is|:|-)?\s*([A-D])\b/i,
  );
  const letter = directLetterMatch?.[0]?.trim()[0] ?? explanationLetterMatch?.[1];

  if (!letter) {
    return -1;
  }

  const index = letter.toUpperCase().charCodeAt(0) - 65;

  return index >= 0 && index < choices.length ? index : -1;
}

function getChoiceIndexFromText(value, choices) {
  const normalizedValue = normalizeAnswerText(value);

  if (!normalizedValue) {
    return -1;
  }

  const normalizedChoices = choices.map(normalizeAnswerText);
  const exactIndex = normalizedChoices.findIndex((choice) => choice === normalizedValue);

  if (exactIndex !== -1) {
    return exactIndex;
  }

  const containedMatches = normalizedChoices
    .map((choice, index) => ({ choice, index }))
    .filter(
      ({ choice }) =>
        choice.length >= 4 &&
        (normalizedValue.includes(choice) || choice.includes(normalizedValue)),
    );

  return containedMatches.length === 1 ? containedMatches[0].index : -1;
}

function getChoiceIndexFromExplanation(value, choices) {
  const explanation = String(value ?? '').trim();

  if (!explanation) {
    return -1;
  }

  const letterIndex = getChoiceIndexFromLetter(explanation, choices);

  if (letterIndex !== -1) {
    return letterIndex;
  }

  const answerSegmentMatch = explanation.match(
    /\b(?:correct\s+answer|answer|correct\s+choice|best\s+answer)\s*(?:is|:|-)\s*([^.;\n]+)/i,
  );

  if (answerSegmentMatch) {
    const segmentIndex = getChoiceIndexFromText(answerSegmentMatch[1], choices);

    if (segmentIndex !== -1) {
      return segmentIndex;
    }
  }

  const normalizedExplanation = normalizeAnswerText(explanation);
  const matches = choices
    .map((choice, index) => ({
      choice: normalizeAnswerText(choice),
      index,
    }))
    .filter(({ choice }) => choice.length >= 4 && normalizedExplanation.includes(choice));

  return matches.length === 1 ? matches[0].index : -1;
}

function getAnswerIndex(rawQuestion, choices) {
  const answerCandidates = [
    rawQuestion.answer,
    rawQuestion.correctAnswer,
    rawQuestion.correct_answer,
  ];

  for (const candidate of answerCandidates) {
    const answerTextIndex = getChoiceIndexFromText(candidate, choices);

    if (answerTextIndex !== -1) {
      return answerTextIndex;
    }

    const answerLetterIndex = getChoiceIndexFromLetter(candidate, choices);

    if (answerLetterIndex !== -1) {
      return answerLetterIndex;
    }
  }

  const explanationIndex = getChoiceIndexFromExplanation(
    rawQuestion.explanation ?? rawQuestion.rationale,
    choices,
  );

  if (explanationIndex !== -1) {
    return explanationIndex;
  }

  const directIndex =
    rawQuestion.answerIndex ??
    rawQuestion.answer_index ??
    rawQuestion.correctIndex ??
    rawQuestion.correct_index;

  if (Number.isInteger(directIndex) && directIndex >= 0 && directIndex < choices.length) {
    return directIndex;
  }

  if (
    typeof directIndex === 'string' &&
    Number.isInteger(Number(directIndex)) &&
    Number(directIndex) >= 0 &&
    Number(directIndex) < choices.length
  ) {
    return Number(directIndex);
  }

  return -1;
}

function cleanMockRationale(explanation) {
  return String(explanation ?? '')
    .replace(
      /\b(?:correct\s+answer|answer|correct\s+choice|best\s+answer)\s*(?:is|:|-)\s*[^.;\n]+[.;]?/gi,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function createMockExplanation(correctChoice, explanation) {
  const rationale = cleanMockRationale(explanation);

  return rationale ? `Correct answer: ${correctChoice}. ${rationale}` : `Correct answer: ${correctChoice}.`;
}

function placeCorrectChoice(choices, answerIndex, questionIndex) {
  const safeAnswerIndex = Math.min(Math.max(answerIndex, 0), choices.length - 1);
  const targetIndex = questionIndex % choices.length;
  const correctChoice = choices[safeAnswerIndex];
  const distractors = choices.filter((_, index) => index !== safeAnswerIndex);
  const rotatedDistractors = distractors.map(
    (_, index) => distractors[(index + questionIndex) % distractors.length],
  );
  const nextChoices = [...rotatedDistractors];

  nextChoices.splice(targetIndex, 0, correctChoice);

  return {
    answerIndex: targetIndex,
    choices: nextChoices,
  };
}

function normalizeMockQuestions(rawQuestions) {
  if (!Array.isArray(rawQuestions)) {
    throw new Error('Pointerx could not format the generated mock test.');
  }

  const seen = new Set();
  const questions = [];

  for (const rawQuestion of rawQuestions) {
    const prompt = String(rawQuestion.question ?? rawQuestion.prompt ?? '').trim();
    const rawChoices = rawQuestion.choices ?? rawQuestion.options ?? [];
    const choices = (Array.isArray(rawChoices) ? rawChoices : Object.values(rawChoices))
      .map((choice) => String(choice).trim())
      .filter(Boolean)
      .slice(0, 4);

    if (!prompt || choices.length < 2) {
      continue;
    }

    const answerIndex = getAnswerIndex(rawQuestion, choices);

    if (answerIndex < 0 || answerIndex >= choices.length) {
      continue;
    }

    const key = prompt.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    const balancedQuestion = placeCorrectChoice(choices, answerIndex, questions.length);

    questions.push({
      answerIndex: balancedQuestion.answerIndex,
      choices: balancedQuestion.choices,
      explanation: createMockExplanation(
        balancedQuestion.choices[balancedQuestion.answerIndex],
        rawQuestion.explanation ?? rawQuestion.rationale,
      ),
      question: prompt,
      topic: String(rawQuestion.topic ?? rawQuestion.tag ?? 'General').trim() || 'General',
    });
  }

  return questions.slice(0, MOCK_TEST_MAX_QUESTIONS);
}

async function createMockTestFromPdfText(fileName, text, targetCount, omittedCharacters) {
  const omissionNote =
    omittedCharacters > 0
      ? `\n\nNote: ${omittedCharacters.toLocaleString()} characters were not processed because the PDF is large.`
      : '';
  const response = await askAi([
    {
      role: 'system',
      content:
        'You are Pointerx, an AI reviewing assistant. Create accurate multiple-choice mock tests from PDF text. Use only the provided text. Return JSON only.',
    },
    {
      role: 'user',
      content: `Create ${targetCount} exam-style multiple-choice questions from the PDF text. The file name "${fileName}" is only a label; do not infer or invent any content from the file name.

Return only a JSON array. Each item must use this shape:
{"question":"question text","choices":["choice A","choice B","choice C","choice D"],"answer":"exact correct choice text","answerIndex":2,"explanation":"brief reason without answer letter","topic":"topic"}

Use 4 choices when possible. The answer field must exactly match the correct choice text. Vary the correct answer position across questions. Do not put every correct answer at index 0. Make questions varied and practical. Do not include answer letters in explanations. Do not invent facts outside the PDF text.
${omissionNote}

PDF text:
${text}`,
    },
  ]);

  return normalizeMockQuestions(extractJsonArray(response, 'generated mock test'));
}

async function createMockQuestionsFromChunk(chunk, index, total, targetCount) {
  const response = await askAi([
    {
      role: 'system',
      content:
        'You are Pointerx, an AI reviewing assistant. Create accurate multiple-choice questions from PDF text. Use only the provided text. Return JSON only.',
    },
    {
      role: 'user',
      content: `PDF section ${index + 1} of ${total}:

${chunk}

Create ${targetCount} exam-style multiple-choice questions from this section.
Return only a JSON array. Each item must use this shape:
{"question":"question text","choices":["choice A","choice B","choice C","choice D"],"answer":"exact correct choice text","answerIndex":2,"explanation":"brief reason without answer letter","topic":"topic"}

Use 4 choices when possible. The answer field must exactly match the correct choice text. Vary the correct answer position across questions. Do not put every correct answer at index 0. Do not include answer letters in explanations.`,
    },
  ]);

  return normalizeMockQuestions(extractJsonArray(response, 'generated mock test'));
}

async function buildReviewerFromPdfFile(file, onProgress = () => {}) {
  onProgress({ percent: 8, state: 'running', status: 'Extracting PDF text...' });
  const parsed = await pdfParse(file.buffer);
  const extractedText = cleanText(parsed.text ?? '');

  onProgress({ percent: 18, state: 'running', status: 'Preparing study sections...' });

  if (extractedText.length < 200) {
    const error = new Error(
      'Pointerx could not extract enough text from this PDF. It may be scanned images instead of selectable text.',
    );
    error.statusCode = 422;
    throw error;
  }

  const allChunks = chunkText(extractedText, CHUNK_SIZE);
  const chunks = allChunks.slice(0, MAX_CHUNKS);
  const processedLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const omittedCharacters = Math.max(0, extractedText.length - processedLength);
  let reviewer;

  if (chunks.length <= 1) {
    onProgress({ percent: 42, state: 'running', status: 'Generating reviewer...' });
    reviewer = await createReviewerFromPdfText(file.originalname, chunks[0], omittedCharacters);
  } else {
    const chunkNotes = [];

    for (let index = 0; index < chunks.length; index += 1) {
      const startPercent = 26 + Math.round((index / chunks.length) * 46);

      onProgress({
        percent: startPercent,
        state: 'running',
        status: `Reading section ${index + 1} of ${chunks.length}...`,
      });

      chunkNotes.push(await summarizeChunk(chunks[index], index, chunks.length));

      onProgress({
        percent: 26 + Math.round(((index + 1) / chunks.length) * 46),
        state: 'running',
        status: `Section ${index + 1} complete.`,
      });
    }

    onProgress({ percent: 82, state: 'running', status: 'Building final reviewer...' });
    reviewer = await createReviewerFromNotes(
      file.originalname,
      chunkNotes.join('\n\n---\n\n'),
      omittedCharacters,
    );
  }

  onProgress({ percent: 96, state: 'running', status: 'Finalizing reviewer...' });

  return {
    fileName: file.originalname,
    pageCount: parsed.numpages,
    extractedCharacters: extractedText.length,
    processedCharacters: processedLength,
    reviewer,
  };
}

async function buildFlashcardsFromPdfFile(file, onProgress = () => {}) {
  onProgress({ percent: 8, state: 'running', status: 'Extracting PDF text...' });
  const parsed = await pdfParse(file.buffer);
  const extractedText = cleanText(parsed.text ?? '');

  onProgress({ percent: 18, state: 'running', status: 'Preparing flashcard topics...' });

  if (extractedText.length < 200) {
    const error = new Error(
      'Pointerx could not extract enough text from this PDF. It may be scanned images instead of selectable text.',
    );
    error.statusCode = 422;
    throw error;
  }

  const allChunks = chunkText(extractedText, CHUNK_SIZE);
  const chunks = allChunks.slice(0, MAX_CHUNKS);
  const processedLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const omittedCharacters = Math.max(0, extractedText.length - processedLength);
  let cards = [];

  if (chunks.length <= 1) {
    onProgress({ percent: 42, state: 'running', status: 'Generating flashcards...' });
    cards = await createFlashcardsFromPdfText(
      file.originalname,
      chunks[0],
      Math.min(FLASHCARD_MAX_CARDS, 18),
      omittedCharacters,
    );
  } else {
    const perChunkCount = Math.max(4, Math.ceil(FLASHCARD_MAX_CARDS / chunks.length));

    for (let index = 0; index < chunks.length; index += 1) {
      onProgress({
        percent: 26 + Math.round((index / chunks.length) * 54),
        state: 'running',
        status: `Creating flashcards from section ${index + 1} of ${chunks.length}...`,
      });

      cards.push(...(await createFlashcardsFromChunk(chunks[index], index, chunks.length, perChunkCount)));
      cards = normalizeFlashcards(cards);

      onProgress({
        percent: 26 + Math.round(((index + 1) / chunks.length) * 54),
        state: 'running',
        status: `Section ${index + 1} flashcards complete.`,
      });
    }
  }

  cards = normalizeFlashcards(cards);

  if (!cards.length) {
    throw new Error('Pointerx could not create flashcards from this PDF.');
  }

  onProgress({ percent: 96, state: 'running', status: 'Finalizing flashcards...' });

  return {
    cards,
    extractedCharacters: extractedText.length,
    fileName: file.originalname,
    pageCount: parsed.numpages,
    processedCharacters: processedLength,
  };
}

async function buildMockTestFromPdfFile(file, onProgress = () => {}) {
  onProgress({ percent: 8, state: 'running', status: 'Extracting PDF text...' });
  const parsed = await pdfParse(file.buffer);
  const extractedText = cleanText(parsed.text ?? '');

  onProgress({ percent: 18, state: 'running', status: 'Preparing test coverage...' });

  if (extractedText.length < 200) {
    const error = new Error(
      'Pointerx could not extract enough text from this PDF. It may be scanned images instead of selectable text.',
    );
    error.statusCode = 422;
    throw error;
  }

  const allChunks = chunkText(extractedText, CHUNK_SIZE);
  const chunks = allChunks.slice(0, MAX_CHUNKS);
  const processedLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const omittedCharacters = Math.max(0, extractedText.length - processedLength);
  let questions = [];

  if (chunks.length <= 1) {
    onProgress({ percent: 42, state: 'running', status: 'Generating mock test...' });
    questions = await createMockTestFromPdfText(
      file.originalname,
      chunks[0],
      Math.min(MOCK_TEST_MAX_QUESTIONS, 12),
      omittedCharacters,
    );
  } else {
    const perChunkCount = Math.max(3, Math.ceil(MOCK_TEST_MAX_QUESTIONS / chunks.length));

    for (let index = 0; index < chunks.length; index += 1) {
      onProgress({
        percent: 26 + Math.round((index / chunks.length) * 54),
        state: 'running',
        status: `Writing questions from section ${index + 1} of ${chunks.length}...`,
      });

      questions.push(
        ...(await createMockQuestionsFromChunk(chunks[index], index, chunks.length, perChunkCount)),
      );
      questions = normalizeMockQuestions(questions);

      onProgress({
        percent: 26 + Math.round(((index + 1) / chunks.length) * 54),
        state: 'running',
        status: `Section ${index + 1} questions complete.`,
      });
    }
  }

  questions = normalizeMockQuestions(questions);

  if (!questions.length) {
    throw new Error('Pointerx could not create a mock test from this PDF.');
  }

  onProgress({ percent: 96, state: 'running', status: 'Finalizing mock test...' });

  return {
    extractedCharacters: extractedText.length,
    fileName: file.originalname,
    pageCount: parsed.numpages,
    processedCharacters: processedLength,
    questions,
  };
}

async function buildReviewerFromTextSource(source, onProgress = () => {}) {
  onProgress({ percent: 10, state: 'running', status: 'Preparing chat source...' });

  const chunks = chunkText(source.sourceText, CHUNK_SIZE).slice(0, MAX_CHUNKS);
  const processedLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const omittedCharacters = source.omittedCharacters + Math.max(0, source.sourceText.length - processedLength);
  let reviewer;

  if (chunks.length <= 1) {
    onProgress({ percent: 44, state: 'running', status: 'Generating reviewer...' });
    reviewer = await createReviewerFromPdfText(source.sourceName, chunks[0], omittedCharacters);
  } else {
    const chunkNotes = [];

    for (let index = 0; index < chunks.length; index += 1) {
      onProgress({
        percent: 26 + Math.round((index / chunks.length) * 46),
        state: 'running',
        status: `Reading section ${index + 1} of ${chunks.length}...`,
      });

      chunkNotes.push(await summarizeChunk(chunks[index], index, chunks.length));

      onProgress({
        percent: 26 + Math.round(((index + 1) / chunks.length) * 46),
        state: 'running',
        status: `Section ${index + 1} complete.`,
      });
    }

    onProgress({ percent: 82, state: 'running', status: 'Building final reviewer...' });
    reviewer = await createReviewerFromNotes(
      source.sourceName,
      chunkNotes.join('\n\n---\n\n'),
      omittedCharacters,
    );
  }

  onProgress({ percent: 96, state: 'running', status: 'Finalizing reviewer...' });

  return {
    extractedCharacters: source.totalCharacters,
    fileName: source.sourceName,
    processedCharacters: processedLength,
    reviewer,
  };
}

async function buildFlashcardsFromTextSource(source, onProgress = () => {}) {
  onProgress({ percent: 10, state: 'running', status: 'Preparing chat source...' });

  const chunks = chunkText(source.sourceText, CHUNK_SIZE).slice(0, MAX_CHUNKS);
  const processedLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const omittedCharacters = source.omittedCharacters + Math.max(0, source.sourceText.length - processedLength);
  let cards = [];

  if (chunks.length <= 1) {
    onProgress({ percent: 44, state: 'running', status: 'Generating flashcards...' });
    cards = await createFlashcardsFromPdfText(
      source.sourceName,
      chunks[0],
      Math.min(FLASHCARD_MAX_CARDS, 18),
      omittedCharacters,
    );
  } else {
    const perChunkCount = Math.max(4, Math.ceil(FLASHCARD_MAX_CARDS / chunks.length));

    for (let index = 0; index < chunks.length; index += 1) {
      onProgress({
        percent: 26 + Math.round((index / chunks.length) * 54),
        state: 'running',
        status: `Creating flashcards from section ${index + 1} of ${chunks.length}...`,
      });

      cards.push(...(await createFlashcardsFromChunk(chunks[index], index, chunks.length, perChunkCount)));
      cards = normalizeFlashcards(cards);

      onProgress({
        percent: 26 + Math.round(((index + 1) / chunks.length) * 54),
        state: 'running',
        status: `Section ${index + 1} flashcards complete.`,
      });
    }
  }

  cards = normalizeFlashcards(cards);

  if (!cards.length) {
    throw new Error('Pointerx could not create flashcards from this chat answer.');
  }

  onProgress({ percent: 96, state: 'running', status: 'Finalizing flashcards...' });

  return {
    cards,
    extractedCharacters: source.totalCharacters,
    fileName: source.sourceName,
    processedCharacters: processedLength,
  };
}

async function buildMockTestFromTextSource(source, onProgress = () => {}) {
  onProgress({ percent: 10, state: 'running', status: 'Preparing chat source...' });

  const chunks = chunkText(source.sourceText, CHUNK_SIZE).slice(0, MAX_CHUNKS);
  const processedLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const omittedCharacters = source.omittedCharacters + Math.max(0, source.sourceText.length - processedLength);
  let questions = [];

  if (chunks.length <= 1) {
    onProgress({ percent: 44, state: 'running', status: 'Generating mock test...' });
    questions = await createMockTestFromPdfText(
      source.sourceName,
      chunks[0],
      Math.min(MOCK_TEST_MAX_QUESTIONS, 12),
      omittedCharacters,
    );
  } else {
    const perChunkCount = Math.max(3, Math.ceil(MOCK_TEST_MAX_QUESTIONS / chunks.length));

    for (let index = 0; index < chunks.length; index += 1) {
      onProgress({
        percent: 26 + Math.round((index / chunks.length) * 54),
        state: 'running',
        status: `Writing questions from section ${index + 1} of ${chunks.length}...`,
      });

      questions.push(
        ...(await createMockQuestionsFromChunk(chunks[index], index, chunks.length, perChunkCount)),
      );
      questions = normalizeMockQuestions(questions);

      onProgress({
        percent: 26 + Math.round(((index + 1) / chunks.length) * 54),
        state: 'running',
        status: `Section ${index + 1} questions complete.`,
      });
    }
  }

  questions = normalizeMockQuestions(questions);

  if (!questions.length) {
    throw new Error('Pointerx could not create a mock test from this chat answer.');
  }

  onProgress({ percent: 96, state: 'running', status: 'Finalizing mock test...' });

  return {
    extractedCharacters: source.totalCharacters,
    fileName: source.sourceName,
    processedCharacters: processedLength,
    questions,
  };
}

async function processReviewerJob(jobId, file) {
  try {
    const result = await buildReviewerFromPdfFile(file, (progress) => {
      updateReviewerJob(jobId, progress);
    });

    updateReviewerJob(jobId, {
      percent: 100,
      result,
      state: 'complete',
      status: 'Reviewer ready.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not generate reviewer.';

    updateReviewerJob(jobId, {
      error: message,
      percent: 100,
      state: 'failed',
      status: 'Reviewer generation failed.',
    });
  }
}

async function processReviewerTextJob(jobId, source) {
  try {
    const result = await buildReviewerFromTextSource(source, (progress) => {
      updateReviewerJob(jobId, progress);
    });

    updateReviewerJob(jobId, {
      percent: 100,
      result,
      state: 'complete',
      status: 'Reviewer ready.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not generate reviewer.';

    updateReviewerJob(jobId, {
      error: message,
      percent: 100,
      state: 'failed',
      status: 'Reviewer generation failed.',
    });
  }
}

async function processFlashcardJob(jobId, file) {
  try {
    const result = await buildFlashcardsFromPdfFile(file, (progress) => {
      updateFlashcardJob(jobId, progress);
    });

    updateFlashcardJob(jobId, {
      percent: 100,
      result,
      state: 'complete',
      status: 'Flashcards ready.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not generate flashcards.';

    updateFlashcardJob(jobId, {
      error: message,
      percent: 100,
      state: 'failed',
      status: 'Flashcard generation failed.',
    });
  }
}

async function processFlashcardTextJob(jobId, source) {
  try {
    const result = await buildFlashcardsFromTextSource(source, (progress) => {
      updateFlashcardJob(jobId, progress);
    });

    updateFlashcardJob(jobId, {
      percent: 100,
      result,
      state: 'complete',
      status: 'Flashcards ready.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not generate flashcards.';

    updateFlashcardJob(jobId, {
      error: message,
      percent: 100,
      state: 'failed',
      status: 'Flashcard generation failed.',
    });
  }
}

async function processFlashcardUrlJob(jobId, sourceUrl) {
  try {
    const source = await fetchUrlSource(sourceUrl, (progress) => {
      updateFlashcardJob(jobId, progress);
    });
    const result = await buildFlashcardsFromTextSource(source, (progress) => {
      updateFlashcardJob(jobId, mapUrlGenerationProgress(progress));
    });

    updateFlashcardJob(jobId, {
      percent: 100,
      result,
      state: 'complete',
      status: 'Flashcards ready.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not generate flashcards.';

    updateFlashcardJob(jobId, {
      error: message,
      percent: 100,
      state: 'failed',
      status: 'Flashcard generation failed.',
    });
  }
}

async function processMockTestJob(jobId, file) {
  try {
    const result = await buildMockTestFromPdfFile(file, (progress) => {
      updateMockTestJob(jobId, progress);
    });

    updateMockTestJob(jobId, {
      percent: 100,
      result,
      state: 'complete',
      status: 'Mock test ready.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not generate mock test.';

    updateMockTestJob(jobId, {
      error: message,
      percent: 100,
      state: 'failed',
      status: 'Mock test generation failed.',
    });
  }
}

async function processMockTestTextJob(jobId, source) {
  try {
    const result = await buildMockTestFromTextSource(source, (progress) => {
      updateMockTestJob(jobId, progress);
    });

    updateMockTestJob(jobId, {
      percent: 100,
      result,
      state: 'complete',
      status: 'Mock test ready.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not generate mock test.';

    updateMockTestJob(jobId, {
      error: message,
      percent: 100,
      state: 'failed',
      status: 'Mock test generation failed.',
    });
  }
}

async function processMockTestUrlJob(jobId, sourceUrl) {
  try {
    const source = await fetchUrlSource(sourceUrl, (progress) => {
      updateMockTestJob(jobId, progress);
    });
    const result = await buildMockTestFromTextSource(source, (progress) => {
      updateMockTestJob(jobId, mapUrlGenerationProgress(progress));
    });

    updateMockTestJob(jobId, {
      percent: 100,
      result,
      state: 'complete',
      status: 'Mock test ready.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not generate mock test.';

    updateMockTestJob(jobId, {
      error: message,
      percent: 100,
      state: 'failed',
      status: 'Mock test generation failed.',
    });
  }
}

app.get('/health', (_request, response) => {
  response.json({
    aiProvider: getActiveAiProvider(),
    aiModel: getActiveAiModel(),
    ok: true,
  });
});

app.post('/api/reviewer', upload.single('file'), async (request, response) => {
  try {
    if (!request.file) {
      response.status(400).json({ error: 'No PDF file was uploaded.' });
      return;
    }

    response.json(await buildReviewerFromPdfFile(request.file));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not generate reviewer.';
    response.status(error.statusCode ?? 500).json({ error: message });
  }
});

app.post('/api/reviewer/jobs', upload.single('file'), (request, response) => {
  if (!request.file) {
    response.status(400).json({ error: 'No PDF file was uploaded.' });
    return;
  }

  const job = createReviewerJob(request.file.originalname);

  response.status(202).json(serializeReviewerJob(job));
  setImmediate(() => processReviewerJob(job.id, request.file));
});

app.post('/api/reviewer/text/jobs', (request, response) => {
  try {
    const source = getTextSourceFromRequest(request);
    const job = createReviewerJob(source.sourceName);

    response.status(202).json(serializeReviewerJob(job));
    setImmediate(() => processReviewerTextJob(job.id, source));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not generate reviewer.';
    response.status(error.statusCode ?? 500).json({ error: message });
  }
});

app.get('/api/reviewer/jobs/:jobId', (request, response) => {
  const job = reviewerJobs.get(request.params.jobId);

  if (!job) {
    response.status(404).json({ error: 'Reviewer job was not found.' });
    return;
  }

  response.json(serializeReviewerJob(job));
});

app.post('/api/flashcards', upload.single('file'), async (request, response) => {
  try {
    if (!request.file) {
      response.status(400).json({ error: 'No PDF file was uploaded.' });
      return;
    }

    response.json(await buildFlashcardsFromPdfFile(request.file));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not generate flashcards.';
    response.status(error.statusCode ?? 500).json({ error: message });
  }
});

app.post('/api/flashcards/jobs', upload.single('file'), (request, response) => {
  if (!request.file) {
    response.status(400).json({ error: 'No PDF file was uploaded.' });
    return;
  }

  const job = createFlashcardJob(request.file.originalname);

  response.status(202).json(serializeFlashcardJob(job));
  setImmediate(() => processFlashcardJob(job.id, request.file));
});

app.post('/api/flashcards/text/jobs', (request, response) => {
  try {
    const source = getTextSourceFromRequest(request);
    const job = createFlashcardJob(source.sourceName);

    response.status(202).json(serializeFlashcardJob(job));
    setImmediate(() => processFlashcardTextJob(job.id, source));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not generate flashcards.';
    response.status(error.statusCode ?? 500).json({ error: message });
  }
});

app.post('/api/flashcards/url/jobs', (request, response) => {
  try {
    const sourceUrl = getUrlFromRequest(request);
    const job = createFlashcardJob(getUrlSourceName(sourceUrl));

    response.status(202).json(serializeFlashcardJob(job));
    setImmediate(() => processFlashcardUrlJob(job.id, sourceUrl));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not generate flashcards.';
    response.status(error.statusCode ?? 500).json({ error: message });
  }
});

app.get('/api/flashcards/jobs/:jobId', (request, response) => {
  const job = flashcardJobs.get(request.params.jobId);

  if (!job) {
    response.status(404).json({ error: 'Flashcard job was not found.' });
    return;
  }

  response.json(serializeFlashcardJob(job));
});

app.post('/api/mock-tests', upload.single('file'), async (request, response) => {
  try {
    if (!request.file) {
      response.status(400).json({ error: 'No PDF file was uploaded.' });
      return;
    }

    response.json(await buildMockTestFromPdfFile(request.file));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not generate mock test.';
    response.status(error.statusCode ?? 500).json({ error: message });
  }
});

app.post('/api/mock-tests/jobs', upload.single('file'), (request, response) => {
  if (!request.file) {
    response.status(400).json({ error: 'No PDF file was uploaded.' });
    return;
  }

  const job = createMockTestJob(request.file.originalname);

  response.status(202).json(serializeMockTestJob(job));
  setImmediate(() => processMockTestJob(job.id, request.file));
});

app.post('/api/mock-tests/text/jobs', (request, response) => {
  try {
    const source = getTextSourceFromRequest(request);
    const job = createMockTestJob(source.sourceName);

    response.status(202).json(serializeMockTestJob(job));
    setImmediate(() => processMockTestTextJob(job.id, source));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not generate mock test.';
    response.status(error.statusCode ?? 500).json({ error: message });
  }
});

app.post('/api/mock-tests/url/jobs', (request, response) => {
  try {
    const sourceUrl = getUrlFromRequest(request);
    const job = createMockTestJob(getUrlSourceName(sourceUrl));

    response.status(202).json(serializeMockTestJob(job));
    setImmediate(() => processMockTestUrlJob(job.id, sourceUrl));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not generate mock test.';
    response.status(error.statusCode ?? 500).json({ error: message });
  }
});

app.get('/api/mock-tests/jobs/:jobId', (request, response) => {
  const job = mockTestJobs.get(request.params.jobId);

  if (!job) {
    response.status(404).json({ error: 'Mock test job was not found.' });
    return;
  }

  response.json(serializeMockTestJob(job));
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Pointerx reviewer server listening on http://0.0.0.0:${PORT}`);
  console.log(`Using ${getActiveAiProvider()} with model ${getActiveAiModel()}`);
});

server.requestTimeout = 10 * 60 * 1000;
server.headersTimeout = 10 * 60 * 1000 + 5000;
