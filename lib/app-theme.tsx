import { AiModels, type AiModelName } from '@/constants/ai-models';
import {
  AppThemes,
  type AppPaletteColors,
  type AppPaletteName,
} from '@/constants/theme';
import * as FileSystem from 'expo-file-system/legacy';
import { createContext, PropsWithChildren, use, useEffect, useMemo, useState } from 'react';

type AppThemeContextValue = {
  aiModelDetail: string;
  aiModelLabel: string;
  aiModelName: AiModelName;
  isMoonlighter: boolean;
  palette: AppPaletteColors;
  setAiModelName: (modelName: AiModelName) => void;
  setThemeName: (themeName: AppPaletteName) => void;
  themeDetail: string;
  themeLabel: string;
  themeName: AppPaletteName;
};

const AppThemeContext = createContext<AppThemeContextValue | null>(null);
const themeFileUri = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}pointerx-theme.json`
  : null;

function isAppPaletteName(value: unknown): value is AppPaletteName {
  return typeof value === 'string' && value in AppThemes;
}

function isAiModelName(value: unknown): value is AiModelName {
  return typeof value === 'string' && value in AiModels;
}

function getStoredThemeName(value: unknown): AppPaletteName | null {
  if (isAppPaletteName(value)) {
    return value;
  }

  if (value && typeof value === 'object' && 'themeName' in value) {
    const themeName = (value as { themeName?: unknown }).themeName;

    return isAppPaletteName(themeName) ? themeName : null;
  }

  return null;
}

function getStoredAiModelName(value: unknown): AiModelName | null {
  if (isAiModelName(value)) {
    return value;
  }

  if (value && typeof value === 'object' && 'aiModelName' in value) {
    const aiModelName = (value as { aiModelName?: unknown }).aiModelName;

    return isAiModelName(aiModelName) ? aiModelName : null;
  }

  return null;
}

export function AppThemeProvider({ children }: PropsWithChildren) {
  const [hasLoadedTheme, setHasLoadedTheme] = useState(false);
  const [aiModelName, setAiModelName] = useState<AiModelName>('ollama');
  const [themeName, setThemeName] = useState<AppPaletteName>('pastel-beige');

  useEffect(() => {
    let isMounted = true;

    async function loadTheme() {
      if (!themeFileUri) {
        setHasLoadedTheme(true);
        return;
      }

      try {
        const fileInfo = await FileSystem.getInfoAsync(themeFileUri);

        if (!fileInfo.exists) {
          return;
        }

        const rawTheme = await FileSystem.readAsStringAsync(themeFileUri);
        const savedPreferences = JSON.parse(rawTheme);
        const savedAiModelName = getStoredAiModelName(savedPreferences);
        const savedThemeName = getStoredThemeName(savedPreferences);

        if (savedThemeName && isMounted) {
          setThemeName(savedThemeName);
        }

        if (savedAiModelName && isMounted) {
          setAiModelName(savedAiModelName);
        }
      } catch {
        // Theme persistence should never block app rendering.
      } finally {
        if (isMounted) {
          setHasLoadedTheme(true);
        }
      }
    }

    loadTheme();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedTheme || !themeFileUri) {
      return;
    }

    FileSystem.writeAsStringAsync(
      themeFileUri,
      JSON.stringify({ aiModelName, themeName }),
    ).catch(() => {
      // Keep the selected theme in memory even if persistence fails.
    });
  }, [aiModelName, hasLoadedTheme, themeName]);

  const value = useMemo<AppThemeContextValue>(() => {
    const activeTheme = AppThemes[themeName];
    const activeAiModel = AiModels[aiModelName];

    return {
      aiModelDetail: activeAiModel.detail,
      aiModelLabel: activeAiModel.label,
      aiModelName,
      isMoonlighter: themeName === 'moonlighter',
      palette: activeTheme.palette,
      setAiModelName,
      setThemeName,
      themeDetail: activeTheme.detail,
      themeLabel: activeTheme.label,
      themeName,
    };
  }, [aiModelName, themeName]);

  return <AppThemeContext value={value}>{children}</AppThemeContext>;
}

export function useAppTheme() {
  const context = use(AppThemeContext);

  if (!context) {
    throw new Error('useAppTheme must be used inside AppThemeProvider');
  }

  return context;
}
