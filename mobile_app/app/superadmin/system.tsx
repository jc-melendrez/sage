import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AdminHeader from '@/components/admin/AdminHeader';
import { COLORS, FONTS } from '@/constants/adminTheme';

interface ServiceStatus {
  name: string;
  status: 'operational' | 'degraded' | 'down';
  uptime: string;
}

const SERVICES: ServiceStatus[] = [
  { name: 'Django REST API', status: 'operational', uptime: '99.98%' },
  { name: 'PostgreSQL Database', status: 'operational', uptime: '99.99%' },
  { name: 'Firebase Auth', status: 'operational', uptime: '100%' },
  { name: 'Cloud Firestore', status: 'degraded', uptime: '98.4%' },
  { name: 'Media Storage', status: 'operational', uptime: '99.95%' },
];

interface LogEntry {
  id: number;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  time: string;
}

const LOGS: LogEntry[] = [
  { id: 1, level: 'INFO', message: 'Scheduled backup completed successfully', time: '2m ago' },
  { id: 2, level: 'WARN', message: 'Firestore latency spike detected (avg 820ms)', time: '18m ago' },
  { id: 3, level: 'INFO', message: 'New deploy: build 42 pushed to production', time: '1h ago' },
  { id: 4, level: 'ERROR', message: 'Quiz submission timeout for session #8213', time: '3h ago' },
  { id: 5, level: 'INFO', message: 'Auto-scaling: added 1 API instance', time: '5h ago' },
  { id: 6, level: 'WARN', message: 'Rate limit reached for AI Assistant endpoint', time: '7h ago' },
];

const STATUS_META: Record<ServiceStatus['status'], { color: string; label: string }> = {
  operational: { color: COLORS.success, label: 'Operational' },
  degraded: { color: COLORS.warning, label: 'Degraded' },
  down: { color: COLORS.danger, label: 'Down' },
};

const LEVEL_COLORS: Record<LogEntry['level'], string> = {
  INFO: COLORS.info,
  WARN: COLORS.warning,
  ERROR: COLORS.danger,
};

export default function SuperAdminSystem() {
  const allOperational = SERVICES.every((s) => s.status === 'operational');

  return (
    <View style={styles.container}>
      <AdminHeader title="System Health & Logs" subtitle="Live infrastructure status" variant="superadmin" />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={[styles.bannerCard, { borderColor: allOperational ? 'rgba(16,185,129,0.35)' : 'rgba(245,158,11,0.35)' }]}>
          <Ionicons
            name={allOperational ? 'checkmark-circle' : 'alert-circle'}
            size={22}
            color={allOperational ? COLORS.success : COLORS.warning}
          />
          <Text style={styles.bannerText}>
            {allOperational ? 'All systems operational' : '1 service is experiencing degraded performance'}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Service Status</Text>
        <View style={styles.card}>
          {SERVICES.map((s, i) => (
            <View key={s.name} style={[styles.serviceRow, i !== 0 && styles.borderTop]}>
              <View style={[styles.dot, { backgroundColor: STATUS_META[s.status].color }]} />
              <Text style={styles.serviceName}>{s.name}</Text>
              <View style={{ flex: 1 }} />
              <Text style={styles.uptimeText}>{s.uptime}</Text>
              <Text style={[styles.statusText, { color: STATUS_META[s.status].color }]}>{STATUS_META[s.status].label}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Recent Logs</Text>
        <View style={styles.card}>
          {LOGS.map((log, i) => (
            <View key={log.id} style={[styles.logRow, i !== 0 && styles.borderTop]}>
              <View style={[styles.levelPill, { backgroundColor: `${LEVEL_COLORS[log.level]}22` }]}>
                <Text style={[styles.levelText, { color: LEVEL_COLORS[log.level] }]}>{log.level}</Text>
              </View>
              <Text style={styles.logMessage}>{log.message}</Text>
              <Text style={styles.logTime}>{log.time}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B1020' },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  bannerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#151B2E',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    marginBottom: 22,
  },
  bannerText: { flex: 1, fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: '#E2E8F0' },
  sectionTitle: { fontSize: 15, fontFamily: FONTS.extraBold, fontWeight: '800', color: '#E2E8F0', marginBottom: 12 },
  card: { backgroundColor: '#151B2E', borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(34,211,238,0.15)', marginBottom: 26 },
  serviceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  borderTop: { borderTopWidth: 1, borderTopColor: 'rgba(148,163,184,0.12)' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  serviceName: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: '#F1F5F9' },
  uptimeText: { fontSize: 12, fontFamily: FONTS.medium, color: '#94A3B8', marginRight: 10 },
  statusText: { fontSize: 12, fontFamily: FONTS.bold, fontWeight: '700' },
  logRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14 },
  levelPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginTop: 1 },
  levelText: { fontSize: 10, fontFamily: FONTS.bold, fontWeight: '700' },
  logMessage: { flex: 1, fontSize: 12, fontFamily: FONTS.medium, color: '#CBD5E1', lineHeight: 17 },
  logTime: { fontSize: 11, fontFamily: FONTS.medium, color: '#64748B' },
});
