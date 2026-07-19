import { CircleBackButton } from '@/components/circle-back-button';
import { LoadingXSpinner } from '@/components/loading-x-spinner';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Fonts, type AppPaletteColors } from '@/constants/theme';
import {
  PendingChatMaterialSource,
  PendingPdfFile,
  consumePendingChatMaterialSource,
} from '@/lib/chat-material-source';
import { useAppTheme } from '@/lib/app-theme';
import {
  generateReviewerFromText,
  MAX_PDF_BYTES,
  uploadPdfForReviewer,
} from '@/lib/reviewer-api';
import { setLatestReviewer } from '@/lib/reviewer-store';
import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export default function ReviewerConverterScreen() {
  const { palette } = useAppTheme();
  const styles = createStyles(palette);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('Select a PDF file to begin.');
  const [progressPercent, setProgressPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const pendingSource = consumePendingChatMaterialSource('reviewer');

    if (pendingSource) {
      generateFromPendingSource(pendingSource);
    }
    // Pending chat handoff should be consumed only once when this page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generateFromPendingSource(source: PendingChatMaterialSource) {
    if (source.sourceFile) {
      await generateFromPdfSource(source.sourceFile);
      return;
    }

    if (source.sourceText) {
      await generateFromChatSource({
        sourceName: source.sourceName,
        sourceText: source.sourceText,
      });
    }
  }

  async function generateFromChatSource(source: { sourceName: string; sourceText: string }) {
    setSelectedFileName(source.sourceName);
    setError(null);
    setProgressPercent(1);
    setStatus('Preparing reviewer from chat...');
    setIsGenerating(true);

    try {
      const reviewer = await generateReviewerFromText(source, (progress) => {
        setProgressPercent(progress.percent);
        setStatus(progress.status);
      });

      setLatestReviewer(reviewer);
      setProgressPercent(100);
      setStatus('Reviewer ready.');
      router.push('/reviewer-result');
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Could not create a reviewer from this chat answer.';

      setError(`${message} Make sure the reviewer service is available.`);
      setProgressPercent(0);
      setStatus('Select a PDF file to try again.');
    } finally {
      setIsGenerating(false);
    }
  }

  async function generateFromPdfSource(sourceFile: PendingPdfFile) {
    setSelectedFileName(sourceFile.name);
    setError(null);
    setProgressPercent(1);
    setStatus('Preparing reviewer from PDF...');
    setIsGenerating(true);

    try {
      const reviewer = await uploadPdfForReviewer(sourceFile, (progress) => {
        setProgressPercent(progress.percent);
        setStatus(progress.status);
      });

      setLatestReviewer(reviewer);
      setProgressPercent(100);
      setStatus('Reviewer ready.');
      router.push('/reviewer-result');
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Could not convert this PDF to a reviewer.';

      setError(`${message} Make sure the reviewer service is available.`);
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
      setError('This PDF is larger than 25 MB. Try a smaller reviewer file first.');
      setStatus('Select a PDF file to begin.');
      setProgressPercent(0);
      return;
    }

    setSelectedFileName(asset.name);
    setProgressPercent(1);
    setIsGenerating(true);

    try {
      const reviewer = await uploadPdfForReviewer(asset, (progress) => {
        setProgressPercent(progress.percent);
        setStatus(progress.status);
      });

      setLatestReviewer(reviewer);
      setProgressPercent(100);
      setStatus('Reviewer ready.');
      router.push('/reviewer-result');
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Could not convert this PDF to a reviewer.';

      setError(`${message} Make sure the reviewer service is available.`);
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
        <Text style={styles.kicker}>Convert PDF to Reviewer</Text>
        <Text style={styles.title}>{isGenerating ? 'Creating reviewer.' : 'Select a PDF file.'}</Text>
        <Text style={styles.subtitle}>
          Pointerx will extract the text, generate a study-ready reviewer, then send you to the
          result page.
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
            <IconSymbol name="tray.and.arrow.up.fill" color={palette.accent} size={30} />
          )}
        </View>
        <View style={styles.selectCopy}>
          <Text style={styles.selectTitle}>
            {selectedFileName ?? 'Choose PDF file'}
          </Text>
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

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
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
    color: palette.accent,
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
    backgroundColor: palette.accentSoft,
    borderRadius: 30,
    height: 60,
    justifyContent: 'center',
    width: 60,
  },
  loadingX: {
    color: palette.accent,
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
    color: palette.accent,
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
    backgroundColor: palette.accent,
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

