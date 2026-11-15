import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { type AppTheme, useTheme } from '@/theme';

import { AppButton } from './app-button';
import { EditSheet } from './edit-sheet';

export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseLocalDate(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

export function dateSummary(value: string): string {
  return value ? parseLocalDate(value).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : 'Not set';
}

export function relativeDate(value: string, now = new Date()): string {
  if (!value) return '';
  const date = parseLocalDate(value);
  const days = Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (days < 0) return `Expired ${-days} ${days === -1 ? 'day' : 'days'} ago`;
  return days === 0 ? 'Today' : `in ${days} ${days === 1 ? 'day' : 'days'}`;
}

export function DateChoices({ value, onSelect, disabled = false, now = new Date(), testID = 'date' }: {
  value: string; onSelect: (value: string) => void; disabled?: boolean; now?: Date; testID?: string;
}) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const [month, setMonth] = useState(() => {
    const initial = value ? parseLocalDate(value) : now;
    return new Date(initial.getFullYear(), initial.getMonth(), 1, 12);
  });
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const slots = Array.from({ length: Math.ceil((month.getDay() + days) / 7) * 7 }, (_, index) => {
    const day = index - month.getDay() + 1;
    return day > 0 && day <= days ? new Date(month.getFullYear(), month.getMonth(), day, 12) : null;
  });
  return <View style={styles.section}>
    <View style={styles.quick}>
      {([['Today', 0], ['Tomorrow', 1], ['+3 days', 3], ['+1 week', 7], ['+2 weeks', 14]] as const).map(([label, offset]) =>
        <AppButton key={label} label={label} variant="outline" disabled={disabled} testID={`${testID}.quick.${offset}`}
          onPress={() => { const date = new Date(now); date.setDate(date.getDate() + offset); onSelect(localDate(date)); }} />)}
    </View>
    <View style={styles.navigation}>
      <AppButton label="‹" accessibilityLabel="Previous month" variant="outline" disabled={disabled} testID={`${testID}.previous`}
        onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1, 12))} />
      <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.month} testID={`${testID}.month`}>
        {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
      </Text>
      <AppButton label="›" accessibilityLabel="Next month" variant="outline" disabled={disabled} testID={`${testID}.next`}
        onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1, 12))} />
    </View>
    <ScrollView horizontal contentContainerStyle={styles.calendarScroll}>
      <View style={styles.calendar}>
        <View style={styles.week}>
          {Array.from({ length: 7 }, (_, day) => <Text key={day} style={styles.weekday}>
            {new Date(2026, 10, 15 + day).toLocaleDateString(undefined, { weekday: 'short' })}
          </Text>)}
        </View>
        {Array.from({ length: slots.length / 7 }, (_, week) => <View key={week} style={styles.week}>
          {slots.slice(week * 7, week * 7 + 7).map((date, day) => {
            if (!date) return <View key={day} style={styles.day} />;
            const key = localDate(date);
            const selected = key === value;
            const today = key === localDate(now);
            return <Pressable key={day} accessibilityRole="button" disabled={disabled}
              accessibilityState={{ selected, disabled }} accessibilityHint={today ? 'Today' : undefined}
              accessibilityLabel={date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              testID={`${testID}.day.${key}`} onPress={() => onSelect(key)}
              style={[styles.day, today && styles.today, selected && styles.selected]}>
              <Text style={[styles.dayText, selected && styles.selectedText]}>{date.getDate()}{selected ? ' ✓' : ''}</Text>
            </Pressable>;
          })}
        </View>)}
      </View>
    </ScrollView>
  </View>;
}

export function DateSheet({ onClose, ...props }: Parameters<typeof DateChoices>[0] & { onClose: () => void }) {
  return <EditSheet title="Use by" testID="date.sheet" onClose={onClose} pending={props.disabled}>
    <DateChoices {...props} />
  </EditSheet>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    section: { gap: theme.spacing.md }, quick: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
    navigation: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
    month: { ...theme.type.cardHeading, color: theme.colors.ink, flex: 1, textAlign: 'center' },
    calendarScroll: { flexGrow: 1 }, calendar: { flex: 1, minWidth: theme.sizes.touchTarget * 7 },
    week: { flexDirection: 'row' }, weekday: { ...theme.type.meta, color: theme.colors.muted, flex: 1, textAlign: 'center' },
    day: { flex: 1, minWidth: theme.sizes.touchTarget, minHeight: theme.sizes.touchTarget, alignItems: 'center', justifyContent: 'center',
      borderRadius: theme.radii.chip, borderWidth: theme.sizes.focusRing, borderColor: theme.colors.ground, paddingVertical: theme.spacing.sm },
    dayText: { ...theme.type.body, color: theme.colors.ink, textAlign: 'center' },
    today: { borderColor: theme.colors.forest }, selected: { backgroundColor: theme.colors.forest },
    selectedText: { color: theme.colors.onForest },
  });
}
