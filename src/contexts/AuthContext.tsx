import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut,
} from 'firebase/auth';
import { auth, db } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const isMobileBrowser = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // iOS Safari (including iPad on iPadOS reporting as Mac with touch) and
  // Android browsers: popup-based OAuth is unreliable, prefer redirect.
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes('Mac') && typeof document !== 'undefined' && 'ontouchend' in document);
  const isAndroid = /Android/i.test(ua);
  return isIOS || isAndroid;
};

interface AuthContextType {
  user: User | null;
  role: 'admin' | 'staff' | null;
  loading: boolean;
  signIn: () => Promise<void>;
  logOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: null,
  loading: true,
  signIn: async () => {},
  logOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<'admin' | 'staff' | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Resolve any pending mobile redirect sign-in so onAuthStateChanged fires
    // with the freshly signed-in user. Errors here surface real auth failures
    // (e.g., unauthorized domain) that would otherwise be silent.
    getRedirectResult(auth).catch((error: any) => {
      if (error?.code === 'auth/no-auth-event') return;
      console.error('Redirect sign-in error:', error);
      if (error?.code === 'auth/unauthorized-domain') {
        alert('Google Sign-In failed: this domain is not authorized in Firebase.\n\nAdd it under Authentication → Settings → Authorized Domains.');
      } else if (error?.message) {
        alert('Sign-In failed: ' + error.message);
      }
    });

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const email = currentUser.email || 'local@test.com';
        const isBootstrapAdmin = 
          email === 'duval.villegas@mdexam.com' || 
          email === 'duval.villegas@gmail.com';
        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (userDoc.exists()) {
          const existingRole = userDoc.data().role as 'admin' | 'staff' | undefined;
          if (isBootstrapAdmin && existingRole !== 'admin') {
            await setDoc(userDocRef, { role: 'admin' }, { merge: true });
            setRole('admin');
          } else {
            setRole(existingRole ?? 'staff');
          }
        } else {
          // User is new, check whitelist
          if (isBootstrapAdmin) {
            await setDoc(userDocRef, {
              email: email,
              displayName: currentUser.displayName || 'Local Tester',
              role: 'admin',
            });
            // Also seed into whitelist so they show in admin UI
            const wlRef = doc(db, 'whitelist', email.toLowerCase());
            const wlDoc = await getDoc(wlRef);
            if (!wlDoc.exists()) {
              await setDoc(wlRef, { role: 'admin', createdAt: new Date().toISOString(), isBootstrap: true });
            }
            setRole('admin');
          } else {
            // Check email whitelist first, then fall back to the domain whitelist.
            const lowerEmail = email.toLowerCase();
            const whitelistDoc = await getDoc(doc(db, 'whitelist', lowerEmail));

            let assignedRole: 'admin' | 'staff' | null = null;
            if (whitelistDoc.exists()) {
              assignedRole = (whitelistDoc.data().role as 'admin' | 'staff') || 'staff';
            } else {
              const domain = lowerEmail.split('@')[1];
              if (domain) {
                const domainDoc = await getDoc(doc(db, 'whitelistDomains', domain));
                if (domainDoc.exists()) {
                  assignedRole = (domainDoc.data().role as 'admin' | 'staff') || 'staff';
                }
              }
            }

            if (assignedRole) {
              await setDoc(userDocRef, {
                email: email,
                displayName: currentUser.displayName || 'Whitelisted User',
                role: assignedRole,
              });
              setRole(assignedRole);
            } else {
              alert('Access Denied. Your email is not on the authorized whitelist. Please ask an Administrator for an invite.');
              await signOut(auth);
              setUser(null);
              setRole(null);
            }
          }
        }
      } else {
        setRole(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const signIn = async () => {
    const provider = new GoogleAuthProvider();
    try {
      if (isMobileBrowser()) {
        // signInWithRedirect uses top-level navigation, avoiding the iOS Safari
        // sessionStorage-partitioning issue that breaks signInWithPopup's
        // implicit redirect fallback ("missing initial state" error).
        await signInWithRedirect(auth, provider);
        return;
      }
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error('Sign-in error:', error);
      // If the popup was blocked or unsupported, fall back to redirect once.
      if (
        error?.code === 'auth/popup-blocked' ||
        error?.code === 'auth/popup-closed-by-user' ||
        error?.code === 'auth/operation-not-supported-in-this-environment' ||
        error?.code === 'auth/web-storage-unsupported'
      ) {
        try {
          await signInWithRedirect(auth, provider);
          return;
        } catch (redirectError: any) {
          console.error('Redirect sign-in error:', redirectError);
          alert('Sign-In failed: ' + (redirectError?.message ?? 'unknown error'));
          return;
        }
      }
      if (error.code === 'auth/unauthorized-domain') {
        alert('Google Sign-In failed because this domain is not authorized in Firebase.\n\nTo fix this: Go to Firebase Console -> Authentication -> Settings -> Authorized Domains, and add this domain (or "localhost" for local dev).');
      } else if (error.code === 'auth/admin-restricted-operation') {
        alert('Sign-In failed. Please enable Google Auth in your Firebase Console.');
      } else {
        alert('Sign-In failed: ' + error.message);
      }
    }
  };

  const logOut = async () => {
    await signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, role, loading, signIn, logOut }}>
      {children}
    </AuthContext.Provider>
  );
}
