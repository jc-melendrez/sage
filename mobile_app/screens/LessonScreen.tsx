import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QuizModal from '../components/QuizModal';

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

interface LessonPart {
  id: number;
  part_number: number;
  part_title: string;
  beginner_summary: string;
  advanced_summary: string;
  questions: QuizQuestion[];
}

interface LearningModule {
  id: number;
  title: string;
  lesson_parts: LessonPart[];
}

interface LessonScreenProps {
  module: LearningModule;
  initialUnlockedParts?: number[]; // array of part_number values the student has already passed
  onXpEarned?: (amount: number) => void;
}

export default function LessonScreen({
  module,
  initialUnlockedParts,
  onXpEarned,
}: LessonScreenProps) {
  const [activePartIndex, setActivePartIndex] = useState<number>(0);
  const [summaryLevel, setSummaryLevel] = useState<'beginner' | 'advanced'>('beginner');
  const [isQuizOpen, setIsQuizOpen] = useState<boolean>(false);
  const [unlockedParts, setUnlockedParts] = useState<number[]>(
    initialUnlockedParts || [1]
  );

  // Reset summary level to beginner whenever active part index changes
  useEffect(() => {
    setSummaryLevel('beginner');
  }, [activePartIndex]);

  const parts = module.lesson_parts || [];
  const activePart = parts[activePartIndex];

  // Safeguard if activePart is not available
  if (!activePart) {
    return (
      <SafeAreaView className="flex-1 bg-slate-950 justify-center items-center">
        <Text className="text-slate-400 font-medium">No active lesson part found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-950">
      {/* 1. PART PROGRESS INDICATOR */}
      <View className="flex-row justify-between px-5 pt-4 pb-2">
        {parts.map((part, index) => {
          const isUnlocked = unlockedParts.includes(part.part_number);
          const isActive = activePartIndex === index;

          return (
            <TouchableOpacity
              key={part.id || index}
              disabled={!isUnlocked}
              onPress={() => setActivePartIndex(index)}
              className={`flex-1 flex-row items-center justify-center py-3 px-2 mx-1 rounded-xl border ${
                isActive
                  ? 'bg-blue-600 border-blue-600'
                  : 'bg-slate-800 border-slate-700'
              }`}
              style={{ opacity: isUnlocked ? 1.0 : 0.4 }}
            >
              {!isUnlocked && (
                <View className="mr-1">
                  <Ionicons name="lock-closed" size={14} color="#94a3b8" />
                </View>
              )}
              <Text
                className={`font-semibold text-sm ${
                  isActive ? 'text-white' : 'text-slate-400'
                }`}
              >
                Part {part.part_number}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* 2. BEGINNER / ADVANCED TOGGLE */}
      <View className="flex-row bg-slate-800 p-1 rounded-full my-3 self-center">
        <TouchableOpacity
          onPress={() => setSummaryLevel('beginner')}
          className={`px-6 py-2 rounded-full ${
            summaryLevel === 'beginner' ? 'bg-blue-600' : 'bg-transparent'
          }`}
        >
          <Text
            className={`font-semibold text-sm ${
              summaryLevel === 'beginner' ? 'text-white' : 'text-slate-400'
            }`}
          >
            Beginner
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setSummaryLevel('advanced')}
          className={`px-6 py-2 rounded-full ${
            summaryLevel === 'advanced' ? 'bg-blue-600' : 'bg-transparent'
          }`}
        >
          <Text
            className={`font-semibold text-sm ${
              summaryLevel === 'advanced' ? 'text-white' : 'text-slate-400'
            }`}
          >
            Advanced
          </Text>
        </TouchableOpacity>
      </View>

      {/* 3. SCROLLABLE CONTENT BODY */}
      <ScrollView className="flex-1">
        <View className="px-5 py-4">
          <Text className="text-2xl font-bold text-white mb-4">
            {activePart.part_title}
          </Text>
          <Text className="text-base text-slate-300 leading-relaxed">
            {summaryLevel === 'beginner'
              ? activePart.beginner_summary
              : activePart.advanced_summary}
          </Text>
        </View>
      </ScrollView>

      {/* 4. "TAKE KNOWLEDGE CHECK" BUTTON */}
      <View className="px-5 py-4 bg-slate-900 border-t border-slate-800">
        <TouchableOpacity
          onPress={() => setIsQuizOpen(true)}
          className="bg-blue-600 py-4 rounded-xl items-center justify-center"
        >
          <Text className="text-white font-bold text-base">
            Take Knowledge Check
          </Text>
        </TouchableOpacity>
      </View>

      {/* 5. QUIZ MODAL */}
      {isQuizOpen && (
        <QuizModal
          questions={activePart.questions}
          partNumber={activePart.part_number}
          onClose={() => setIsQuizOpen(false)}
          onPartCompleted={(partNum: number) =>
            setUnlockedParts((prev) => [...prev, partNum + 1])
          }
          onXpEarned={onXpEarned || (() => {})}
        />
      )}
    </SafeAreaView>
  );
}
