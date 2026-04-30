import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '@/components/student/ScreenHeader';
import TabBar from '@/components/student/TabBar';
import ToDoItem from '@/components/student/ToDoItem';
import { AppColors, Spacing } from '@/constants/theme';

const todoTabs = [
  { id: 'pending', label: 'Pending' },
  { id: 'pastdue', label: 'Past Due' },
  { id: 'completed', label: 'Completed' },
];

const interventionItems = [
  { title: 'Science Quiz', subject: 'Computer Programming', deadline: 'October 30, 2025' },
  { title: 'Math Remediation', subject: 'Mathematics 8', deadline: 'November 2, 2025' },
];

const pastDueItems = [
  { title: 'Assignment 4', subject: 'Computer Programming', deadline: 'October 30, 2025' },
  { title: 'Assignment 3', subject: 'Computer Programming', deadline: 'October 28, 2025' },
  { title: 'Assignment 2', subject: 'Computer Programming', deadline: 'October 25, 2025' },
];

const upcomingItems = [
  { title: 'Assignment 6', subject: 'Computer Programming', deadline: 'November 5, 2025' },
  { title: 'Performance Task', subject: 'Science 8', deadline: 'November 7, 2025' },
];

const completedItems = [
  { title: 'Assignment 1', subject: 'Computer Programming', deadline: 'October 20, 2025' },
  { title: 'Written Work #1', subject: 'English 8', deadline: 'October 18, 2025' },
];

const ToDo = () => {
  const [activeTab, setActiveTab] = useState('pending');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="To Do" />
      <TabBar tabs={todoTabs} activeTab={activeTab} onChange={setActiveTab} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {activeTab === 'pending' && (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Intervention</Text>
              {interventionItems.map((item, i) => <ToDoItem key={i} {...item} />)}
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Past Due</Text>
              {pastDueItems.map((item, i) => <ToDoItem key={i} {...item} />)}
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Upcoming</Text>
              {upcomingItems.map((item, i) => <ToDoItem key={i} {...item} />)}
            </View>
          </>
        )}
        {activeTab === 'pastdue' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Past Due</Text>
            {pastDueItems.map((item, i) => <ToDoItem key={i} {...item} />)}
          </View>
        )}
        {activeTab === 'completed' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Completed</Text>
            {completedItems.map((item, i) => <ToDoItem key={i} {...item} />)}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.background },
  scroll: { flex: 1 },
  content: { padding: Spacing.lg, gap: 24, paddingBottom: 32 },
  section: { gap: 12 },
  sectionTitle: { fontSize: 22, fontWeight: '700', color: AppColors.foreground },
});

export default ToDo;
