/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

export const PastelBeigePalette = {
  canvas: '#F8F0E5',
  surface: '#FFF9F0',
  surfaceMuted: '#F1E2D0',
  border: '#E4CDB7',
  text: '#3E3028',
  mutedText: '#7E6B5D',
  accent: '#9C6B4E',
  accentSoft: '#EBCFB8',
  sage: '#B8C7A3',
  clay: '#DDAE93',
  blue: '#B8CAD9',
  gold: '#E4C47A',
  success: '#7F9C67',
  white: '#FFFFFF',
  overlay: 'rgba(62, 48, 40, 0.22)',
};

export const MoonlighterPalette: typeof PastelBeigePalette = {
  canvas: '#0F1218',
  surface: '#171B23',
  surfaceMuted: '#222A36',
  border: '#344052',
  text: '#F5F0E8',
  mutedText: '#AEB8C9',
  accent: '#2FB7AD',
  accentSoft: '#123A42',
  sage: '#8FA889',
  clay: '#B4937E',
  blue: '#87A1C8',
  gold: '#D8C98C',
  success: '#9DBF7C',
  white: '#FFFFFF',
  overlay: 'rgba(4, 7, 13, 0.64)',
};

export const AppPalette = PastelBeigePalette;

export type AppPaletteName = 'pastel-beige' | 'moonlighter';
export type AppPaletteColors = typeof AppPalette;

export const AppThemes: Record<
  AppPaletteName,
  {
    detail: string;
    label: string;
    navigation: 'light' | 'dark';
    palette: AppPaletteColors;
  }
> = {
  'pastel-beige': {
    detail: 'Warm pastel beige',
    label: 'Pastel beige',
    navigation: 'light',
    palette: PastelBeigePalette,
  },
  moonlighter: {
    detail: 'Moonlight black night mode',
    label: 'Moonlighter',
    navigation: 'dark',
    palette: MoonlighterPalette,
  },
};

export const Colors = {
  light: {
    text: PastelBeigePalette.text,
    background: PastelBeigePalette.canvas,
    tint: PastelBeigePalette.accent,
    icon: PastelBeigePalette.mutedText,
    tabIconDefault: PastelBeigePalette.mutedText,
    tabIconSelected: PastelBeigePalette.accent,
  },
  dark: {
    text: MoonlighterPalette.text,
    background: MoonlighterPalette.canvas,
    tint: MoonlighterPalette.accent,
    icon: MoonlighterPalette.mutedText,
    tabIconDefault: MoonlighterPalette.mutedText,
    tabIconSelected: MoonlighterPalette.accent,
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
