import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Badge {
  id: number;
  icon: string;
  name: string;
  earned_at: string;
  course?: number;
  course_name?: string;
}

interface CourseBadgesProps {
  badges: Badge[];
  loading?: boolean;
}

export default function CourseBadges({ badges, loading }: CourseBadgesProps) {
  if (loading) return null;
  if (badges.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="ribbon-outline" size={18} color="#4C1D95" />
        <Text style={styles.title}>Course Achievements</Text>
      </View>
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false} 
        contentContainerStyle={styles.list}
      >
        {badges.map((badge) => (
          <View key={badge.id} style={styles.badgeCard}>
            <Text style={styles.badgeIcon}>{badge.icon}</Text>
            <Text style={styles.badgeName} numberOfLines={1}>{badge.name}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    borderRadius: 16,
    paddingVertical: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#3a107a',
  },
  list: {
    paddingHorizontal: 12,
    gap: 10,
  },
  badgeCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    width: 90,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  badgeIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  badgeName: {
    fontSize: 10,
    fontWeight: '600',
    color: '#4b5563',
    textAlign: 'center',
  },
});
