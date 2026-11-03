import { router, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useOperation } from '@/features/operation/operation-provider';
import type { OperationPhase } from '@/features/operation/operation-machine';
import { ChargeList } from '@/features/report/charge-list';
import { chargesVisible } from '@/features/report/report-visibility';
import { formatStatementSize, statementFormatLabel } from '@/features/statement/statement-policy';
import { homeScreenMode } from '@/features/ui/home-screen-mode';
import { primaryActions } from '@/features/ui/screen-actions';
import { useTheme } from '@/hooks/use-theme';

const PHASE_LABEL: Record<OperationPhase, string> = {
  selection: 'Choose a file',
  confirmation: 'Confirm file',
  submitting: 'Sending',
  submissionUnknown: 'Upload result unknown',
  queued: 'Queued',
  processing: 'Processing',
  ready: 'Ready',
  deleting: 'Deleting',
  deleted: 'Deleted',
  error: 'Needs attention',
};

function Detail({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.detail}>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <ThemedText selectable testID={testID}>{value}</ThemedText>
    </View>
  );
}

export default function HomeScreen() {
  const theme = useTheme();
  const {
    state,
    hydrated,
    busy,
    chooseStatement,
    cancelStatement,
    submitStatement,
    deleteStatement,
    retryOperation,
    reset,
  } = useOperation();
  const operation = state.operation;
  const mode = homeScreenMode({
    hydrated,
    phase: state.phase,
    hasOperation: Boolean(operation),
    hasError: Boolean(state.error),
  });
  const actions = primaryActions({
    mode,
    phase: state.phase,
    hasError: Boolean(state.error),
    errorCode: state.error?.code,
  });
  const showCharges = Boolean(operation && chargesVisible(state.phase, Boolean(operation.report)));

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="smallBold" themeColor="textSecondary">KELPIE · STATEMENT</ThemedText>
          <ThemedText accessibilityRole="header" style={styles.title}>Choose a file</ThemedText>
          <ThemedText themeColor="textSecondary">
            PDF and CSV statements are checked locally, then kept only in the app cache.
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open diagnostics"
            onPress={() => router.push('/diagnostics' as Href)}
            style={styles.textButton}
            testID="open-diagnostics"
          >
            <ThemedText type="link">Diagnostics</ThemedText>
          </Pressable>

          {mode === 'loading' ? (
            <ThemedView type="backgroundElement" style={styles.card} testID="home-loading">
              <ThemedText type="smallBold">RESTORING</ThemedText>
              <ThemedText themeColor="textSecondary">
                Checking the saved import before anything is sent again.
              </ThemedText>
            </ThemedView>
          ) : null}

          {mode === 'empty' ? (
            <ThemedView type="backgroundElement" style={styles.card} testID="home-empty">
              <ThemedText type="smallBold">NO FILE SELECTED</ThemedText>
              <ThemedText themeColor="textSecondary">
                Pick a statement from Files. The extension is not used.
              </ThemedText>
              {actions.includes('choose') ? (
                <ActionButton
                  label={busy ? 'Reading file…' : 'Choose statement'}
                  accessibilityLabel="Choose statement"
                  disabled={busy}
                  onPress={() => void chooseStatement()}
                  color={theme.text}
                  textColor={theme.background}
                  testID="choose-statement"
                />
              ) : null}
            </ThemedView>
          ) : null}

          {mode === 'error' ? (
            <ThemedView type="backgroundElement" style={styles.card} testID="home-error">
              <ThemedText type="smallBold">NEEDS ATTENTION</ThemedText>
              <ThemedText testID="statement-error">
                {state.error?.message ?? 'The statement could not be read.'}
              </ThemedText>
              <ThemedText themeColor="textSecondary">
                Choose the file again. Nothing has been uploaded for this attempt.
              </ThemedText>
              {actions.includes('choose') ? (
                <ActionButton
                  label="Choose statement"
                  accessibilityLabel="Choose statement"
                  disabled={busy}
                  onPress={() => void chooseStatement()}
                  color={theme.text}
                  textColor={theme.background}
                  testID="choose-statement"
                />
              ) : null}
            </ThemedView>
          ) : null}

          {mode === 'confirmation' && operation ? (
            <ThemedView type="backgroundElement" style={styles.card} testID="statement-confirmation">
              <ThemedText type="smallBold">CONFIRM FILE</ThemedText>
              <Detail label="Name" value={operation.fileName} testID="confirm-file-name" />
              <Detail label="Size" value={formatStatementSize(operation.sizeBytes)} testID="confirm-file-size" />
              <Detail label="Format" value={statementFormatLabel(operation.format)} testID="confirm-file-format" />
              <ThemedText themeColor="textSecondary">
                Sending uses the original bytes and the key already saved for this file.
              </ThemedText>
              {actions.includes('submit') ? (
                <ActionButton
                  label={busy ? 'Sending…' : 'Send statement'}
                  accessibilityLabel="Send statement"
                  disabled={busy}
                  onPress={() => void submitStatement()}
                  color={theme.text}
                  textColor={theme.background}
                  testID="submit-statement"
                />
              ) : null}
              {actions.includes('cancel-local-copy') ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel and remove the temporary copy"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => void cancelStatement()}
                  style={styles.textButton}
                >
                  <ThemedText type="smallBold">Cancel</ThemedText>
                </Pressable>
              ) : null}
            </ThemedView>
          ) : null}

          {mode === 'status' && operation ? (
            <ThemedView type="backgroundElement" style={styles.card} testID="operation-status">
              <ThemedText type="smallBold">IMPORT</ThemedText>
              <ThemedText accessibilityRole="header" testID="operation-phase" style={styles.status}>
                {PHASE_LABEL[state.phase]}
              </ThemedText>
              <Detail label="Revision" value={String(operation.lastAcceptedRevision)} testID="operation-revision" />
              <Detail label="Job" value={operation.jobId ?? 'Not assigned'} testID="operation-job" />
              {state.phase === 'deleting' ? (
                <ThemedText themeColor="textSecondary">
                  Deletion is accepted, not finished. The charges stay visible until a later status says deleted.
                </ThemedText>
              ) : null}
              {state.phase === 'submissionUnknown' ? (
                <ThemedText themeColor="textSecondary">
                  The upload may already exist. Retry looks it up with the same key before sending the same bytes again.
                </ThemedText>
              ) : null}
              {state.error ? <ThemedText testID="operation-error">{state.error.message}</ThemedText> : null}
              {showCharges && operation.report ? <ChargeList report={operation.report} /> : null}
              {actions.includes('delete-import') ? (
                <ActionButton
                  label={busy ? 'Deleting…' : 'Delete statement'}
                  accessibilityLabel="Delete statement"
                  disabled={busy}
                  onPress={() => void deleteStatement()}
                  color={theme.text}
                  textColor={theme.background}
                  testID="delete-statement"
                />
              ) : null}
              {actions.includes('retry') ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry the current operation"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => void retryOperation()}
                  style={styles.textButton}
                  testID="retry-operation"
                >
                  <ThemedText type="smallBold">{busy ? 'Working…' : 'Retry'}</ThemedText>
                </Pressable>
              ) : null}
              {actions.includes('choose-another') ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Choose another statement"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => void reset()}
                  style={styles.textButton}
                  testID="choose-another"
                >
                  <ThemedText type="smallBold">Choose another file</ThemedText>
                </Pressable>
              ) : null}
            </ThemedView>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function ActionButton({
  label,
  accessibilityLabel,
  disabled,
  onPress,
  color,
  textColor,
  testID,
}: {
  label: string;
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
  color: string;
  textColor: string;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy: disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, { backgroundColor: color, opacity: disabled ? 0.5 : 1 }]}
      testID={testID}
    >
      <ThemedText type="smallBold" style={[styles.buttonLabel, { color: textColor }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safeArea: { flex: 1 },
  content: {
    padding: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.three,
    maxWidth: 700,
    width: '100%',
    alignSelf: 'center',
  },
  title: { fontSize: 32, lineHeight: 40, fontWeight: '700' },
  status: { fontSize: 32, lineHeight: 40, fontWeight: '700' },
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.three },
  detail: { gap: Spacing.half },
  button: { borderRadius: 12, paddingVertical: Spacing.three, paddingHorizontal: Spacing.three, alignItems: 'center' },
  buttonLabel: { textAlign: 'center' },
  textButton: { paddingVertical: Spacing.two, alignItems: 'center' },
});
