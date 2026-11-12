import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isApiError } from '@/api';
import { useAuth } from '@/auth/auth-provider';
import { AppButton } from '@/components/ui/app-button';
import { FormField } from '@/components/ui/form-field';
import { IconButton } from '@/components/ui/icon-button';
import { type AppTheme, useTheme } from '@/theme';

interface AuthScreenProps {
  mode: 'login' | 'signup';
}

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
}

export function AuthScreen({ mode }: AuthScreenProps) {
  const theme = useTheme();
  const { login, signup } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const styles = createStyles(theme);
  const signingUp = mode === 'signup';

  async function submit() {
    const errors = validate({ signingUp, name, email, password });
    setFieldErrors(errors);
    setFormError('');
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      if (signingUp) {
        await signup({ display_name: name.trim(), email: email.trim(), password });
      } else {
        await login({ email: email.trim(), password });
      }
      router.replace('/home');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'We couldn’t sign you in. Try again.';
      if (isApiError(cause) && cause.code === 'invalid_credentials') {
        setFieldErrors({ password: 'That email and password don’t match. Try again.' });
      } else if (isApiError(cause) && cause.code === 'email_taken') {
        setFieldErrors({ email: message });
      } else {
        setFormError(message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}>
        <IconButton icon="arrow-left" label="Back" onPress={() => router.back()} testID={`${mode}.back.button`} />
        <View style={styles.header}>
          <Text style={styles.title}>{signingUp ? 'Create your account' : 'Welcome back'}</Text>
          <Text style={styles.subtitle}>
            {signingUp ? 'Start tracking what’s in your fridge.' : 'Your fridge missed you.'}
          </Text>
        </View>
        <View style={styles.form}>
          {signingUp ? (
            <FormField
              autoComplete="name"
              error={fieldErrors.name}
              errorTestID="signup.name.error"
              label="Name"
              maxLength={60}
              onChangeText={setName}
              testID="signup.name.input"
              value={name}
              editable={!submitting}
            />
          ) : null}
          <FormField
            autoComplete={signingUp ? 'email' : 'username'}
            editable={!submitting}
            error={fieldErrors.email}
            errorTestID={`${mode}.email.error`}
            keyboardType="email-address"
            label="Email"
            maxLength={254}
            onChangeText={setEmail}
            testID={`${mode}.email.input`}
            value={email}
          />
          <FormField
            autoComplete={signingUp ? 'new-password' : 'current-password'}
            editable={!submitting}
            error={fieldErrors.password}
            errorTestID={`${mode}.password.error`}
            hint={signingUp ? 'At least 8 characters.' : undefined}
            label="Password"
            maxLength={256}
            onChangeText={setPassword}
            secure
            testID={`${mode}.password.input`}
            value={password}
          />
          {formError ? (
            <Text accessibilityRole="alert" style={styles.formError} testID={`${mode}.form.error`}>
              {formError}
            </Text>
          ) : null}
          <AppButton
            label={signingUp ? 'Create account' : 'Log in'}
            loading={submitting}
            onPress={() => void submit()}
            testID={`${mode}.submit.button`}
          />
        </View>
        <View style={styles.switchRow}>
          <Text style={styles.switchText}>{signingUp ? 'Already have an account?' : 'New here?'}</Text>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={signingUp ? 'Log in' : 'Create an account'}
            onPress={() => router.replace(signingUp ? '/login' : '/signup')}
            style={({ pressed }) => [styles.switchButton, pressed && styles.pressed]}
            testID={signingUp ? 'signup.login.link' : 'login.signup.link'}>
            <Text style={styles.switchLink}>{signingUp ? 'Log in' : 'Create an account'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function validate({
  signingUp,
  name,
  email,
  password,
}: {
  signingUp: boolean;
  name: string;
  email: string;
  password: string;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (signingUp && !name.trim()) errors.name = 'Enter your name.';
  const normalizedEmail = email.trim();
  if (!normalizedEmail) errors.email = 'Enter your email.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) errors.email = 'Enter a valid email address.';
  if (!password) errors.password = 'Enter your password.';
  else if (signingUp && password.length < 8) errors.password = 'Use at least 8 characters.';
  return errors;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.ground },
    content: { flexGrow: 1, gap: theme.spacing.xl, padding: theme.spacing.xl },
    header: { gap: theme.spacing.xs },
    title: { ...theme.type.screenTitle, color: theme.colors.ink },
    subtitle: { ...theme.type.bodySmall, color: theme.colors.muted },
    form: { gap: theme.spacing.lg },
    formError: { ...theme.type.bodySmall, color: theme.colors.urgentInk },
    switchRow: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      marginTop: 'auto',
    },
    switchText: { ...theme.type.bodySmall, color: theme.colors.muted },
    switchButton: {
      justifyContent: 'center',
      minHeight: theme.sizes.touchTarget,
      paddingHorizontal: theme.spacing.xs,
    },
    switchLink: { ...theme.type.bodySmall, color: theme.colors.forest, fontWeight: '600' },
    pressed: { opacity: 0.65 },
  });
}
