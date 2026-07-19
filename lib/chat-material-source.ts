export type ChatMaterialKind = 'flashcards' | 'mock-test' | 'reviewer';

export type PendingPdfFile = {
  file?: File;
  mimeType?: string;
  name: string;
  size?: number;
  uri: string;
};

type PendingChatTextSource = {
  kind: ChatMaterialKind;
  sourceFile?: never;
  sourceName: string;
  sourceText: string;
  sourceUrl?: never;
};

type PendingChatUrlSource = {
  kind: ChatMaterialKind;
  sourceFile?: never;
  sourceName: string;
  sourceText?: never;
  sourceUrl: string;
};

type PendingChatFileSource = {
  kind: ChatMaterialKind;
  sourceFile: PendingPdfFile;
  sourceName: string;
  sourceText?: never;
  sourceUrl?: never;
};

export type PendingChatMaterialSource =
  | PendingChatFileSource
  | PendingChatTextSource
  | PendingChatUrlSource;

let pendingChatMaterialSource: PendingChatMaterialSource | null = null;

export function setPendingChatMaterialSource(source: PendingChatMaterialSource) {
  pendingChatMaterialSource = source;
}

export function consumePendingChatMaterialSource(kind: ChatMaterialKind) {
  if (!pendingChatMaterialSource || pendingChatMaterialSource.kind !== kind) {
    return null;
  }

  const source = pendingChatMaterialSource;
  pendingChatMaterialSource = null;
  return source;
}
