import { useEffect, useState } from 'react';
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  linkWithCredential,
  reauthenticateWithPopup,
  updatePassword,
} from 'firebase/auth';
import { KeyRound, Loader2, Smartphone } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

const ERROR_MESSAGES: Record<string, string> = {
  'auth/operation-not-allowed':
    'Email/password sign-in is not enabled for this Firebase project yet. In the Firebase console open Authentication → Sign-in method, enable "Email/Password", then try again.',
  'auth/weak-password': 'Firebase rejected that password as too weak. Use at least 8 characters.',
  'auth/email-already-in-use': 'A separate password account already exists for this email. Sign in on the phone with that password, or ask an admin to remove it in the Firebase console.',
  'auth/credential-already-in-use': 'A separate password account already exists for this email. Sign in on the phone with that password, or ask an admin to remove it in the Firebase console.',
};

/**
 * Lets the signed-in user attach a password to their Google-backed account so
 * the Expo app (where Google sign-in is unavailable) can sign in as the same
 * user with the same role.
 */
export function MobilePasswordCard() {
  const { user } = useAuth();
  const [hasPassword, setHasPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setHasPassword(!!user?.providerData.some((p) => p.providerId === 'password'));
  }, [user]);

  if (!user?.email) return null;
  const email = user.email;

  const fail = (err: unknown) => {
    const code = (err as { code?: string } | null)?.code ?? '';
    setStatus('error');
    setMessage(ERROR_MESSAGES[code] ?? (err instanceof Error ? err.message : 'Could not save the password.'));
  };

  const apply = async () => {
    if (password.length < 8) {
      setStatus('error');
      setMessage('Use at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setStatus('error');
      setMessage('The two passwords do not match.');
      return;
    }
    setStatus('saving');
    setMessage(null);

    const run = async () => {
      if (hasPassword) await updatePassword(user, password);
      else await linkWithCredential(user, EmailAuthProvider.credential(email, password));
    };

    try {
      await run();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? '';
      if (code === 'auth/requires-recent-login') {
        try {
          await reauthenticateWithPopup(user, new GoogleAuthProvider());
          await run();
        } catch (err2) {
          fail(err2);
          return;
        }
      } else if (code === 'auth/provider-already-linked') {
        try {
          await updatePassword(user, password);
        } catch (err2) {
          fail(err2);
          return;
        }
      } else {
        fail(err);
        return;
      }
    }

    await user.reload().catch(() => {});
    setHasPassword(true);
    setStatus('saved');
    setMessage(
      hasPassword
        ? 'Password updated.'
        : `Password set. On the phone app sign in with ${email} and this password — it is the same account and role as here.`,
    );
    setPassword('');
    setConfirm('');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <Smartphone className="h-5 w-5 mr-2 text-teal-600" />
          Phone app sign-in
        </CardTitle>
        <CardDescription>
          The VialTrack Count app (Expo) cannot use Google sign-in. Set a password for <span className="font-medium">{email}</span> to
          sign in there as the same user.
          {hasPassword ? ' A password is already set; you can change it below.' : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="mobile-pw">{hasPassword ? 'New password' : 'Password'}</Label>
            <Input id="mobile-pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mobile-pw2">Confirm</Label>
            <Input id="mobile-pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={apply} disabled={status === 'saving' || !password} className="bg-teal-600 hover:bg-teal-700">
            {status === 'saving' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <KeyRound className="h-4 w-4 mr-2" />}
            {hasPassword ? 'Update password' : 'Set password'}
          </Button>
          {message && (
            <p className={`text-sm ${status === 'error' ? 'text-red-600' : 'text-green-700'}`}>{message}</p>
          )}
        </div>
        <p className="text-xs text-gray-500">
          One-time setup for the project: Firebase console → Authentication → Sign-in method → enable Email/Password.
        </p>
      </CardContent>
    </Card>
  );
}
