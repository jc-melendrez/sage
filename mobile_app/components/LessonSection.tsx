import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants/theme';

interface LessonSectionProps {
  section: {
    title: string;
    content: string;
    key_concepts: string[];
  };
}

export default function LessonSection({ section }: LessonSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <View style={styles.sectionContainer}>
      <TouchableOpacity 
        style={styles.sectionHeader} 
        onPress={() => setIsExpanded(!isExpanded)}
        activeOpacity={0.7}
      >
        <Text style={styles.sectionTitle}>{section.title}</Text>
        <Ionicons 
          name={isExpanded ? "chevron-down" : "chevron-forward"} 
          size={20} 
          color={colors.primary} 
        />
      </TouchableOpacity>

      {isExpanded && (
        <View style={styles.sectionContent}>
          <Text style={styles.contentText}>{section.content}</Text>
          
          {section.key_concepts.length > 0 && (
            <View style={styles.conceptsContainer}>
              <Text style={styles.conceptsTitle}>Key Concepts:</Text>
              <View style={styles.conceptsList}>
                {section.key_concepts.map((concept, index) => (
                  <View key={index} style={styles.conceptTag}>
                    <Text style={styles.conceptText}>{concept}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionContainer: {
    backgroundColor: 'white',
    borderRadius: 16,
    marginBottom: 16,
    elevation: 3,
    shadowColor: '#111',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    fontFamily: 'sans-serif',
  },
  sectionContent: {
    padding: 16,
  },
  contentText: {
    fontSize: 14,
    color: '#4B5563',
    lineHeight: 20,
    fontFamily: 'sans-serif',
    marginBottom: 12,
  },
  conceptsContainer: {
    marginTop: 12,
  },
  conceptsTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6D28D9',
    marginBottom: 8,
    fontFamily: 'sans-serif',
  },
  conceptsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  conceptTag: {
    backgroundColor: '#F3E8FF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E9D5FF',
  },
  conceptText: {
    fontSize: 12,
    color: '#6D28D9',
    fontWeight: '500',
    fontFamily: 'sans-serif',
  },
});