import { Fonts, type AppPaletteColors } from '@/constants/theme';
import { useAppTheme } from '@/lib/app-theme';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';

type CircleBackButtonProps = {
  fallback?: Parameters<typeof router.replace>[0];
  style?: ViewStyle;
};

export function CircleBackButton({ fallback, style }: CircleBackButtonProps) {
  const { palette } = useAppTheme();
  const styles = createStyles(palette);

  function goBack() {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    if (fallback) {
      router.replace(fallback);
    }
  }

  return (
    <Pressable accessibilityLabel="Go back" onPress={goBack} style={[styles.button, style]}>
      <Text style={styles.symbol}>{'<'}</Text>
    </Pressable>
  );
}

const createStyles = (palette: AppPaletteColors) => StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 21,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  symbol: {
    color: palette.accent,
    fontFamily: Fonts.rounded,
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 28,
  },
});
