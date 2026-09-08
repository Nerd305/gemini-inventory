import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';
import { Button, ui } from '../components/ui';
import { colors, font } from '../theme';

const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/wrong-password': 'Wrong password.',
  'auth/user-not-found': 'No account with that email.',
  'auth/invalid-email': 'That email address is not valid.',
  'auth/operation-not-allowed': 'Email/password sign-in is not enabled yet. In the Firebase console open Authentication → Sign-in method and enable "Email/Password".',
  'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
  'auth/network-request-failed': 'No connection to Firebase. Check Wi-Fi.',
};

export default function SignInScreen() {
  const { signIn } = useAuth();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      setError(MESSAGES[code] ?? (err instanceof Error ? err.message : 'Sign-in failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.root, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 20 }]}>
      <Text style={styles.brand}>VialTrack</Text>
      <Text style={styles.tagline}>Count</Text>
      <View style={{ height: 28 }} />
      <Text style={styles.label}>Email</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="username"
        style={ui.input}
      />
      <Text style={[styles.label, { marginTop: 12 }]}>Password</Text>
      <TextInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
        textContentType="password"
        onSubmitEditing={submit}
        returnKeyType="go"
        style={ui.input}
      />
      {error ? <Text style={[ui.error, { marginTop: 12 }]}>{error}</Text> : null}
      <Button title="Sign in" onPress={submit} loading={busy} disabled={!email.trim() || !password} style={{ marginTop: 20 }} />
      <Text style={styles.help}>
        Same account as the web app. Google sign-in can't run inside Expo Go, so set a password once on the web app under Settings → Phone
        app sign-in, then use it here.
      </Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white, paddingHorizontal: 24 },
  brand: { fontSize: 34, fontWeight: '800', color: colors.tealDark },
  tagline: { fontSize: font.md, color: colors.muted, marginTop: -4 },
  label: { fontSize: font.xs, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  help: { color: colors.muted, fontSize: font.xs, marginTop: 18, lineHeight: 17 },
});
