import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView
} from 'react-native';
import { useRouter } from 'expo-router';
import { getToken } from '@/services/authService';
import { API_BASE_URL } from '@/config/api';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Ionicons } from '@expo/vector-icons';

export default function ClassicGameSetupScreen() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState('');
  const [questionCount, setQuestionCount] = useState('5');
  const [timePerQuestion, setTimePerQuestion] = useState('15');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'home' | 'create' | 'join'>('home');
  const [selectedFile, setSelectedFile] = useState<{ name: string; content: string } | null>(null);

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/plain', 'application/pdf'],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        let content: string;
        
        // Check if it's a PDF file
        if (file.mimeType === 'application/pdf') {
          // PDF files need special handling - show info that only text files are fully supported
          Alert.alert(
            'PDF Info', 
            'PDF files are not fully supported yet. For best results, please upload a .txt file. Attempting to extract any available text...'
          );
          // Try to read as text, but handle encoding issues gracefully
          try {
            content = await FileSystem.readAsStringAsync(file.uri);
          } catch (readErr) {
            content = `[PDF file: ${file.name} - content extraction requires PDF parsing library]`;
          }
        } else {
          // Regular text file
          content = await FileSystem.readAsStringAsync(file.uri);
        }
        setSelectedFile({ name: file.name, content });
      }
    } catch (err: any) {
      console.error('Document pick error:', err);
      Alert.alert('Error', err?.message || 'Failed to pick document');
    }
  };

  const handleCreate = async () => {
    if (!selectedFile) {
      Alert.alert('Error', 'Please upload a study material first');
      return;
    }
    setLoading(true);
    try {
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/game/create/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          fileContent: selectedFile.content,
          questionCount: parseInt(questionCount),
          timePerQuestion: parseInt(timePerQuestion),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to create room');
      router.push({ pathname: '/game/lobby', params: { roomCode: data.roomCode, isHost: 'true', topic: data.topic } });
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!joinCode.trim()) {
      Alert.alert('Error', 'Please enter a room code');
      return;
    }
    setLoading(true);
    try {
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/game/join/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ roomCode: joinCode.toUpperCase() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to join room');
      router.push({ pathname: '/game/lobby', params: { roomCode: joinCode.toUpperCase(), isHost: 'false', topic: data.topic } });
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  if (mode === 'home') {
    return (
      <View style={styles.container}>
        <TouchableOpacity style={{ position: 'absolute', top: 50, left: 20 }} onPress={() => router.back()}>
           <Text style={{ color: '#7F77DD', fontWeight: 'bold' }}>← Back to Hub</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Classic Quiz Battle</Text>
        <Text style={styles.subtitle}>Compete with others in real-time!</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => setMode('create')}>
          <Text style={styles.primaryBtnText}>Create Room</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => setMode('join')}>
          <Text style={styles.secondaryBtnText}>Join Room</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
     <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ alignItems: 'center', width: '100%' }}>
          <Text style={styles.title}>{mode === 'create' ? 'Create Room' : 'Join Room'}</Text>
          {mode === 'create' ? (
            <>
              <Text style={styles.label}>1. Upload Study Material</Text>
              <TouchableOpacity style={styles.uploadBox} onPress={pickDocument}>
                <Ionicons name={selectedFile ? "document-attach" : "cloud-upload"} size={32} color="#7F77DD" />
                <Text style={styles.uploadText}>
                  {selectedFile ? selectedFile.name : 'Select PDF or Text file'}
                </Text>
                {selectedFile && <Text style={styles.changeText}>Tap to change</Text>}
              </TouchableOpacity>

              <Text style={styles.label}>2. Settings</Text>
              <View style={styles.row}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.smallLabel}>Questions</Text>
                  <TextInput 
                    style={styles.input} 
                    value={questionCount} 
                    onChangeText={setQuestionCount} 
                    keyboardType="numeric" 
                  />
                </View>
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={styles.smallLabel}>Seconds/Q</Text>
                  <TextInput 
                    style={styles.input} 
                    value={timePerQuestion} 
                    onChangeText={setTimePerQuestion} 
                    keyboardType="numeric" 
                  />
                </View>
              </View>

              <TouchableOpacity style={styles.primaryBtn} onPress={handleCreate} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Generate Room</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TextInput style={styles.input} placeholder="Room Code" value={joinCode} onChangeText={setJoinCode} autoCapitalize="characters" />
              <TouchableOpacity style={styles.primaryBtn} onPress={handleJoin} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Join</Text>}
              </TouchableOpacity>
            </>
          )}
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => setMode('home')}><Text style={styles.secondaryBtnText}>Back</Text></TouchableOpacity>
        </ScrollView>
     </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#0f0c29' },
  title: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#aaa', marginBottom: 40 },
  input: { width: '100%', backgroundColor: '#1e1b4b', color: '#fff', borderRadius: 12, padding: 14, marginBottom: 12, fontSize: 16 },
  primaryBtn: { width: '100%', backgroundColor: '#7F77DD', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 12 },
  primaryBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  secondaryBtn: { width: '100%', borderWidth: 1, borderColor: '#7F77DD', borderRadius: 12, padding: 16, alignItems: 'center' },
  secondaryBtnText: { color: '#7F77DD', fontWeight: 'bold', fontSize: 16 },
  label: { alignSelf: 'flex-start', color: '#fff', fontSize: 16, fontWeight: 'bold', marginBottom: 12, marginTop: 10 },
  smallLabel: { color: '#aaa', fontSize: 12, marginBottom: 4 },
  uploadBox: { width: '100%', borderStyle: 'dashed', borderWidth: 2, borderColor: '#7F77DD', borderRadius: 16, padding: 24, alignItems: 'center', marginBottom: 20, backgroundColor: '#1e1b4b' },
  uploadText: { color: '#fff', marginTop: 8, fontSize: 14, textAlign: 'center' },
  changeText: { color: '#7F77DD', fontSize: 12, marginTop: 4 },
  row: { flexDirection: 'row', width: '100%', marginBottom: 20 },
});