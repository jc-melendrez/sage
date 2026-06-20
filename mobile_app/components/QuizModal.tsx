import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, SafeAreaView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { saveQuizProgress } from '../utils/offlineStorage';

const QUIZ_PASS_THRESHOLD = 0.6;

interface QuizOption {
  id: number;
  option_text: string;
  is_correct: boolean;
}

interface QuizQuestion {
  id: number;
  question_text: string;
  explanation: string;
  options: QuizOption[];
}

interface QuizModalProps {
  questions: QuizQuestion[];   // the 5 questions for this lesson part
  partNumber: number;          // used to tell the parent which part was completed
  onClose: () => void;         // called when the modal is dismissed
  onPartCompleted: (partNumber: number) => void; // called on passing score
  onXpEarned: (amount: number) => void;          // called with 50 on pass
}

export default function QuizModal({
  questions,
  partNumber,
  onClose,
  onPartCompleted,
  onXpEarned,
}: QuizModalProps) {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState<number>(0);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number | null>(null);
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  const [correctCount, setCorrectCount] = useState<number>(0);
  const [isFinished, setIsFinished] = useState<boolean>(false);

  const currentQuestion = questions[currentQuestionIndex];
  const options = currentQuestion?.options || [];

  const passed = questions.length > 0 ? (correctCount / questions.length) >= QUIZ_PASS_THRESHOLD : false;

  // Trigger actions when the quiz finishes (isFinished is true)
  useEffect(() => {
    if (isFinished) {
      const score = questions.length > 0 ? correctCount / questions.length : 0.0;
      saveQuizProgress(partNumber, passed, score).catch((err) => {
        console.error('Failed to save quiz progress offline:', err);
      });

      if (passed) {
        onXpEarned(50);
        onPartCompleted(partNumber);
      }
    }
  }, [isFinished, passed, partNumber, questions.length, correctCount]);

  if (!currentQuestion) {
    return (
      <Modal animationType="slide" transparent={false} visible={true} onRequestClose={onClose}>
        <SafeAreaView className="flex-1 bg-slate-950 justify-center items-center p-5">
          <Text className="text-slate-400 mb-4">No questions available for this quiz.</Text>
          <TouchableOpacity onPress={onClose} className="bg-blue-600 py-3.5 px-6 rounded-xl">
            <Text className="text-white font-semibold">Close</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </Modal>
    );
  }

  return (
    <Modal animationType="slide" transparent={false} visible={true} onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-slate-950">
        {!isFinished ? (
          <View className="flex-1 px-5 py-4 justify-between">
            <View>
              {/* Header */}
              <View className="flex-row justify-between items-center mb-6">
                <Text className="text-slate-400 font-semibold">
                  Part {partNumber} Quiz
                </Text>
                <TouchableOpacity onPress={onClose} className="p-1">
                  <Ionicons name="close" size={24} color="#94a3b8" />
                </TouchableOpacity>
              </View>

              {/* Progress bar */}
              <View className="w-full bg-slate-800 h-1.5 rounded-full mb-6 overflow-hidden">
                <View
                  className="bg-blue-600 h-full"
                  style={{ width: `${((currentQuestionIndex + 1) / questions.length) * 100}%` }}
                />
              </View>

              <Text className="text-slate-400 font-semibold text-xs uppercase tracking-wider mb-2">
                Question {currentQuestionIndex + 1} of {questions.length}
              </Text>
              
              <Text className="text-white text-lg font-bold leading-snug mb-6">
                {currentQuestion.question_text}
              </Text>

              {/* Options */}
              <View>
                {options.map((option, idx) => {
                  const isOptionSelected = selectedOptionIndex === idx;
                  const isOptionCorrect = option.is_correct;

                  let optionClass = "border border-slate-700 bg-slate-900/60 p-4 rounded-2xl mb-3.5 flex-row items-center justify-between";
                  let textClass = "text-slate-200 text-base font-medium flex-1";

                  if (isSubmitted) {
                    if (isOptionCorrect) {
                      optionClass = "border border-green-600 bg-green-950/30 p-4 rounded-2xl mb-3.5 flex-row items-center justify-between";
                      textClass = "text-green-200 text-base font-bold flex-1";
                    } else if (isOptionSelected) {
                      optionClass = "border border-red-600 bg-red-950/30 p-4 rounded-2xl mb-3.5 flex-row items-center justify-between";
                      textClass = "text-red-200 text-base font-bold flex-1";
                    }
                  } else if (isOptionSelected) {
                    optionClass = "border-2 border-blue-500 bg-slate-800/80 p-4 rounded-2xl mb-3.5 flex-row items-center justify-between";
                    textClass = "text-white text-base font-bold flex-1";
                  }

                  return (
                    <TouchableOpacity
                      key={option.id || idx}
                      disabled={isSubmitted}
                      onPress={() => setSelectedOptionIndex(idx)}
                      className={optionClass}
                    >
                      <Text className={textClass}>
                        {option.option_text}
                      </Text>
                      
                      {/* Correctness check icons */}
                      {isSubmitted && isOptionCorrect && (
                        <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
                      )}
                      {isSubmitted && isOptionSelected && !isOptionCorrect && (
                        <Ionicons name="close-circle" size={20} color="#ef4444" />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Explanation */}
              {isSubmitted && currentQuestion.explanation && (
                <View className="bg-slate-900 border border-slate-800 p-4 rounded-2xl mt-4">
                  <Text className="text-blue-400 font-bold text-sm mb-1.5">Explanation</Text>
                  <Text className="text-slate-300 text-sm leading-relaxed">
                    {currentQuestion.explanation}
                  </Text>
                </View>
              )}
            </View>

            {/* Action Buttons */}
            <View className="mb-4">
              {!isSubmitted ? (
                <TouchableOpacity
                  disabled={selectedOptionIndex === null}
                  onPress={() => {
                    if (selectedOptionIndex !== null) {
                      setIsSubmitted(true);
                      const isCorrect = options[selectedOptionIndex]?.is_correct;
                      if (isCorrect) {
                        setCorrectCount(prev => prev + 1);
                      }
                    }
                  }}
                  className={`py-4 rounded-2xl items-center justify-center ${
                    selectedOptionIndex === null ? 'bg-slate-800' : 'bg-blue-600 active:bg-blue-700'
                  }`}
                >
                  <Text className={`font-bold text-base ${
                    selectedOptionIndex === null ? 'text-slate-500' : 'text-white'
                  }`}>
                    Submit Answer
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={() => {
                    if (currentQuestionIndex < questions.length - 1) {
                      setCurrentQuestionIndex(prev => prev + 1);
                      setSelectedOptionIndex(null);
                      setIsSubmitted(false);
                    } else {
                      setIsFinished(true);
                    }
                  }}
                  className="bg-blue-600 py-4 rounded-2xl items-center justify-center active:bg-blue-700"
                >
                  <Text className="text-white font-bold text-base">
                    {currentQuestionIndex < questions.length - 1 ? 'Next Question' : 'See Results'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ) : (
          /* Result Screen */
          <View className="flex-1 px-6 py-10 justify-between items-center">
            <View className="flex-1 justify-center items-center w-full">
              {passed ? (
                <View className="items-center">
                  <View className="bg-green-950/50 p-6 rounded-full border border-green-500/30 mb-6">
                    <Ionicons name="trophy" size={64} color="#22c55e" />
                  </View>
                  <Text className="text-white text-3xl font-extrabold mb-2 text-center">
                    Part Completed!
                  </Text>
                  <Text className="text-slate-400 text-base mb-6 text-center">
                    Excellent work! You've passed the knowledge check.
                  </Text>
                  
                  <View className="bg-slate-900 border border-slate-800 py-4 px-8 rounded-2xl mb-8 items-center">
                    <Text className="text-slate-400 text-xs uppercase tracking-wider mb-1">Score</Text>
                    <Text className="text-green-400 text-3xl font-extrabold">
                      {correctCount} / {questions.length}
                    </Text>
                  </View>

                  <View className="bg-amber-500/10 border border-amber-500/30 px-6 py-3 rounded-full flex-row items-center mb-6">
                    <Ionicons name="sparkles" size={20} color="#f59e0b" style={{ marginRight: 6 }} />
                    <Text className="text-amber-400 font-bold text-lg">+50 XP</Text>
                  </View>
                </View>
              ) : (
                <View className="items-center">
                  <View className="bg-red-950/50 p-6 rounded-full border border-red-500/30 mb-6">
                    <Ionicons name="alert-circle" size={64} color="#ef4444" />
                  </View>
                  <Text className="text-white text-3xl font-extrabold mb-2 text-center">
                    Keep Learning!
                  </Text>
                  <Text className="text-slate-400 text-base mb-6 text-center">
                    You didn't reach the passing score of {QUIZ_PASS_THRESHOLD * 100}%.
                  </Text>

                  <View className="bg-slate-900 border border-slate-800 py-4 px-8 rounded-2xl mb-8 items-center">
                    <Text className="text-slate-400 text-xs uppercase tracking-wider mb-1">Score</Text>
                    <Text className="text-red-400 text-3xl font-extrabold">
                      {correctCount} / {questions.length}
                    </Text>
                  </View>
                </View>
              )}
            </View>

            <View className="w-full mb-6">
              {passed ? (
                <TouchableOpacity
                  onPress={onClose}
                  className="bg-green-600 py-4 rounded-2xl items-center justify-center active:bg-green-700"
                >
                  <Text className="text-white font-extrabold text-lg">Continue</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={onClose}
                  className="bg-blue-600 py-4 rounded-2xl items-center justify-center active:bg-blue-700"
                >
                  <Text className="text-white font-extrabold text-lg">Review Lesson</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}
