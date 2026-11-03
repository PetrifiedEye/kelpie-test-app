import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { MOCK_API_URL } from '@/config/api';
import {
  DIAGNOSTIC_SCENARIOS,
  readScenarioStatus,
  resetMockState,
  setScenario,
  type DiagnosticScenario,
  type ScenarioStatus,
} from '@/features/diagnostics/scenario-client';
import { safeLog } from '@/features/privacy/safe-log';
import { createActionGate } from '@/features/ui/action-gate';
import { useTheme } from '@/hooks/use-theme';

export default function DiagnosticsScreen() {
  const theme = useTheme();
  const gate = useRef(createActionGate());
  const [status, setStatus] = useState<ScenarioStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (work: () => Promise<void>) => {
    await gate.current.run(async () => {
      setBusy(true);
      setError(null);
      try {
        await work();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'The mock diagnostics request failed.');
      } finally {
        setBusy(false);
      }
    });
  }, []);

  const refresh = useCallback(async () => {
    await run(async () => {
      setStatus(await readScenarioStatus(MOCK_API_URL));
    });
  }, [run]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const select = useCallback(
    (mode: DiagnosticScenario) => {
      void run(async () => {
        safeLog('scenario', { scenario: mode });
        await setScenario(MOCK_API_URL, mode);
        setStatus(await readScenarioStatus(MOCK_API_URL));
      });
    },
    [run],
  );

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to the statement"
            onPress={() => router.back()}
            style={styles.textButton}
          >
            <ThemedText type="link">Back</ThemedText>
          </Pressable>
          <ThemedText accessibilityRole="header" style={styles.title}>Diagnostics</ThemedText>
          <ThemedText themeColor="textSecondary">
            Switches the local mock scenario. App source stays the same between runs.
          </ThemedText>

          <ThemedView type="backgroundElement" style={styles.card} testID="diagnostics-status">
            <ThemedText type="smallBold">MOCK</ThemedText>
            {status ? (
              <View style={styles.counters}>
                <Counter label="Scenario" value={status.mode} testID="diagnostics-mode" />
                <Counter label="createRequests" value={String(status.createRequests)} testID="diagnostics-create-requests" />
                <Counter label="newJobs" value={String(status.newJobs)} testID="diagnostics-new-jobs" />
                <Counter label="duplicateHits" value={String(status.duplicateHits)} testID="diagnostics-duplicate-hits" />
                <Counter label="deleteRequests" value={String(status.deleteRequests)} testID="diagnostics-delete-requests" />
              </View>
            ) : (
              <ThemedText themeColor="textSecondary" testID="diagnostics-empty">
                Counters appear after a refresh. File names and statement contents are not shown.
              </ThemedText>
            )}
            {error ? <ThemedText testID="diagnostics-error">{error}</ThemedText> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh mock counters"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => void refresh()}
              style={[styles.button, { backgroundColor: theme.text, opacity: busy ? 0.5 : 1 }]}
              testID="diagnostics-refresh"
            >
              <ThemedText type="smallBold" style={{ color: theme.background, textAlign: 'center' }}>
                {busy ? 'Working…' : 'Refresh counters'}
              </ThemedText>
            </Pressable>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">SCENARIO</ThemedText>
            {DIAGNOSTIC_SCENARIOS.map((mode) => {
              const selected = status?.mode === mode;
              return (
                <Pressable
                  key={mode}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${mode} scenario`}
                  accessibilityState={{ disabled: busy, selected }}
                  disabled={busy}
                  onPress={() => select(mode)}
                  style={[styles.button, { backgroundColor: selected ? theme.text : theme.backgroundSelected, opacity: busy ? 0.5 : 1 }]}
                  testID={`diagnostics-scenario-${mode}`}
                >
                  <ThemedText type="smallBold" style={{ color: selected ? theme.background : theme.text, textAlign: 'center' }}>
                    {mode}
                  </ThemedText>
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reset mock counters"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => {
                void run(async () => {
                  safeLog('scenario', { scenario: 'reset' });
                  await resetMockState(MOCK_API_URL);
                  setStatus(await readScenarioStatus(MOCK_API_URL));
                });
              }}
              style={styles.textButton}
              testID="diagnostics-reset"
            >
              <ThemedText type="smallBold">Reset mock counters</ThemedText>
            </Pressable>
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Counter({ label, value, testID }: { label: string; value: string; testID: string }) {
  return (
    <View style={styles.counter}>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <ThemedText selectable testID={testID}>{value}</ThemedText>
    </View>
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
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.three },
  counters: { gap: Spacing.two },
  counter: { gap: Spacing.half },
  button: { borderRadius: 12, paddingVertical: Spacing.three, paddingHorizontal: Spacing.three, alignItems: 'center' },
  textButton: { paddingVertical: Spacing.two, alignItems: 'center' },
});
