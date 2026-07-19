import { CircleBackButton } from '@/components/circle-back-button';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Fonts, type AppPaletteColors } from '@/constants/theme';
import { useAppTheme } from '@/lib/app-theme';
import { MockQuestion, getLatestMockTest } from '@/lib/mock-test-store';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

function formatTestMeta(
  questionCount: number,
  pageCount: number | undefined,
  processedCharacters: number,
) {
  const pages = pageCount ? `${pageCount} pages` : 'Unknown pages';

  return `${questionCount} questions / ${pages} / ${processedCharacters.toLocaleString()} characters processed`;
}

function normalizeAnswerText(value: string) {
  return value
    .replace(/^[A-D](?:\.|\)|:)?\s*/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getChoiceIndexFromLetter(value: string, choices: string[]) {
  const directLetterMatch = value.trim().match(/^[A-D](?:\.|\)|:|\s|$)/i);
  const explanationLetterMatch = value.match(
    /\b(?:correct\s+)?(?:answer|choice|option)\s*(?:is|:|-)?\s*([A-D])\b/i,
  );
  const letter = directLetterMatch?.[0]?.trim()[0] ?? explanationLetterMatch?.[1];

  if (!letter) {
    return -1;
  }

  const index = letter.toUpperCase().charCodeAt(0) - 65;

  return index >= 0 && index < choices.length ? index : -1;
}

function getChoiceIndexFromText(value: string, choices: string[]) {
  const normalizedValue = normalizeAnswerText(value);

  if (!normalizedValue) {
    return -1;
  }

  const normalizedChoices = choices.map(normalizeAnswerText);
  const exactIndex = normalizedChoices.findIndex((choice) => choice === normalizedValue);

  if (exactIndex !== -1) {
    return exactIndex;
  }

  const containedMatches = normalizedChoices
    .map((choice, index) => ({ choice, index }))
    .filter(
      ({ choice }) =>
        choice.length >= 4 &&
        (normalizedValue.includes(choice) || choice.includes(normalizedValue)),
    );

  return containedMatches.length === 1 ? containedMatches[0].index : -1;
}

function getChoiceIndexFromExplanation(value: string | undefined, choices: string[]) {
  if (!value) {
    return -1;
  }

  const letterIndex = getChoiceIndexFromLetter(value, choices);

  if (letterIndex !== -1) {
    return letterIndex;
  }

  const answerSegmentMatch = value.match(
    /\b(?:correct\s+answer|answer|correct\s+choice|best\s+answer)\s*(?:is|:|-)\s*([^.;\n]+)/i,
  );

  if (answerSegmentMatch) {
    const segmentIndex = getChoiceIndexFromText(answerSegmentMatch[1], choices);

    if (segmentIndex !== -1) {
      return segmentIndex;
    }
  }

  const normalizedExplanation = normalizeAnswerText(value);
  const matches = choices
    .map((choice, index) => ({
      choice: normalizeAnswerText(choice),
      index,
    }))
    .filter(({ choice }) => choice.length >= 4 && normalizedExplanation.includes(choice));

  return matches.length === 1 ? matches[0].index : -1;
}

function getResolvedAnswerIndex(question: MockQuestion) {
  const explanationIndex = getChoiceIndexFromExplanation(question.explanation, question.choices);

  if (explanationIndex !== -1) {
    return explanationIndex;
  }

  if (question.answerIndex >= 0 && question.answerIndex < question.choices.length) {
    return question.answerIndex;
  }

  return 0;
}

function OptionButton({
  index,
  isCorrect,
  isSelected,
  isAnswered,
  option,
  onPress,
}: {
  index: number;
  isAnswered: boolean;
  isCorrect: boolean;
  isSelected: boolean;
  option: string;
  onPress: () => void;
}) {
  const { palette } = useAppTheme();
  const styles = createStyles(palette);
  const shouldHighlightCorrect = isAnswered && isCorrect;
  const shouldHighlightWrong = isAnswered && isSelected && !isCorrect;

  return (
    <Pressable
      disabled={isAnswered}
      onPress={onPress}
      style={[
        styles.optionButton,
        shouldHighlightCorrect && styles.optionButtonCorrect,
        shouldHighlightWrong && styles.optionButtonWrong,
      ]}>
      <View
        style={[
          styles.optionLetter,
          shouldHighlightCorrect && styles.optionLetterCorrect,
          shouldHighlightWrong && styles.optionLetterWrong,
        ]}>
        <Text
          style={[
            styles.optionLetterText,
            (shouldHighlightCorrect || shouldHighlightWrong) && styles.optionLetterTextActive,
          ]}>
          {OPTION_LETTERS[index] ?? index + 1}
        </Text>
      </View>
      <Text
        selectable
        style={[
          styles.optionText,
          (shouldHighlightCorrect || shouldHighlightWrong) && styles.optionTextActive,
        ]}>
        {option}
      </Text>
    </Pressable>
  );
}

function QuestionPanel({
  currentIndex,
  onAnswer,
  question,
  selectedAnswer,
  totalQuestions,
}: {
  currentIndex: number;
  onAnswer: (choiceIndex: number) => void;
  question: MockQuestion;
  selectedAnswer?: number;
  totalQuestions: number;
}) {
  const { palette } = useAppTheme();
  const styles = createStyles(palette);
  const isAnswered = selectedAnswer !== undefined;
  const resolvedAnswerIndex = getResolvedAnswerIndex(question);
  const isCorrect = selectedAnswer === resolvedAnswerIndex;
  const correctAnswerText = `Correct answer: ${OPTION_LETTERS[resolvedAnswerIndex]}. ${
    question.choices[resolvedAnswerIndex]
  }`;

  return (
    <View style={styles.questionPanel}>
      <View style={styles.questionHeader}>
        <Text style={styles.questionNumber}>
          Question {currentIndex + 1}/{totalQuestions}
        </Text>
        {question.topic ? <Text style={styles.topicPill}>{question.topic}</Text> : null}
      </View>

      <Text selectable style={styles.questionText}>
        {question.question}
      </Text>

      <View style={styles.optionsList}>
        {question.choices.map((choice, index) => (
          <OptionButton
            key={`${choice}-${index}`}
            index={index}
            isAnswered={isAnswered}
            isCorrect={index === resolvedAnswerIndex}
            isSelected={selectedAnswer === index}
            onPress={() => onAnswer(index)}
            option={choice}
          />
        ))}
      </View>

      {isAnswered ? (
        <View style={styles.feedbackPanel}>
          <Text style={[styles.feedbackTitle, isCorrect ? styles.correctText : styles.wrongText]}>
            {isCorrect ? 'Correct' : 'Review this one'}
          </Text>
          <Text selectable style={styles.feedbackText}>
            {correctAnswerText}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export default function MockTestResultScreen() {
  const { palette } = useAppTheme();
  const styles = createStyles(palette);
  const mockTest = getLatestMockTest();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});

  const answeredCount = Object.keys(selectedAnswers).length;
  const score = useMemo(() => {
    if (!mockTest) {
      return 0;
    }

    return mockTest.questions.reduce(
      (total, question, index) =>
        selectedAnswers[index] === getResolvedAnswerIndex(question) ? total + 1 : total,
      0,
    );
  }, [mockTest, selectedAnswers]);
  const progressPercent = mockTest
    ? Math.round((answeredCount / mockTest.questions.length) * 100)
    : 0;

  function answerCurrentQuestion(choiceIndex: number) {
    setSelectedAnswers((currentAnswers) => {
      if (currentAnswers[currentIndex] !== undefined) {
        return currentAnswers;
      }

      return {
        ...currentAnswers,
        [currentIndex]: choiceIndex,
      };
    });
  }

  function resetTest() {
    setCurrentIndex(0);
    setSelectedAnswers({});
  }

  if (!mockTest) {
    return (
      <View style={[styles.screen, styles.emptyState]}>
        <CircleBackButton fallback="/mock-test-converter" style={styles.emptyBackButton} />
        <Text style={styles.title}>No mock test yet.</Text>
        <Text style={styles.subtitle}>Select a PDF first to generate a practice test here.</Text>
        <Pressable onPress={() => router.replace('/mock-test-converter')} style={styles.primaryButton}>
          <IconSymbol name="graduationcap.fill" color={palette.white} size={19} />
          <Text style={styles.primaryButtonText}>Select PDF</Text>
        </Pressable>
      </View>
    );
  }

  const currentQuestion = mockTest.questions[currentIndex];

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
      contentContainerStyle={styles.content}>
      <CircleBackButton fallback="/mock-test-converter" />

      <View style={styles.header}>
        <Text style={styles.kicker}>Mock Test</Text>
        <Text style={styles.title}>{mockTest.fileName}</Text>
        <Text selectable style={styles.subtitle}>
          {formatTestMeta(
            mockTest.questions.length,
            mockTest.pageCount,
            mockTest.processedCharacters,
          )}
        </Text>
      </View>

      <View style={styles.progressPanel}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressLabel}>Test progress</Text>
          <Text selectable style={styles.progressValue}>
            {answeredCount}/{mockTest.questions.length} answered
          </Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
        </View>
        <View style={styles.scoreRow}>
          <Text selectable style={styles.scoreText}>
            Score: {score}/{answeredCount || mockTest.questions.length}
          </Text>
          <Pressable onPress={resetTest} style={styles.resetButton}>
            <Text style={styles.resetButtonText}>Reset</Text>
          </Pressable>
        </View>
      </View>

      <QuestionPanel
        currentIndex={currentIndex}
        onAnswer={answerCurrentQuestion}
        question={currentQuestion}
        selectedAnswer={selectedAnswers[currentIndex]}
        totalQuestions={mockTest.questions.length}
      />

      <View style={styles.navigationRow}>
        <Pressable
          disabled={currentIndex === 0}
          onPress={() => setCurrentIndex((index) => Math.max(0, index - 1))}
          style={[styles.navButton, currentIndex === 0 && styles.navButtonDisabled]}>
          <Text style={styles.navButtonText}>Previous</Text>
        </Pressable>
        <Pressable
          disabled={currentIndex === mockTest.questions.length - 1}
          onPress={() =>
            setCurrentIndex((index) => Math.min(mockTest.questions.length - 1, index + 1))
          }
          style={[
            styles.navButton,
            currentIndex === mockTest.questions.length - 1 && styles.navButtonDisabled,
          ]}>
          <Text style={styles.navButtonText}>Next</Text>
        </Pressable>
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
    color: palette.blue,
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
    backgroundColor: palette.blue,
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
    color: palette.blue,
    fontSize: 14,
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
    backgroundColor: palette.blue,
    borderRadius: 999,
    height: '100%',
  },
  scoreRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  scoreText: {
    color: palette.text,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
    fontWeight: '900',
  },
  resetButton: {
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
  questionPanel: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 28,
    borderWidth: 1,
    gap: 16,
    padding: 18,
  },
  questionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  questionNumber: {
    color: palette.blue,
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  topicPill: {
    backgroundColor: palette.blue,
    borderRadius: 999,
    color: palette.text,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  questionText: {
    color: palette.text,
    fontFamily: Fonts.rounded,
    fontSize: 21,
    fontWeight: '900',
    lineHeight: 28,
  },
  optionsList: {
    gap: 10,
  },
  optionButton: {
    alignItems: 'center',
    backgroundColor: palette.canvas,
    borderColor: palette.border,
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 58,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  optionButtonCorrect: {
    backgroundColor: '#E3EBD9',
    borderColor: palette.success,
  },
  optionButtonWrong: {
    backgroundColor: '#F3DDD7',
    borderColor: '#A4493D',
  },
  optionLetter: {
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  optionLetterCorrect: {
    backgroundColor: palette.success,
  },
  optionLetterWrong: {
    backgroundColor: '#A4493D',
  },
  optionLetterText: {
    color: palette.blue,
    fontSize: 13,
    fontWeight: '900',
  },
  optionLetterTextActive: {
    color: palette.white,
  },
  optionText: {
    color: palette.text,
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
  },
  optionTextActive: {
    color: palette.text,
  },
  feedbackPanel: {
    backgroundColor: palette.canvas,
    borderRadius: 20,
    gap: 6,
    padding: 14,
  },
  feedbackTitle: {
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  correctText: {
    color: palette.success,
  },
  wrongText: {
    color: '#A4493D',
  },
  feedbackText: {
    color: palette.text,
    fontSize: 14,
    lineHeight: 21,
  },
  navigationRow: {
    flexDirection: 'row',
    gap: 10,
  },
  navButton: {
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 46,
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

