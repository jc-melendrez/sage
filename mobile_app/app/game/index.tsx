import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform
} from 'react-native';
import { useRouter } from 'expo-router';
import { getToken } from '@/services/authService';

const API_BASE_URL = 'http://192.168.1.16:8000/api';

export default function GameHomeScreen() {
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

  if (mode === 'create') {
    return (
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Text style={styles.title}>Create Room</Text>
        <TextInput style={styles.input} placeholder="Topic (e.g. World War 2)" value={topic} onChangeText={setTopic} />
        <TextInput style={styles.input} placeholder="Number of questions (default 5)" value={questionCount} onChangeText={setQuestionCount} keyboardType="numeric" />
        <TextInput style={styles.input} placeholder="Seconds per question (default 15)" value={timePerQuestion} onChangeText={setTimePerQuestion} keyboardType="numeric" />
        <TouchableOpacity style={styles.primaryBtn} onPress={handleCreate} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Create</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => setMode('home')}>
          <Text style={styles.secondaryBtnText}>Back</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.title}>Join Room</Text>
      <TextInput style={styles.input} placeholder="Enter room code" value={joinCode} onChangeText={setJoinCode} autoCapitalize="characters" maxLength={6} />
      <TouchableOpacity style={styles.primaryBtn} onPress={handleJoin} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Join</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryBtn} onPress={() => setMode('home')}>
        <Text style={styles.secondaryBtnText}>Back</Text>
      </TouchableOpacity>
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