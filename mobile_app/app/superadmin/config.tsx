import { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Switch, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AdminHeader from '@/components/admin/AdminHeader';
import { COLORS, FONTS } from '@/constants/adminTheme';

interface FeatureFlag {
  key: string;
  label: string;
  desc: string;
  enabled: boolean;
  beta?: boolean;
}

const INITIAL_FLAGS: FeatureFlag[] = [
  { key: 'ai_assistant', label: 'AI Assistant', desc: 'Chat-based study helper for students', enabled: true },
  { key: 'leaderboard', label: 'Leaderboard', desc: 'Global XP & points ranking', enabled: true },
  { key: 'study_groups', label: 'Study Groups', desc: 'Multiplayer group chat & sessions', enabled: true },
  { key: 'offline_mode', label: 'Offline Mode', desc: 'Local queueing when connection drops', enabled: true },
  { key: 'quiz_engine_v2', label: 'New Quiz Engine', desc: 'Adaptive difficulty scoring model', enabled: false, beta: true },
  { key: 'game_lobby', label: 'Live Game Lobby', desc: 'Real-time multiplayer quiz battles', enabled: true },
];

export default function SuperAdminConfig() {
  const [flags, setFlags] = useState(INITIAL_FLAGS);
  const [maintenanceMode, setMaintenanceMode] = useState(false);

  const toggleFlag = (key: string) => {
    setFlags((prev) => prev.map((f) => (f.key === key ? { ...f, enabled: !f.enabled } : f)));
  };

  return (
    <View style={styles.container}>
      <AdminHeader title="Feature Flags & Config" subtitle="Applies instantly to all clients" variant="superadmin" />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.warningCard}>
          <Ionicons name="alert-circle-outline" size={18} color={COLORS.warning} />
          <Text style={styles.warningText}>Changes here affect the app for every user immediately.</Text>
        </View>

        <Text style={styles.sectionTitle}>Feature Flags</Text>
        <View style={styles.card}>
          {flags.map((flag, i) => (
            <View key={flag.key} style={[styles.row, i !== 0 && styles.borderTop]}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>{flag.label}</Text>
                  {flag.beta && (
                    <View style={styles.betaPill}>
                      <Text style={styles.betaText}>BETA</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.desc}>{flag.desc}</Text>
              </View>
              <Switch
                value={flag.enabled}
                onValueChange={() => toggleFlag(flag.key)}
                trackColor={{ false: '#334155', true: 'rgba(34,211,238,0.5)' }}
                thumbColor={flag.enabled ? COLORS.superAdminGlow : '#94A3B8'}
              />
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>App Configuration</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.label}>Maintenance Mode</Text>
              <Text style={styles.desc}>Blocks student/teacher logins with a maintenance screen</Text>
            </View>
            <Switch
              value={maintenanceMode}
              onValueChange={setMaintenanceMode}
              trackColor={{ false: '#334155', true: 'rgba(239,68,68,0.5)' }}
              thumbColor={maintenanceMode ? COLORS.danger : '#94A3B8'}
            />
          </View>
          <View style={[styles.row, styles.borderTop]}>
            <Text style={styles.configKey}>API Base URL</Text>
            <Text style={styles.configValue}>api.sage-learning.app</Text>
          </View>
          <View style={[styles.row, styles.borderTop]}>
            <Text style={styles.configKey}>App Version</Text>
            <Text style={styles.configValue}>1.0.0 (build 42)</Text>
          </View>
          <View style={[styles.row, styles.borderTop]}>
            <Text style={styles.configKey}>Environment</Text>
            <View style={styles.envPill}>
              <Text style={styles.envPillText}>Production</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={styles.saveBtn}
          onPress={() => Alert.alert('Saved', 'Configuration changes have been applied.')}
        >
          <Ionicons name="save-outline" size={16} color="#0B1020" />
          <Text style={styles.saveBtnText}>Save Changes</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B1020' },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  warningCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(245,158,11,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.3)',
    borderRadius: 14,
    padding: 12,
    marginBottom: 22,
  },
  warningText: { flex: 1, fontSize: 12, fontFamily: FONTS.medium, color: '#FCD34D' },
  sectionTitle: { fontSize: 15, fontFamily: FONTS.extraBold, fontWeight: '800', color: '#E2E8F0', marginBottom: 12 },
  card: { backgroundColor: '#151B2E', borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(34,211,238,0.15)', marginBottom: 26 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  borderTop: { borderTopWidth: 1, borderTopColor: 'rgba(148,163,184,0.12)' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700', color: '#F1F5F9' },
  desc: { fontSize: 11, fontFamily: FONTS.medium, color: '#94A3B8', marginTop: 3 },
  betaPill: { backgroundColor: 'rgba(167,139,250,0.15)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  betaText: { fontSize: 9, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.purpleLight },
  configKey: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: '#CBD5E1' },
  configValue: { fontSize: 13, fontFamily: FONTS.medium, color: '#94A3B8' },
  envPill: { backgroundColor: 'rgba(16,185,129,0.15)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  envPillText: { fontSize: 11, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.success },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.superAdminGlow,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 4,
  },
  saveBtnText: { color: '#0B1020', fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700' },
});
