import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_BASE_URL } from '@/config/api';
import { getToken, getCurrentUser } from '@/services/authService';
import LessonScreen from '../../screens/LessonScreen';
import { saveModuleToLocalCache, getLocalModuleData } from '../../utils/offlineStorage';

interface LearningModuleSummary {
  id: number;
  title: string;
  created_at: string;
}

export default function LessonsTab() {
  const [modules, setModules] = useState<LearningModuleSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeModuleId, setActiveModuleId] = useState<number | null>(null);
  const [activeModule, setActiveModule] = useState<any | null>(null);
  const [loadingModule, setLoadingModule] = useState(false);

  useEffect(() => {
    fetchModules();
  }, []);

  const fetchModules = async () => {
    try {
      setLoading(true);
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/lessons/modules/`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setModules(data);
      }
    } catch (error) {
      console.error('Failed to fetch modules:', error);
    } finally {
      setLoading(false);
    }
  };

  const openModule = async (moduleId: number) => {
    try {
      setLoadingModule(true);
      setActiveModuleId(moduleId);
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/lessons/modules/${moduleId}/`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        setActiveModule(data);
        // Cache online data locally for offline use
        saveModuleToLocalCache(data).catch(console.error);
      } else {
        // Offline fallback — load from local SQLite
        const localData = await getLocalModuleData(moduleId);
        if (localData) {
          setActiveModule(localData);
          Alert.alert('Offline Mode', 'Showing locally cached version of this module.');
        } else {
          Alert.alert('Error', 'Could not load this module. Please check your connection.');
          setActiveModuleId(null);
        }
      }
    } catch (error) {
      // Network error — try offline cache
      const localData = await getLocalModuleData(moduleId);
      if (localData) {
        setActiveModule(localData);
        Alert.alert('Offline Mode', 'Showing locally cached version of this module.');
      } else {
        Alert.alert('No Connection', 'This module is not available offline.');
        setActiveModuleId(null);
      }
    } finally {
      setLoadingModule(false);
    }
  };

  const handleBack = () => {
    setActiveModule(null);
    setActiveModuleId(null);
  };

  // --- MODULE LESSON VIEW ---
  if (activeModule) {
    return (
      <View style={{ flex: 1 }}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={22} color="white" />
          <Text style={styles.backButtonText}>All Modules</Text>
        </TouchableOpacity>
        <LessonScreen module={activeModule} />
      </View>
    );
  }

  // --- MODULE LIST VIEW ---
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Lessons</Text>
        <Text style={styles.headerSubtitle}>AI-generated learning modules</Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#6D28D9" style={styles.loader} />
      ) : (
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {loadingModule && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#6D28D9" />
              <Text style={styles.loadingText}>Opening module…</Text>
            </View>
          )}

          {modules.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="book-outline" size={56} color="#D1D5DB" />
              <Text style={styles.emptyTitle}>No Modules Yet</Text>
              <Text style={styles.emptySubtitle}>
                Ask your educator to generate a learning module, or use the AI Assistant to create one.
              </Text>
            </View>
          ) : (
            <View style={styles.moduleList}>
              {modules.map((mod) => (
                <TouchableOpacity
                  key={mod.id}
                  style={styles.moduleCard}
                  onPress={() => openModule(mod.id)}
                  disabled={loadingModule}
                >
                  <View style={styles.moduleIconBox}>
                    <Ionicons name="book" size={24} color="#6D28D9" />
                  </View>
                  <View style={styles.moduleInfo}>
                    <Text style={styles.moduleTitle} numberOfLines={2}>
                      {mod.title}
                    </Text>
                    <Text style={styles.moduleMeta}>
                      3 Parts • AI Generated
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    backgroundColor: '#6D28D9',
    paddingTop: 4,
    paddingBottom: 24,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: 'white',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#DDD6FE',
    marginTop: 2,
  },
  loader: {
    marginTop: 60,
  },
  content: {
    flex: 1,
    paddingTop: 8,
  },
  loadingOverlay: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 12,
  },
  loadingText: {
    color: '#6B7280',
    fontSize: 14,
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingTop: 64,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#374151',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 21,
  },
  moduleList: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 12,
  },
  moduleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
  },
  moduleIconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#F3E8FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  moduleInfo: {
    flex: 1,
    marginRight: 8,
  },
  moduleTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  moduleMeta: {
    fontSize: 12,
    color: '#6B7280',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6D28D9',
    paddingTop: 52,
    paddingBottom: 12,
    paddingHorizontal: 16,
    gap: 4,
  },
  backButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 15,
  },
});
