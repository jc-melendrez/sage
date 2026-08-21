import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { getCoursePath } from '@/services/courseService';
import { CoursePathTopic, NODE_TYPE_CONFIG, LearningNode } from '@/types/learning';
import ProgressRing from '@/components/courses/ProgressRing';

const COLORS = {
  bg: '#baaeda',
  surface: '#cdc2dd',
  purpleDeep: '#4C1D95',
  purpleDark: '#6D28D9',
  purpleVibrant: '#8B5CF6',
  purpleGhost: '#DDD6FE',
  accent: '#22D3EE',
  success: '#10B981',
  warning: '#F59E0B',
  textPrimary: '#3a107a',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  border: 'rgba(44, 29, 0, 0.15)',
};

const FONTS = {
  extraBold: 'Montserrat-ExtraBold',
  bold: 'Montserrat-Bold',
  semiBold: 'Montserrat-SemiBold',
  medium: 'Montserrat-Medium',
};

function getNodeStatus(node: LearningNode, index: number, allNodes: LearningNode[]): 'completed' | 'current' | 'locked' {
  if (node.progress?.passed) return 'completed';
  const allPriorCompleted = allNodes.slice(0, index).every(n => n.progress?.passed);
  if (allPriorCompleted) return 'current';
  return 'locked';
}

export default function CourseDetailScreen() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const router = useRouter();
  const [topics, setTopics] = useState<CoursePathTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTopics();
  }, [courseId]);

  const loadTopics = async () => {
    try {
      setLoading(true);
      const data = await getCoursePath(Number(courseId));
      setTopics(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load course');
    } finally {
      setLoading(false);
    }
  };

  const getTopicProgress = (topic: CoursePathTopic) => {
    const total = topic.nodes.length;
    const done = topic.nodes.filter(n => n.progress?.passed).length;
    return { done, total };
  };

  const getTotalMinutes = (topic: CoursePathTopic) =>
    topic.nodes.reduce((sum, n) => sum + n.estimated_minutes, 0);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.purpleDark} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Ionicons name="cloud-offline-outline" size={40} color={COLORS.textMuted} />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={loadTopics}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={[COLORS.purpleDeep, COLORS.purpleDark]} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="white" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Course Topics</Text>
        <View style={{ width: 32 }} />
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {topics.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="book-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.emptyTitle}>No topics yet</Text>
            <Text style={styles.emptySubtitle}>The educator hasn't added any topics.</Text>
          </View>
        ) : (
          topics.map((topic) => {
            const { done, total } = getTopicProgress(topic);
            const pct = total > 0 ? done / total : 0;
            const minutes = getTotalMinutes(topic);

            return (
              <TouchableOpacity
                key={topic.id}
                style={styles.topicCard}
                activeOpacity={0.8}
                onPress={() => router.push(`/course/topic/${topic.id}?courseId=${courseId}&title=${encodeURIComponent(topic.title)}` as any)}
              >
                <View style={styles.topicTop}>
                  <View style={styles.topicInfo}>
                    <Text style={styles.topicTitle}>{topic.title}</Text>
                    {topic.description ? (
                      <Text style={styles.topicDesc} numberOfLines={2}>{topic.description}</Text>
                    ) : null}
                  </View>
                  <ProgressRing
                    progress={pct}
                    size={52}
                    strokeWidth={5}
                    fillColor={pct >= 1 ? COLORS.success : COLORS.purpleVibrant}
                  />
                </View>

                <View style={styles.topicMeta}>
                  <View style={styles.metaItem}>
                    <Ionicons name="layers-outline" size={14} color={COLORS.textMuted} />
                    <Text style={styles.metaText}>{total} activities</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Ionicons name="time-outline" size={14} color={COLORS.textMuted} />
                    <Text style={styles.metaText}>~{minutes} min</Text>
                  </View>
                  {done > 0 && (
                    <View style={styles.metaItem}>
                      <Ionicons name="checkmark-circle" size={14} color={COLORS.success} />
                      <Text style={[styles.metaText, { color: COLORS.success }]}>{done}/{total} done</Text>
                    </View>
                  )}
                </View>

                <View style={styles.nodeRow}>
                  {topic.nodes.map((node, i) => {
                    const status = getNodeStatus(node, i, topic.nodes);
                    const cfg = NODE_TYPE_CONFIG[node.node_type];
                    return (
                      <View key={node.id} style={styles.nodeDotWrap}>
                        <View style={[
                          styles.nodeDot,
                          { backgroundColor: status === 'completed' ? COLORS.success : status === 'current' ? cfg.color : 'transparent' },
                          status === 'current' && styles.nodeDotCurrent,
                          { borderColor: status === 'locked' ? COLORS.textMuted : cfg.color },
                        ]}>
                          {status === 'completed' && <Ionicons name="checkmark" size={10} color="white" />}
                          {status === 'current' && <View style={styles.nodeDotInner} />}
                        </View>
                        {i < topic.nodes.length - 1 && <View style={[styles.nodeLine, { backgroundColor: status === 'completed' ? COLORS.success : COLORS.textMuted + '40' }]} />}
                      </View>
                    );
                  })}
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center', gap: 12 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 48,
    paddingBottom: 18,
    paddingHorizontal: 16,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  backBtn: { padding: 6, width: 36, alignItems: 'center' },
  headerTitle: { color: 'white', fontSize: 17, fontFamily: FONTS.extraBold, fontWeight: '800' },
  content: { padding: 20, paddingBottom: 40, gap: 16 },
  emptyState: { alignItems: 'center', paddingVertical: 80, gap: 10 },
  emptyTitle: { fontSize: 17, fontFamily: FONTS.bold, color: COLORS.textPrimary },
  emptySubtitle: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textMuted, textAlign: 'center' },
  errorText: { fontSize: 14, fontFamily: FONTS.medium, color: COLORS.textMuted, textAlign: 'center' },
  retryBtn: { backgroundColor: COLORS.purpleDark, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, marginTop: 8 },
  retryText: { color: 'white', fontFamily: FONTS.semiBold, fontSize: 13 },
  topicCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  topicTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  topicInfo: { flex: 1 },
  topicTitle: { fontSize: 16, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  topicDesc: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.textMuted, marginTop: 4, lineHeight: 18 },
  topicMeta: { flexDirection: 'row', gap: 16, marginTop: 14 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 11, fontFamily: FONTS.medium, color: COLORS.textMuted },
  nodeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, paddingHorizontal: 4 },
  nodeDotWrap: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  nodeDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeDotCurrent: { shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 6, elevation: 4 },
  nodeDotInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'white' },
  nodeLine: { flex: 1, height: 2, marginHorizontal: 2 },
});
