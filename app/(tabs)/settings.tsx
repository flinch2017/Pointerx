import { IconSymbol } from '@/components/ui/icon-symbol';
import { AiModels, type AiModelName } from '@/constants/ai-models';
import { AppThemes, Fonts, type AppPaletteColors, type AppPaletteName } from '@/constants/theme';
import { useAppTheme } from '@/lib/app-theme';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

const aiModelChoices = Object.entries(AiModels) as [AiModelName, (typeof AiModels)[AiModelName]][];
const themeChoices = Object.entries(AppThemes) as [AppPaletteName, (typeof AppThemes)[AppPaletteName]][];

export default function SettingsScreen() {
  const {
    aiModelDetail,
    aiModelName,
    palette,
    setAiModelName,
    setThemeName,
    themeDetail,
    themeName,
  } = useAppTheme();
  const styles = createStyles(palette);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
      contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.kicker}>Settings</Text>
        <Text style={styles.title}>Personalize your review setup.</Text>
      </View>

      <View style={styles.panel}>
        <View style={styles.themeRow}>
          <View style={styles.rowTop}>
            <View style={styles.iconWrap}>
              <IconSymbol name="sparkles" color={palette.accent} size={21} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>Theme</Text>
              <Text style={styles.rowDetail}>{themeDetail}</Text>
            </View>
          </View>

          <View style={styles.themeChoices}>
            {themeChoices.map(([choiceName, choice]) => {
              const isSelected = choiceName === themeName;

              return (
                <Pressable
                  accessibilityLabel={`Use ${choice.label} theme`}
                  key={choiceName}
                  onPress={() => setThemeName(choiceName)}
                  style={[styles.themeChoice, isSelected && styles.themeChoiceSelected]}>
                  <View
                    style={[
                      styles.themeSwatch,
                      {
                        backgroundColor: choice.palette.canvas,
                        borderColor: choice.palette.border,
                      },
                    ]}>
                    <View
                      style={[
                        styles.themeSwatchAccent,
                        { backgroundColor: choice.palette.accent },
                      ]}
                    />
                  </View>
                  <View style={styles.themeChoiceCopy}>
                    <Text
                      style={[
                        styles.themeChoiceTitle,
                        isSelected && styles.themeChoiceTitleSelected,
                      ]}>
                      {choice.label}
                    </Text>
                    <Text style={styles.themeChoiceDetail}>{choice.detail}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.modelRow}>
          <View style={styles.rowTop}>
            <View style={styles.iconWrap}>
              <IconSymbol name="bolt.fill" color={palette.accent} size={21} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>AI model</Text>
              <Text style={styles.rowDetail}>{aiModelDetail}</Text>
            </View>
          </View>

          <View style={styles.modelChoices}>
            {aiModelChoices.map(([choiceName, choice]) => {
              const isSelected = choiceName === aiModelName;

              return (
                <Pressable
                  accessibilityLabel={`Use ${choice.label} AI model`}
                  key={choiceName}
                  onPress={() => setAiModelName(choiceName)}
                  style={[styles.modelChoice, isSelected && styles.modelChoiceSelected]}>
                  <Text
                    style={[
                      styles.modelChoiceText,
                      isSelected && styles.modelChoiceTextSelected,
                    ]}>
                    {choice.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const createStyles = (palette: AppPaletteColors) => StyleSheet.create({
  screen: {
    backgroundColor: palette.canvas,
    flex: 1,
  },
  content: {
    gap: 22,
    padding: 20,
    paddingBottom: 120,
    paddingTop: 58,
  },
  header: {
    gap: 6,
  },
  kicker: {
    color: palette.accent,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  title: {
    color: palette.text,
    fontFamily: Fonts.rounded,
    fontSize: 30,
    fontWeight: '900',
    lineHeight: 35,
  },
  panel: {
    gap: 12,
  },
  themeRow: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 30,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  modelRow: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 30,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  rowTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  iconWrap: {
    alignItems: 'center',
    backgroundColor: palette.accentSoft,
    borderColor: palette.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  rowCopy: {
    flex: 1,
    gap: 3,
  },
  rowTitle: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '900',
  },
  rowDetail: {
    color: palette.mutedText,
    fontSize: 13,
  },
  themeChoices: {
    gap: 8,
  },
  themeChoice: {
    alignItems: 'center',
    borderColor: palette.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 58,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  themeChoiceSelected: {
    backgroundColor: palette.accentSoft,
    borderColor: palette.accent,
  },
  themeSwatch: {
    alignItems: 'flex-end',
    borderRadius: 999,
    borderWidth: 1,
    height: 34,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    padding: 5,
    width: 46,
  },
  themeSwatchAccent: {
    borderRadius: 999,
    height: 12,
    width: 12,
  },
  themeChoiceCopy: {
    flex: 1,
    gap: 2,
  },
  themeChoiceTitle: {
    color: palette.text,
    fontSize: 14,
    fontWeight: '900',
  },
  themeChoiceTitleSelected: {
    color: palette.accent,
  },
  themeChoiceDetail: {
    color: palette.mutedText,
    fontSize: 12,
  },
  modelChoices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  modelChoice: {
    alignItems: 'center',
    borderColor: palette.border,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 38,
    minWidth: 74,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  modelChoiceSelected: {
    backgroundColor: palette.accentSoft,
    borderColor: palette.accent,
  },
  modelChoiceText: {
    color: palette.mutedText,
    fontSize: 13,
    fontWeight: '900',
  },
  modelChoiceTextSelected: {
    color: palette.accent,
  },
});
