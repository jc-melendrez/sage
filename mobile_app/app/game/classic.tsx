import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform
} from 'react-native';
import { useRouter } from 'expo-router';
import { getToken } from '@/services/authService';

const API_BASE_URL = 'http://192.168.1.16:8000/api';

export default function ClassicGameSetupScreen() {
  const router = useRouter();
  const [topic, setTopic] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [questionCount, setQuestionCount] = useState('5');
  const [timePerQuestion, setTimePerQuestion] = useState('15');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'home' | 'create' | 'join'>('home');

  const handleCreate = async () => {
    if (!topic.trim()) {
      Alert.alert('Error', 'Please enter a topic');
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
          topic,
          questionCount: parseInt(questionCount),
          timePerQuestion: parseInt(timePerQuestion),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to create room');
      router.push({ pathname: '/game/lobby', params: { roomCode: data.roomCode, isHost: 'true', topic } });
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

  // ... Keep existing create/join logic UI from original index.tsx
  return (
     <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Text style={styles.title}>{mode === 'create' ? 'Create Room' : 'Join Room'}</Text>
        {mode === 'create' ? (
           <>
             <TextInput style={styles.input} placeholder="Topic" value={topic} onChangeText={setTopic} />
             <TouchableOpacity style={styles.primaryBtn} onPress={handleCreate} disabled={loading}><Text style={styles.primaryBtnText}>Create</Text></TouchableOpacity>
           </>
        ) : (
           <>
             <TextInput style={styles.input} placeholder="Room Code" value={joinCode} onChangeText={setJoinCode} autoCapitalize="characters" />
             <TouchableOpacity style={styles.primaryBtn} onPress={handleJoin} disabled={loading}><Text style={styles.primaryBtnText}>Join</Text></TouchableOpacity>
           </>
        )}
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => setMode('home')}><Text style={styles.secondaryBtnText}>Back</Text></TouchableOpacity>
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
});