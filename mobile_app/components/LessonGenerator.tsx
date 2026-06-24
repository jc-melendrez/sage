import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as DocumentPicker from 'expo-document-picker';
import { API_BASE_URL } from '@/config/api';
import { getToken } from '@/services/authService';
import { colors } from '@/constants/theme';

interface LessonGeneratorProps {
  onLessonGenerated: (lesson: any) => void;
  onCancel: () => void;
}

export default function LessonGenerator({ onLessonGenerated, onCancel }: LessonGeneratorProps) {
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'topic' | 'document'>('topic');

  const handleGenerateLesson = async () => {
    if (!topic.trim()) {
      Alert.alert('Error', 'Please enter a topic for the lesson');
      return;
    }

    setLoading(true);
    try {
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/users/lessons/generate/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ topic }),
      });

      if (response.ok) {
        const lesson = await response.json();
        onLessonGenerated(lesson);
      } else {
        const errorData = await response.json();
        Alert.alert('Error', errorData.error || 'Failed to generate lesson');
      }
    } catch (error) {
      console.error('Error generating lesson:', error);
      Alert.alert('Error', 'Failed to generate lesson');
    } finally {
      setLoading(false);
    }
  };

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        const validTypes = ['.pdf', '.docx', '.txt'];
        const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
        
        if (validTypes.includes(fileExtension)) {
          setSelectedFile(file);
          Alert.alert('Success', `Document "${file.name}" selected successfully`);
        } else {
          Alert.alert('Error', 'Unsupported file type. Please select PDF, DOCX, or TXT files.');
        }
      }
    } catch (error) {
      console.error('Error picking document:', error);
      Alert.alert('Error', 'Failed to pick document');
    }
  };

  const handleUploadDocument = async () => {
    if (!selectedFile) {
      Alert.alert('Error', 'Please select a document first');
      return;
    }

    setLoading(true);
    try {
      const token = await getToken();
      
      // Create form data for React Native
      const formData = new FormData();
      const fileData = {
        uri: selectedFile.uri,
        type: selectedFile.mimeType,
        name: selectedFile.name,
      };
      
      // Convert to proper format for React Native
      (formData as any).append('file', fileData);

      const response = await fetch(`${API_BASE_URL}/users/documents/upload/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      if (response.ok) {
        const lesson = await response.json();
        onLessonGenerated(lesson);
      } else {
        const errorData = await response.json();
        Alert.alert('Error', errorData.error || 'Failed to upload document');
      }
    } catch (error) {
      console.error('Error uploading document:', error);
      Alert.alert('Error', 'Failed to upload document');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={colors.gradients.primary as any}
        style={styles.headerGradient}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel} style={styles.closeButton}>
            <Ionicons name="close" size={24} color="white" />
          </TouchableOpacity>
          <Text style={styles.title}>Generate AI Lesson</Text>
          <View style={styles.placeholder} />
        </View>
      </LinearGradient>

      <View style={styles.content}>
        {/* Tab Navigation */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'topic' && styles.activeTab]}
            onPress={() => setActiveTab('topic')}
          >
            <Text style={[styles.tabText, activeTab === 'topic' && styles.activeTabText]}>
              By Topic
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'document' && styles.activeTab]}
            onPress={() => setActiveTab('document')}
          >
            <Text style={[styles.tabText, activeTab === 'document' && styles.activeTabText]}>
              From Document
            </Text>
          </TouchableOpacity>
        </View>

        {/* Topic Input Tab */}
        {activeTab === 'topic' && (
          <>
            <View style={styles.inputContainer}>
              <Ionicons name="search" size={20} color={colors.primary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Enter a topic (e.g., Photosynthesis, World War II, Algebra)"
                value={topic}
                onChangeText={setTopic}
                placeholderTextColor={colors.textSecondary}
              />
            </View>

            <Text style={styles.description}>
              Our AI will create a comprehensive lesson with structured sections and key concepts tailored to your topic.
            </Text>

            <TouchableOpacity 
              style={[styles.generateButton, loading && { opacity: 0.7 }]} 
              onPress={handleGenerateLesson}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Ionicons name="refresh" size={20} color="white" />
                  <Text style={styles.generateButtonText}>Generating...</Text>
                </>
              ) : (
                <>
                  <Ionicons name="sparkles" size={20} color="white" />
                  <Text style={styles.generateButtonText}>Generate Lesson</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}

        {/* Document Upload Tab */}
        {activeTab === 'document' && (
          <>
            <TouchableOpacity 
              style={styles.pickButton}
              onPress={handlePickDocument}
            >
              <Ionicons name="document-text" size={20} color={colors.primary} style={styles.inputIcon} />
              <Text style={styles.pickButtonText}>
                {selectedFile ? `Selected: ${selectedFile.name}` : 'Pick a Document'}
              </Text>
            </TouchableOpacity>

            <Text style={styles.description}>
              Upload a PDF, DOCX, or TXT file and our AI will create a lesson based on the content.
            </Text>

            {selectedFile && (
              <View style={styles.fileInfo}>
                <Ionicons name="file-tray" size={16} color={colors.primary} />
                <Text style={styles.fileInfoText}>
                  {selectedFile.name} ({(selectedFile.fileSize / 1024 / 1024).toFixed(2)} MB)
                </Text>
              </View>
            )}

            <TouchableOpacity 
              style={[styles.uploadButton, loading && { opacity: 0.7 }, !selectedFile && { opacity: 0.5 }]} 
              onPress={handleUploadDocument}
              disabled={loading || !selectedFile}
            >
              {loading ? (
                <>
                  <Ionicons name="refresh" size={20} color="white" />
                  <Text style={styles.uploadButtonText}>Processing...</Text>
                </>
              ) : (
                <>
                  <Ionicons name="cloud-upload" size={20} color="white" />
                  <Text style={styles.uploadButtonText}>Generate from Document</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerGradient: {
    paddingTop: 40,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    color: 'white',
    fontSize: 20,
    fontWeight: '700',
  },
  placeholder: {
    width: 40,
    height: 40,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: 'white',
    borderRadius: 12,
    marginBottom: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
  },
  activeTab: {
    backgroundColor: colors.primary,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  activeTabText: {
    color: 'white',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
  },
  description: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 24,
  },
  pickButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  pickButtonText: {
    fontSize: 16,
    color: colors.text,
    marginLeft: 8,
  },
  fileInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(109, 40, 217, 0.1)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 16,
  },
  fileInfoText: {
    fontSize: 14,
    color: colors.text,
    marginLeft: 8,
  },
  generateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 16,
    elevation: 3,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  generateButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 16,
    elevation: 3,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  uploadButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});
