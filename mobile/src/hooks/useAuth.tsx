import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, BOOTSTRAP_ADMINS } from '../firebase';

export type Role = 'admin' | 'staff';

interface AuthContextValue {
  user: User | null;
  role: Role | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOutUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/**
 * Resolve the role for a signed-in user the same way the web app does:
 * existing /users doc → bootstrap admin email → whitelist entry → rejected.
 */
async function resolveRole(user: User): Promise<Role> {
  const email = (user.email ?? '').toLowerCase();
  const userRef = doc(db, 'users', user.uid);
  const snap = await getDoc(userRef);
  if (snap.exists()) {
    const role = snap.data().role;
    return role === 'admin' ? 'admin' : 'staff';
  }
  if (BOOTSTRAP_ADMINS.includes(email)) {
    await setDoc(userRef, { email, displayName: user.displayName ?? 'Admin', role: 'admin' });
    return 'admin';
  }
  const wl = await getDoc(doc(db, 'whitelist', email));
  if (wl.exists()) {
    const role: Role = wl.data().role === 'admin' ? 'admin' : 'staff';
    await setDoc(userRef, { email, displayName: user.displayName ?? 'Staff', role });
    return role;
  }
  throw new Error('This email is not on the whitelist. Ask an administrator for an invite.');
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (next) => {
      if (!next) {
        setUser(null);
        setRole(null);
        setLoading(false);
        return;
      }
      try {
        const r = await resolveRole(next);
        setUser(next);
        setRole(r);
      } catch (err) {
        console.warn('Role resolution failed', err);
        await signOut(auth).catch(() => {});
        setUser(null);
        setRole(null);
      } finally {
        setLoading(false);
      }
    });
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email.trim(), password);
  }, []);

  const signOutUser = useCallback(async () => {
    await signOut(auth);
  }, []);

  return <AuthContext.Provider value={{ user, role, loading, signIn, signOutUser }}>{children}</AuthContext.Provider>;
}
