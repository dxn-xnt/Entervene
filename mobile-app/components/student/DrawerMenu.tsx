import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  Dimensions,
  StyleSheet,
  Pressable,
} from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDrawer } from '@/context/DrawerContext';
import { useAuth } from '@/context/AuthContext';
import { AppColors, NeoShadow, Spacing, Borders } from '@/constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DRAWER_WIDTH = SCREEN_WIDTH * 0.78;

type MenuItem = {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  badge?: number;
};

const menuItems: MenuItem[] = [
  { id: 'storyboard', label: 'Study Board', icon: 'grid-outline', route: '/student/storyboard' },
  { id: 'subjects', label: 'Subjects', icon: 'book-outline', route: '/student/subjects' },
  { id: 'grades', label: 'Grades', icon: 'stats-chart-outline', route: '/student/grades' },
  { id: 'todo', label: 'To Do', icon: 'list-outline', route: '/student/todo', badge: 12 },
  { id: 'notifications', label: 'Notifications', icon: 'notifications-outline', route: '/student/notifications' },
];

const DrawerMenu = () => {
  const { isOpen, closeDrawer } = useDrawer();
  const { logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const slideAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isOpen) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          tension: 65,
          friction: 11,
          useNativeDriver: true,
        }),
        Animated.timing(overlayAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: -DRAWER_WIDTH,
          tension: 65,
          friction: 11,
          useNativeDriver: true,
        }),
        Animated.timing(overlayAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isOpen]);

  const handleNavigate = (route: string) => {
    closeDrawer();
    setTimeout(() => {
      router.push(route as any);
    }, 100);
  };

  const handleLogout = async () => {
    closeDrawer();
    await logout();
    router.replace('/login');
  };

  const isActiveRoute = (route: string) => {
    return pathname === route || pathname.startsWith(route + '/');
  };

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <Animated.View
          style={[styles.overlay, { opacity: overlayAnim }]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={closeDrawer} />
        </Animated.View>
      )}

      {/* Drawer */}
      <Animated.View
        style={[styles.drawer, { transform: [{ translateX: slideAnim }] }]}
      >
        <SafeAreaView style={styles.drawerInner} edges={['top', 'bottom']}>
          {/* Logo / Brand */}
          <View style={styles.brandSection}>
            <View style={styles.logoBox}>
              <Text style={styles.logoText}>E</Text>
            </View>
            <View>
              <Text style={styles.brandName}>ENTERVENE</Text>
              <Text style={styles.brandTagline}>MSTS EDUHUB</Text>
            </View>
          </View>

          {/* Quarter Selector */}
          <TouchableOpacity style={styles.quarterSelector} activeOpacity={0.7}>
            <Text style={styles.quarterText}>1st Quarter (2025-2026)</Text>
            <Ionicons name="chevron-down" size={16} color={AppColors.foreground} />
          </TouchableOpacity>

          {/* Menu Label */}
          <Text style={styles.menuLabel}>Menu</Text>

          {/* Menu Items */}
          <View style={styles.menuList}>
            {menuItems.map((item) => {
              const active = isActiveRoute(item.route);
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.menuItem, active && styles.menuItemActive]}
                  onPress={() => handleNavigate(item.route)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={item.icon}
                    size={20}
                    color={active ? AppColors.foreground : AppColors.mutedForeground}
                  />
                  <Text style={[styles.menuItemText, active && styles.menuItemTextActive]}>
                    {item.label}
                  </Text>
                  {item.badge !== undefined && item.badge > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{item.badge}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Spacer */}
          <View style={{ flex: 1 }} />

          {/* User Profile / Logout */}
          <TouchableOpacity style={styles.userSection} onPress={handleLogout} activeOpacity={0.7}>
            <View style={styles.avatar}>
              <Ionicons name="person" size={20} color={AppColors.foreground} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.userName}>John Doe</Text>
              <Text style={styles.userRole}>Student</Text>
            </View>
            <Ionicons name="log-out-outline" size={20} color={AppColors.mutedForeground} />
          </TouchableOpacity>
        </SafeAreaView>
      </Animated.View>
    </>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    zIndex: 90,
  },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: DRAWER_WIDTH,
    backgroundColor: AppColors.background,
    borderRightWidth: Borders.width,
    borderRightColor: AppColors.border,
    zIndex: 100,
    elevation: 20,
  },
  drawerInner: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },

  // Brand
  brandSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: Spacing.lg,
  },
  logoBox: {
    width: 44,
    height: 44,
    backgroundColor: AppColors.primary,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: AppColors.border,
    ...NeoShadow.sm,
  },
  logoText: {
    fontSize: 22,
    fontWeight: '900',
    color: AppColors.primaryForeground,
  },
  brandName: {
    fontSize: 16,
    fontWeight: '900',
    color: AppColors.foreground,
    letterSpacing: 1,
  },
  brandTagline: {
    fontSize: 10,
    fontWeight: '600',
    color: AppColors.mutedForeground,
    letterSpacing: 0.5,
  },

  // Quarter Selector
  quarterSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: Spacing.lg,
    backgroundColor: AppColors.card,
    shadowColor: AppColors.border,
    ...NeoShadow.xs,
  },
  quarterText: {
    fontSize: 13,
    fontWeight: '600',
    color: AppColors.foreground,
  },

  // Menu
  menuLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: AppColors.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  menuList: {
    gap: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
  },
  menuItemActive: {
    backgroundColor: AppColors.accent,
  },
  menuItemText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: AppColors.mutedForeground,
  },
  menuItemTextActive: {
    fontWeight: '700',
    color: AppColors.foreground,
  },
  badge: {
    backgroundColor: AppColors.primary,
    borderWidth: 1.5,
    borderColor: AppColors.border,
    borderRadius: 10,
    minWidth: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: AppColors.primaryForeground,
  },

  // User
  userSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: AppColors.muted,
    marginBottom: Spacing.sm,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    backgroundColor: AppColors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  userName: {
    fontSize: 14,
    fontWeight: '700',
    color: AppColors.foreground,
  },
  userRole: {
    fontSize: 11,
    color: AppColors.mutedForeground,
  },
});

export default DrawerMenu;
