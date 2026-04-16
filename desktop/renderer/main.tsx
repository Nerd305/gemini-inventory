import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from '../../src/contexts/AuthContext';
import { App } from './App';

function Root() {
  const { user, loading, signIn } = useAuth();

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>
        Loading…
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
        <h1 style={{ margin: 0 }}>VialTrack Print Server</h1>
        <p style={{ margin: 0, color: '#6b7280' }}>Sign in to start receiving print jobs.</p>
        <button
          onClick={signIn}
          style={{ padding: '10px 20px', background: '#4f46e5', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <Root />
  </AuthProvider>,
);
