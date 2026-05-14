import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Animated,
  Dimensions,
  StyleSheet,
  Modal,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDrawer } from '@/context/DrawerContext';
import { useAuth } from '@/context/AuthContext';
import { AppColors, NeoShadow, Spacing, Borders } from '@/constants/theme';
import { useStudentSubjects } from '@/hooks/useStudentSubjects';

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
  { id: 'storyboard',    label: 'Study Board',   icon: 'grid-outline',          route: '/student/storyboard' },
  { id: 'subjects',      label: 'Subjects',       icon: 'book-outline',          route: '/student/subjects' },
  { id: 'grades',        label: 'Grades',         icon: 'stats-chart-outline',   route: '/student/grades' },
  { id: 'todo',          label: 'To Do',          icon: 'list-outline',          route: '/student/todo' },
  { id: 'notifications', label: 'Notifications',  icon: 'notifications-outline', route: '/student/notifications' },
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

  const slideAnim   = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;

  const [modalVisible,    setModalVisible]    = useState(false);
  const [userPanelVisible, setUserPanelVisible] = useState(false);
  const [loggingOut,       setLoggingOut]       = useState(false);

  const { activeQuarter } = useStudentSubjects();

  useEffect(() => {
    if (isOpen) {
      setModalVisible(true);
      requestAnimationFrame(() => {
        Animated.parallel([
          Animated.spring(slideAnim,   { toValue: 0,             tension: 65, friction: 11, useNativeDriver: true }),
          Animated.timing(overlayAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
        ]).start();
      });
    } else {
      setUserPanelVisible(false);
      Animated.parallel([
        Animated.spring(slideAnim,   { toValue: -DRAWER_WIDTH, tension: 65, friction: 11, useNativeDriver: true }),
        Animated.timing(overlayAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setModalVisible(false);
      });
    }
  }, [isOpen]);

  const handleNavigate = (route: string) => {
    closeDrawer();
    setTimeout(() => router.push(route as any), 280);
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    setUserPanelVisible(false);
    closeDrawer();
    await logout();
    router.replace('/login');
  };

  const isActiveRoute = (route: string) =>
    pathname === route || pathname.startsWith(route + '/');

  const initials = session?.full_name ? getInitials(session.full_name) : '?';

  return (
    <Modal
      visible={modalVisible}
      transparent
      animationType="none"
      onRequestClose={closeDrawer}
      statusBarTranslucent
    >
      {/* Dim overlay — tap to close */}
      <TouchableWithoutFeedback onPress={closeDrawer}>
        <Animated.View style={[styles.overlay, { opacity: overlayAnim }]} />
      </TouchableWithoutFeedback>

      {/* Sliding drawer panel */}
      <Animated.View style={[styles.drawer, { transform: [{ translateX: slideAnim }] }]}>
        <SafeAreaView style={styles.drawerInner} edges={['top', 'bottom']}>

          {/* Brand */}
          <View style={styles.brandSection}>
            <View style={styles.logoBox}>
              <Text style={styles.logoText}>E</Text>
            </View>
            <View>
              <Text style={styles.brandName}>ENTERVENE</Text>
              <Text style={styles.brandTagline}>MSTS EDUHUB · STUDENT</Text>
            </View>
          </View>

          {/* Quarter Selector */}
          <TouchableOpacity style={styles.quarterSelector} activeOpacity={0.7}>
            <Text style={styles.quarterText}>
              {activeQuarter
                ? `${activeQuarter.period_name} (${activeQuarter.year_label})`
                : 'Loading quarter…'}
            </Text>
            <Ionicons name="chevron-down" size={16} color={AppColors.foreground} />
          </TouchableOpacity>

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

          {/* User Section */}
          <TouchableOpacity
            style={styles.userSection}
            onPress={() => setUserPanelVisible((v) => !v)}
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
            <Ionicons
              name={userPanelVisible ? 'chevron-up' : 'ellipsis-vertical'}
              size={18}
              color={AppColors.mutedForeground}
            />
          </TouchableOpacity>

          {/* Inline user action panel */}
          {userPanelVisible && (
            <View style={styles.userPanel}>
              <Pressable
                style={({ pressed }) => [styles.panelItem, pressed && styles.panelItemPressed]}
                onPress={() => setUserPanelVisible(false)}
              >
                <Ionicons name="person-circle-outline" size={18} color={AppColors.foreground} />
                <Text style={styles.panelItemText}>Account</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.panelItem, pressed && styles.panelItemPressed]}
                onPress={() => { setUserPanelVisible(false); handleNavigate('/student/notifications'); }}
              >
                <Ionicons name="notifications-outline" size={18} color={AppColors.foreground} />
                <Text style={styles.panelItemText}>Notifications</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.panelItem, pressed && styles.panelItemPressed]}
                onPress={handleLogout}
                disabled={loggingOut}
              >
                {loggingOut
                  ? <ActivityIndicator size="small" color={AppColors.destructive} />
                  : <Ionicons name="log-out-outline" size={18} color={AppColors.destructive} />
                }
                <Text style={[styles.panelItemText, styles.panelItemDestructive]}>
                  {loggingOut ? 'Logging out…' : 'Log out'}
                </Text>
              </Pressable>
            </View>
          )}
        </SafeAreaView>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  drawer: {
    position: 'absolute',
    top: 0, bottom: 0, left: 0,
    width: DRAWER_WIDTH,
    backgroundColor: AppColors.background,
    borderRightWidth: Borders.width,
    borderRightColor: AppColors.border,
    elevation: 20,
  },
  drawerInner: {
    flex: 1,
    paddingTop: Spacing.md,
  },
  brandSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.lg,
  },
  logoBox: {
    width: 44, height: 44,
    backgroundColor: AppColors.primary,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    justifyContent: 'center',
    alignItems: 'center',
    ...NeoShadow.sm,
  },
  logoText: { fontSize: 22, fontWeight: '900', color: AppColors.primaryForeground },
  brandName: { fontSize: 16, fontWeight: '900', color: AppColors.foreground, letterSpacing: 1 },
  brandTagline: { fontSize: 10, fontWeight: '600', color: AppColors.mutedForeground, letterSpacing: 0.5 },
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
    marginHorizontal: Spacing.md,
    backgroundColor: AppColors.card,
    ...NeoShadow.xs,
  },
  quarterText: { fontSize: 13, fontWeight: '600', color: AppColors.foreground },
  menuLabel: {
    fontSize: 11, fontWeight: '700', color: AppColors.mutedForeground,
    textTransform: 'uppercase', letterSpacing: 1,
    marginBottom: 8, marginHorizontal: Spacing.md,
  },
  menuList: { gap: 4 },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 12, paddingVertical: 12,
  },
  menuItemActive: { backgroundColor: AppColors.muted },
  menuItemText: { flex: 1, fontSize: 15, fontWeight: '500', color: AppColors.mutedForeground },
  menuItemTextActive: { fontWeight: '700', color: AppColors.foreground },
  badge: {
    backgroundColor: AppColors.primary, borderWidth: 1.5, borderColor: AppColors.border,
    borderRadius: 10, minWidth: 24, height: 24,
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6,
  },
  badgeText: { fontSize: 11, fontWeight: '800', color: AppColors.primaryForeground },
  userSection: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: Spacing.md,
    borderTopWidth: Borders.width, borderTopColor: AppColors.border,
    marginBottom: Spacing.sm,
  },
  avatar: {
    width: 38, height: 38, borderRadius: 8,
    borderWidth: Borders.width, borderColor: AppColors.border,
    backgroundColor: AppColors.muted, justifyContent: 'center', alignItems: 'center',
  },
  avatarInitials: { fontSize: 13, fontWeight: '700', color: AppColors.foreground },
  userName: { fontSize: 14, fontWeight: '700', color: AppColors.foreground },
  userEmail: { fontSize: 11, color: AppColors.mutedForeground },
  userPanel: {
    borderTopWidth: Borders.width, borderTopColor: AppColors.border,
    marginBottom: Spacing.sm,
    backgroundColor: AppColors.card, borderRadius: 8, overflow: 'hidden',
    marginHorizontal: Spacing.md,
  },
  panelItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 13,
  },
  panelItemPressed: { backgroundColor: AppColors.accent },
  panelItemText: { fontSize: 14, fontWeight: '500', color: AppColors.foreground },
  panelItemDestructive: { color: AppColors.destructive },
});

export default DrawerMenu;