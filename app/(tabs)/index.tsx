import { IconSymbol } from '@/components/ui/icon-symbol';
import { LoadingXSpinner, SpinningXCursor } from '@/components/loading-x-spinner';
import { type AppPaletteColors } from '@/constants/theme';
import {
  ChatMaterialKind,
  setPendingChatMaterialSource,
} from '@/lib/chat-material-source';
import { useAppTheme } from '@/lib/app-theme';
import { setLatestReviewer } from '@/lib/reviewer-store';
import {
  fetchStudyResources,
  getStudyResourceIntent,
  type StudyResource,
} from '@/lib/study-resources';
import Constants from 'expo-constants';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import * as WebBrowser from 'expo-web-browser';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInRight,
  FadeOut,
  FadeOutRight,
  LinearTransition,
} from 'react-native-reanimated';

type ChatMessage = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  resources?: StudyResource[];
};

type ChatThread = {
  id: string;
  messages: ChatMessage[];
  title: string;
  updatedAt: number;
};

type ToolIntent = {
  assistantMessage: string;
  reviewerSourceText?: string;
  route: Parameters<typeof router.push>[0];
  sourceKind?: ChatMaterialKind;
  sourceName?: string;
  sourceText?: string;
  sourceUrl?: string;
};

type ToolTarget = ToolIntent & {
  pattern: RegExp;
};

const EXPLORE_TOOL_INTENT: ToolIntent = {
  assistantMessage: 'Opening learning tools. Choose the material you want to create there.',
  route: '/(tabs)/explore',
};

const TOOL_TARGETS: (ToolTarget & { sourceKind: ChatMaterialKind })[] = [
  {
    assistantMessage: 'Opening PDF to Reviewer. Select your PDF file there.',
    pattern: /\b(reviewer|study reviewer|review notes|study notes)\b/,
    route: '/reviewer-converter',
    sourceKind: 'reviewer',
  },
  {
    assistantMessage: 'Opening PDF to Flashcards. Select your PDF file there.',
    pattern: /\b(flash\s*cards?|flashcards?|active recall)\b/,
    route: '/flashcard-converter',
    sourceKind: 'flashcards',
  },
  {
    assistantMessage: 'Opening Create Mock Test. Select your PDF file there.',
    pattern: /\b(mock\s*tests?|practice\s*(tests?|exam|quiz)|quiz|exam)\b/,
    route: '/mock-test-converter',
    sourceKind: 'mock-test',
  },
];

const CHAT_CONVERSION_TARGETS = [
  {
    icon: 'doc.text.fill' as const,
    kind: 'reviewer' as const,
    label: 'Convert into reviewer',
    route: '/reviewer-converter' as const,
  },
  {
    icon: 'rectangle.stack.fill' as const,
    kind: 'flashcards' as const,
    label: 'Convert into flashcards',
    route: '/flashcard-converter' as const,
  },
  {
    icon: 'graduationcap.fill' as const,
    kind: 'mock-test' as const,
    label: 'Convert into mock test',
    route: '/mock-test-converter' as const,
  },
];

function getDefaultOllamaUrl() {
  if (Platform.OS === 'web') {
    return 'http://localhost:11434';
  }

  const devHost = Constants.expoConfig?.hostUri?.split(':')[0];

  if (devHost && devHost !== 'localhost' && devHost !== '127.0.0.1') {
    return `http://${devHost}:11434`;
  }

  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:11434';
  }

  return 'http://localhost:11434';
}

const OLLAMA_BASE_URL = process.env.EXPO_PUBLIC_OLLAMA_URL ?? getDefaultOllamaUrl();

const OLLAMA_MODEL = process.env.EXPO_PUBLIC_OLLAMA_MODEL ?? 'llama3.2';
const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
const GEMINI_MODEL = process.env.EXPO_PUBLIC_GEMINI_MODEL ?? 'gemini-3.5-flash';
const OPENROUTER_API_KEY = process.env.EXPO_PUBLIC_OPENROUTER_API_KEY;
const OPENROUTER_DEFAULT_MODEL = 'mistralai/mistral-7b-instruct:free';
const OPENROUTER_FREE_ROUTER_MODEL = 'openrouter/free';
const OPENROUTER_FALLBACK_MODELS = [
  'google/gemma-4-31b-it:free',
  OPENROUTER_FREE_ROUTER_MODEL,
];
const OPENROUTER_UNAVAILABLE_FREE_MODELS = new Set([
  'google/gemma-3-4b-it:free',
  'qwen/qwen3-4b:free',
]);
const OPENROUTER_MODEL = getOpenRouterModel();
const OPENROUTER_APP_URL = process.env.EXPO_PUBLIC_OPENROUTER_APP_URL;
const OPENROUTER_APP_TITLE = process.env.EXPO_PUBLIC_OPENROUTER_APP_TITLE ?? 'Pointerx';
const OPENROUTER_RETRY_NOTE =
  'The previous provider returned only safety metadata or failed before answering. Reply normally to the user now. Do not mention provider errors, safety labels, metadata, or retries.';

const SYSTEM_PROMPT =
  'You are Pointerx, an AI reviewing assistant. Help students study and, when needed, guide them to Pointerx tools that convert PDFs into reviewers, flashcards, and mock tests. The chat itself cannot create, save, or finish PDF learning materials. Never claim a reviewer, flashcards, or mock test was created unless the user provided generated content in chat or a tool result explicitly says so. Do not recommend outside apps or websites for PDF conversion unless the user explicitly asks for alternatives. If the user returns after opening a tool and says thanks, simply acknowledge it. Write in clean plain text only. Do not use Markdown formatting, bold markers, headings, or asterisks for emphasis.';

const initialMessages: ChatMessage[] = [];

const initialThreadId = 'thread-initial';
const chatHistoryFileUri = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}pointerx-chat-history.json`
  : null;
const historyOverlayEntering = FadeIn.duration(80);
const historyOverlayExiting = FadeOut.duration(90);
const historyDrawerEntering = FadeInRight.duration(150);
const historyDrawerExiting = FadeOutRight.duration(120);
const welcomeEntering = FadeInDown.duration(260).springify().damping(18).stiffness(150);
const welcomeExiting = FadeOut.duration(120);
const historyItemEntering = FadeIn.duration(110);
const smoothLayout = LinearTransition.springify().damping(22).stiffness(180);
const welcomeTypingLines = [
  'Study with me',
  'Developed by Iris Contado',
  'Convert PDFs to learning materials',
];

function appendToMessage(messages: ChatMessage[], id: string, content: string) {
  return messages.map((message) =>
    message.id === id
      ? { ...message, content: cleanAssistantText(message.content + content) }
      : message,
  );
}

function getOpenRouterModel() {
  const configuredModel = process.env.EXPO_PUBLIC_OPENROUTER_MODEL?.trim();

  if (
    !configuredModel ||
    configuredModel === OPENROUTER_FREE_ROUTER_MODEL ||
    OPENROUTER_UNAVAILABLE_FREE_MODELS.has(configuredModel)
  ) {
    return OPENROUTER_DEFAULT_MODEL;
  }

  return configuredModel;
}

function cleanAssistantText(text: string) {
  return text
    .replace(/\*\*/g, '')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`{1,3}/g, '')
    .replace(/^\s*(user|prompt)\s+safety\s*:\s*safe\s*$/gim, '')
    .replace(/^\s*response\s+safety\s*:\s*safe\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimStart();
}

function isMetadataOnlyReply(text: string) {
  return (
    !cleanAssistantText(text).trim() &&
    /\b(user|prompt|response)\s+safety\s*:\s*safe\b/i.test(text)
  );
}

function shouldRetryOpenRouterError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return !/\b(api key|unauthorized|invalid key|forbidden|credit|quota)\b/i.test(error.message);
}

function isToolStatusMessage(message?: ChatMessage) {
  if (!message || message.role !== 'assistant') {
    return false;
  }

  return (
    message.id.includes('-assistant-tool') ||
    message.content.startsWith('Opening ') ||
    message.content.includes('Select your PDF file there.') ||
    message.content.includes('Choose a tool, then select your PDF there.')
  );
}

function isToolCommandMessage(message: ChatMessage, index: number, messages: ChatMessage[]) {
  if (message.role !== 'user') {
    return false;
  }

  return message.id.includes('-user-tool-command') || isToolStatusMessage(messages[index + 1]);
}

function getAiChatHistory(messages: ChatMessage[]) {
  return messages.filter(
    (message, index) =>
      message.id !== 'welcome' &&
      !isToolStatusMessage(message) &&
      !isToolCommandMessage(message, index, messages),
  );
}

function isThanksOnly(prompt: string) {
  return /^(thanks|thank you|ty|thx|appreciate it|salamat)(\s+(so much|a lot|bro|man|po))?[.!?]*$/i.test(
    prompt.trim(),
  );
}

function getLastNonToolAssistantMessage(messages: ChatMessage[]) {
  return [...messages]
    .reverse()
    .find((message) => message.role === 'assistant' && !isToolStatusMessage(message))?.content ?? '';
}

function getReadableChatMessages(messages: ChatMessage[]) {
  return messages.filter(
    (message, index) =>
      message.id !== 'welcome' &&
      message.content.trim() &&
      !isToolStatusMessage(message) &&
      !isToolCommandMessage(message, index, messages),
  );
}

function getChatThreadTitle(messages: ChatMessage[]) {
  const firstUserMessage = getReadableChatMessages(messages).find(
    (message) => message.role === 'user',
  );
  const title = firstUserMessage?.content.trim() || 'New chat';
  const compactTitle = title.replace(/\s+/g, ' ');

  return compactTitle.length > 38 ? `${compactTitle.slice(0, 38)}...` : compactTitle;
}

function getChatThreadPreview(messages: ChatMessage[]) {
  const lastMessage = [...getReadableChatMessages(messages)].reverse()[0];
  const preview = lastMessage?.content.trim() || 'No messages yet';
  const compactPreview = preview.replace(/\s+/g, ' ');

  return compactPreview.length > 64 ? `${compactPreview.slice(0, 64)}...` : compactPreview;
}

function createChatThread(id: string, messages = initialMessages): ChatThread {
  return {
    id,
    messages,
    title: getChatThreadTitle(messages),
    updatedAt: Date.now(),
  };
}

function normalizeStudyResources(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const resources = value.filter((resource): resource is StudyResource => {
    const candidate = resource as Partial<StudyResource>;

    return (
      Boolean(candidate) &&
      typeof candidate === 'object' &&
      typeof candidate.id === 'string' &&
      typeof candidate.title === 'string' &&
      typeof candidate.url === 'string' &&
      typeof candidate.sourceLabel === 'string' &&
      (candidate.kind === 'image' || candidate.kind === 'video')
    );
  });

  return resources.length > 0 ? resources : undefined;
}

function normalizeChatThreads(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((thread): thread is ChatThread => {
      return (
        Boolean(thread) &&
        typeof thread === 'object' &&
        typeof (thread as ChatThread).id === 'string' &&
        Array.isArray((thread as ChatThread).messages)
      );
    })
    .map((thread) => {
      const messages = thread.messages
        .filter((message): message is ChatMessage => {
          const candidate = message as Partial<ChatMessage>;

          return (
            Boolean(candidate) &&
            typeof candidate === 'object' &&
            candidate.id !== 'welcome' &&
            typeof candidate.id === 'string' &&
            typeof candidate.content === 'string' &&
            (candidate.role === 'assistant' || candidate.role === 'user')
          );
        })
        .map((message) => ({
          ...message,
          resources: normalizeStudyResources(message.resources),
        }));

      return {
        id: thread.id,
        messages,
        title: getChatThreadTitle(messages),
        updatedAt: typeof thread.updatedAt === 'number' ? thread.updatedAt : Date.now(),
      };
    })
    .filter((thread) => thread.messages.length > 0)
    .sort((first, second) => second.updatedAt - first.updatedAt);
}

function normalizePrompt(prompt: string) {
  return prompt
    .toLowerCase()
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getToolMatches(normalizedPrompt: string) {
  return TOOL_TARGETS.map((target) => ({
    ...target,
    index: normalizedPrompt.search(target.pattern),
  }))
    .filter((target) => target.index !== -1)
    .sort((first, second) => first.index - second.index);
}

function getFirstUrl(prompt: string) {
  const match = prompt.match(/https?:\/\/[^\s<>"']+|www\.[^\s<>"']+/i);
  const rawUrl = match?.[0]?.replace(/[)\].,!?;:]+$/g, '');

  if (!rawUrl) {
    return null;
  }

  return rawUrl.startsWith('www.') ? `https://${rawUrl}` : rawUrl;
}

function hasExplicitUrl(prompt: string) {
  return getFirstUrl(prompt) !== null;
}

function hasLearningSourceContext(normalizedPrompt: string) {
  return /\b(pdf|file|document|lesson|module|notes?|handout|slides?|link|url|webpage|website|article|page|site|resource|content)\b/.test(
    normalizedPrompt,
  ) || hasExplicitUrl(normalizedPrompt);
}

function hasGenericLearningMaterialRequest(normalizedPrompt: string) {
  return /\b(learning materials?|study materials?|review materials?|reviewing materials?)\b/.test(
    normalizedPrompt,
  );
}

function hasSourceAction(normalizedPrompt: string) {
  return /\b(convert|create|generate|make|turn|build|upload|attach|add|open|start|select|choose|pick|replace|change|switch|swap|prepare|practice|quiz)\b/.test(
    normalizedPrompt,
  );
}

function hasUploadableSourceCue(normalizedPrompt: string) {
  return /\b(pdf|file|document|upload|attachment|attach)\b/.test(normalizedPrompt);
}

function hasToolRequestCue(normalizedPrompt: string) {
  return /\b(want|need|would like|looking for|give me|use|do)\b/.test(normalizedPrompt);
}

function isShortToolChoice(prompt: string, normalizedPrompt = normalizePrompt(prompt)) {
  return (
    normalizedPrompt.length <= 40 &&
    !prompt.includes('?') &&
    /\b(reviewer|flash\s*cards?|flashcards?|mock\s*tests?|quiz|exam)\b/.test(normalizedPrompt)
  );
}

function getGenericSourceIntent(prompt: string): ToolIntent | null {
  const normalizedPrompt = normalizePrompt(prompt);

  if (hasExplicitUrl(prompt)) {
    return null;
  }

  const matches = getToolMatches(normalizedPrompt);

  if (
    matches[0] &&
    (hasSourceAction(normalizedPrompt) ||
      hasLearningSourceContext(normalizedPrompt) ||
      hasToolRequestCue(normalizedPrompt) ||
      isShortToolChoice(prompt, normalizedPrompt))
  ) {
    return matches[0];
  }

  if (
    (hasUploadableSourceCue(normalizedPrompt) &&
      (hasSourceAction(normalizedPrompt) || hasToolRequestCue(normalizedPrompt))) ||
    (hasGenericLearningMaterialRequest(normalizedPrompt) && hasSourceAction(normalizedPrompt))
  ) {
    return {
      ...EXPLORE_TOOL_INTENT,
      assistantMessage: 'Opening learning tools. Choose a tool, then select your PDF there.',
    };
  }

  return null;
}

function isPointerxToolOffer(message: string) {
  const normalizedMessage = normalizePrompt(message);
  const mentionsPointerxMaterial =
    /\b(pdf|file|document|review materials?|reviewing materials?|learning materials?|study materials?|reviewer|flash\s*cards?|flashcards?|mock\s*tests?|quiz|exam)\b/.test(
      normalizedMessage,
    );
  const offersCreation =
    /\b(convert|converted|converting|create|created|creating|generate|generated|generating|make|making|turn|build|prepare|open|help|need)\b/.test(
      normalizedMessage,
    );
  const soundsLikeOffer =
    /\b(do you have|would you like|do you want|want me|should i|i can|i could|need|let me know|how can i assist)\b/.test(
      normalizedMessage,
    ) || message.includes('?');

  return mentionsPointerxMaterial && offersCreation && soundsLikeOffer;
}

function getAffirmativeToolOfferIntent(prompt: string, messages: ChatMessage[]): ToolIntent | null {
  const normalizedPrompt = normalizePrompt(prompt);

  if (!isAffirmativeFollowUp(normalizedPrompt)) {
    return null;
  }

  const lastAssistantMessage = getLastNonToolAssistantMessage(messages);

  if (!isPointerxToolOffer(lastAssistantMessage)) {
    return null;
  }

  const lastAssistantMatches = getToolMatches(normalizePrompt(lastAssistantMessage));

  if (lastAssistantMatches.length === 1) {
    return lastAssistantMatches[0];
  }

  return {
    ...EXPLORE_TOOL_INTENT,
    assistantMessage: 'Opening learning tools. Choose a tool, then select your PDF there.',
  };
}

function isAffirmativeFollowUp(normalizedPrompt: string) {
  return /^(yes|yeah|yep|yup|sure|ok|okay|please|pls|go ahead|do it|do that|sounds good|convert it|create it|make it|generate it|turn it|start|open it)\b/.test(
    normalizedPrompt,
  );
}

function getLastAssistantMessage(messages: ChatMessage[]) {
  return [...messages].reverse().find((message) => message.role === 'assistant')?.content ?? '';
}

function getLatestAssistantSource(messages: ChatMessage[]) {
  return [...getAiChatHistory(messages)]
    .reverse()
    .find(
      (message) =>
        message.role === 'assistant' &&
        message.id !== 'welcome' &&
        message.content.length >= 80 &&
        !message.content.startsWith('Opening '),
    )?.content;
}

function referencesPreviousContent(normalizedPrompt: string) {
  return /\b(that|it|this|above|previous|last|answer|response|summary|material)\b/.test(
    normalizedPrompt,
  );
}

function isPdfExportRequest(normalizedPrompt: string) {
  const asksForPdf = /\bpdf\b/.test(normalizedPrompt);
  const asksForExport =
    /\b(save|export|download|convert|make|create|generate|turn)\b/.test(normalizedPrompt);

  return asksForPdf && asksForExport && referencesPreviousContent(normalizedPrompt);
}

function isLearningMaterialOffer(message: string) {
  const normalizedMessage = normalizePrompt(message);
  const soundsLikeOffer =
    /\b(would you like|do you want|want me|should i|i can|i could|i’m able|i am able|ready to)\b/.test(
      normalizedMessage,
    );
  const hasCreationLanguage =
    /\b(convert|create|generate|make|turn|build|prepare)\b/.test(normalizedMessage);

  return (
    soundsLikeOffer &&
    hasCreationLanguage &&
    (hasLearningSourceContext(normalizedMessage) ||
      hasGenericLearningMaterialRequest(normalizedMessage) ||
      getToolMatches(normalizedMessage).length > 0)
  );
}

function getChatSourceToolIntent(
  normalizedPrompt: string,
  messages: ChatMessage[],
): ToolIntent | null {
  const sourceText = getLatestAssistantSource(messages);

  if (!sourceText) {
    return null;
  }

  const matches = getToolMatches(normalizedPrompt);

  if (isPdfExportRequest(normalizedPrompt)) {
    return {
      assistantMessage: 'Opening PDF export. You can save it from the result page.',
      reviewerSourceText: sourceText,
      route: '/reviewer-result',
    };
  }

  if (!referencesPreviousContent(normalizedPrompt) && !isAffirmativeFollowUp(normalizedPrompt)) {
    return null;
  }

  if (matches[0]) {
    return {
      assistantMessage: matches[0].assistantMessage.replace('Select your PDF file there.', 'Generating it from the chat answer.'),
      route: matches[0].route,
      sourceKind: matches[0].sourceKind,
      sourceText,
    };
  }

  const lastAssistantMessage = getLastAssistantMessage(messages);

  if (!isLearningMaterialOffer(lastAssistantMessage)) {
    return null;
  }

  const previousMatches = getToolMatches(normalizePrompt(lastAssistantMessage));

  if (previousMatches.length === 1) {
    return {
      assistantMessage: previousMatches[0].assistantMessage.replace(
        'Select your PDF file there.',
        'Generating it from the chat answer.',
      ),
      route: previousMatches[0].route,
      sourceKind: previousMatches[0].sourceKind,
      sourceText,
    };
  }

  if (isAffirmativeFollowUp(normalizedPrompt)) {
    return EXPLORE_TOOL_INTENT;
  }

  return null;
}

function getToolIntent(prompt: string, messages: ChatMessage[]): ToolIntent | null {
  const normalizedPrompt = normalizePrompt(prompt);
  const explicitUrl = getFirstUrl(prompt);
  const hasToolAction = hasSourceAction(normalizedPrompt);
  const matches = getToolMatches(normalizedPrompt);

  const affirmativeToolOfferIntent = getAffirmativeToolOfferIntent(prompt, messages);

  if (affirmativeToolOfferIntent) {
    return affirmativeToolOfferIntent;
  }

  if (
    explicitUrl &&
    matches[0] &&
    hasToolAction &&
    (matches[0].sourceKind === 'flashcards' || matches[0].sourceKind === 'mock-test')
  ) {
    return {
      assistantMessage:
        matches[0].sourceKind === 'flashcards'
          ? 'Opening Flashcard Generator. Creating it from the link.'
          : 'Opening Mock Test Generator. Creating it from the link.',
      route: matches[0].route,
      sourceKind: matches[0].sourceKind,
      sourceName: 'Link source',
      sourceUrl: explicitUrl,
    };
  }

  const chatSourceIntent = getChatSourceToolIntent(normalizedPrompt, messages);

  if (chatSourceIntent) {
    return chatSourceIntent;
  }

  if (/\b(link|url|webpage|website|article|page|site)\b/.test(normalizedPrompt)) {
    return null;
  }

  const genericSourceIntent = getGenericSourceIntent(prompt);

  if (genericSourceIntent) {
    return genericSourceIntent;
  }

  if (
    matches[0] &&
    (hasLearningSourceContext(normalizedPrompt) ||
      hasToolAction ||
      hasToolRequestCue(normalizedPrompt) ||
      isShortToolChoice(prompt, normalizedPrompt))
  ) {
    return matches[0];
  }

  if (
    hasGenericLearningMaterialRequest(normalizedPrompt) &&
    (hasLearningSourceContext(normalizedPrompt) || hasToolAction)
  ) {
    return EXPLORE_TOOL_INTENT;
  }

  return null;
}

function parseOllamaLine(line: string) {
  return JSON.parse(line) as {
    error?: string;
    message?: { content?: string };
  };
}

function streamOllamaChat(
  messages: ChatMessage[],
  onToken: (token: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let processedLength = 0;
    let buffer = '';
    let fullReply = '';

    function processText(text: string) {
      buffer += text;

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmedLine = line.trim();

        if (!trimmedLine) {
          continue;
        }

        const chunk = parseOllamaLine(trimmedLine);

        if (chunk.error) {
          throw new Error(chunk.error);
        }

        const token = chunk.message?.content ?? '';

        if (token) {
          fullReply += token;
          onToken(token);
        }
      }
    }

    xhr.open('POST', `${OLLAMA_BASE_URL}/api/chat`);
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.onprogress = () => {
      try {
        const nextText = xhr.responseText.slice(processedLength);
        processedLength = xhr.responseText.length;
        processText(nextText);
      } catch (streamError) {
        xhr.abort();
        reject(streamError);
      }
    };

    xhr.onload = () => {
      try {
        if (xhr.status < 200 || xhr.status >= 300) {
          throw new Error(`The AI service returned ${xhr.status}`);
        }

        const finalText = xhr.responseText.slice(processedLength);

        if (finalText) {
          processText(finalText);
        }

        const finalLine = buffer.trim();

        if (finalLine) {
          const chunk = parseOllamaLine(finalLine);

          if (chunk.error) {
            throw new Error(chunk.error);
          }

          const token = chunk.message?.content ?? '';

          if (token) {
            fullReply += token;
            onToken(token);
          }
        }

        resolve(fullReply);
      } catch (loadError) {
        reject(loadError);
      }
    };

    xhr.onerror = () => reject(new Error('Network request failed'));
    xhr.ontimeout = () => reject(new Error('The AI response took too long'));
    xhr.timeout = 180000;

    xhr.send(
      JSON.stringify({
        model: OLLAMA_MODEL,
        stream: true,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...getAiChatHistory(messages).map((message) => ({
            role: message.role,
            content: message.content,
          })),
        ],
      }),
    );
  });
}

type GeminiContent = {
  parts: { text: string }[];
  role: 'model' | 'user';
};

type GeminiGenerateContentResponse = {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
    };
  }[];
  error?: {
    message?: string;
  };
};

type OpenRouterChatChunk = {
  choices?: {
    delta?: {
      content?: string | null;
    };
    message?: {
      content?: string | null;
    };
  }[];
  error?: {
    message?: string;
  };
};

function getGeminiContents(messages: ChatMessage[]) {
  const contents: GeminiContent[] = [];

  for (const message of getAiChatHistory(messages)) {
    const text = message.content.trim();

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

  const firstUserIndex = contents.findIndex((content) => content.role === 'user');

  return firstUserIndex === -1 ? [] : contents.slice(firstUserIndex);
}

function getGeminiChunkText(chunk: GeminiGenerateContentResponse) {
  if (chunk.error?.message) {
    throw new Error(chunk.error.message);
  }

  return (
    chunk.candidates
      ?.flatMap((candidate) => candidate.content?.parts?.map((part) => part.text ?? '') ?? [])
      .join('') ?? ''
  );
}

function streamGeminiChat(
  messages: ChatMessage[],
  onToken: (token: string) => void,
): Promise<string> {
  if (!GEMINI_API_KEY?.trim()) {
    return Promise.reject(
      new Error('Gemini API key is missing. Add EXPO_PUBLIC_GEMINI_API_KEY to your .env file'),
    );
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const modelPath = GEMINI_MODEL.startsWith('models/') ? GEMINI_MODEL : `models/${GEMINI_MODEL}`;
    let processedLength = 0;
    let buffer = '';
    let fullReply = '';

    function processEvent(eventText: string) {
      const data = eventText
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.replace(/^data:\s?/, ''))
        .join('\n')
        .trim();

      if (!data || data === '[DONE]') {
        return;
      }

      const token = getGeminiChunkText(JSON.parse(data) as GeminiGenerateContentResponse);

      if (token) {
        fullReply += token;
        onToken(token);
      }
    }

    function processText(text: string) {
      buffer += text;

      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';

      for (const eventText of events) {
        processEvent(eventText);
      }
    }

    xhr.open(
      'POST',
      `https://generativelanguage.googleapis.com/v1beta/${modelPath}:streamGenerateContent?alt=sse`,
    );
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('x-goog-api-key', GEMINI_API_KEY);

    xhr.onprogress = () => {
      try {
        const nextText = xhr.responseText.slice(processedLength);
        processedLength = xhr.responseText.length;
        processText(nextText);
      } catch (streamError) {
        xhr.abort();
        reject(streamError);
      }
    };

    xhr.onload = () => {
      try {
        if (xhr.status < 200 || xhr.status >= 300) {
          throw new Error(`Gemini returned ${xhr.status}`);
        }

        const finalText = xhr.responseText.slice(processedLength);

        if (finalText) {
          processText(finalText);
        }

        if (buffer.trim()) {
          processEvent(buffer);
        }

        resolve(fullReply);
      } catch (loadError) {
        reject(loadError);
      }
    };

    xhr.onerror = () => reject(new Error('Network request failed'));
    xhr.ontimeout = () => reject(new Error('The Gemini response took too long'));
    xhr.timeout = 180000;

    xhr.send(
      JSON.stringify({
        contents: getGeminiContents(messages),
        generationConfig: {
          maxOutputTokens: 1600,
          temperature: 0.7,
        },
        system_instruction: {
          parts: [{ text: SYSTEM_PROMPT }],
        },
      }),
    );
  });
}

function getOpenRouterErrorMessage(responseText: string, fallback: string) {
  try {
    const response = JSON.parse(responseText) as {
      error?: { message?: string };
      message?: string;
    };

    return response.error?.message ?? response.message ?? fallback;
  } catch {
    return fallback;
  }
}

function getOpenRouterMessages(messages: ChatMessage[]) {
  return getAiChatHistory(messages)
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }))
    .filter((message) => message.content);
}

function getOpenRouterChunkText(chunk: OpenRouterChatChunk) {
  if (chunk.error?.message) {
    throw new Error(chunk.error.message);
  }

  return (
    chunk.choices
      ?.map((choice) => choice.delta?.content ?? choice.message?.content ?? '')
      .join('') ?? ''
  );
}

function streamOpenRouterChat(
  messages: ChatMessage[],
  onToken: (token: string) => void,
  options: { isRetry?: boolean; model?: string } = {},
): Promise<string> {
  if (!OPENROUTER_API_KEY?.trim()) {
    return Promise.reject(
      new Error(
        'OpenRouter API key is missing. Add EXPO_PUBLIC_OPENROUTER_API_KEY to your .env file',
      ),
    );
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const systemPrompt = options.isRetry
      ? `${SYSTEM_PROMPT}\n\n${OPENROUTER_RETRY_NOTE}`
      : SYSTEM_PROMPT;
    let processedLength = 0;
    let buffer = '';
    let fullReply = '';

    function processEvent(eventText: string) {
      const data = eventText
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.replace(/^data:\s?/, ''))
        .join('\n')
        .trim();

      if (!data || data === '[DONE]') {
        return;
      }

      const token = getOpenRouterChunkText(JSON.parse(data) as OpenRouterChatChunk);

      if (token) {
        fullReply += token;
        onToken(token);
      }
    }

    function processText(text: string) {
      buffer += text;

      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';

      for (const eventText of events) {
        processEvent(eventText);
      }
    }

    xhr.open('POST', 'https://openrouter.ai/api/v1/chat/completions');
    xhr.setRequestHeader('Authorization', `Bearer ${OPENROUTER_API_KEY}`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('X-Title', OPENROUTER_APP_TITLE);

    if (OPENROUTER_APP_URL?.trim()) {
      xhr.setRequestHeader('HTTP-Referer', OPENROUTER_APP_URL.trim());
    }

    xhr.onprogress = () => {
      try {
        const nextText = xhr.responseText.slice(processedLength);
        processedLength = xhr.responseText.length;
        processText(nextText);
      } catch (streamError) {
        xhr.abort();
        reject(streamError);
      }
    };

    xhr.onload = () => {
      try {
        if (xhr.status < 200 || xhr.status >= 300) {
          throw new Error(
            getOpenRouterErrorMessage(xhr.responseText, `OpenRouter returned ${xhr.status}`),
          );
        }

        const finalText = xhr.responseText.slice(processedLength);

        if (finalText) {
          processText(finalText);
        }

        if (buffer.trim()) {
          processEvent(buffer);
        }

        resolve(fullReply);
      } catch (loadError) {
        reject(loadError);
      }
    };

    xhr.onerror = () => reject(new Error('Network request failed'));
    xhr.ontimeout = () => reject(new Error('The OpenRouter response took too long'));
    xhr.timeout = 180000;

    xhr.send(
      JSON.stringify({
        max_tokens: 1600,
        messages: [
          { role: 'system', content: systemPrompt },
          ...getOpenRouterMessages(messages),
        ],
        model: options.model ?? OPENROUTER_MODEL,
        stream: true,
        temperature: 0.7,
      }),
    );
  });
}

export default function ChatScreen() {
  const { aiModelLabel, aiModelName, palette } = useAppTheme();
  const styles = createStyles(palette);
  const scrollViewRef = useRef<ScrollView>(null);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyLongPressRef = useRef(false);
  const scrollLatestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAutoScrollingToLatestRef = useRef(false);
  const isNearLatestRef = useRef(true);
  const [activeThreadId, setActiveThreadId] = useState(initialThreadId);
  const [chatThreads, setChatThreads] = useState<ChatThread[]>([
    createChatThread(initialThreadId),
  ]);
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState('');
  const [hasLoadedChatHistory, setHasLoadedChatHistory] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [openHistoryMenuId, setOpenHistoryMenuId] = useState<string | null>(null);
  const [openMessageMenuId, setOpenMessageMenuId] = useState<string | null>(null);
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [welcomeLineIndex, setWelcomeLineIndex] = useState(0);
  const [welcomeTypedLength, setWelcomeTypedLength] = useState(0);
  const [isWelcomeDeleting, setIsWelcomeDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const keyboardShowSubscription = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setIsKeyboardVisible(true),
    );
    const keyboardHideSubscription = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setIsKeyboardVisible(false),
    );

    return () => {
      keyboardShowSubscription.remove();
      keyboardHideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current);
      }

      if (scrollLatestTimeoutRef.current) {
        clearTimeout(scrollLatestTimeoutRef.current);
      }

      Speech.stop();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadChatHistory() {
      if (!chatHistoryFileUri) {
        setHasLoadedChatHistory(true);
        return;
      }

      try {
        const fileInfo = await FileSystem.getInfoAsync(chatHistoryFileUri);

        if (!fileInfo.exists) {
          return;
        }

        const rawHistory = await FileSystem.readAsStringAsync(chatHistoryFileUri);
        const loadedThreads = normalizeChatThreads(JSON.parse(rawHistory));

        if (loadedThreads.length > 0 && isMounted) {
          setChatThreads(loadedThreads);
          setActiveThreadId(loadedThreads[0].id);
          setMessages(loadedThreads[0].messages);
        }
      } catch {
        // Keep the default empty chat if saved history cannot be read.
      } finally {
        if (isMounted) {
          setHasLoadedChatHistory(true);
        }
      }
    }

    loadChatHistory();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    setChatThreads((currentThreads) =>
      currentThreads
        .map((thread) =>
          thread.id === activeThreadId
            ? {
                ...thread,
                messages,
                title: getChatThreadTitle(messages),
                updatedAt: Date.now(),
              }
            : thread,
        )
        .sort((first, second) => second.updatedAt - first.updatedAt),
    );
  }, [activeThreadId, messages]);

  useEffect(() => {
    if (!hasLoadedChatHistory || !chatHistoryFileUri || isSending) {
      return;
    }

    FileSystem.writeAsStringAsync(chatHistoryFileUri, JSON.stringify(chatThreads)).catch(() => {
      // History persistence should never block chat usage.
    });
  }, [chatThreads, hasLoadedChatHistory, isSending]);

  useEffect(() => {
    const shouldAnimateWelcome =
      messages.filter((message) => message.id !== 'welcome').length === 0 && !error;

    if (!shouldAnimateWelcome) {
      setWelcomeLineIndex(0);
      setWelcomeTypedLength(0);
      setIsWelcomeDeleting(false);
      return;
    }

    const activeLine = welcomeTypingLines[welcomeLineIndex];
    const isFullyTyped = welcomeTypedLength === activeLine.length;
    const isFullyErased = welcomeTypedLength === 0;
    const delay = isFullyTyped
      ? 1250
      : isWelcomeDeleting
        ? 32
        : isFullyErased && welcomeLineIndex > 0
          ? 280
          : 58;

    const timeout = setTimeout(() => {
      if (!isWelcomeDeleting && welcomeTypedLength < activeLine.length) {
        setWelcomeTypedLength((currentLength) => currentLength + 1);
        return;
      }

      if (!isWelcomeDeleting) {
        setIsWelcomeDeleting(true);
        return;
      }

      if (welcomeTypedLength > 0) {
        setWelcomeTypedLength((currentLength) => currentLength - 1);
        return;
      }

      setIsWelcomeDeleting(false);
      setWelcomeLineIndex((currentIndex) => (currentIndex + 1) % welcomeTypingLines.length);
    }, delay);

    return () => clearTimeout(timeout);
  }, [error, isWelcomeDeleting, messages, welcomeLineIndex, welcomeTypedLength]);

  async function stopReading() {
    await Speech.stop();
    setSpeakingMessageId(null);
  }

  function openHistory() {
    Keyboard.dismiss();
    setOpenHistoryMenuId(null);
    setOpenMessageMenuId(null);
    setIsHistoryOpen(true);
  }

  function closeHistory() {
    setOpenHistoryMenuId(null);
    setIsHistoryOpen(false);
  }

  async function openThread(thread: ChatThread) {
    await stopReading();
    setActiveThreadId(thread.id);
    setMessages(thread.messages);
    setDraft('');
    setError(null);
    setActiveAssistantId(null);
    setCopiedMessageId(null);
    setShowScrollToLatest(false);
    isNearLatestRef.current = true;
    setOpenHistoryMenuId(null);
    setOpenMessageMenuId(null);
    closeHistory();
    Keyboard.dismiss();
  }

  function handleHistoryThreadPress(thread: ChatThread) {
    if (historyLongPressRef.current) {
      return;
    }

    openThread(thread);
  }

  function triggerHistoryLongPressHaptic() {
    if (Platform.OS === 'android') {
      Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Long_Press).catch(() => undefined);
      return;
    }

    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    }
  }

  function handleHistoryThreadLongPress(threadId: string) {
    historyLongPressRef.current = true;
    triggerHistoryLongPressHaptic();
    setOpenHistoryMenuId((currentId) => (currentId === threadId ? null : threadId));
  }

  function releaseHistoryLongPressGuard() {
    if (!historyLongPressRef.current) {
      return;
    }

    setTimeout(() => {
      historyLongPressRef.current = false;
    }, 250);
  }

  async function startNewChat() {
    await stopReading();

    if (getReadableChatMessages(messages).length === 0) {
      setDraft('');
      setError(null);
      setActiveAssistantId(null);
      setCopiedMessageId(null);
      setShowScrollToLatest(false);
      isNearLatestRef.current = true;
      setOpenHistoryMenuId(null);
      setOpenMessageMenuId(null);
      closeHistory();
      Keyboard.dismiss();
      return;
    }

    const newThread = createChatThread(`${Date.now()}-thread`);

    setChatThreads((currentThreads) => [newThread, ...currentThreads]);
    setActiveThreadId(newThread.id);
    setMessages(newThread.messages);
    setDraft('');
    setError(null);
    setActiveAssistantId(null);
    setCopiedMessageId(null);
    setShowScrollToLatest(false);
    isNearLatestRef.current = true;
    setOpenHistoryMenuId(null);
    setOpenMessageMenuId(null);
    closeHistory();
    Keyboard.dismiss();
  }

  function deleteHistoryThread(threadId: string) {
    if (isSending) {
      return;
    }

    const remainingThreads = chatThreads.filter((thread) => thread.id !== threadId);
    const nextThreads =
      remainingThreads.length > 0 ? remainingThreads : [createChatThread(`${Date.now()}-thread`)];

    setChatThreads(nextThreads);
    setOpenHistoryMenuId(null);

    if (threadId === activeThreadId) {
      const nextThread = nextThreads[0];

      setActiveThreadId(nextThread.id);
      setMessages(nextThread.messages);
      setDraft('');
      setError(null);
      setActiveAssistantId(null);
      setCopiedMessageId(null);
      setShowScrollToLatest(false);
      isNearLatestRef.current = true;
      setOpenMessageMenuId(null);
      Keyboard.dismiss();
    }
  }

  async function copyAssistantMessage(message: ChatMessage) {
    if (!message.content.trim()) {
      return;
    }

    await Clipboard.setStringAsync(message.content);

    if (copiedTimeoutRef.current) {
      clearTimeout(copiedTimeoutRef.current);
    }

    setCopiedMessageId(message.id);
    setOpenMessageMenuId(null);
    copiedTimeoutRef.current = setTimeout(() => {
      setCopiedMessageId(null);
      copiedTimeoutRef.current = null;
    }, 1500);
  }

  async function toggleReadAssistantMessage(message: ChatMessage) {
    const textToSpeak = message.content.trim();

    if (!textToSpeak) {
      return;
    }

    if (speakingMessageId === message.id) {
      await Speech.stop();
      setSpeakingMessageId(null);
      return;
    }

    await Speech.stop();
    setSpeakingMessageId(message.id);
    setOpenMessageMenuId(null);
    Speech.speak(textToSpeak.slice(0, Speech.maxSpeechInputLength), {
      onDone: () => setSpeakingMessageId(null),
      onError: () => setSpeakingMessageId(null),
      onStopped: () => setSpeakingMessageId(null),
      rate: 0.95,
    });
  }

  async function openStudyResource(resource: StudyResource) {
    if (!resource.url) {
      return;
    }

    await WebBrowser.openBrowserAsync(resource.url).catch(() => undefined);
  }

  function deleteAssistantMessage(messageId: string) {
    if (speakingMessageId === messageId) {
      Speech.stop();
      setSpeakingMessageId(null);
    }

    setMessages((currentMessages) =>
      currentMessages.filter((currentMessage) => currentMessage.id !== messageId),
    );
    setCopiedMessageId((currentId) => (currentId === messageId ? null : currentId));
    setOpenMessageMenuId(null);
  }

  function convertAssistantMessage(
    message: ChatMessage,
    target: (typeof CHAT_CONVERSION_TARGETS)[number],
  ) {
    const sourceText = cleanAssistantText(message.content).trim();

    if (!sourceText) {
      return;
    }

    setPendingChatMaterialSource({
      kind: target.kind,
      sourceName: 'Chat answer',
      sourceText,
    });
    setOpenMessageMenuId(null);
    setError(null);
    Keyboard.dismiss();
    router.push(target.route);
  }

  function dismissMessageMenu() {
    setOpenMessageMenuId(null);
  }

  function dismissHistoryMenu() {
    setOpenHistoryMenuId(null);
  }

  function keepPopoverOpen(event: GestureResponderEvent) {
    event.stopPropagation();
  }

  function clearScrollLatestTimeout() {
    if (!scrollLatestTimeoutRef.current) {
      return;
    }

    clearTimeout(scrollLatestTimeoutRef.current);
    scrollLatestTimeoutRef.current = null;
  }

  function finishAutoScrollToLatest() {
    if (!isAutoScrollingToLatestRef.current) {
      return;
    }

    clearScrollLatestTimeout();
    isAutoScrollingToLatestRef.current = false;
    isNearLatestRef.current = true;
    setShowScrollToLatest(false);
  }

  function cancelAutoScrollToLatest() {
    clearScrollLatestTimeout();
    isAutoScrollingToLatestRef.current = false;
  }

  function scrollToLatest(animated = true, options: { dismissMenu?: boolean } = {}) {
    if (options.dismissMenu ?? true) {
      dismissMessageMenu();
    }

    clearScrollLatestTimeout();
    isAutoScrollingToLatestRef.current = true;
    isNearLatestRef.current = true;
    setShowScrollToLatest(false);
    scrollViewRef.current?.scrollToEnd({ animated });
    scrollLatestTimeoutRef.current = setTimeout(
      finishAutoScrollToLatest,
      animated ? 900 : 60,
    );
  }

  function handleChatScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromLatest = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    const isNearLatest = distanceFromLatest < 140;

    if (isAutoScrollingToLatestRef.current) {
      isNearLatestRef.current = true;
      setShowScrollToLatest(false);

      if (isNearLatest) {
        finishAutoScrollToLatest();
      }

      return;
    }

    isNearLatestRef.current = isNearLatest;
    setShowScrollToLatest((isVisible) => {
      const shouldShow = !isNearLatest && messages.length > 0;

      return isVisible === shouldShow ? isVisible : shouldShow;
    });
  }

  function handleChatScrollBeginDrag() {
    cancelAutoScrollToLatest();
    dismissMessageMenu();
  }

  async function sendMessage() {
    const content = draft.trim();

    if (!content || isSending) {
      return;
    }

    const shouldReplyToThanks = isThanksOnly(content);
    const studyResourceIntent = shouldReplyToThanks ? null : getStudyResourceIntent(content);
    const toolIntent =
      shouldReplyToThanks || studyResourceIntent ? null : getToolIntent(content, messages);
    const userMessage: ChatMessage = {
      id: `${Date.now()}-${toolIntent ? 'user-tool-command' : 'user'}`,
      role: 'user',
      content,
    };
    const nextMessages = [...messages, userMessage];

    if (shouldReplyToThanks) {
      setMessages([
        ...nextMessages,
        {
          id: `${Date.now()}-assistant-thanks`,
          role: 'assistant',
          content: cleanAssistantText("You're welcome."),
        },
      ]);
      setDraft('');
      setError(null);
      isNearLatestRef.current = true;
      setShowScrollToLatest(false);
      Keyboard.dismiss();
      return;
    }

    if (studyResourceIntent) {
      const assistantMessage: ChatMessage = {
        id: `${Date.now()}-assistant-resources`,
        role: 'assistant',
        content: cleanAssistantText(
          `Looking for study resources about "${studyResourceIntent.query}"...`,
        ),
      };

      setMessages([...nextMessages, assistantMessage]);
      setDraft('');
      setError(null);
      isNearLatestRef.current = true;
      setShowScrollToLatest(false);
      setIsSending(true);
      setActiveAssistantId(assistantMessage.id);
      Keyboard.dismiss();

      try {
        const resources = await fetchStudyResources(studyResourceIntent);
        const hasImages = studyResourceIntent.kinds.includes('image');
        const hasVideos = studyResourceIntent.kinds.includes('video');
        const resourceLabel =
          hasImages && hasVideos ? 'images and videos' : hasImages ? 'images' : 'videos';

        setMessages((currentMessages) =>
          currentMessages.map((currentMessage) =>
            currentMessage.id === assistantMessage.id
              ? {
                  ...currentMessage,
                  content: cleanAssistantText(
                    `Here are study ${resourceLabel} for "${studyResourceIntent.query}".`,
                  ),
                  resources,
                }
              : currentMessage,
          ),
        );
      } catch {
        setMessages((currentMessages) =>
          currentMessages.map((currentMessage) =>
            currentMessage.id === assistantMessage.id
              ? {
                  ...currentMessage,
                  content: cleanAssistantText(
                    'I could not fetch study resources right now. Check your connection, then try again.',
                  ),
                }
              : currentMessage,
          ),
        );
      } finally {
        setIsSending(false);
        setActiveAssistantId(null);
      }

      return;
    }

    if (toolIntent) {
      if (toolIntent.sourceKind && toolIntent.sourceText) {
        setPendingChatMaterialSource({
          kind: toolIntent.sourceKind,
          sourceName: toolIntent.sourceName ?? 'Chat answer',
          sourceText: toolIntent.sourceText,
        });
      }

      if (toolIntent.sourceKind && toolIntent.sourceUrl) {
        setPendingChatMaterialSource({
          kind: toolIntent.sourceKind,
          sourceName: toolIntent.sourceName ?? 'Link source',
          sourceUrl: toolIntent.sourceUrl,
        });
      }

      if (toolIntent.reviewerSourceText) {
        setLatestReviewer({
          extractedCharacters: toolIntent.reviewerSourceText.length,
          fileName: 'Chat answer',
          processedCharacters: toolIntent.reviewerSourceText.length,
          reviewer: toolIntent.reviewerSourceText,
        });
      }

      setMessages([
        ...nextMessages,
        {
          id: `${Date.now()}-assistant-tool`,
          role: 'assistant',
          content: cleanAssistantText(toolIntent.assistantMessage),
        },
      ]);
      setDraft('');
      setError(null);
      isNearLatestRef.current = true;
      setShowScrollToLatest(false);
      Keyboard.dismiss();
      router.push(toolIntent.route);
      return;
    }

    if (
      aiModelName !== 'ollama' &&
      aiModelName !== 'gemini' &&
      aiModelName !== 'openrouter'
    ) {
      setMessages([
        ...nextMessages,
        {
          id: `${Date.now()}-assistant-model-unavailable`,
          role: 'assistant',
          content: cleanAssistantText(
            `${aiModelLabel} is selected, but this model is not connected yet. Try OpenRouter, Gemini, or switch AI model to Ollama in Settings for now.`,
          ),
        },
      ]);
      setDraft('');
      setError(null);
      isNearLatestRef.current = true;
      setShowScrollToLatest(false);
      Keyboard.dismiss();
      return;
    }

    const assistantMessage: ChatMessage = {
      id: `${Date.now()}-assistant`,
      role: 'assistant',
      content: '',
    };

    setMessages([...nextMessages, assistantMessage]);
    setDraft('');
    setError(null);
    isNearLatestRef.current = true;
    setShowScrollToLatest(false);
    setIsSending(true);
    setActiveAssistantId(assistantMessage.id);
    Keyboard.dismiss();

    try {
      const streamToMessage = (
        streamChat: (
          streamMessages: ChatMessage[],
          onToken: (token: string) => void,
        ) => Promise<string>,
      ) => streamChat(nextMessages, (token) => {
        setMessages((currentMessages) =>
          appendToMessage(currentMessages, assistantMessage.id, token),
        );
      });
      const clearAssistantMessage = () => {
        setMessages((currentMessages) =>
          currentMessages.map((currentMessage) =>
            currentMessage.id === assistantMessage.id
              ? { ...currentMessage, content: '' }
              : currentMessage,
          ),
        );
      };
      const streamOpenRouterToMessage = (options?: { isRetry?: boolean; model?: string }) =>
        streamOpenRouterChat(
          nextMessages,
          (token) => {
            setMessages((currentMessages) =>
              appendToMessage(currentMessages, assistantMessage.id, token),
            );
          },
          options,
        );
      const streamOpenRouterFallback = async () => {
        let lastRetryError: unknown = null;

        for (const model of OPENROUTER_FALLBACK_MODELS) {
          clearAssistantMessage();

          try {
            const fallbackReply = await streamOpenRouterToMessage({ isRetry: true, model });

            if (!isMetadataOnlyReply(fallbackReply) && cleanAssistantText(fallbackReply).trim()) {
              return fallbackReply;
            }

            lastRetryError = new Error('OpenRouter returned metadata instead of an answer');
          } catch (fallbackError) {
            if (!shouldRetryOpenRouterError(fallbackError)) {
              throw fallbackError;
            }

            lastRetryError = fallbackError;
          }
        }

        throw lastRetryError instanceof Error
          ? lastRetryError
          : new Error('OpenRouter could not find an available free model');
      };
      let fullReply = '';

      if (aiModelName === 'gemini') {
        fullReply = await streamToMessage(streamGeminiChat);
      } else if (aiModelName === 'openrouter') {
        try {
          fullReply = await streamOpenRouterToMessage();
        } catch (openRouterError) {
          if (!shouldRetryOpenRouterError(openRouterError)) {
            throw openRouterError;
          }

          fullReply = await streamOpenRouterFallback();
        }
      } else {
        fullReply = await streamToMessage(streamOllamaChat);
      }

      if (isMetadataOnlyReply(fullReply)) {
        if (aiModelName !== 'openrouter') {
          throw new Error('The AI returned metadata instead of an answer');
        }

        fullReply = await streamOpenRouterFallback();
      }

      if (!cleanAssistantText(fullReply).trim()) {
        throw new Error('The AI returned an empty response');
      }
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Could not connect to Pointerx AI right now.';

      setMessages((currentMessages) =>
        currentMessages.filter(
          (currentMessage) =>
            currentMessage.id !== assistantMessage.id || currentMessage.content.trim(),
        ),
      );
      setError(
        aiModelName === 'gemini'
          ? `${message}. Check your Gemini API key and internet connection, then try again.`
          : aiModelName === 'openrouter'
            ? `${message}. Check your OpenRouter API key, selected model, and internet connection, then try again.`
          : `${message}. Make sure Pointerx AI is available, then try again.`,
      );
    } finally {
      setIsSending(false);
      setActiveAssistantId(null);
    }
  }

  const visibleMessages = messages.filter((message) => message.id !== 'welcome');
  const showWelcome = visibleMessages.length === 0 && !error;
  const activeWelcomeLine = welcomeTypingLines[welcomeLineIndex] ?? welcomeTypingLines[0];
  const typedWelcomeLine = activeWelcomeLine.slice(0, welcomeTypedLength);

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: 'padding', default: 'height' })}
      keyboardVerticalOffset={Platform.select({ ios: 12, default: 0 })}
      style={styles.keyboardRoot}>
      <View style={styles.screen}>
        <Pressable
          accessibilityLabel="Open chat history"
          disabled={isSending}
          onPress={openHistory}
          style={[styles.historyToggleButton, isSending && styles.historyToggleButtonDisabled]}>
          <IconSymbol name="plus" color={palette.accent} size={24} />
        </Pressable>

        <View style={styles.chatArea}>
          <ScrollView
            ref={scrollViewRef}
            contentContainerStyle={styles.messageList}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => {
              if (isNearLatestRef.current) {
                scrollToLatest(true, { dismissMenu: false });
              }
            }}
            onScroll={handleChatScroll}
            onMomentumScrollEnd={finishAutoScrollToLatest}
            onScrollBeginDrag={handleChatScrollBeginDrag}
            onScrollEndDrag={finishAutoScrollToLatest}
            onTouchStart={dismissMessageMenu}
            scrollEventThrottle={64}
            showsVerticalScrollIndicator>
            {showWelcome ? (
              <Animated.View
                entering={welcomeEntering}
                exiting={welcomeExiting}
                key={`welcome-${activeThreadId}`}
                layout={smoothLayout}
                style={styles.welcomeState}>
                <View style={styles.welcomeBrandRow}>
                  <Text style={styles.welcomeBrandText}>Pointer</Text>
                  <LoadingXSpinner
                    letter="x"
                    size={48}
                    style={styles.welcomeSpinner}
                    textStyle={styles.welcomeSpinnerText}
                  />
                </View>
                <View style={styles.welcomeTypingFrame}>
                  <Text numberOfLines={1} style={styles.welcomeTagline}>
                    {typedWelcomeLine}
                    <Text style={styles.welcomeTypingCursor}>|</Text>
                  </Text>
                </View>
              </Animated.View>
            ) : null}

            {visibleMessages.map((message) => {
              const isUser = message.role === 'user';
              const isActiveAssistant = message.id === activeAssistantId;
              const isCopied = copiedMessageId === message.id;
              const isSpeaking = speakingMessageId === message.id;
              const isMenuOpen = openMessageMenuId === message.id;

              return (
                <View
                  key={message.id}
                  onTouchStart={() => {
                    if (openMessageMenuId && openMessageMenuId !== message.id) {
                      dismissMessageMenu();
                    }
                  }}
                  style={[styles.messageGroup, isUser ? styles.userGroup : styles.assistantGroup]}>
                  <View style={[styles.messageBubble, isUser && styles.userBubble]}>
                    {message.content ? (
                      isActiveAssistant && !isUser ? (
                        <View style={styles.streamingMessage}>
                          <Text style={[styles.messageText, styles.streamingMessageText]}>
                            {message.content}
                          </Text>
                          <SpinningXCursor size={15} style={styles.streamingCursor} />
                        </View>
                      ) : (
                        <Text style={[styles.messageText, isUser && styles.userMessageText]}>
                          {message.content}
                        </Text>
                      )
                    ) : (
                      <LoadingXSpinner
                        size={30}
                        style={styles.loadingBrandSpinner}
                        textStyle={styles.loadingBrandX}
                      />
                    )}
                    {!isUser && message.resources?.length ? (
                      <View style={styles.resourceList}>
                        {message.resources.map((resource) => (
                          <Pressable
                            accessibilityLabel={`Open ${resource.title}`}
                            key={resource.id}
                            onPress={() => openStudyResource(resource)}
                            style={styles.resourceCard}>
                            {resource.imageUrl ? (
                              <Image
                                contentFit="cover"
                                source={{ uri: resource.imageUrl }}
                                style={styles.resourceThumbnail}
                              />
                            ) : (
                              <View style={styles.resourceThumbnailFallback}>
                                <IconSymbol
                                  name={
                                    resource.kind === 'video' ? 'play.circle.fill' : 'photo.fill'
                                  }
                                  color={palette.accent}
                                  size={28}
                                />
                              </View>
                            )}
                            <View style={styles.resourceCopy}>
                              <Text numberOfLines={2} style={styles.resourceTitle}>
                                {resource.title}
                              </Text>
                              {resource.subtitle ? (
                                <Text numberOfLines={1} style={styles.resourceSubtitle}>
                                  {resource.subtitle}
                                </Text>
                              ) : null}
                              <Text numberOfLines={1} style={styles.resourceSource}>
                                {resource.sourceLabel}
                              </Text>
                            </View>
                            <IconSymbol name="chevron.right" color={palette.mutedText} size={22} />
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </View>
                  {!isUser && message.content && !isActiveAssistant ? (
                    <>
                      <View style={styles.aiActions}>
                        <Pressable
                          accessibilityLabel="Copy response"
                          onPress={() => copyAssistantMessage(message)}
                          style={styles.aiActionButton}>
                          <IconSymbol
                            name={isCopied ? 'checkmark.circle.fill' : 'doc.on.doc.fill'}
                            color={isCopied ? palette.accent : palette.mutedText}
                            size={18}
                          />
                        </Pressable>
                        <Pressable
                          accessibilityLabel={isSpeaking ? 'Stop reading response' : 'Read response'}
                          onPress={() => toggleReadAssistantMessage(message)}
                          style={[styles.aiActionButton, isSpeaking && styles.aiActionButtonActive]}>
                          <IconSymbol
                            name="speaker.wave.2.fill"
                            color={isSpeaking ? palette.accent : palette.mutedText}
                            size={18}
                          />
                        </Pressable>
                        <Pressable
                          accessibilityLabel="More response actions"
                          onTouchStart={keepPopoverOpen}
                          onPress={(event) => {
                            keepPopoverOpen(event);
                            setOpenMessageMenuId((currentId) =>
                              currentId === message.id ? null : message.id,
                            );
                          }}
                          style={[styles.aiActionButton, isMenuOpen && styles.aiActionButtonActive]}>
                          <IconSymbol
                            name="ellipsis"
                            color={isMenuOpen ? palette.accent : palette.mutedText}
                            size={20}
                          />
                        </Pressable>
                      </View>
                      {isMenuOpen ? (
                        <View
                          onStartShouldSetResponder={() => true}
                          onTouchStart={keepPopoverOpen}
                          style={styles.messageMenu}>
                          {CHAT_CONVERSION_TARGETS.map((target) => (
                            <Pressable
                              accessibilityLabel={target.label}
                              key={target.kind}
                              onPress={(event) => {
                                keepPopoverOpen(event);
                                convertAssistantMessage(message, target);
                              }}
                              style={styles.messageMenuItem}>
                              <IconSymbol name={target.icon} color={palette.accent} size={17} />
                              <Text style={styles.messageMenuText}>{target.label}</Text>
                            </Pressable>
                          ))}
                          <View style={styles.messageMenuDivider} />
                          <Pressable
                            accessibilityLabel="Delete response"
                            onPress={(event) => {
                              keepPopoverOpen(event);
                              deleteAssistantMessage(message.id);
                            }}
                            style={styles.messageMenuItem}>
                            <IconSymbol name="trash.fill" color="#A4493D" size={17} />
                            <Text style={styles.messageMenuDeleteText}>Delete</Text>
                          </Pressable>
                          <Pressable
                            accessibilityLabel="Report response"
                            disabled
                            onPress={keepPopoverOpen}
                            style={[styles.messageMenuItem, styles.messageMenuItemDisabled]}>
                            <IconSymbol name="flag.fill" color={palette.mutedText} size={17} />
                            <Text style={styles.messageMenuDisabledText}>Report</Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </>
                  ) : null}
                </View>
              );
            })}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </ScrollView>
        </View>

        {showScrollToLatest && visibleMessages.length > 0 ? (
          <Animated.View
            entering={FadeIn.duration(120)}
            exiting={FadeOut.duration(100)}
            style={[
              styles.scrollLatestContainer,
              isKeyboardVisible && styles.scrollLatestContainerKeyboardVisible,
            ]}>
            <Pressable
              accessibilityLabel="Scroll to latest message"
              onPress={() => scrollToLatest(true)}
              style={styles.scrollLatestButton}>
              <IconSymbol name="chevron.down" color={palette.accent} size={24} />
            </Pressable>
          </Animated.View>
        ) : null}

        <View style={[styles.composer, isKeyboardVisible && styles.composerKeyboardVisible]}>
          <View style={styles.promptBar}>
            <TextInput
              multiline
              onChangeText={setDraft}
              placeholder="Message Pointerx..."
              placeholderTextColor={palette.mutedText}
              onFocus={dismissMessageMenu}
              returnKeyType="send"
              style={styles.input}
              value={draft}
            />
            <Pressable
              disabled={!draft.trim() || isSending}
              onPress={() => {
                dismissMessageMenu();
                sendMessage();
              }}
              style={[
                styles.sendButton,
                (!draft.trim() || isSending) && styles.sendButtonDisabled,
              ]}>
              <IconSymbol name="paperplane.fill" color={palette.white} size={19} />
            </Pressable>
          </View>
        </View>

        {isHistoryOpen ? (
          <Animated.View
            entering={historyOverlayEntering}
            exiting={historyOverlayExiting}
            style={styles.historyOverlay}>
            <Pressable
              accessibilityLabel="Close chat history"
              onPress={closeHistory}
              style={styles.historyBackdrop}
            />
            <Animated.View
              entering={historyDrawerEntering}
              exiting={historyDrawerExiting}
              style={styles.historyDrawer}>
              <Pressable
                accessibilityLabel="Dismiss chat options"
                onPress={dismissHistoryMenu}
                style={styles.historyDrawerContent}>
                <View style={styles.historyHeader}>
                  <Text style={styles.historyTitle}>Chats</Text>
                  <Pressable
                    accessibilityLabel="Close chat history"
                    onPress={closeHistory}
                    style={styles.historyCloseButton}>
                    <IconSymbol name="xmark.circle.fill" color={palette.mutedText} size={23} />
                  </Pressable>
                </View>

                <Pressable
                  accessibilityLabel="Start new chat"
                  onPress={startNewChat}
                  style={styles.newChatButton}>
                  <IconSymbol name="plus" color={palette.white} size={19} />
                  <Text style={styles.newChatButtonText}>New chat</Text>
                </Pressable>

                <ScrollView
                  contentContainerStyle={styles.historyList}
                  onScrollBeginDrag={dismissHistoryMenu}
                  showsVerticalScrollIndicator={false}>
                  {chatThreads.map((thread) => {
                    const isActiveThread = thread.id === activeThreadId;

                    return (
                      <Animated.View
                        entering={historyItemEntering}
                        key={thread.id}
                        layout={smoothLayout}
                        style={styles.historyItemBlock}>
                        <Pressable
                          accessibilityLabel={`Open ${thread.title}`}
                          delayLongPress={280}
                          onLongPress={(event) => {
                            keepPopoverOpen(event);
                            handleHistoryThreadLongPress(thread.id);
                          }}
                          onPress={(event) => {
                            keepPopoverOpen(event);
                            handleHistoryThreadPress(thread);
                          }}
                          onPressOut={releaseHistoryLongPressGuard}
                          style={[styles.historyItem, isActiveThread && styles.historyItemActive]}>
                          <View style={styles.historyItemContent}>
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.historyItemTitle,
                                isActiveThread && styles.historyItemTitleActive,
                              ]}>
                              {thread.title}
                            </Text>
                            <Text numberOfLines={2} style={styles.historyItemPreview}>
                              {getChatThreadPreview(thread.messages)}
                            </Text>
                          </View>
                          {isActiveThread ? <View style={styles.activeThreadDot} /> : null}
                        </Pressable>
                        {openHistoryMenuId === thread.id ? (
                          <Animated.View
                            entering={FadeIn.duration(90)}
                            exiting={FadeOut.duration(80)}
                            layout={smoothLayout}
                            onTouchStart={keepPopoverOpen}
                            style={styles.historyContextMenu}>
                            <Pressable
                              accessibilityLabel={`Delete ${thread.title}`}
                              onPress={(event) => {
                                keepPopoverOpen(event);
                                deleteHistoryThread(thread.id);
                              }}
                              style={styles.historyMenuItem}>
                              <IconSymbol name="trash.fill" color="#A4493D" size={17} />
                              <Text style={styles.historyMenuDeleteText}>Delete</Text>
                            </Pressable>
                            <Pressable
                              accessibilityLabel="Report a problem"
                              disabled
                              onPress={keepPopoverOpen}
                              style={[styles.historyMenuItem, styles.historyMenuItemDisabled]}>
                              <IconSymbol name="flag.fill" color={palette.mutedText} size={17} />
                              <Text style={styles.historyMenuDisabledText}>Report problem</Text>
                            </Pressable>
                          </Animated.View>
                        ) : null}
                      </Animated.View>
                    );
                  })}
                </ScrollView>
              </Pressable>
            </Animated.View>
          </Animated.View>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const createStyles = (palette: AppPaletteColors) => StyleSheet.create({
  keyboardRoot: {
    backgroundColor: palette.canvas,
    flex: 1,
  },
  screen: {
    backgroundColor: palette.canvas,
    flex: 1,
    padding: 20,
    paddingTop: 24,
  },
  chatArea: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  messageList: {
    flexGrow: 1,
    gap: 14,
    paddingBottom: 170,
    paddingTop: 92,
  },
  historyToggleButton: {
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    position: 'absolute',
    right: 20,
    top: 56,
    width: 44,
    zIndex: 8,
  },
  historyToggleButtonDisabled: {
    opacity: 0.45,
  },
  historyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'stretch',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    zIndex: 20,
  },
  historyBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: palette.overlay,
  },
  historyDrawer: {
    backgroundColor: palette.canvas,
    borderColor: palette.border,
    borderLeftWidth: 1,
    height: '100%',
    maxWidth: 350,
    padding: 16,
    paddingBottom: 28,
    paddingTop: 62,
    width: '86%',
  },
  historyDrawerContent: {
    flex: 1,
    gap: 14,
  },
  historyHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  historyTitle: {
    color: palette.text,
    fontSize: 22,
    fontWeight: '900',
  },
  historyCloseButton: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  newChatButton: {
    alignItems: 'center',
    backgroundColor: palette.accent,
    borderRadius: 22,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  newChatButtonText: {
    color: palette.white,
    fontSize: 15,
    fontWeight: '900',
  },
  historyList: {
    gap: 8,
    paddingBottom: 18,
  },
  historyItemBlock: {
    gap: 6,
  },
  historyItem: {
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 76,
    padding: 12,
  },
  historyItemActive: {
    backgroundColor: palette.accentSoft,
    borderColor: palette.accent,
  },
  historyItemContent: {
    flex: 1,
    gap: 4,
  },
  historyItemTitle: {
    color: palette.text,
    fontSize: 15,
    fontWeight: '900',
  },
  historyItemTitleActive: {
    color: palette.text,
  },
  historyItemPreview: {
    color: palette.mutedText,
    fontSize: 12,
    lineHeight: 17,
  },
  activeThreadDot: {
    backgroundColor: palette.accent,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  historyContextMenu: {
    alignSelf: 'stretch',
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: 2,
    padding: 6,
  },
  historyMenuItem: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    minHeight: 38,
    paddingHorizontal: 10,
  },
  historyMenuItemDisabled: {
    opacity: 0.45,
  },
  historyMenuDeleteText: {
    color: '#A4493D',
    fontSize: 14,
    fontWeight: '800',
  },
  historyMenuDisabledText: {
    color: palette.mutedText,
    fontSize: 14,
    fontWeight: '800',
  },
  welcomeState: {
    alignItems: 'center',
    flexGrow: 1,
    gap: 10,
    justifyContent: 'center',
    paddingBottom: 78,
  },
  welcomeBrandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  welcomeBrandText: {
    color: palette.text,
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 54,
  },
  welcomeSpinner: {
    marginLeft: 1,
  },
  welcomeSpinnerText: {
    color: palette.accent,
    fontSize: 39,
    lineHeight: 48,
  },
  welcomeTypingFrame: {
    alignItems: 'center',
    height: 30,
    justifyContent: 'center',
    width: '100%',
  },
  welcomeTagline: {
    color: palette.mutedText,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0,
    textAlign: 'center',
  },
  welcomeTypingCursor: {
    color: palette.accent,
    fontWeight: '900',
  },
  messageGroup: {
    gap: 6,
    maxWidth: '88%',
  },
  assistantGroup: {
    alignSelf: 'flex-start',
  },
  userGroup: {
    alignSelf: 'flex-end',
  },
  messageBubble: {
    paddingHorizontal: 2,
    paddingVertical: 8,
  },
  loadingBrandSpinner: {
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  loadingBrandX: {
    color: palette.accent,
  },
  userBubble: {
    backgroundColor: palette.accentSoft,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  messageText: {
    color: palette.text,
    fontSize: 15,
    lineHeight: 21,
  },
  streamingMessage: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
  },
  streamingMessageText: {
    flexShrink: 1,
  },
  streamingCursor: {
    marginBottom: 2,
  },
  userMessageText: {
    color: palette.text,
  },
  resourceList: {
    gap: 9,
    paddingTop: 10,
  },
  resourceCard: {
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 82,
    padding: 8,
  },
  resourceThumbnail: {
    backgroundColor: palette.surfaceMuted,
    borderRadius: 15,
    height: 62,
    width: 76,
  },
  resourceThumbnailFallback: {
    alignItems: 'center',
    backgroundColor: palette.accentSoft,
    borderRadius: 15,
    height: 62,
    justifyContent: 'center',
    width: 76,
  },
  resourceCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  resourceTitle: {
    color: palette.text,
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 18,
  },
  resourceSubtitle: {
    color: palette.mutedText,
    fontSize: 12,
  },
  resourceSource: {
    color: palette.accent,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  aiActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  aiActionButton: {
    alignItems: 'center',
    borderRadius: 16,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  aiActionButtonActive: {
    backgroundColor: palette.surfaceMuted,
  },
  messageMenu: {
    alignSelf: 'flex-start',
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: 2,
    maxWidth: 260,
    minWidth: 230,
    padding: 6,
  },
  messageMenuItem: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    minHeight: 38,
    paddingHorizontal: 10,
  },
  messageMenuDivider: {
    backgroundColor: palette.border,
    height: 1,
    marginHorizontal: 8,
    marginVertical: 4,
  },
  messageMenuItemDisabled: {
    opacity: 0.45,
  },
  messageMenuText: {
    color: palette.text,
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
  },
  messageMenuDeleteText: {
    color: '#A4493D',
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
  },
  messageMenuDisabledText: {
    color: palette.mutedText,
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
  },
  errorText: {
    color: '#A4493D',
    fontSize: 13,
    lineHeight: 18,
  },
  scrollLatestContainer: {
    alignItems: 'flex-end',
    bottom: 164,
    left: 20,
    pointerEvents: 'box-none',
    position: 'absolute',
    right: 28,
    zIndex: 10,
  },
  scrollLatestContainerKeyboardVisible: {
    bottom: 88,
  },
  scrollLatestButton: {
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  composer: {
    backgroundColor: 'transparent',
    bottom: 88,
    left: 20,
    position: 'absolute',
    right: 20,
    zIndex: 9,
  },
  composerKeyboardVisible: {
    bottom: 12,
  },
  promptBar: {
    alignItems: 'flex-end',
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 28,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 10,
  },
  input: {
    color: palette.text,
    flex: 1,
    fontSize: 16,
    maxHeight: 110,
    minHeight: 42,
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  sendButton: {
    alignItems: 'center',
    backgroundColor: palette.accent,
    borderRadius: 21,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
});

