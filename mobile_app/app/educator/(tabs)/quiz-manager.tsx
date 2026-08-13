import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { API_BASE_URL } from '@/config/api';
import { getToken } from '@/services/authService';
import { COLORS, FONTS, RADIUS, tint } from '@/constants/educatorTheme';
import { EducatorHeader } from '@/components/educator/EducatorHeader';
import { SectionHeader, Pill, FilterChip, EmptyState } from '@/components/educator/EducatorPrimitives';

interface Quiz {
  id: number;
  title: string;
  quiz_type: string;
  created_at: string;
  questions: { id: number; question_text: string; options: string[]; correct_answer: string; explanation?: string }[];
}

interface EditableQuestion {
  id?: number;
  question_text: string;
  options: string[];
  correct_answer: string;
  explanation: string;
}

interface EditableQuiz {
  id: number;
  title: string;
  quiz_type: string;
  questions: EditableQuestion[];
}

const QUESTION_TYPE_OPTIONS = ['Multiple Choice', 'True/False', 'Short Answer', 'Fill-in-the-Blank'];
const HAS_OPTIONS = ['Multiple Choice', 'True/False'];

export default function QuizManagerScreen() {
  const router = useRouter();

  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const [selectedFile, setSelectedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [difficulty, setDifficulty] = useState('Medium');
  const [questionCount, setQuestionCount] = useState('10');
  const [questionType, setQuestionType] = useState('Multiple Choice');
  const [isTypeDropdownOpen, setIsTypeDropdownOpen] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');
  const [generationProgress, setGenerationProgress] = useState(0);
  const [previewQuiz, setPreviewQuiz] = useState<Quiz | null>(null);
  const [editingQuiz, setEditingQuiz] = useState<Quiz | null>(null);
  const [draft, setDraft] = useState<EditableQuiz | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const loadQuizzes = async () => {
    try {
      setLoading(true);
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/ai/quizzes/`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) setQuizzes(await res.json());
    } catch (error) {
      console.error('Failed to load quizzes:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQuizzes();
  }, []);

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

    setIsGenerating(true);
    try {
      setGenerationStatus('Reading file...');
      setGenerationProgress(0.1);

      const base64Data = await FileSystem.readAsStringAsync(selectedFile.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      setGenerationStatus('Generating questions...');
      setGenerationProgress(0.4);

      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/ai/generate-quiz/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          file: { name: selectedFile.name, data: base64Data },
          difficulty,
          count,
          type: questionType,
          instructions,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to generate quiz');
      }

      setGenerationProgress(1.0);
      await new Promise(resolve => setTimeout(resolve, 1000));

      Alert.alert('Quiz Ready!', `Successfully generated ${count} ${difficulty} ${questionType} questions.`);
      setCreating(false);
      setSelectedFile(null);
      setQuestionCount('10');
      setInstructions('');
      await loadQuizzes();
    } catch (err) {
      console.error('Generation Error Details:', err);
      Alert.alert('Generation Failed', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setIsGenerating(false);
      setGenerationStatus('');
      setGenerationProgress(0);
    }
  };

  const handleDeleteQuiz = (quiz: Quiz) => {
    Alert.alert(
      'Delete Quiz',
      `Delete "${quiz.title}"? This will permanently remove the quiz and its questions.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const token = await getToken();
              const res = await fetch(`${API_BASE_URL}/ai/quizzes/${quiz.id}/`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` },
              });
              if (!res.ok) throw new Error('Failed to delete quiz');
              await loadQuizzes();
            } catch (err) {
              console.error('Delete Error:', err);
              Alert.alert('Delete Failed', err instanceof Error ? err.message : 'Something went wrong.');
            }
          },
        },
      ],
    );
  };

  const openEditor = (quiz: Quiz) => {
    setEditingQuiz(quiz);
    setDraft({
      id: quiz.id,
      title: quiz.title,
      quiz_type: quiz.quiz_type,
      questions: (quiz.questions || []).map((q) => ({
        id: q.id,
        question_text: q.question_text,
        options: [...(q.options || [])],
        correct_answer: q.correct_answer,
        explanation: q.explanation || '',
      })),
    });
  };

  const closeEditor = () => {
    setEditingQuiz(null);
    setDraft(null);
  };

  const updateTitle = (title: string) => {
    if (draft) setDraft({ ...draft, title });
  };

  const updateQuestion = (index: number, field: keyof EditableQuestion, value: string | string[]) => {
    if (!draft) return;
    const questions = draft.questions.map((q, i) => (i === index ? { ...q, [field]: value } : q));
    setDraft({ ...draft, questions });
  };

  const updateOption = (qIndex: number, oIndex: number, text: string) => {
    if (!draft) return;
    const questions = draft.questions.map((q, i) => {
      if (i !== qIndex) return q;
      const options = q.options.map((opt, oi) => (oi === oIndex ? text : opt));
      const correct_answer = q.correct_answer === q.options[oIndex] ? text : q.correct_answer;
      return { ...q, options, correct_answer };
    });
    setDraft({ ...draft, questions });
  };

  const addOption = (qIndex: number) => {
    if (!draft) return;
    const questions = draft.questions.map((q, i) => (i === qIndex ? { ...q, options: [...q.options, ''] } : q));
    setDraft({ ...draft, questions });
  };

  const removeOption = (qIndex: number, oIndex: number) => {
    if (!draft) return;
    const questions = draft.questions.map((q, i) => {
      if (i !== qIndex) return q;
      const removed = q.options[oIndex];
      const options = q.options.filter((_, oi) => oi !== oIndex);
      const correct_answer = q.correct_answer === removed ? '' : q.correct_answer;
      return { ...q, options, correct_answer };
    });
    setDraft({ ...draft, questions });
  };

  const setCorrect = (qIndex: number, optionText: string) => {
    updateQuestion(qIndex, 'correct_answer', optionText);
  };

  const removeQuestion = (qIndex: number) => {
    if (!draft) return;
    setDraft({ ...draft, questions: draft.questions.filter((_, i) => i !== qIndex) });
  };

  const addQuestion = () => {
    if (!draft) return;
    setDraft({
      ...draft,
      questions: [...draft.questions, { question_text: '', options: ['', ''], correct_answer: '', explanation: '' }],
    });
  };

  const handleSave = async () => {
    if (!draft) return;

    if (!draft.title.trim()) {
      Alert.alert('Missing Title', 'Give the quiz a title before saving.');
      return;
    }

    for (let i = 0; i < draft.questions.length; i++) {
      const q = draft.questions[i];
      if (!q.question_text.trim()) {
        Alert.alert('Incomplete Question', `Question ${i + 1} needs question text.`);
        return;
      }
      if (HAS_OPTIONS.includes(draft.quiz_type)) {
        const nonEmpty = q.options.filter((o) => o.trim());
        if (nonEmpty.length < 2) {
          Alert.alert('Incomplete Question', `Question ${i + 1} needs at least two options.`);
          return;
        }
        if (!q.correct_answer) {
          Alert.alert('Missing Correct Answer', `Pick the correct answer for Question ${i + 1}.`);
          return;
        }
      } else if (!q.correct_answer.trim()) {
        Alert.alert('Missing Answer', `Question ${i + 1} needs an answer.`);
        return;
      }
    }

    setIsSaving(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE_URL}/ai/quizzes/${draft.id}/`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: draft.title.trim(),
          questions: draft.questions.map((q) => ({
            id: q.id,
            question_text: q.question_text.trim(),
            options: q.options.map((o) => o.trim()).filter((o) => o !== ''),
            correct_answer: q.correct_answer,
            explanation: q.explanation.trim(),
          })),
        }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to save quiz');
      }
      await loadQuizzes();
      closeEditor();
      Alert.alert('Saved', 'Quiz updated successfully.');
    } catch (err) {
      console.error('Save Error:', err);
      Alert.alert('Save Failed', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <EducatorHeader
        title="Quiz & Content"
        subtitle={`${quizzes.length} quizzes · AI generated`}
        rightIcon={creating ? 'close' : 'add'}
        onRightPress={() => {
          setCreating(!creating);
          setIsTypeDropdownOpen(false);
        }}
      />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Assignments shortcut */}
        <View style={styles.section}>
          <SectionHeader title="Assignments" actionLabel="View all" onAction={() => router.push('/educator/assignments' as any)} />
          <TouchableOpacity
            style={styles.linkCard}
            activeOpacity={0.8}
            onPress={() => router.push('/educator/assignments' as any)}
          >
            <View style={[styles.linkIconBg, { backgroundColor: tint(COLORS.purplePrimary) }]}>
              <Ionicons name="document-text-outline" size={18} color={COLORS.purplePrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Track submissions & due dates</Text>
              <Text style={styles.linkSub}>Manage assignments across your classes</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <SectionHeader title="Quizzes" />
          {loading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator size="large" color={COLORS.purpleVibrant} />
            </View>
          ) : quizzes.length > 0 ? (
            <View style={{ gap: 12 }}>
              {quizzes.map((q) => (
                <View key={q.id} style={styles.quizCard}>
                  <View style={styles.quizCardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.quizCardTitle}>{q.title}</Text>
                      <Text style={styles.quizCardMeta}>
                        {q.questions?.length || 0} questions · {q.quiz_type} · {new Date(q.created_at).toLocaleDateString()}
                      </Text>
                    </View>
                    <Pill label="AI Generated" color={COLORS.purpleVibrant} icon="sparkles" />
                  </View>
                  <View style={styles.quizCardActions}>
                    <TouchableOpacity style={styles.quizActionBtn} onPress={() => openEditor(q)}>
                      <Ionicons name="create-outline" size={16} color={COLORS.purplePrimary} />
                      <Text style={styles.quizActionText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.quizActionBtn} onPress={() => setPreviewQuiz(q)}>
                      <Ionicons name="eye-outline" size={16} color={COLORS.purplePrimary} />
                      <Text style={styles.quizActionText}>Preview</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.quizActionBtn} onPress={() => handleDeleteQuiz(q)}>
                      <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                      <Text style={[styles.quizActionText, { color: COLORS.danger }]}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <EmptyState icon="document-text-outline" title="No quizzes yet" text="Tap + to create your first AI-generated quiz." />
          )}
        </View>
      </ScrollView>

      <Modal
        visible={creating}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setCreating(false);
          setIsTypeDropdownOpen(false);
        }}
      >
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>New Quiz</Text>
              <TouchableOpacity
                onPress={() => {
                  setCreating(false);
                  setIsTypeDropdownOpen(false);
                }}
              >
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
              <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled={true} contentContainerStyle={{ paddingBottom: 24 }}>
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
                        ? `${selectedFile.name.split('.').pop()?.toUpperCase() || 'FILE'} • ${selectedFile.size ? (selectedFile.size / (1024 * 1024)).toFixed(1) + ' MB' : 'Unknown size'}`
                        : 'Select a PDF or text file'}
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.changeBtn} onPress={pickFile}>
                    <Text style={styles.changeBtnText}>{selectedFile ? 'Change' : 'Select'}</Text>
                  </TouchableOpacity>
                </View>

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

                <TouchableOpacity style={styles.generateBtn} activeOpacity={0.85} onPress={handleGenerateQuiz}>
                  <Ionicons name="sparkles" size={16} color="white" />
                  <Text style={styles.generateBtnText}>Generate Quiz</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={!!previewQuiz}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setPreviewQuiz(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1, paddingRight: 16 }}>
                <Text style={styles.sheetTitle} numberOfLines={1}>{previewQuiz?.title}</Text>
                <Text style={styles.previewMeta}>
                  {previewQuiz?.questions?.length || 0} questions · {previewQuiz?.quiz_type}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setPreviewQuiz(null)}>
                <Ionicons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
              {(previewQuiz?.questions || []).map((question, idx) => (
                <View key={question.id} style={styles.previewQuestionCard}>
                  <Text style={styles.previewQuestionText}>{idx + 1}. {question.question_text}</Text>
                  <View style={styles.previewOptions}>
                    {(question.options || []).map((option, oi) => {
                      const isCorrect = option === question.correct_answer;
                      return (
                        <View key={oi} style={[styles.previewOption, isCorrect && styles.previewOptionCorrect]}>
                          <Ionicons
                            name={isCorrect ? 'checkmark-circle' : 'ellipse-outline'}
                            size={16}
                            color={isCorrect ? COLORS.success : COLORS.textMuted}
                          />
                          <Text style={[styles.previewOptionText, isCorrect && { color: COLORS.success }]}>{option}</Text>
                        </View>
                      );
                    })}
                  </View>
                  {!!question.explanation && (
                    <View style={styles.previewExplanationRow}>
                      <Ionicons name="bulb-outline" size={14} color={COLORS.warning} />
                      <Text style={styles.previewExplanation}>{question.explanation}</Text>
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!editingQuiz}
        animationType="slide"
        onRequestClose={closeEditor}
      >
        <KeyboardAvoidingView style={styles.editorRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.editorHeader}>
            <TouchableOpacity onPress={closeEditor} style={styles.editorHeaderBtn} disabled={isSaving}>
              <Ionicons name="close" size={24} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.editorHeaderTitle}>Edit Quiz</Text>
            <TouchableOpacity
              style={[styles.editorSaveBtn, isSaving && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={isSaving}
            >
              {isSaving ? <ActivityIndicator size="small" color="white" /> : <Text style={styles.editorSaveText}>Save</Text>}
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.editorContent}>
            {draft && (
              <>
                <Text style={styles.editorLabel}>Quiz Title</Text>
                <TextInput
                  style={styles.editorTitleInput}
                  value={draft.title}
                  onChangeText={updateTitle}
                  placeholder="Quiz title"
                  placeholderTextColor={COLORS.textMuted}
                />
                <Text style={styles.editorMeta}>
                  {draft.questions.length} questions · {draft.quiz_type} · Tap an option to mark the correct answer
                </Text>

                {draft.questions.map((question, qIndex) => (
                  <View key={question.id ?? `new-${qIndex}`} style={styles.questionCard}>
                    <View style={styles.questionCardHeader}>
                      <Text style={styles.questionNumber}>Question {qIndex + 1}</Text>
                      <TouchableOpacity onPress={() => removeQuestion(qIndex)}>
                        <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                      </TouchableOpacity>
                    </View>

                    <TextInput
                      style={[styles.editorInput, styles.questionTextInput]}
                      value={question.question_text}
                      onChangeText={(text) => updateQuestion(qIndex, 'question_text', text)}
                      placeholder="Enter the question"
                      placeholderTextColor={COLORS.textMuted}
                      multiline
                    />

                    {HAS_OPTIONS.includes(draft.quiz_type) ? (
                      <>
                        <Text style={styles.editorLabel}>Options</Text>
                        {question.options.map((option, oIndex) => {
                          const isCorrect = option === question.correct_answer && !!option;
                          return (
                            <View key={oIndex} style={styles.optionRow}>
                              <TouchableOpacity onPress={() => setCorrect(qIndex, option)} style={styles.optionCheck}>
                                <Ionicons
                                  name={isCorrect ? 'checkmark-circle' : 'ellipse-outline'}
                                  size={20}
                                  color={isCorrect ? COLORS.success : COLORS.textMuted}
                                />
                              </TouchableOpacity>
                              <TextInput
                                style={styles.optionInput}
                                value={option}
                                onChangeText={(text) => updateOption(qIndex, oIndex, text)}
                                placeholder={`Option ${oIndex + 1}`}
                                placeholderTextColor={COLORS.textMuted}
                              />
                              <TouchableOpacity onPress={() => removeOption(qIndex, oIndex)} style={styles.optionRemove}>
                                <Ionicons name="close-circle" size={20} color={COLORS.textMuted} />
                              </TouchableOpacity>
                            </View>
                          );
                        })}
                        <TouchableOpacity style={styles.addOptionBtn} onPress={() => addOption(qIndex)}>
                          <Ionicons name="add" size={16} color={COLORS.purplePrimary} />
                          <Text style={styles.addOptionText}>Add Option</Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <>
                        <Text style={styles.editorLabel}>Answer</Text>
                        <TextInput
                          style={styles.editorInput}
                          value={question.correct_answer}
                          onChangeText={(text) => updateQuestion(qIndex, 'correct_answer', text)}
                          placeholder="Enter the correct answer"
                          placeholderTextColor={COLORS.textMuted}
                        />
                      </>
                    )}

                    <Text style={styles.editorLabel}>Explanation (Optional)</Text>
                    <TextInput
                      style={[styles.editorInput, styles.explanationInput]}
                      value={question.explanation}
                      onChangeText={(text) => updateQuestion(qIndex, 'explanation', text)}
                      placeholder="Brief explanation why"
                      placeholderTextColor={COLORS.textMuted}
                      multiline
                    />
                  </View>
                ))}

                <TouchableOpacity style={styles.addQuestionBtn} onPress={addQuestion}>
                  <Ionicons name="add-circle-outline" size={18} color={COLORS.purplePrimary} />
                  <Text style={styles.addQuestionText}>Add Question</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  section: { marginBottom: 28 },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    width: '100%',
    maxHeight: '90%',
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  sheetTitle: { fontSize: 20, fontFamily: FONTS.black, fontWeight: '900', color: COLORS.textPrimary },

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

  loadingContainer: { paddingVertical: 32, alignItems: 'center', justifyContent: 'center' },
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

  loadingState: { paddingVertical: 40, alignItems: 'center' },

  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  linkIconBg: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  linkTitle: { fontSize: 14, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 2 },
  linkSub: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textSecondary },

  quizCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  quizCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  quizCardTitle: { fontSize: 15, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 3 },
  quizCardMeta: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textSecondary },
  quizCardActions: { flexDirection: 'row', gap: 22, paddingTop: 12, marginTop: 12, borderTopWidth: 1, borderTopColor: COLORS.border },
  quizActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  quizActionText: { fontSize: 12.5, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.purplePrimary },

  previewMeta: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 2 },
  previewQuestionCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: 16,
    marginTop: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  previewQuestionText: { fontSize: 14, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 10, lineHeight: 20 },
  previewOptions: { gap: 6 },
  previewOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'white',
    borderRadius: RADIUS.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  previewOptionCorrect: { borderColor: COLORS.success, backgroundColor: tint(COLORS.success) },
  previewOptionText: { flex: 1, fontSize: 13, fontFamily: FONTS.medium, color: COLORS.textPrimary },
  previewExplanationRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 10 },
  previewExplanation: { flex: 1, fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted, lineHeight: 17 },

  editorRoot: { flex: 1, backgroundColor: COLORS.bg },
  editorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 56 : 40,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  editorHeaderBtn: { padding: 6 },
  editorHeaderTitle: { fontSize: 17, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.textPrimary },
  editorSaveBtn: {
    backgroundColor: COLORS.purplePrimary,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 18,
    paddingVertical: 8,
    minWidth: 64,
    alignItems: 'center',
  },
  editorSaveText: { color: 'white', fontSize: 14, fontFamily: FONTS.bold, fontWeight: '700' },
  editorContent: { padding: 20, paddingBottom: 48 },

  editorLabel: { fontSize: 12, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8, marginTop: 14, textTransform: 'uppercase', letterSpacing: 0.3 },
  editorTitleInput: {
    backgroundColor: 'white',
    borderRadius: RADIUS.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 18,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  editorMeta: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.textMuted, marginTop: 10 },
  editorInput: {
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

  questionCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  questionCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  questionNumber: { fontSize: 13, fontFamily: FONTS.bold, fontWeight: '700', color: COLORS.purpleDeep },
  questionTextInput: { marginTop: 6, minHeight: 64, textAlignVertical: 'top' },

  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  optionCheck: { padding: 2 },
  optionInput: {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: RADIUS.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: FONTS.medium,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  optionRemove: { padding: 2 },
  addOptionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, alignSelf: 'flex-start' },
  addOptionText: { fontSize: 13, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.purplePrimary },

  explanationInput: { minHeight: 60, textAlignVertical: 'top' },

  addQuestionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
    paddingVertical: 16,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    borderColor: COLORS.purplePrimary,
    borderStyle: 'dashed',
    backgroundColor: tint(COLORS.purplePrimary),
  },
  addQuestionText: { fontSize: 14, fontFamily: FONTS.semiBold, fontWeight: '600', color: COLORS.purplePrimary },
});
