import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppColors, Spacing, Borders, NeoShadow } from '@/constants/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

type StudentEntry = {
  student_id: number | string;
  student_name: string;
  email?: string | null;
  submitted_at?: string | null;
  grade?: number | null;
};

type Props = {
  submitted: StudentEntry[];
  missing: StudentEntry[];
  isLoading: boolean;
  classworkTitle: string;
  totalPoints: number;
  dueDate: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return null;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({
  count,
  label,
  bg,
  borderColor,
  textColor,
}: {
  count: number;
  label: string;
  bg: string;
  borderColor: string;
  textColor: string;
}) {
  return (
    <View style={[sc.card, { backgroundColor: bg, borderColor }]}>
      <Text style={[sc.cardCount, { color: textColor }]}>{count}</Text>
      <Text style={[sc.cardLabel, { color: textColor }]}>{label}</Text>
    </View>
  );
}

const sc = StyleSheet.create({
  card: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderWidth: Borders.width,
    borderRadius: 8,
    gap: 2,
    ...NeoShadow.xs,
  },
  cardCount: { fontSize: 22, fontWeight: '900' },
  cardLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
});

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  label,
  count,
  color,
  expanded,
  onToggle,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  count: number;
  color: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <TouchableOpacity style={[sh.row, { borderColor: color + '55' }]} onPress={onToggle} activeOpacity={0.7}>
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[sh.label, { color }]}>{label}</Text>
      <View style={[sh.badge, { backgroundColor: color + '22', borderColor: color + '55' }]}>
        <Text style={[sh.badgeText, { color }]}>{count}</Text>
      </View>
      <Ionicons
        name={expanded ? 'chevron-up' : 'chevron-down'}
        size={16}
        color={color}
        style={{ marginLeft: 'auto' }}
      />
    </TouchableOpacity>
  );
}

const sh = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: Borders.width,
    borderRadius: 8,
    backgroundColor: AppColors.inputBackground,
  },
  label: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: Borders.width,
  },
  badgeText: { fontSize: 11, fontWeight: '900' },
});

// ─── Student row ──────────────────────────────────────────────────────────────

type RowStatus = 'submitted' | 'missing';

function StudentRow({
  student,
  status,
  totalPoints,
}: {
  student: StudentEntry;
  status: RowStatus;
  totalPoints: number;
}) {
  const statusConfig: Record<
    RowStatus,
    { label: string; bg: string; textColor: string; borderColor: string }
  > = {
    submitted: { label: 'Submitted', bg: '#dcfce7', textColor: '#166534', borderColor: '#166534' },
    missing:   { label: 'Missing',   bg: '#fee2e2', textColor: '#991b1b', borderColor: '#991b1b' },
  };

  const cfg = statusConfig[status];
  const submittedAt = formatDateTime(student.submitted_at);
  const hasGrade = student.grade != null;

  return (
    <View style={sr.row}>
      <View style={sr.avatar}>
        <Text style={sr.avatarText}>
          {(student.student_name ?? '?').charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={sr.info}>
        <Text style={sr.name} numberOfLines={1}>{student.student_name}</Text>
        {status === 'submitted' && submittedAt ? (
          <Text style={sr.meta}>{submittedAt}</Text>
        ) : null}
      </View>
      <View style={sr.right}>
        <View style={[sr.statusBadge, { backgroundColor: cfg.bg, borderColor: cfg.borderColor }]}>
          <Text style={[sr.statusText, { color: cfg.textColor }]}>{cfg.label}</Text>
        </View>
        {status === 'submitted' && hasGrade ? (
          <Text style={sr.grade}>
            {student.grade}/{totalPoints}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const sr = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: AppColors.white,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 8,
    ...NeoShadow.xs,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 999,
    backgroundColor: AppColors.primary,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 16, fontWeight: '900', color: AppColors.primaryForeground },
  info: { flex: 1, gap: 2 },
  name: { fontSize: 14, fontWeight: '700', color: AppColors.foreground },
  meta: { fontSize: 11, color: AppColors.mutedForeground, marginTop: 2 },
  right: { alignItems: 'flex-end', gap: 4 },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: Borders.width,
  },
  statusText: { fontSize: 11, fontWeight: '900' },
  grade: { fontSize: 12, fontWeight: '700', color: AppColors.mutedForeground },
});

// ─── Main component ───────────────────────────────────────────────────────────

export default function SubmissionMonitor({
  submitted,
  missing,
  isLoading,
  totalPoints,
  dueDate,
}: Props) {
  const [showSubmitted, setShowSubmitted] = useState(true);
  const [showMissing, setShowMissing]     = useState(true);

  const isPastDue = dueDate ? new Date() > new Date(dueDate) : false;
  const total = submitted.length + missing.length;

  if (isLoading) {
    return (
      <View style={m.loadingWrap}>
        <ActivityIndicator size="small" color={AppColors.primary} />
        <Text style={m.loadingText}>Loading submissions…</Text>
      </View>
    );
  }

  return (
    <View style={m.root}>
      {/* ── Summary cards ── */}
      <View style={m.summaryRow}>
        <SummaryCard
          count={submitted.length}
          label="Submitted"
          bg="#dcfce7"
          borderColor="#166534"
          textColor="#166534"
        />
        <SummaryCard
          count={missing.length}
          label="Missing"
          bg="#fee2e2"
          borderColor="#991b1b"
          textColor="#991b1b"
        />
        <SummaryCard
          count={total}
          label="Total"
          bg={AppColors.inputBackground}
          borderColor={AppColors.border}
          textColor={AppColors.foreground}
        />
      </View>

      {/* ── Due date note ── */}
      {dueDate ? (
        <View style={[m.dueNote, isPastDue ? m.dueNotePast : m.dueNoteFuture]}>
          <Ionicons
            name={isPastDue ? 'alert-circle-outline' : 'time-outline'}
            size={14}
            color={isPastDue ? '#991b1b' : '#166534'}
          />
          <Text style={[m.dueNoteText, isPastDue ? m.dueNoteTextPast : m.dueNoteTextFuture]}>
            {isPastDue
              ? `Due date passed (${formatDate(dueDate)}) — students who haven't submitted are marked Missing.`
              : `Due date: ${formatDate(dueDate)} — students won't be marked Missing until after the due date.`}
          </Text>
        </View>
      ) : (
        <View style={m.dueNote}>
          <Ionicons name="information-circle-outline" size={14} color={AppColors.mutedForeground} />
          <Text style={m.dueNoteTextNeutral}>No due date set — students won't be marked Missing.</Text>
        </View>
      )}

      {/* ── Submitted section ── */}
      {submitted.length > 0 ? (
        <View style={m.section}>
          <SectionHeader
            icon="checkmark-circle-outline"
            label="Submitted"
            count={submitted.length}
            color="#166534"
            expanded={showSubmitted}
            onToggle={() => setShowSubmitted((v) => !v)}
          />
          {showSubmitted && (
            <View style={m.list}>
              {submitted.map((s) => (
                <StudentRow
                  key={s.student_id}
                  student={s}
                  status="submitted"
                  totalPoints={totalPoints}
                />
              ))}
            </View>
          )}
        </View>
      ) : null}

      {/* ── Missing section ── */}
      {missing.length > 0 ? (
        <View style={m.section}>
          <SectionHeader
            icon="close-circle-outline"
            label="Missing"
            count={missing.length}
            color="#991b1b"
            expanded={showMissing}
            onToggle={() => setShowMissing((v) => !v)}
          />
          {showMissing && (
            <View style={m.list}>
              {missing.map((s) => (
                <StudentRow
                  key={s.student_id}
                  student={s}
                  status="missing"
                  totalPoints={totalPoints}
                />
              ))}
            </View>
          )}
        </View>
      ) : null}

      {/* ── All caught up ── */}
      {total === 0 && (
        <View style={m.emptyWrap}>
          <Ionicons name="people-outline" size={32} color={AppColors.mutedForeground} />
          <Text style={m.emptyText}>No students submitting yet.</Text>
        </View>
      )}
    </View>
  );
}

const m = StyleSheet.create({
  root: { gap: Spacing.sm },
  loadingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 20,
    justifyContent: 'center',
  },
  loadingText: { fontSize: 13, color: AppColors.mutedForeground, fontWeight: '600' },
  summaryRow: { flexDirection: 'row', gap: 8 },
  dueNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    padding: 10,
    borderWidth: Borders.width,
    borderRadius: 8,
    borderColor: AppColors.border,
    backgroundColor: AppColors.inputBackground,
  },
  dueNoteFuture: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
  dueNotePast:   { backgroundColor: '#fef2f2', borderColor: '#fecaca' },
  dueNoteText: { flex: 1, fontSize: 12, fontWeight: '600', lineHeight: 17 },
  dueNoteTextFuture: { color: '#166534' },
  dueNoteTextPast:   { color: '#991b1b' },
  dueNoteTextNeutral: { flex: 1, fontSize: 12, fontWeight: '600', lineHeight: 17, color: AppColors.mutedForeground },
  section: { gap: 8 },
  list: { gap: 8 },
  emptyWrap: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  emptyText: { fontSize: 14, color: AppColors.mutedForeground, fontWeight: '600' },
});