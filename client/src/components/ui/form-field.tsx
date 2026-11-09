import { useEffect, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type KeyboardTypeOptions,
  useAnimatedValue,
  View,
} from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { type AppTheme, useTheme } from '@/theme';

interface FormFieldProps {
  label: string;
  testID: string;
  errorTestID: string;
  value: string;
  onChangeText: (value: string) => void;
  autoComplete: 'name' | 'email' | 'username' | 'current-password' | 'new-password';
  keyboardType?: KeyboardTypeOptions;
  maxLength: number;
  secure?: boolean;
  error?: string;
  hint?: string;
  editable?: boolean;
}

export function FormField({
  label,
  testID,
  errorTestID,
  value,
  onChangeText,
  autoComplete,
  keyboardType = 'default',
  maxLength,
  secure = false,
  error,
  hint,
  editable = true,
}: FormFieldProps) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const shake = useAnimatedValue(0);
  const fade = useAnimatedValue(1);
  const styles = createStyles(theme);

  useEffect(() => {
    if (!error) return;
    if (reducedMotion) {
      fade.setValue(0);
      Animated.timing(fade, {
        duration: theme.motion.quickMs,
        toValue: 1,
        useNativeDriver: true,
      }).start();
      return;
    }
    shake.setValue(0);
    const distance = theme.sizes.errorShake;
    const timing = (toValue: number) =>
      Animated.timing(shake, {
        duration: theme.motion.quickMs / 2.5,
        toValue,
        useNativeDriver: true,
      });
    const animation = Animated.sequence([
      timing(distance),
      timing(-distance),
      timing(distance),
      timing(-distance),
      timing(0),
    ]);
    animation.start();
    return () => animation.stop();
  }, [error, fade, reducedMotion, shake, theme.motion.quickMs, theme.sizes.errorShake]);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Animated.View
        style={[
          styles.inputShell,
          focused && styles.focused,
          Boolean(error) && styles.invalid,
          secure && styles.passwordShell,
          { opacity: fade, transform: [{ translateX: shake }] },
        ]}>
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={hint}
          autoCapitalize={secure || keyboardType === 'email-address' ? 'none' : 'sentences'}
          autoComplete={autoComplete}
          autoCorrect={false}
          editable={editable}
          keyboardType={keyboardType}
          maxLength={maxLength}
          onBlur={() => setFocused(false)}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          placeholderTextColor={theme.colors.muted}
          secureTextEntry={secure && !visible}
          selectionColor={theme.colors.forest}
          style={styles.input}
          testID={testID}
          value={value}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={visible ? 'Hide password' : 'Show password'}
            onPress={() => setVisible((current) => !current)}
            testID={testID.replace('.input', '.toggle')}
            style={({ pressed }) => [styles.visibilityButton, pressed && styles.pressed]}>
            <AppIcon name={visible ? 'eye-off-outline' : 'eye-outline'} color={theme.colors.muted} />
          </Pressable>
        ) : null}
      </Animated.View>
      {error ? (
        <View accessibilityRole="alert" style={styles.errorRow} testID={errorTestID}>
          <AppIcon name="alert-circle-outline" color={theme.colors.urgentInk} size={theme.sizes.iconSmall} />
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    field: { gap: theme.spacing.sm },
    label: { ...theme.type.formLabel, color: theme.colors.inkSecondary },
    inputShell: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.input,
      borderWidth: theme.sizes.borderHairline,
      justifyContent: 'center',
      minHeight: theme.sizes.input,
    },
    passwordShell: { alignItems: 'center', flexDirection: 'row', paddingRight: theme.spacing.xxs },
    focused: { borderColor: theme.colors.forest, borderWidth: theme.sizes.focusRing },
    invalid: { borderColor: theme.colors.urgentInk, borderWidth: theme.sizes.focusRing },
    input: {
      ...theme.type.bodyLarge,
      color: theme.colors.ink,
      flex: 1,
      minHeight: theme.sizes.input,
      paddingHorizontal: theme.spacing.tileInner,
      paddingVertical: theme.spacing.sm,
    },
    visibilityButton: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: theme.sizes.touchTarget,
      minWidth: theme.sizes.touchTarget,
    },
    errorRow: { alignItems: 'flex-start', flexDirection: 'row', gap: theme.spacing.sm },
    error: { ...theme.type.meta, color: theme.colors.urgentInk, flex: 1 },
    hint: { ...theme.type.meta, color: theme.colors.muted },
    pressed: { opacity: 0.65 },
  });
}
