import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '@/components/student/ScreenHeader';
import TabBar from '@/components/student/TabBar';
import NotificationCard from '@/components/student/NotificationCard';
import { AppColors, Spacing } from '@/constants/theme';

const STORAGE_KEY = '@entervene_notifications_read';

const tabs = [
  { id: 'all', label: 'All' },
  { id: 'classworks', label: 'Classworks' },
  { id: 'announcements', label: 'Announcements' },
];

const classworkCards = [
  { id: 'cw1', title: 'Written Work #5 - Math 8', description: "Your teacher assigned a new written work on 'Systems of Linear Equations.'", cardInfo: 'Nov 25, 2025 - 8:00 AM  Math 8 - Ms. Reyes', badge: 'Due in 3 hrs' },
  { id: 'cw2', title: 'Performance Task - Science 8', description: "Complete the lab report on 'Force and Motion.'", cardInfo: 'Nov 26, 2025 - 11:59 PM  Science 8 - Mr. Santos', badge: 'Due Tomorrow' },
  { id: 'cw3', title: 'Written Work #3 - English 8', description: 'Online quiz covering Chapters 4-6 of the reading material.', cardInfo: 'Nov 27, 2025 - 9:00 AM  English 8 - Ms. Cruz', badge: 'Due in 2 days' },
];

const announcementCards = [
  { id: 'an1', title: 'No Classes - Nov 30', description: 'Classes are suspended on November 30 in observance of Bonifacio Day.', cardInfo: 'Nov 25, 2025 - 7:00 AM  Admin Office', badge: 'Holiday' },
  { id: 'an2', title: 'Card Distribution', description: 'Report cards will be distributed on December 5.', cardInfo: 'Nov 24, 2025 - 3:00 PM  Grade 8 Office', badge: 'Reminder' },
];

const Notifications = () => {
  const [activeTab, setActiveTab] = useState('all');
  const [allRead, setAllRead] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const val = await AsyncStorage.getItem(STORAGE_KEY);
        if (val === 'true') setAllRead(true);
      } catch { /* ignore */ }
    };
    load();
  }, []);

  const handleMarkAllRead = useCallback(async () => {
    setAllRead(true);
    try { await AsyncStorage.setItem(STORAGE_KEY, 'true'); } catch { /* ignore */ }
  }, []);

  const markReadBtn = (
    <TouchableOpacity onPress={handleMarkAllRead} activeOpacity={0.7} style={[styles.markBtn, allRead && styles.markBtnDone]}>
      <Text style={styles.markBtnText}>{allRead ? '✓' : 'Read all'}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Notifications" rightElement={markReadBtn} />
      <TabBar tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {(activeTab === 'all' || activeTab === 'classworks') && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Classwork</Text>
            {classworkCards.map((c) => (
              <NotificationCard key={c.id} title={c.title} description={c.description} cardInfo={c.cardInfo} badge={c.badge} />
            ))}
          </View>
        )}
        {(activeTab === 'all' || activeTab === 'announcements') && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Announcement</Text>
            {announcementCards.map((c) => (
              <NotificationCard key={c.id} title={c.title} description={c.description} cardInfo={c.cardInfo} badge={c.badge} />
            ))}
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
  markBtn: { backgroundColor: '#7ABA78', borderWidth: 2, borderColor: AppColors.border, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  markBtnDone: { backgroundColor: AppColors.muted },
  markBtnText: { fontSize: 12, fontWeight: '700', color: AppColors.foreground },
});

export default Notifications;
