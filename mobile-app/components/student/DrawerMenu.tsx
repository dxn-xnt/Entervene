import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  Dimensions,
  StyleSheet,
  Pressable,
  Modal,
  ActivityIndicator,
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

const getInitials = (fullName: string): string => {
  const parts = fullName.trim().split(' ').filter((p) => p.length > 0);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const DrawerMenu = () => {
  const { isOpen, closeDrawer } = useDrawer();
  const { logout, session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const slideAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const [userMenuVisible, setUserMenuVisible] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

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
    setLoggingOut(true);
    setUserMenuVisible(false);
    closeDrawer();
    await logout();
    router.replace('/login');
  };

  const isActiveRoute = (route: string) => {
    return pathname === route || pathname.startsWith(route + '/');
  };

  const initials = session?.full_name ? getInitials(session.full_name) : '?';

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <Animated.View style={[styles.overlay, { opacity: overlayAnim }]}>
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

          <View style={{ flex: 1 }} />

          {/* User Section — tapping opens the popup menu */}
          <TouchableOpacity
            style={styles.userSection}
            onPress={() => setUserMenuVisible(true)}
            activeOpacity={0.7}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.userName} numberOfLines={1}>
                {session?.full_name ?? 'Unknown'}
              </Text>
              <Text style={styles.userEmail} numberOfLines={1}>
                {session?.email ?? ''}
              </Text>
            </View>
            <Ionicons name="ellipsis-vertical" size={18} color={AppColors.mutedForeground} />
          </TouchableOpacity>
        </SafeAreaView>
      </Animated.View>

      {/* User Popup Menu */}
      <Modal
        visible={userMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setUserMenuVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setUserMenuVisible(false)}>
          <View style={styles.popupMenu}>
            {/* User info header inside popup */}
            <View style={styles.popupHeader}>
              <View style={styles.popupAvatar}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.popupName} numberOfLines={1}>
                  {session?.full_name ?? 'Unknown'}
                </Text>
                <Text style={styles.popupEmail} numberOfLines={1}>
                  {session?.email ?? ''}
                </Text>
              </View>
            </View>

            <View style={styles.popupDivider} />

            {/* Account */}
            <Pressable
              style={({ pressed }) => [styles.popupItem, pressed && styles.popupItemPressed]}
              onPress={() => {
                setUserMenuVisible(false);
              }}
            >
              <Ionicons name="person-circle-outline" size={18} color={AppColors.foreground} />
              <Text style={styles.popupItemText}>Account</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.popupItem, pressed && styles.popupItemPressed]}
              onPress={() => {
                setUserMenuVisible(false);
                handleNavigate('/student/notifications');
              }}
            >
              <Ionicons name="notifications-outline" size={18} color={AppColors.foreground} />
              <Text style={styles.popupItemText}>Notifications</Text>
            </Pressable>


            <Pressable
              style={({ pressed }) => [styles.popupItem, pressed && styles.popupItemPressed]}
              onPress={handleLogout}
              disabled={loggingOut}
            >
              {loggingOut ? (
                <ActivityIndicator size="small" color={AppColors.destructive} />
              ) : (
                <Ionicons name="log-out-outline" size={18} color={AppColors.destructive} />
              )}
              <Text style={[styles.popupItemText, styles.popupItemDestructive]}>
                {loggingOut ? 'Logging out…' : 'Log out'}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
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
    backgroundColor: AppColors.muted,
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

  // User section (bottom of drawer)
  userSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: Spacing.md,
    borderTopWidth: Borders.width,
    borderTopColor: AppColors.border,
    marginBottom: Spacing.sm,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 8,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    backgroundColor: AppColors.muted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: {
    fontSize: 13,
    fontWeight: '700',
    color: AppColors.foreground,
  },
  userName: {
    fontSize: 14,
    fontWeight: '700',
    color: AppColors.foreground,
  },
  userEmail: {
    fontSize: 11,
    color: AppColors.mutedForeground,
  },
  popupItemPressed: {
    backgroundColor: AppColors.accent,
  },

  // Popup modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing.lg,
    paddingBottom: 40,
  },
  popupMenu: {
    backgroundColor: AppColors.card,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    borderRadius: 10,
    overflow: 'hidden',
    ...NeoShadow.sm,
  },
  popupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
  },
  popupAvatar: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    backgroundColor: AppColors.muted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  popupName: {
    fontSize: 14,
    fontWeight: '700',
    color: AppColors.foreground,
  },
  popupEmail: {
    fontSize: 11,
    color: AppColors.mutedForeground,
  },
  popupDivider: {
    height: Borders.width,
    backgroundColor: AppColors.border,
  },
  popupItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  popupItemText: {
    fontSize: 14,
    fontWeight: '500',
    color: AppColors.foreground,
  },
  popupItemDestructive: {
    color: AppColors.destructive,
  },
});

export default DrawerMenu;