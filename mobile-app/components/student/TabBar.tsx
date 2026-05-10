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
      <View style={styles.backgroundHolder}></View>
      <ScrollView style={styles.foregroundHolder} horizontal showsHorizontalScrollIndicator={false}>
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

  },
  backgroundHolder: {
    height: 36,
    borderBottomColor: AppColors.border,
    borderBottomWidth: 2,
  },
  foregroundHolder: {
    zIndex: 10,
    height: 36,
    position: 'absolute',
    paddingHorizontal: Spacing.md,
  },
  tab: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    marginRight: 4,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRightWidth: 6,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  activeTab: {
    borderColor: AppColors.border,
    borderBottomWidth: 4,
    borderRightWidth: 6,
    borderBottomColor: AppColors.background,
    backgroundColor: AppColors.background,
    marginBottom: -4,
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
