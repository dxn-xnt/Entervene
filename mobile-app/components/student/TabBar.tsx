import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { AppColors, Spacing } from '@/constants/theme';

type Tab = {
  id: string;
  label: string;
};

type TabBarProps = {
  tabs: Tab[];
  activeTab: string;
  onChange: (id: string) => void;
};

const TabBar = ({ tabs, activeTab, onChange }: TabBarProps) => {
  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <TouchableOpacity
              key={tab.id}
              onPress={() => onChange(tab.id)}
              activeOpacity={0.7}
              style={[styles.tab, isActive && styles.activeTab]}
            >
              <Text style={[styles.tabText, isActive && styles.activeTabText]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    borderBottomColor: AppColors.muted,
    paddingHorizontal: Spacing.md,
  },
  tab: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    marginRight: 4,
    borderWidth: 1,
    borderColor: 'transparent',
    borderBottomWidth: 0,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  activeTab: {
    borderColor: AppColors.border,
    backgroundColor: AppColors.background,
    marginBottom: -1,
  },
  tabText: {
    fontSize: 14,
    color: AppColors.mutedForeground,
  },
  activeTabText: {
    color: AppColors.foreground,
    fontWeight: '600',
  },
});

export default TabBar;
