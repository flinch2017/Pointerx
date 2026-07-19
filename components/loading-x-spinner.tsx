import { Fonts } from '@/constants/theme';
import { useAppTheme } from '@/lib/app-theme';
import { useEffect } from 'react';
import { StyleSheet, Text, type TextStyle, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

type LoadingXSpinnerProps = {
  letter?: string;
  size?: number;
  style?: ViewStyle;
  textStyle?: TextStyle;
};

type SpinningXCursorProps = {
  letter?: string;
  size?: number;
  style?: ViewStyle;
  textStyle?: TextStyle;
};

function useClockwiseSpin() {
  const spinValue = useSharedValue(0);

  useEffect(() => {
    spinValue.value = withRepeat(
      withTiming(1, {
        duration: 850,
        easing: Easing.linear,
      }),
      -1,
      false,
    );

    return () => cancelAnimation(spinValue);
  }, [spinValue]);

  return useAnimatedStyle(() => ({
    transform: [{ rotate: `${spinValue.value * 360}deg` }],
  }));
}

export function LoadingXSpinner({
  letter = 'X',
  size = 30,
  style,
  textStyle,
}: LoadingXSpinnerProps) {
  const { palette } = useAppTheme();
  const spinStyle = useClockwiseSpin();

  return (
    <Animated.View
      style={[
        styles.spinner,
        {
          height: size,
          width: size,
        },
        spinStyle,
        style,
      ]}>
      <Text
        style={[
          styles.xText,
          {
            color: palette.accent,
            fontSize: size * 0.6,
            lineHeight: size * 0.74,
          },
          textStyle,
        ]}>
        {letter}
      </Text>
    </Animated.View>
  );
}

export function SpinningXCursor({
  letter = 'X',
  size = 15,
  style,
  textStyle,
}: SpinningXCursorProps) {
  const { palette } = useAppTheme();
  const spinStyle = useClockwiseSpin();

  return (
    <Animated.View
      style={[
        styles.inlineCursorBox,
        {
          height: size * 1.35,
          width: size * 1.35,
        },
        spinStyle,
        style,
      ]}>
      <Text
        style={[
          styles.inlineCursor,
          {
            color: palette.accent,
            fontSize: size,
            lineHeight: size * 1.25,
          },
          textStyle,
        ]}>
        {letter}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  spinner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  xText: {
    fontFamily: Fonts.rounded,
    fontWeight: '900',
  },
  inlineCursorBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineCursor: {
    fontFamily: Fonts.rounded,
    fontWeight: '900',
  },
});
