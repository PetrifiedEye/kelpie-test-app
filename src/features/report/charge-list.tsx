import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { ImportReport } from '@/features/operation/operation-machine';

import { presentReport } from './present-report';

export function ChargeList({ report }: { report: ImportReport }) {
  const presented = presentReport(report);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <View style={styles.list} testID="charge-list">
      <View style={styles.total}>
        <ThemedText type="small" themeColor="textSecondary">Monthly total</ThemedText>
        <ThemedText accessibilityRole="text" testID="monthly-total" style={styles.totalValue}>
          {presented.totalLabel}
        </ThemedText>
      </View>
      {presented.charges.map((charge) => {
        const open = openId === charge.id;
        return (
          <View key={charge.id} style={styles.charge} testID={`charge-${charge.id}`}>
            <View style={styles.chargeRow}>
              <ThemedText style={styles.merchant}>{charge.merchant}</ThemedText>
              <ThemedText testID={`charge-amount-${charge.id}`}>{charge.amountLabel}</ThemedText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Подробнее, ${charge.merchant}`}
              accessibilityState={{ expanded: open }}
              onPress={() => setOpenId(open ? null : charge.id)}
              style={styles.detailsButton}
              testID={`charge-details-${charge.id}`}
            >
              <ThemedText type="smallBold">Подробнее</ThemedText>
            </Pressable>
            {open ? (
              <ThemedView type="backgroundSelected" style={styles.card} testID={`charge-card-${charge.id}`}>
                <Field label="Amount" value={charge.amountLabel} testID={`charge-card-amount-${charge.id}`} />
                <Field label="Cadence" value={charge.cadence} testID={`charge-card-cadence-${charge.id}`} />
                <Field label="Last seen" value={charge.lastSeen} testID={`charge-card-last-seen-${charge.id}`} />
              </ThemedView>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function Field({ label, value, testID }: { label: string; value: string; testID: string }) {
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <ThemedText selectable testID={testID}>{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.three },
  total: { gap: Spacing.half },
  totalValue: { fontSize: 22, lineHeight: 30, fontWeight: '700' },
  charge: { gap: Spacing.two },
  chargeRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: Spacing.two },
  merchant: { flexShrink: 1, fontWeight: '700' },
  detailsButton: { alignSelf: 'flex-start', paddingVertical: Spacing.two, paddingHorizontal: Spacing.one },
  card: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  field: { gap: Spacing.half },
});
