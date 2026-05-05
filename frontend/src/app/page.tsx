'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { FiLock } from 'react-icons/fi';
import Link from 'next/link';

export default function Home() {
  const { user } = useAuth();
  const router = useRouter();

  // Auto-redirect logged in users to chat
  useEffect(() => {
    if (user) {
      router.push('/chat');
    }
  }, [user, router]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-xs text-center">
        <div className="flex justify-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-secondary border border-border flex items-center justify-center">
            <FiLock className="text-3xl text-accent" />
          </div>
        </div>

        <h1 className="text-3xl font-bold tracking-tight mb-2 text-foreground uppercase tracking-widest">
          Chatty
        </h1>
        <p className="text-sm text-muted mb-10">
          End-to-end private. Invite-only rooms.
        </p>

        <Link href="/auth" className="block w-full py-3 px-4 bg-primary hover:bg-primary-hover text-foreground font-semibold text-sm uppercase tracking-widest transition-colors text-center">
          Enter System
        </Link>
      </div>
    </div>
  );
}
