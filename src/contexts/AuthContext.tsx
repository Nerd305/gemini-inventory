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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<'admin' | 'staff' | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const signIn = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error('Sign-in error:', error);
      if (error.code === 'auth/unauthorized-domain') {
        alert('Google Sign-In failed because localhost is not authorized in Firebase.\\n\\nTo fix this: Go to Firebase Console -> Authentication -> Settings -> Authorized Domains, and add "localhost".');
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
