import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { API_BASE_URL } from '@/config/api';
import { getToken } from '@/services/authService';
import { colors } from '@/constants/theme';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

// --- Updated props: onCourseGenerated instead of onLessonGenerated ---
interface LessonGeneratorProps {
  onCourseGenerated: (course: any) => void;
  onCancel: () => void;
}

export default function LessonGenerator({ onCourseGenerated, onCancel }: LessonGeneratorProps) {
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);

  const handleSelectFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'text/plain',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;
      setSelectedFile(result.assets[0]);
    } catch (err) {
      console.error('File picker error:', err);
      Alert.alert('Error', 'Failed to select file.');
    }
  };

  const handleGenerateLesson = async () => {
    if (!selectedFile) {
      Alert.alert('Error', 'Please select a study file.');
      return;
    }

    setLoading(true);

    try {
      const token = await getToken();
      const formData = new FormData();
      formData.append("file", {
        uri: selectedFile.uri,
        name: selectedFile.name,
        type: selectedFile.mimeType || "application/pdf",
      } as any);

      console.log("🚀 Sending file only request...");
      console.log("Selected file:", selectedFile);

      const response = await fetch(`${API_BASE_URL}/users/lessons/generate/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const rawText = await response.text();
      console.log("📩 RAW RESPONSE:", rawText);

      const data = JSON.parse(rawText);

      if (!response.ok) {
        Alert.alert('Error', data.error || 'Failed to generate lesson');
        return;
      }

      // ✅ Call the updated callback
      onCourseGenerated(data);
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'Failed to generate lesson');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={colors.gradients.primary as any} style={styles.headerGradient}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel} style={styles.closeButton}>
            <Ionicons name="close" size={24} color="white" />
          </TouchableOpacity>
          <Text style={styles.title}>Generate AI Course</Text>
          <View style={styles.placeholder} />
        </View>
      </LinearGradient>

      <View style={styles.content}>
        <Text style={styles.label}>Study Material</Text>
        <TouchableOpacity onPress={handleSelectFile} style={styles.filePicker}>
          <Ionicons name="document-outline" size={20} color={colors.primary} />
          <Text style={styles.filePickerText}>
            {selectedFile ? selectedFile.name : 'Select PDF, TXT, DOC or DOCX'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.description}>
          Upload a study material. AI will generate a structured course with three difficulty levels.
        </Text>

        <TouchableOpacity
          style={[styles.generateButton, loading && styles.disabled]}
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
              <Text style={styles.generateButtonText}>Generate Course</Text>
            </>
          )}
        </TouchableOpacity>
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
  label: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 8,
    fontWeight: '600',
  },
  filePicker: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  filePickerText: {
    marginLeft: 12,
    flex: 1,
    color: colors.text,
  },
  description: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 24,
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
  disabled: {
    opacity: 0.7,
  },
  generateButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});