import { CircleBackButton } from '@/components/circle-back-button';
import { LoadingXSpinner } from '@/components/loading-x-spinner';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Fonts, type AppPaletteColors } from '@/constants/theme';
import { PendingChatMaterialSource, consumePendingChatMaterialSource } from '@/lib/chat-material-source';
import { useAppTheme } from '@/lib/app-theme';
import {
  generateMockTestFromText,
  generateMockTestFromUrl,
  MAX_PDF_BYTES,
  uploadPdfForMockTest,
} from '@/lib/mock-test-api';
import { setLatestMockTest } from '@/lib/mock-test-store';
import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export default function MockTestConverterScreen() {
  const { palette } = useAppTheme();
  const styles = createStyles(palette);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('Select a PDF file to begin.');
  const [progressPercent, setProgressPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const pendingSource = consumePendingChatMaterialSource('mock-test');

    if (pendingSource) {
      generateFromPendingSource(pendingSource);
    }
  }, []);

  async function generateFromPendingSource(source: PendingChatMaterialSource) {
    setSelectedFileName(source.sourceName);
    setError(null);
    setProgressPercent(1);
    setStatus(
      source.sourceUrl
        ? 'Preparing mock test from link...'
        : source.sourceFile
          ? 'Preparing mock test from PDF...'
          : 'Preparing mock test from chat...',
    );
    setIsGenerating(true);

    try {
      const mockTest = source.sourceUrl
        ? await generateMockTestFromUrl(
            { sourceName: source.sourceName, sourceUrl: source.sourceUrl },
            (progress) => {
              setProgressPercent(progress.percent);
              setStatus(progress.status);
            },
          )
        : source.sourceFile
          ? await uploadPdfForMockTest(source.sourceFile, (progress) => {
              setProgressPercent(progress.percent);
              setStatus(progress.status);
            })
        : source.sourceText
          ? await generateMockTestFromText(
              { sourceName: source.sourceName, sourceText: source.sourceText },
              (progress) => {
                setProgressPercent(progress.percent);
                setStatus(progress.status);
              },
            )
          : null;

      if (!mockTest) {
        throw new Error('Pointerx could not find a source to create a mock test.');
      }

      setLatestMockTest(mockTest);
      setProgressPercent(100);
      setStatus('Mock test ready.');
      router.push('/mock-test-result');
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Could not create a mock test from this source.';

      setError(`${message} Make sure the learning material service is available.`);
      setProgressPercent(0);
      setStatus('Select a PDF file to try again.');
    } finally {
      setIsGenerating(false);
    }
  }

  async function selectPdfFile() {
    if (isGenerating) {
      return;
    }

    setError(null);
    setProgressPercent(0);
    setStatus('Opening file picker...');

    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: 'application/pdf',
    });

    if (result.canceled) {
      setStatus('Select a PDF file to begin.');
      setProgressPercent(0);
      return;
    }

    const asset = result.assets[0];

    if (!asset) {
      setStatus('Select a PDF file to begin.');
      setProgressPercent(0);
      return;
    }

    if (asset.size && asset.size > MAX_PDF_BYTES) {
      setError('This PDF is larger than 25 MB. Try a smaller file first.');
      setStatus('Select a PDF file to begin.');
      setProgressPercent(0);
      return;
    }

    setSelectedFileName(asset.name);
    setProgressPercent(1);
    setIsGenerating(true);

    try {
      const mockTest = await uploadPdfForMockTest(asset, (progress) => {
        setProgressPercent(progress.percent);
        setStatus(progress.status);
      });

      setLatestMockTest(mockTest);
      setProgressPercent(100);
      setStatus('Mock test ready.');
      router.push('/mock-test-result');
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Could not convert this PDF to a mock test.';

      setError(`${message} Make sure the learning material service is available.`);
      setProgressPercent(0);
      setStatus('Select a PDF file to try again.');
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
      contentContainerStyle={styles.content}>
      <CircleBackButton fallback="/(tabs)/explore" />

      <View style={styles.header}>
        <Text style={styles.kicker}>Create Mock Test</Text>
        <Text style={styles.title}>
          {isGenerating ? 'Creating mock test.' : 'Select a PDF file.'}
        </Text>
        <Text style={styles.subtitle}>
          Pointerx will extract the text, generate exam-style questions, then send you to the
          test page.
        </Text>
      </View>

      <Pressable
        disabled={isGenerating}
        onPress={selectPdfFile}
        style={[styles.selectCard, isGenerating && styles.selectCardDisabled]}>
        <View style={styles.selectIcon}>
          {isGenerating ? (
            <LoadingXSpinner size={30} textStyle={styles.loadingX} />
          ) : (
            <IconSymbol name="tray.and.arrow.up.fill" color={palette.blue} size={30} />
          )}
        </View>
        <View style={styles.selectCopy}>
          <Text style={styles.selectTitle}>{selectedFileName ?? 'Choose PDF file'}</Text>
          <Text style={styles.selectDetail}>{status}</Text>
        </View>
        <IconSymbol name="chevron.right" color={palette.mutedText} size={23} />
      </Pressable>

      {isGenerating ? (
        <View style={styles.progressPanel}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressLabel}>Generation progress</Text>
            <Text selectable style={styles.progressValue}>
              {progressPercent}%
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
          </View>
          <Text style={styles.progressStatus}>{status}</Text>
        </View>
      ) : null}

      {error ? (
        <Text selectable style={styles.errorText}>
          {error}
        </Text>
      ) : null}
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
    paddingBottom: 32,
    paddingTop: 28,
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
    fontSize: 32,
    fontWeight: '900',
    lineHeight: 37,
  },
  subtitle: {
    color: palette.mutedText,
    fontSize: 15,
    lineHeight: 22,
  },
  selectCard: {
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 44,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    minHeight: 104,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  selectCardDisabled: {
    opacity: 0.75,
  },
  selectIcon: {
    alignItems: 'center',
    backgroundColor: palette.blue,
    borderRadius: 30,
    height: 60,
    justifyContent: 'center',
    width: 60,
  },
  loadingX: {
    color: palette.blue,
  },
  selectCopy: {
    flex: 1,
    gap: 4,
  },
  selectTitle: {
    color: palette.text,
    fontSize: 17,
    fontWeight: '900',
  },
  selectDetail: {
    color: palette.mutedText,
    fontSize: 13,
    lineHeight: 19,
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
    backgroundColor: palette.blue,
    borderRadius: 999,
    height: '100%',
  },
  progressStatus: {
    color: palette.mutedText,
    fontSize: 13,
    lineHeight: 19,
  },
  errorText: {
    color: '#A4493D',
    fontSize: 13,
    lineHeight: 19,
  },
});

