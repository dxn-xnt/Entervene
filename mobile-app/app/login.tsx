import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '@/context/AuthContext';
import { AppColors, NeoShadow, Spacing, Borders } from '@/constants/theme';

const { width } = Dimensions.get('window');

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [secureText, setSecureText] = useState(true);

  // ── Animations ──
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;
  const cardScale = useRef(new Animated.Value(0.95)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 50,
        friction: 8,
        useNativeDriver: true,
      }),
      Animated.spring(cardScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const triggerShake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 4, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setError('Please fill in all fields.');
      triggerShake();
      return;
    }

    setLoading(true);
    setError('');

    try {
      await login(username.trim(), password);
      router.replace('/(tabs)');
    } catch (err: any) {
      setError(err.message || 'Invalid email or password.');
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />

      {/* Background pattern – decorative squares */}
      <View style={styles.bgPattern}>
        <View style={[styles.bgSquare, styles.bgSquare1]} />
        <View style={[styles.bgSquare, styles.bgSquare2]} />
        <View style={[styles.bgSquare, styles.bgSquare3]} />
        <View style={[styles.bgSquare, styles.bgSquare4]} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Card */}
          <Animated.View
            style={[
              styles.card,
              {
                opacity: fadeAnim,
                transform: [
                  { translateY: slideAnim },
                  { scale: cardScale },
                  { translateX: shakeAnim },
                ],
              },
            ]}
          >
            {/* Card Header */}
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Sign In</Text>
              <Text style={styles.cardDescription}>
                Welcome back! Enter your details to access your account.
              </Text>
            </View>

            {/* Card Content */}
            <View style={styles.cardContent}>
              {/* Email / Username */}
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Email Address</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.input}
                    placeholder="Email"
                    placeholderTextColor={AppColors.placeholder}
                    value={username}
                    onChangeText={(text) => {
                      setUsername(text);
                      if (error) setError('');
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    returnKeyType="next"
                  />
                </View>
              </View>

              {/* Password */}
              <View style={styles.fieldGroup}>
                <View style={styles.passwordLabelRow}>
                  <Text style={styles.label}>Password</Text>
                  <TouchableOpacity activeOpacity={0.7}>
                    <Text style={styles.forgotLink}>Forget password?</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={[styles.input, styles.passwordInput]}
                    placeholder="Password"
                    placeholderTextColor={AppColors.placeholder}
                    value={password}
                    onChangeText={(text) => {
                      setPassword(text);
                      if (error) setError('');
                    }}
                    secureTextEntry={secureText}
                    autoCapitalize="none"
                    returnKeyType="done"
                    onSubmitEditing={handleLogin}
                  />
                  <TouchableOpacity
                    style={styles.eyeButton}
                    onPress={() => setSecureText(!secureText)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.eyeIcon}>{secureText ? '👁' : '👁‍🗨'}</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Error */}
              {error ? (
                <View style={styles.errorContainer}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {/* Remember Me */}
              <TouchableOpacity
                style={styles.checkboxRow}
                onPress={() => setRememberMe(!rememberMe)}
                activeOpacity={0.7}
              >
                <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                  {rememberMe && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={styles.checkboxLabel}>Remember me</Text>
              </TouchableOpacity>

              {/* Sign In Button */}
              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleLogin}
                activeOpacity={0.8}
                disabled={loading}
              >
                <Animated.View style={styles.buttonInner}>
                  {loading ? (
                    <ActivityIndicator color={AppColors.primaryForeground} />
                  ) : (
                    <Text style={styles.buttonText}>Sign In</Text>
                  )}
                </Animated.View>
              </TouchableOpacity>

              {/* Sign Up prompt */}
              <View style={styles.signupRow}>
                <Text style={styles.signupText}>Don't have an account?</Text>
                <TouchableOpacity activeOpacity={0.7}>
                  <Text style={styles.signupLink}>Sign Up</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  root: {
    flex: 1,
    backgroundColor: AppColors.background,
  },

  // ── Background Pattern ──
  bgPattern: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  bgSquare: {
    position: 'absolute',
    borderWidth: Borders.width,
    borderColor: AppColors.accent,
    borderRadius: 0,
    opacity: 0.3,
  },
  bgSquare1: {
    width: 120,
    height: 120,
    top: 60,
    left: -30,
    transform: [{ rotate: '15deg' }],
  },
  bgSquare2: {
    width: 80,
    height: 80,
    top: 140,
    right: -20,
    transform: [{ rotate: '-10deg' }],
    backgroundColor: AppColors.accent,
    opacity: 0.15,
  },
  bgSquare3: {
    width: 60,
    height: 60,
    bottom: 120,
    left: 20,
    transform: [{ rotate: '25deg' }],
    backgroundColor: AppColors.primary,
    opacity: 0.12,
  },
  bgSquare4: {
    width: 100,
    height: 100,
    bottom: 60,
    right: -40,
    transform: [{ rotate: '-20deg' }],
    borderColor: AppColors.primary,
    opacity: 0.2,
  },

  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xxl,
  },

  // ── Brand ──
  brandContainer: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  logoBox: {
    width: 72,
    height: 72,
    backgroundColor: AppColors.primary,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
    shadowColor: AppColors.border,
    ...NeoShadow.lg,
  },
  logoLetter: {
    fontSize: 36,
    fontWeight: '900',
    color: AppColors.primaryForeground,
    letterSpacing: -1,
  },
  brandName: {
    fontSize: 28,
    fontWeight: '900',
    color: AppColors.foreground,
    letterSpacing: 1,
  },
  brandTagline: {
    fontSize: 13,
    color: AppColors.mutedForeground,
    marginTop: 4,
    fontWeight: '500',
  },

  // ── Card ──
  card: {
    backgroundColor: AppColors.card,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    shadowColor: AppColors.border,
    ...NeoShadow.lg,
    overflow: 'hidden',
  },

  // ── Card Header ──
  cardHeader: {
    backgroundColor: AppColors.accent,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    borderBottomWidth: Borders.width,
    borderBottomColor: AppColors.border,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: AppColors.foreground,
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 14,
    color: AppColors.foreground,
    fontWeight: '500',
    opacity: 0.8,
  },

  // ── Card Content ──
  cardContent: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    gap: Spacing.md + 4,
  },

  // ── Fields ──
  fieldGroup: {
    gap: Spacing.sm,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: AppColors.foreground,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    backgroundColor: AppColors.white,
    shadowColor: AppColors.border,
    ...NeoShadow.sm,
  },
  input: {
    flex: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Platform.OS === 'ios' ? 14 : 12,
    fontSize: 15,
    color: AppColors.foreground,
  },
  passwordInput: {
    paddingRight: 48,
  },

  // ── Password Toggle ──
  eyeButton: {
    position: 'absolute',
    right: 0,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  eyeIcon: {
    fontSize: 18,
  },

  // ── Password Label Row ──
  passwordLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  forgotLink: {
    fontSize: 13,
    color: AppColors.foreground,
    textDecorationLine: 'underline',
    fontWeight: '500',
  },

  // ── Error ──
  errorContainer: {
    backgroundColor: '#fef2f2',
    borderWidth: Borders.width,
    borderColor: AppColors.destructive,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
  },
  errorText: {
    color: AppColors.destructive,
    fontSize: 13,
    fontWeight: '600',
  },

  // ── Checkbox ──
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: AppColors.white,
  },
  checkboxChecked: {
    backgroundColor: AppColors.primary,
  },
  checkmark: {
    fontSize: 14,
    fontWeight: '900',
    color: AppColors.primaryForeground,
    lineHeight: 18,
  },
  checkboxLabel: {
    fontSize: 14,
    color: AppColors.foreground,
    fontWeight: '500',
  },

  // ── Button ──
  button: {
    backgroundColor: AppColors.primary,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: AppColors.border,
    ...NeoShadow.md,
    marginTop: Spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.7,
    ...NeoShadow.xs,
  },
  buttonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '900',
    color: AppColors.primaryForeground,
    letterSpacing: 0.5,
  },

  // ── Sign Up ──
  signupRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  signupText: {
    fontSize: 14,
    color: AppColors.foreground,
  },
  signupLink: {
    fontSize: 14,
    fontWeight: '700',
    color: AppColors.foreground,
    textDecorationLine: 'underline',
  },

  // ── Role Badges ──
  roleBadgesContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.md,
    marginTop: Spacing.xl,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: Borders.width,
    borderColor: AppColors.border,
    backgroundColor: AppColors.white,
    shadowColor: AppColors.border,
    ...NeoShadow.xs,
  },
  roleBadgeTeacher: {
    backgroundColor: AppColors.accent,
  },
  roleBadgeStudent: {
    backgroundColor: AppColors.primary,
  },
  roleBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: AppColors.primaryForeground,
  },
});
