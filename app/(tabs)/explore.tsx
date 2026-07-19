import { IconSymbol } from '@/components/ui/icon-symbol';
import { Fonts, type AppPaletteColors } from '@/constants/theme';
import { useAppTheme } from '@/lib/app-theme';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

const cards = [
  {
    title: 'Convert PDF to Reviewer',
    detail: 'Generate concise notes, key terms, and high-yield summaries.',
    icon: 'doc.text.fill',
    color: 'clay',
  },
  {
    title: 'Convert PDF to Flashcards',
    detail: 'Turn lessons into active recall cards for quick review.',
    icon: 'rectangle.stack.fill',
    color: 'sage',
  },
  {
    title: 'Create Mock Test',
    detail: 'Build practice exams with answers and rationales.',
    icon: 'graduationcap.fill',
    color: 'blue',
  },
] as const;

export default function ExploreScreen() {
  const { palette } = useAppTheme();
  const styles = createStyles(palette);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
      contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.kicker}>Explore</Text>
        <Text style={styles.title}>Choose what Pointerx should create.</Text>
      </View>

      <View style={styles.cardList}>
        {cards.map((card) => (
          <Pressable
            key={card.title}
            onPress={
              card.title === 'Convert PDF to Reviewer'
                ? () => router.push('/reviewer-converter')
                : card.title === 'Convert PDF to Flashcards'
                  ? () => router.push('/flashcard-converter')
                  : card.title === 'Create Mock Test'
                    ? () => router.push('/mock-test-converter')
                    : undefined
            }
            style={styles.card}>
            <View style={[styles.iconWrap, { backgroundColor: palette[card.color] }]}>
              <IconSymbol name={card.icon} color={palette.text} size={28} />
            </View>
            <View style={styles.cardCopy}>
              <Text style={styles.cardTitle}>{card.title}</Text>
              <Text style={styles.cardDetail}>{card.detail}</Text>
            </View>
            <IconSymbol name="chevron.right" color={palette.mutedText} size={23} />
          </Pressable>
        ))}
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
  cardList: {
    gap: 12,
  },
  card: {
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 44,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    minHeight: 96,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  iconWrap: {
    alignItems: 'center',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  cardCopy: {
    flex: 1,
    gap: 4,
  },
  cardTitle: {
    color: palette.text,
    fontSize: 17,
    fontWeight: '900',
  },
  cardDetail: {
    color: palette.mutedText,
    fontSize: 13,
    lineHeight: 19,
  },
});
