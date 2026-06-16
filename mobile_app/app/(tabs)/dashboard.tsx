import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Dashboard from '../../components/Dashboard';
import { useRouter } from 'expo-router';
export default function DashboardScreen() {
  const [isModalVisible, setIsModalVisible] = useState(false);
  const router = useRouter();

  return (
    <View style={{ flex: 1 }}>
      {/* 🌟 Update your Dashboard component to call this prop when 'Generate Quiz' is pressed */}
      <Dashboard onGenerateQuiz={() => setIsModalVisible(true)} />

      <Modal
        animationType="fade"
        transparent={true}
        visible={isModalVisible}
        onRequestClose={() => setIsModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Quiz Generator</Text>
            <View style={styles.testMessageContainer}>
              <Text style={styles.modalText}>
                Testing: This modal replaces the routing to AI Assistant. 
              </Text>
              <Text style={styles.modalText}>
                The quiz generation configuration settings will be placed here soon!
              </Text>
            </View>
            
            <TouchableOpacity 
              style={styles.closeButton} 
              onPress={() => setIsModalVisible(false)}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 24,
    padding: 24,
    width: '90%',
    alignItems: 'center',
    elevation: 5,
  },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#1F2937', marginBottom: 16 },
  testMessageContainer: { marginBottom: 24 },
  modalText: { fontSize: 15, color: '#4B5563', textAlign: 'center', marginBottom: 8, lineHeight: 22 },
  closeButton: { backgroundColor: '#6D28D9', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 12 },
  closeButtonText: { color: 'white', fontWeight: '700', fontSize: 16 },
});