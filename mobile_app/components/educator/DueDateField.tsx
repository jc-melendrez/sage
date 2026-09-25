import React, { useState } from 'react';
import { Platform, Text, TouchableOpacity, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { FilterChip } from './EducatorPrimitives';
import { formatDueShort } from '@/services/dueDate';

interface DueDateFieldProps {
  value: Date | null;
  onChange: (next: Date | null) => void;
  label?: string;
}

/** End of the current day — "Today" means due tonight, not right now. */
function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return d;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function atEndOfDay(base: Date): Date {
  const d = new Date(base);
  d.setHours(23, 59, 0, 0);
  return d;
}

/**
 * Deadline picker for an assignment: quick presets plus an exact date and
 * time. Android steps through two native dialogs (date, then time) because a
 * dialog can only show one mode; iOS shows a date and a time spinner together.
 */
export function DueDateField({ value, onChange, label = 'Due date & time' }: DueDateFieldProps) {
  const [open, setOpen] = useState(false);
  // The in-progress selection, so the date and time halves can be merged while
  // the picker is open.
  const [draft, setDraft] = useState<Date>(new Date());

  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

  const isSame = (candidate: Date) => (value ? sameDay(candidate, value) : false);

  // An assignment that is already overdue must keep showing its real date
  // instead of being clamped forward to today.
  const minDate = value && value.getTime() < today.getTime() ? new Date(value) : today;

  const openCustom = () => {
    setDraft(value ?? endOfToday());
    setOpen(true);
  };

  const handle = (
    event: DateTimePickerEvent,
    picked: Date | undefined,
    part: 'date' | 'time',
  ) => {
    // Android fires `dismissed` as the user closes the dialog.
    if (event.type === 'dismissed') {
      setOpen(false);
      return;
    }
    if (!picked) return;

    const merged = new Date(draft);
    if (part === 'date') {
      merged.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
    } else {
      merged.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
    }
    setDraft(merged);
    onChange(merged);

    if (Platform.OS === 'android') setOpen(part === 'date');
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>

      <View style={styles.chipRow}>
        <FilterChip label="None" active={!value} onPress={() => onChange(null)} />
        <FilterChip
          label="Today"
          active={isSame(today)}
          onPress={() => onChange(endOfToday())}
        />
        <FilterChip
          label="Tomorrow"
          active={isSame(tomorrow)}
          onPress={() => onChange(atEndOfDay(tomorrow))}
        />
        <FilterChip
          label="Next week"
          active={isSame(nextWeek)}
          onPress={() => onChange(atEndOfDay(nextWeek))}
        />
      </View>

      <View style={styles.customRow}>
        <TouchableOpacity style={styles.customBtn} activeOpacity={0.85} onPress={openCustom}>
          <Ionicons name="calendar-outline" size={17} color={COLORS.purpleVibrant} />
          <Text style={styles.customBtnText}>
            {value ? formatDueShort(value.toISOString()) : 'Pick date & time'}
          </Text>
        </TouchableOpacity>
        {value && (
          <TouchableOpacity
            style={styles.clearBtn}
            activeOpacity={0.85}
            onPress={() => onChange(null)}
          >
            <Ionicons name="close" size={16} color={COLORS.danger} />
          </TouchableOpacity>
        )}
      </View>

      {value && (
        <Text style={styles.hint}>
          Students see this deadline in their own timezone.
        </Text>
      )}

      {open && (
        <View>
          <DateTimePicker
            value={draft}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            minimumDate={minDate}
            onChange={(event, picked) => handle(event, picked, 'date')}
          />
          {Platform.OS === 'ios' && (
            <DateTimePicker
              value={draft}
              mode="time"
              display="spinner"
              onChange={(event, picked) => handle(event, picked, 'time')}
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = {
  wrap: { gap: 10 },
  label: {
    fontSize: 12,
    fontFamily: FONTS.bold,
    color: COLORS.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  customRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  customBtn: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: tint(COLORS.purpleVibrant, 0.08),
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  customBtnText: {
    flex: 1,
    fontSize: 13,
    fontFamily: FONTS.semiBold,
    color: COLORS.textPrimary,
  },
  clearBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: tint(COLORS.danger, 0.12),
  },
  hint: {
    fontSize: 11,
    fontFamily: FONTS.regular,
    color: COLORS.textMuted,
  },
};
