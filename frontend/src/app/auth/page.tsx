'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signInWithPopup
} from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, googleProvider } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { FiTerminal, FiUser, FiMail, FiLock } from 'react-icons/fi';
import { FcGoogle } from 'react-icons/fc';

export default function AuthPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (user) router.push('/chat');
  }, [user, router]);

  const saveUserToDb = async (uid: string, data: object) => {
    await setDoc(doc(db, 'users', uid), {
      ...data,
      isOnline: true,
      lastLogin: serverTimestamp(),
    }, { merge: true });
  };

  const friendlyError = (code: string, fallback: string) => ({
    'auth/user-not-found': 'No account found with this email.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/invalid-credential': 'Invalid email or password.',
    'auth/email-already-in-use': 'This email is already registered.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/invalid-email': 'Invalid email address.',
    'auth/too-many-requests': 'Too many attempts. Try again later.',
  }[code] || fallback);

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setError('');
    try {
      const result = await signInWithPopup(auth, googleProvider);
      await saveUserToDb(result.user.uid, {
        email: result.user.email,
        displayName: result.user.displayName || result.user.email?.split('@')[0],
        createdAt: serverTimestamp(),
      });
      const dest = result.user.email?.toLowerCase() === 'master@gmail.com' ? '/admin' : '/chat';
      router.push(dest);
    } catch (err: any) {
      setError(friendlyError(err.code, err.message));
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      if (isLogin) {
        const result = await signInWithEmailAndPassword(auth, email, password);
        await saveUserToDb(result.user.uid, { email });
        router.push(result.user.email === 'master@gmail.com' ? '/admin' : '/chat');
      } else {
        if (!displayName.trim()) {
          setError('Preferred Name is required.');
          setIsLoading(false);
          return;
        }
        const result = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(result.user, { displayName: displayName.trim() });
        await saveUserToDb(result.user.uid, {
          email,
          displayName: displayName.trim(),
          createdAt: serverTimestamp(),
        });
        const dest = result.user.email?.toLowerCase() === 'master@gmail.com' ? '/admin' : '/chat';
        router.push(dest);
      }
    } catch (err: any) {
      setError(friendlyError(err.code, err.message));
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex items-center gap-2 justify-center mb-8">
          <FiTerminal className="text-accent text-xl" />
          <span className="text-foreground font-bold uppercase tracking-widest text-sm">Private Chat</span>
        </div>

        <div className="bg-secondary border border-border p-6 sm:p-8">
          <h2 className="text-base font-bold text-foreground uppercase tracking-wider mb-6">
            {isLogin ? 'Login to your account' : 'Create account'}
          </h2>

          {error && (
            <div className="mb-5 p-3 border border-danger/40 bg-danger/10 text-danger text-xs leading-relaxed">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-muted mb-1.5">
                  Preferred Name
                </label>
                <div className="relative">
                  <FiUser className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-xs" />
                  <input
                    type="text"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    className="w-full pl-8 pr-3 py-2.5 bg-background border border-border text-foreground text-sm focus:outline-none focus:border-accent transition-colors"
                    placeholder="e.g. Ghost"
                    autoComplete="off"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted mb-1.5">Email</label>
              <div className="relative">
                <FiMail className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-xs" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full pl-8 pr-3 py-2.5 bg-background border border-border text-foreground text-sm focus:outline-none focus:border-accent transition-colors"
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted mb-1.5">Password</label>
              <div className="relative">
                <FiLock className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-xs" />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full pl-8 pr-3 py-2.5 bg-background border border-border text-foreground text-sm focus:outline-none focus:border-accent transition-colors"
                  required
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 bg-primary hover:bg-primary-hover text-white text-xs font-bold uppercase tracking-widest transition-colors disabled:opacity-50 mt-1"
            >
              {isLoading ? 'Please wait...' : isLogin ? 'Login' : 'Create Account'}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <div className="flex-1 border-t border-border" />
            <span className="text-muted text-[10px] uppercase">or</span>
            <div className="flex-1 border-t border-border" />
          </div>

          <button
            onClick={handleGoogleSignIn}
            disabled={isLoading}
            className="w-full py-2.5 bg-white hover:bg-slate-100 text-slate-900 text-xs font-bold uppercase tracking-widest transition-colors flex items-center justify-center gap-3 disabled:opacity-50"
          >
            <FcGoogle className="text-lg" /> Continue with Google
          </button>

          <div className="mt-6 text-center">
            <button
              onClick={() => { setIsLogin(!isLogin); setError(''); }}
              className="text-[11px] text-muted hover:text-foreground transition-colors underline underline-offset-2"
            >
              {isLogin ? "Don't have an account? Register" : 'Already have an account? Login'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
