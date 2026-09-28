import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
  Platform,
} from 'react-native';
import { KeyboardSafeView } from '@/components/KeyboardSafeView';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import DateTimePicker from '@react-native-community/datetimepicker';
import { FilterChip } from '@/components/educator/EducatorPrimitives';
import { generateQuiz, parseDeadlineInput } from '@/services/quizService';
import { getMyCourses } from '@/services/courseService';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';

const QUESTION_TYPE_OPTIONS = ['Multiple Choice', 'True/False', 'Short Answer', 'Fill-in-the-Blank'];

type Props = {
  visible: boolean;
  /** Class the generated quiz is attached to. */
  initialCourseId?: number | null;
  /** Show the "Class" chip row so the educator can pick a class. Off = locked to initialCourseId. */
  allowCourseSelection?: boolean;
  onClose: () => void;
  /** Called after a successful generation so the host can refresh its list. */
  onGenerated?: () => void | Promise<void>;
};

/**
 * AI quiz generator as a slide-up sheet, shared by the class Quizzes tab and
 * the standalone quiz manager. When opened from a class, the sheet locks the
 * quiz to that class so the educator never has to re-pick it.
 */
export function QuizGeneratorSheet({
  visible,
  initialCourseId,
  allowCourseSelection = false,
  onClose,
  onGenerated,
}: Props) {
  const [selectedFile, setSelectedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [difficulty, setDifficulty] = useState('Medium');
  const [questionCount, setQuestionCount] = useState('10');
  const [questionType, setQuestionType] = useState('Multiple Choice');
  const [isTypeDropdownOpen, setIsTypeDropdownOpen] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [availableUntil, setAvailableUntil] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');
  const [generationProgress, setGenerationProgress] = useState(0);

  // Class selection — only fetched when the sheet is allowed to offer a choice.
  const [courses, setCourses] = useState<{ id: number; name: string }[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<number | null>(initialCourseId ?? null);

  useEffect(() => {
    setSelectedCourse(initialCourseId ?? null);
  }, [initialCourseId]);

  const loadCourses = useCallback(async () => {
    try {
      const data = await getMyCourses();
      setCourses(data.map((c) => ({ id: c.id, name: c.name })));
    } catch {
      // non-fatal — chips just won't render
    }
  }, []);

  useEffect(() => {
    if (!visible || !allowCourseSelection) return;
    loadCourses();
  }, [visible, allowCourseSelection, loadCourses]);

  // Close the dropdown when the sheet goes away so reopening starts clean.
  useEffect(() => {
    if (!visible) setIsTypeDropdownOpen(false);
  }, [visible]);

  // Deadline picker state
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(false);
  const [deadlinePickerMode, setDeadlinePickerMode] = useState<'date' | 'time'>('date');
  const [deadlineTempDate, setDeadlineTempDate] = useState<Date>(new Date());

  const resetForm = () => {
    setSelectedFile(null);
    setQuestionCount('10');
    setDifficulty('Medium');
    setQuestionType('Multiple Choice');
    setInstructions('');
    setAvailableUntil('');
    setIsTypeDropdownOpen(false);
  };

  const close = () => {
    if (isGenerating) return;
    resetForm();
    onClose();
  };

  const openDeadlinePicker = () => {
    const parsed = availableUntil ? parseDeadlineInput(availableUntil) : null;
    setDeadlineTempDate(parsed || new Date());
    setDeadlinePickerMode('date');
    setShowDeadlinePicker(true);
  };

  const handleDeadlineChange = ({ nativeEvent }: { nativeEvent: { type?: string; timestamp?: number } }) => {
    if (nativeEvent.type === 'dismissed') {
      setShowDeadlinePicker(false);
      return;
    }
    const newDate = nativeEvent.timestamp ? new Date(nativeEvent.timestamp) : deadlineTempDate;
    setDeadlineTempDate(newDate);
    if (deadlinePickerMode === 'date') {
      setDeadlinePickerMode('time');
      return;
    }
    const combined = new Date(
      deadlineTempDate.getFullYear(),
      deadlineTempDate.getMonth(),
      deadlineTempDate.getDate(),
      newDate.getHours(),
      newDate.getMinutes(),
    );
    setAvailableUntil(
      `${combined.getFullYear()}-${String(combined.getMonth() + 1).padStart(2, '0')}-${String(combined.getDate()).padStart(2, '0')} ${String(combined.getHours()).padStart(2, '0')}:${String(combined.getMinutes()).padStart(2, '0')}`,
    );
    setShowDeadlinePicker(false);
  };

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      setSelectedFile(result.assets[0]);
    } catch (err) {
      console.error('File picker error:', err);
      Alert.alert('Error', 'Failed to select file.');
    }
  };

  const handleGenerateQuiz = async () => {
    if (!selectedFile) {
      Alert.alert('Material Required', 'Please select a study material (PDF or Text) before generating a quiz.');
      return;
    }
    const count = parseInt(questionCount, 10);
    if (isNaN(count) || count < 1) {
      Alert.alert('Invalid Count', 'Enter a valid number of questions.');
      return;
    }

    let deadlineIso: string | undefined;
    if (availableUntil.trim()) {
      const parsed = parseDeadlineInput(availableUntil);
      if (!parsed) {
        Alert.alert('Invalid Deadline', 'Enter the deadline as YYYY-MM-DD HH:MM (24-hour), or leave it blank.');
        return;
      }
      deadlineIso = parsed.toISOString();
    }

    setIsGenerating(true);
    try {
      setGenerationStatus('Reading file...');
      setGenerationProgress(0.1);

      const base64Data = await FileSystem.readAsStringAsync(selectedFile.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      setGenerationStatus('Generating questions...');
      setGenerationProgress(0.4);

      await generateQuiz({
        file: { name: selectedFile.name, data: base64Data },
        difficulty,
        count,
        type: questionType,
        instructions,
        course: selectedCourse ?? undefined,
        available_until: deadlineIso,
      });

      setGenerationProgress(1.0);
      await new Promise(resolve => setTimeout(resolve, 1000));

      Alert.alert('Quiz Ready!', `Successfully generated ${count} ${difficulty} ${questionType} questions.`);
      resetForm();
      onClose();
      await onGenerated?.();
    } catch (err) {
      console.error('Generation Error Details:', err);
      Alert.alert('Generation Failed', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setIsGenerating(false);
      setGenerationStatus('');
      setGenerationProgress(0);
    }
  };

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        transparent
        onRequestClose={close}
      >
        <KeyboardSafeView style={styles.overlay}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={close} />
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <View style={styles.header}>
              <Text style={styles.headerTitle}>New Quiz</Text>
              <TouchableOpacity onPress={close} disabled={isGenerating} hitSlop={10}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

            {isGenerating ? (
              <View style={styles.loadingContainer}>
                <View style={styles.loadingIconContainer}>
                  <ActivityIndicator size="large" color={COLORS.purplePrimary} />
                  <Ionicons name="sparkles" size={24} color={COLORS.purplePrimary} style={styles.sparkleIcon} />
                </View>
                <Text style={styles.statusTitle}>{generationStatus}</Text>
                <Text style={styles.statusSubtitle}>SAGE AI is crafting the perfect assessment for your class.</Text>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${generationProgress * 100}%` }]} />
                </View>
                <Text style={styles.progressText}>{Math.round(generationProgress * 100)}% Complete</Text>
              </View>
            ) : (
              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled={true}
                contentContainerStyle={styles.content}
              >
                <Text style={styles.fieldLabel}>Study Material</Text>
                <View style={styles.materialPreview}>
                  <View style={styles.materialIconBg}>
                    <Ionicons name={selectedFile ? 'document-text' : 'cloud-upload-outline'} size={24} color={COLORS.purplePrimary} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.materialName} numberOfLines={1}>
                      {selectedFile ? selectedFile.name : 'No file selected'}
                    </Text>
                    <Text style={styles.materialMeta}>
                      {selectedFile
                        ? `${selectedFile.name.split('.').pop()?.toUpperCase() || 'FILE'} · ${selectedFile.size ? (selectedFile.size / (1024 * 1024)).toFixed(1) + ' MB' : 'Unknown size'}`
                        : 'Select a PDF or text file'}
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.changeBtn} onPress={pickFile}>
                    <Text style={styles.changeBtnText}>{selectedFile ? 'Change' : 'Select'}</Text>
                  </TouchableOpacity>
                </View>

                {allowCourseSelection && courses.length > 0 && (
                  <>
                    <Text style={styles.fieldLabel}>Class</Text>
                    <View style={styles.chipRow}>
                      <FilterChip
                        label="No class"
                        active={selectedCourse === null}
                        onPress={() => setSelectedCourse(null)}
                      />
                      {courses.map((course) => (
                        <FilterChip
                          key={course.id}
                          label={course.name}
                          active={selectedCourse === course.id}
                          onPress={() => setSelectedCourse(course.id)}
                        />
                      ))}
                    </View>
                  </>
                )}

                <Text style={styles.fieldLabel}>Difficulty</Text>
                <View style={styles.chipRow}>
                  {['Easy', 'Medium', 'Hard'].map((d) => (
                    <FilterChip key={d} label={d} active={difficulty === d} onPress={() => setDifficulty(d)} />
                  ))}
                </View>

                <View style={styles.rowFields}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Questions</Text>
                    <TextInput
                      style={styles.input}
                      value={questionCount}
                      onChangeText={setQuestionCount}
                      keyboardType="number-pad"
                    />
                  </View>
                  <View style={{ width: 12 }} />
                  <View style={{ flex: 2 }}>
                    <Text style={styles.fieldLabel}>Question Type</Text>
                    <TouchableOpacity
                      style={styles.selector}
                      onPress={() => setIsTypeDropdownOpen(!isTypeDropdownOpen)}
                    >
                      <Text style={styles.selectorText} numberOfLines={1}>{questionType}</Text>
                      <Ionicons name="chevron-down" size={20} color={COLORS.textMuted} />
                    </TouchableOpacity>
                    {isTypeDropdownOpen && (
                      <ScrollView style={styles.dropdown} nestedScrollEnabled={true}>
                        {QUESTION_TYPE_OPTIONS.map((type) => (
                          <TouchableOpacity
                            key={type}
                            style={styles.dropdownItem}
                            onPress={() => {
                              setQuestionType(type);
                              setIsTypeDropdownOpen(false);
                            }}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.dropdownItemText}>{type}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                </View>

                <Text style={styles.fieldLabel}>Additional Instruction (Optional)</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="e.g. Focus on word problems involving fractions"
                  placeholderTextColor={COLORS.textMuted}
                  multiline
                  numberOfLines={3}
                  value={instructions}
                  onChangeText={setInstructions}
                />

                <Text style={styles.fieldLabel}>Deadline (Optional) · YYYY-MM-DD HH:MM</Text>
                <View style={styles.deadlineRow}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="e.g. 2026-10-01 23:59"
                    placeholderTextColor={COLORS.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={availableUntil}
                    onChangeText={setAvailableUntil}
                  />
                  <TouchableOpacity
                    style={styles.pickerBtn}
                    activeOpacity={0.8}
                    onPress={openDeadlinePicker}
                  >
                    <Ionicons name="calendar" size={22} color={COLORS.purplePrimary} />
                  </TouchableOpacity>
                  {!!availableUntil && (
                    <TouchableOpacity
                      style={styles.pickerBtn}
                      activeOpacity={0.8}
                      onPress={() => setAvailableUntil('')}
                    >
                      <Ionicons name="close-circle" size={22} color={COLORS.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={styles.deadlineHint}>Quiz closes at this time — students can&apos;t take it after. Leave blank for no deadline.</Text>

                <TouchableOpacity style={styles.generateBtn} activeOpacity={0.85} onPress={handleGenerateQuiz}>
                  <Ionicons name="sparkles" size={16} color="white" />
                  <Text style={styles.generateBtnText}>Generate Quiz</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </KeyboardSafeView>
      </Modal>

      {showDeadlinePicker && Platform.OS !== 'web' && (
        <DateTimePicker
          testID="deadlinePicker"
          value={deadlineTempDate}
          mode={deadlinePickerMode}
          is24Hour={true}
          onChange={handleDeadlineChange}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  sheet: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    width: '100%',
    maxHeight: '90%',
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    overflow: 'hidden',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    marginTop: 8,
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: { fontSize: 20, fontFamily: FONTS.black, fontWeight: '900', color: COLORS.textPrimary },

  content: { padding: 24, paddingBottom: 40 },
  fieldLabel: { fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8, marginTop: 14, textTransform: 'uppercase', letterSpacing: 0.3 },
  input: {
    backgroundColor: 'white',
    borderRadius: RADIUS.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: FONTS.medium,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rowFields: { flexDirection: 'row', alignItems: 'flex-start' },
  textArea: { minHeight: 80, textAlignVertical: 'top' },

  materialPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    padding: 12,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  materialIconBg: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: tint(COLORS.purplePrimary),
    justifyContent: 'center',
    alignItems: 'center',
  },
  materialName: { fontSize: 15, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary },
  materialMeta: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 2 },
  changeBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  changeBtnText: { color: COLORS.purplePrimary, fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600' },

  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'white',
    borderRadius: RADIUS.sm,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  selectorText: { fontSize: 14, fontFamily: FONTS.medium, color: COLORS.textPrimary, flex: 1 },
  dropdown: {
    position: 'absolute',
    top: 78,
    left: 0,
    right: 0,
    backgroundColor: 'white',
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    zIndex: 1000,
    maxHeight: 200,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  dropdownItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: COLORS.bgSecondary },
  dropdownItemText: { fontSize: 14, fontFamily: FONTS.medium, color: COLORS.textPrimary },

  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.purplePrimary,
    borderRadius: RADIUS.sm,
    paddingVertical: 14,
    marginTop: 20,
  },
  generateBtnText: { color: 'white', fontSize: 14.5, fontFamily: FONTS.bold, fontWeight: '700' },

  loadingContainer: { paddingVertical: 48, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' },
  loadingIconContainer: { position: 'relative', marginBottom: 20, width: 80, height: 80, justifyContent: 'center', alignItems: 'center' },
  sparkleIcon: { position: 'absolute', top: 0, right: 0 },
  statusTitle: { fontSize: 18, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 6, textAlign: 'center' },
  statusSubtitle: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.textMuted, textAlign: 'center', marginBottom: 24, paddingHorizontal: 20, lineHeight: 19 },
  progressTrack: {
    width: '100%',
    height: 8,
    backgroundColor: 'rgba(124,58,237,0.12)',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressFill: { height: '100%', backgroundColor: COLORS.purplePrimary },
  progressText: { fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.purplePrimary },

  deadlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pickerBtn: { padding: 6 },
  deadlineHint: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 6, marginBottom: 4, lineHeight: 16 },
});
