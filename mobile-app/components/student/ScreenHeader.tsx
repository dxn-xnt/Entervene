import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDrawer } from '@/context/DrawerContext';
import { AppColors, Spacing, Borders } from '@/constants/theme';

type ScreenHeaderProps = {
  title: string;
  rightElement?: React.ReactNode;
};

const ScreenHeader = ({ title, rightElement }: ScreenHeaderProps) => {
  const { openDrawer } = useDrawer();

  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={openDrawer} activeOpacity={0.7} style={styles.hamburger}>
        <Ionicons name="menu" size={26} color={AppColors.foreground} />
      </TouchableOpacity>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {rightElement ? rightElement : <View style={styles.placeholder} />}
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.muted,
    backgroundColor: AppColors.background,
    gap: 12,
  },
  hamburger: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
    color: AppColors.foreground,
  },
  placeholder: {
    width: 36,
  },
});

export default ScreenHeader;
