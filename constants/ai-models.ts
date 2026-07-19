export type AiModelName = 'ollama' | 'gemini' | 'openrouter' | 'claude' | 'gpt';

export const AiModels: Record<
  AiModelName,
  {
    detail: string;
    label: string;
  }
> = {
  ollama: {
    detail: 'Local model',
    label: 'Ollama',
  },
  gemini: {
    detail: 'Google AI',
    label: 'Gemini',
  },
  openrouter: {
    detail: 'Free and paid model router',
    label: 'OpenRouter',
  },
  claude: {
    detail: 'Anthropic',
    label: 'Claude',
  },
  gpt: {
    detail: 'OpenAI',
    label: 'GPT',
  },
};
