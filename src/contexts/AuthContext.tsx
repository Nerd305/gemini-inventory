import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { auth, db } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

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

/** One readable sentence per sign-in failure; names the real host instead of assuming localhost. */
function describeSignInError(error: any): string {
  switch (error?.code) {
    case 'auth/unauthorized-domain':
      return `Google Sign-In is not allowed from ${window.location.host}.\n\nAdd this domain in Firebase Console → Authentication → Settings → Authorized domains.`;
    case 'auth/admin-restricted-operation':
      return 'Sign-in failed. Please enable Google as a sign-in method in the Firebase Console.';
    case 'auth/popup-blocked':
    case 'auth/operation-not-supported-in-this-environment':
      return 'Your browser blocked the Google sign-in window. Allow pop-ups for this site, or open the app in Safari or Chrome and sign in there.';
    case 'auth/network-request-failed':
      return 'No connection. Check Wi-Fi or cellular and try again.';
    default:
      return 'Sign-in failed: ' + (error?.message || 'unknown error');
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<'admin' | 'staff' | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      try {
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
            // Check whitelist
            const whitelistDocRef = doc(db, 'whitelist', email.toLowerCase());
            const whitelistDoc = await getDoc(whitelistDocRef);
            
            if (whitelistDoc.exists()) {
              const role = whitelistDoc.data().role || 'staff';
              await setDoc(userDocRef, {
                email: email,
                displayName: currentUser.displayName || 'Whitelisted User',
                role: role,
              });
              setRole(role as 'admin' | 'staff');
            } else {
              // Not whitelisted!
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
      } catch (error) {
        // A failed read (offline fridge room, permission error) must not leave the app on a spinner forever.
        console.error('Auth bootstrap failed:', error);
        setRole(null);
        alert('Could not load your account. Check your connection and reload the app.');
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const signIn = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      // Closing the Google window is not an error worth an alert.
      if (error?.code === 'auth/popup-closed-by-user' || error?.code === 'auth/cancelled-popup-request') return;
      console.error('Sign-in error:', error);
      alert(describeSignInError(error));
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
