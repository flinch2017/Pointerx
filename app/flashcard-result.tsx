import { CircleBackButton } from '@/components/circle-back-button';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Fonts, type AppPaletteColors } from '@/constants/theme';
import { Flashcard, getLatestFlashcards } from '@/lib/flashcard-store';
import { useAppTheme } from '@/lib/app-theme';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

function formatCardMeta(cardCount: number, pageCount: number | undefined, processedCharacters: number) {
  const pages = pageCount ? `${pageCount} pages` : 'Unknown pages';

  return `${cardCount} cards / ${pages} / ${processedCharacters.toLocaleString()} characters processed`;
}

function FlashcardItem({
  card,
  index,
  isLearned,
  isRevealed,
  onToggleLearned,
  onToggleRevealed,
}: {
  card: Flashcard;
  index: number;
  isLearned: boolean;
  isRevealed: boolean;
  onToggleLearned: () => void;
  onToggleRevealed: () => void;
}) {
  const { palette } = useAppTheme();
  const styles = createStyles(palette);

  return (
    <Pressable onPress={onToggleRevealed} style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardNumber}>Card {index + 1}</Text>
        {card.tag ? <Text style={styles.tagPill}>{card.tag}</Text> : null}
      </View>

      <Text selectable style={styles.frontText}>
        {card.front}
      </Text>

      {card.hint && !isRevealed ? (
        <Text selectable style={styles.hintText}>
          Hint: {card.hint}
        </Text>
      ) : null}

      {isRevealed ? (
        <View style={styles.answerPanel}>
          <Text style={styles.answerLabel}>Answer</Text>
          <Text selectable style={styles.answerText}>
            {card.back}
          </Text>
        </View>
      ) : null}

      <View style={styles.cardActions}>
        <Pressable onPress={onToggleRevealed} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>{isRevealed ? 'Hide' : 'Show answer'}</Text>
        </Pressable>
        <Pressable
          onPress={onToggleLearned}
          style={[styles.learnedButton, isLearned && styles.learnedButtonActive]}>
          <IconSymbol
            name="checkmark.circle.fill"
            color={isLearned ? palette.white : palette.success}
            size={18}
          />
          <Text style={[styles.learnedButtonText, isLearned && styles.learnedButtonTextActive]}>
            {isLearned ? 'Learned' : 'Mark learned'}
          </Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

export default function FlashcardResultScreen() {
  const { palette } = useAppTheme();
  const styles = createStyles(palette);
  const flashcards = getLatestFlashcards();
  const deckRef = useRef<ScrollView>(null);
  const { width } = useWindowDimensions();
  const pageWidth = Math.max(320, width);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealedCards, setRevealedCards] = useState<Set<number>>(() => new Set());
  const [learnedCards, setLearnedCards] = useState<Set<number>>(() => new Set());

  const progressPercent = useMemo(() => {
    if (!flashcards?.cards.length) {
      return 0;
    }

    return Math.round((learnedCards.size / flashcards.cards.length) * 100);
  }, [flashcards?.cards.length, learnedCards.size]);

  function toggleSetValue(setter: (value: Set<number>) => void, current: Set<number>, index: number) {
    const next = new Set(current);

    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }

    setter(next);
  }

  function goToCard(index: number) {
    const safeIndex = Math.min(Math.max(index, 0), (flashcards?.cards.length ?? 1) - 1);

    setCurrentIndex(safeIndex);
    deckRef.current?.scrollTo({ animated: true, x: safeIndex * pageWidth });
  }

  function handleDeckScrollEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / pageWidth);

    setCurrentIndex(nextIndex);
  }

  if (!flashcards) {
    return (
      <View style={[styles.screen, styles.emptyState]}>
        <CircleBackButton fallback="/flashcard-converter" style={styles.emptyBackButton} />
        <Text style={styles.title}>No flashcards yet.</Text>
        <Text style={styles.subtitle}>Convert a PDF first to study the generated flashcards here.</Text>
        <Pressable onPress={() => router.replace('/flashcard-converter')} style={styles.primaryButton}>
          <IconSymbol name="rectangle.stack.fill" color={palette.white} size={19} />
          <Text style={styles.primaryButtonText}>Select PDF</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
      contentContainerStyle={styles.content}>
      <CircleBackButton fallback="/flashcard-converter" />

      <View style={styles.header}>
        <Text style={styles.kicker}>Flashcard Learning Materials</Text>
        <Text style={styles.title}>{flashcards.fileName}</Text>
        <Text selectable style={styles.subtitle}>
          {formatCardMeta(
            flashcards.cards.length,
            flashcards.pageCount,
            flashcards.processedCharacters,
          )}
        </Text>
      </View>

      <View style={styles.progressPanel}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressLabel}>Study progress</Text>
          <Text selectable style={styles.progressValue}>
            {learnedCards.size}/{flashcards.cards.length}
          </Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
        </View>
        <Pressable
          onPress={() => {
            setLearnedCards(new Set());
            setRevealedCards(new Set());
            goToCard(0);
          }}
          style={styles.resetButton}>
          <Text style={styles.resetButtonText}>Reset study session</Text>
        </Pressable>
      </View>

      <View style={styles.deckSection}>
        <View style={styles.deckHeader}>
          <Text style={styles.deckCounter}>
            {currentIndex + 1}/{flashcards.cards.length}
          </Text>
          <View style={styles.dots}>
            {flashcards.cards.map((card, index) => (
              <View
                key={`${card.front}-dot-${index}`}
                style={[styles.dot, index === currentIndex && styles.dotActive]}
              />
            ))}
          </View>
        </View>

        <ScrollView
          ref={deckRef}
          horizontal
          onMomentumScrollEnd={handleDeckScrollEnd}
          pagingEnabled
          scrollEventThrottle={16}
          showsHorizontalScrollIndicator={false}
          style={styles.deckScroller}>
          {flashcards.cards.map((card, index) => (
            <View key={`${card.front}-${index}`} style={[styles.slide, { width: pageWidth }]}>
              <FlashcardItem
                card={card}
                index={index}
                isLearned={learnedCards.has(index)}
                isRevealed={revealedCards.has(index)}
                onToggleLearned={() => toggleSetValue(setLearnedCards, learnedCards, index)}
                onToggleRevealed={() => toggleSetValue(setRevealedCards, revealedCards, index)}
              />
            </View>
          ))}
        </ScrollView>

        <View style={styles.deckNavigation}>
          <Pressable
            disabled={currentIndex === 0}
            onPress={() => goToCard(currentIndex - 1)}
            style={[styles.navButton, currentIndex === 0 && styles.navButtonDisabled]}>
            <Text style={styles.navButtonText}>Previous</Text>
          </Pressable>
          <Pressable
            disabled={currentIndex === flashcards.cards.length - 1}
            onPress={() => goToCard(currentIndex + 1)}
            style={[
              styles.navButton,
              currentIndex === flashcards.cards.length - 1 && styles.navButtonDisabled,
            ]}>
            <Text style={styles.navButtonText}>Next</Text>
          </Pressable>
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
    gap: 18,
    padding: 20,
    paddingBottom: 32,
    paddingTop: 28,
  },
  emptyState: {
    gap: 14,
    justifyContent: 'center',
    padding: 24,
  },
  emptyBackButton: {
    left: 24,
    position: 'absolute',
    top: 56,
  },
  header: {
    gap: 8,
  },
  kicker: {
    color: palette.success,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  title: {
    color: palette.text,
    fontFamily: Fonts.rounded,
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 34,
  },
  subtitle: {
    color: palette.mutedText,
    fontSize: 14,
    lineHeight: 21,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: palette.success,
    borderRadius: 28,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: palette.white,
    fontSize: 16,
    fontWeight: '900',
  },
  progressPanel: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 28,
    borderWidth: 1,
    gap: 10,
    padding: 18,
  },
  progressHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressLabel: {
    color: palette.text,
    fontSize: 15,
    fontWeight: '900',
  },
  progressValue: {
    color: palette.success,
    fontSize: 15,
    fontVariant: ['tabular-nums'],
    fontWeight: '900',
  },
  progressTrack: {
    backgroundColor: palette.surfaceMuted,
    borderRadius: 999,
    height: 12,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: palette.success,
    borderRadius: 999,
    height: '100%',
  },
  resetButton: {
    alignSelf: 'flex-start',
    borderColor: palette.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  resetButtonText: {
    color: palette.mutedText,
    fontSize: 13,
    fontWeight: '800',
  },
  deckSection: {
    gap: 12,
    marginHorizontal: -20,
  },
  deckHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  deckCounter: {
    color: palette.success,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
    fontWeight: '900',
  },
  dots: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 5,
    justifyContent: 'flex-end',
  },
  dot: {
    backgroundColor: palette.border,
    borderRadius: 999,
    height: 7,
    width: 7,
  },
  dotActive: {
    backgroundColor: palette.success,
    width: 18,
  },
  deckScroller: {
    flexGrow: 0,
  },
  slide: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 28,
    borderWidth: 1,
    gap: 12,
    minHeight: 360,
    padding: 18,
    width: '100%',
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  cardNumber: {
    color: palette.success,
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  tagPill: {
    backgroundColor: palette.sage,
    borderRadius: 999,
    color: palette.text,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  frontText: {
    color: palette.text,
    fontFamily: Fonts.rounded,
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 26,
  },
  hintText: {
    color: palette.mutedText,
    fontSize: 13,
    lineHeight: 19,
  },
  answerPanel: {
    backgroundColor: palette.canvas,
    borderRadius: 20,
    gap: 6,
    padding: 14,
  },
  answerLabel: {
    color: palette.success,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  answerText: {
    color: palette.text,
    fontSize: 15,
    lineHeight: 22,
  },
  cardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: palette.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    color: palette.text,
    fontSize: 13,
    fontWeight: '900',
  },
  learnedButton: {
    alignItems: 'center',
    borderColor: palette.success,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 14,
  },
  learnedButtonActive: {
    backgroundColor: palette.success,
  },
  learnedButtonText: {
    color: palette.success,
    fontSize: 13,
    fontWeight: '900',
  },
  learnedButtonTextActive: {
    color: palette.white,
  },
  deckNavigation: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  navButton: {
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  navButtonDisabled: {
    opacity: 0.45,
  },
  navButtonText: {
    color: palette.text,
    fontSize: 14,
    fontWeight: '900',
  },
});

