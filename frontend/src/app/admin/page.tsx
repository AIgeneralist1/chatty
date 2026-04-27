'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, onSnapshot, setDoc, serverTimestamp, deleteDoc, doc } from 'firebase/firestore';
import {
  FiUsers, FiArrowLeft, FiMessageSquare, FiLock,
  FiZap, FiEye, FiEyeOff, FiCopy, FiCheck, FiShield
} from 'react-icons/fi';
import Link from 'next/link';

export default function AdminPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [allUsers, setAllUsers]     = useState<any[]>([]);
  const [allRooms, setAllRooms]     = useState<any[]>([]);
  const [allowlist, setAllowlist]   = useState<any[]>([]);
  const [tab, setTab]               = useState<'agents' | 'rooms' | 'access'>('agents');
  const [newAllowEmail, setNewAllowEmail] = useState('');
  const [allowMsg, setAllowMsg]     = useState('');
  const [adminError, setAdminError] = useState('');
  const [revealedPasscodes, setRevealedPasscodes] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId]     = useState('');

  // ── Guard: wait for auth, then enforce admin-only ─────────
  useEffect(() => {
    if (loading) return;                          // still resolving — do nothing
    if (!user) { router.replace('/auth'); return; }
    if (user.email?.toLowerCase() !== 'master@gmail.com') {
      router.replace('/chat');
      return;
    }

    // Admin confirmed — set up real-time listeners
    const unsubUsers = onSnapshot(
      collection(db, 'users'),
      (snap) => setAllUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err)  => setAdminError(`Users: ${err.message}`)
    );
    const unsubRooms = onSnapshot(
      collection(db, 'rooms'),
      (snap) => setAllRooms(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err)  => setAdminError(`Rooms: ${err.message}`)
    );
    const unsubAllow = onSnapshot(
      collection(db, 'allowlist'),
      (snap) => setAllowlist(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err)  => setAdminError(`Allowlist: ${err.message}`)
    );

    return () => { unsubUsers(); unsubRooms(); unsubAllow(); };
  }, [user, loading, router]);

  // ── Show spinner while auth resolves ──────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-muted text-xs uppercase tracking-widest">Loading admin…</span>
        </div>
      </div>
    );
  }

  // ── Block non-admins from seeing anything ─────────────────
  if (!user || user.email?.toLowerCase() !== 'master@gmail.com') return null;

  // ── Allowlist helpers ─────────────────────────────────────
  const addToAllowlist = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailVal = newAllowEmail.trim().toLowerCase();
    if (!emailVal.includes('@')) { setAllowMsg('Enter a valid email.'); return; }
    await setDoc(doc(db, 'allowlist', emailVal), {
      email: emailVal, addedAt: serverTimestamp(), addedBy: user.uid,
    });
    setNewAllowEmail('');
    setAllowMsg(`✓ ${emailVal} added.`);
    setTimeout(() => setAllowMsg(''), 3000);
  };

  const removeFromAllowlist = async (id: string) => {
    await deleteDoc(doc(db, 'allowlist', id));
  };

  // ── Display helpers ───────────────────────────────────────
  const onlineCount      = allUsers.filter(u => u.isOnline).length;
  const persistentRooms  = allRooms.filter(r => r.type !== 'temp');
  const tempRooms        = allRooms.filter(r => r.type === 'temp');

  const getUsersInRoom = (roomId: string) =>
    allUsers.filter(u => u.rooms?.some((r: any) => r.roomId === roomId));

  const getCreatorName = (uid: string) => {
    const u = allUsers.find(u => u.id === uid);
    return u?.displayName || u?.email || uid;
  };

  const togglePasscode = (id: string) => {
    setRevealedPasscodes(prev => {
      const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
    });
  };

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(''), 2000);
  };

  const fmt = (ts: any) => ts?.toDate?.().toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }) ?? '—';

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="bg-secondary border-b border-border px-4 sm:px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <FiShield className="text-danger text-lg" />
          <div>
            <span className="text-danger font-bold text-sm uppercase tracking-widest block">Master Overwatch</span>
            <span className="text-muted text-[10px] hidden sm:block">Full access — confidential</span>
          </div>
        </div>
        <Link href="/chat">
          <button className="flex items-center gap-2 text-muted hover:text-foreground text-xs border border-border px-3 py-1.5 transition-colors">
            <FiArrowLeft /> <span className="hidden sm:inline">Dashboard</span>
          </button>
        </Link>
      </header>

      {/* Error banner */}
      {adminError && (
        <div className="mx-4 sm:mx-6 mt-4 p-3 border border-danger/40 bg-danger/10 text-danger text-xs">
          <strong>Error:</strong> {adminError} —{' '}
          <span className="opacity-70">Check Firestore Security Rules and ensure the database is initialised.</span>
        </div>
      )}

      <div className="flex-1 p-4 sm:p-6 max-w-6xl mx-auto w-full">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total Agents',      value: allUsers.length,        color: 'text-foreground' },
            { label: 'Online Now',         value: onlineCount,            color: 'text-accent'     },
            { label: 'Persistent Rooms',   value: persistentRooms.length, color: 'text-foreground' },
            { label: 'Temp Rooms',         value: tempRooms.length,       color: 'text-danger'     },
          ].map(s => (
            <div key={s.label} className="bg-secondary border border-border px-4 py-4">
              <div className="text-[10px] uppercase tracking-widest text-muted mb-1">{s.label}</div>
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border mb-6 overflow-x-auto">
          {([
            { id: 'agents', label: `Agents (${allUsers.length})`,    icon: <FiUsers /> },
            { id: 'rooms',  label: `Rooms (${allRooms.length})`,     icon: <FiMessageSquare /> },
            { id: 'access', label: `Access List (${allowlist.length})`, icon: <FiShield /> },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs uppercase tracking-widest font-semibold border-b-2 whitespace-nowrap transition-colors ${tab === t.id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-foreground'}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* ── AGENTS TAB ── */}
        {tab === 'agents' && (
          <div className="bg-secondary border border-border overflow-hidden">
            {/* Desktop */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-background">
                  <tr>
                    {['Status', 'Agent', 'Email', 'Rooms', 'Last Login'].map(h => (
                      <th key={h} className="px-5 py-3 font-semibold uppercase tracking-wider text-muted">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {allUsers.map(u => (
                    <tr key={u.id} className="hover:bg-background transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${u.isOnline ? 'bg-accent' : 'bg-border'}`} />
                          <span className={`font-semibold ${u.isOnline ? 'text-accent' : 'text-muted'}`}>
                            {u.isOnline ? 'Online' : 'Offline'}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-foreground font-semibold">{u.displayName || '—'}</td>
                      <td className="px-5 py-4 text-muted">{u.email}</td>
                      <td className="px-5 py-4">
                        {u.rooms?.length ? (
                          <div className="flex flex-wrap gap-1">
                            {u.rooms.map((r: any) => (
                              <span key={r.roomId} className="px-2 py-0.5 bg-background border border-border text-foreground">{r.name}</span>
                            ))}
                          </div>
                        ) : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-5 py-4 text-muted">{fmt(u.lastLogin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-border">
              {allUsers.map(u => (
                <div key={u.id} className="p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-foreground font-bold">{u.displayName || u.email}</span>
                    <div className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full ${u.isOnline ? 'bg-accent' : 'bg-border'}`} />
                      <span className={`text-xs ${u.isOnline ? 'text-accent' : 'text-muted'}`}>{u.isOnline ? 'Online' : 'Offline'}</span>
                    </div>
                  </div>
                  <div className="text-muted text-xs">{u.email}</div>
                </div>
              ))}
            </div>
            {allUsers.length === 0 && (
              <div className="px-5 py-12 text-center text-muted text-xs">No agents registered yet.</div>
            )}
          </div>
        )}

        {/* ── ROOMS TAB ── */}
        {tab === 'rooms' && (
          <div className="space-y-3">
            {allRooms.length === 0 && (
              <div className="bg-secondary border border-border px-5 py-12 text-center text-muted text-xs">No rooms created yet.</div>
            )}
            {allRooms.map(room => {
              const usersIn   = getUsersInRoom(room.id);
              const isRevealed = revealedPasscodes.has(room.id);
              const isTemp    = room.type === 'temp';
              return (
                <div key={room.id} className={`bg-secondary border ${isTemp ? 'border-danger/30' : 'border-border'} p-4 sm:p-5`}>
                  <div className="flex flex-wrap items-start gap-3 justify-between mb-4">
                    <div className="flex items-center gap-3">
                      {isTemp ? <FiZap className="text-danger shrink-0" /> : <FiLock className="text-accent shrink-0" />}
                      <div>
                        <span className="text-foreground font-bold text-sm">{room.name}</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 border ${isTemp ? 'text-danger border-danger/40' : 'text-accent border-accent/30'}`}>
                            {isTemp ? 'Temporary' : 'Persistent'}
                          </span>
                          <span className="text-[10px] text-muted">{fmt(room.createdAt)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Passcode — admin-only reveal */}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted uppercase tracking-wider">Passcode:</span>
                      <div className="flex items-center gap-1 bg-background border border-border px-3 py-1.5">
                        <span className={`text-sm font-bold tracking-widest ${isRevealed ? 'text-accent' : 'text-muted'}`}>
                          {isRevealed ? room.passcode : '•'.repeat(Math.min(room.passcode?.length || 6, 8))}
                        </span>
                        <button onClick={() => togglePasscode(room.id)} className="text-muted hover:text-foreground ml-2 transition-colors">
                          {isRevealed ? <FiEyeOff className="text-xs" /> : <FiEye className="text-xs" />}
                        </button>
                        {isRevealed && (
                          <button onClick={() => copyText(room.passcode, room.id)} className="text-muted hover:text-accent ml-1 transition-colors">
                            {copiedId === room.id ? <FiCheck className="text-xs text-accent" /> : <FiCopy className="text-xs" />}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Created By</div>
                      <div className="text-xs text-foreground">{getCreatorName(room.createdBy)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Members ({usersIn.length})</div>
                      {usersIn.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {usersIn.map(u => (
                            <div key={u.id} className="flex items-center gap-1.5 bg-background border border-border px-2 py-1">
                              <div className={`w-1.5 h-1.5 rounded-full ${u.isOnline ? 'bg-accent' : 'bg-border'}`} />
                              <span className="text-[10px] text-foreground">{u.displayName || u.email}</span>
                            </div>
                          ))}
                        </div>
                      ) : <span className="text-xs text-muted">No members yet</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── ACCESS LIST TAB ── */}
        {tab === 'access' && (
          <div className="space-y-4">
            <div className="bg-secondary border border-border p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-4">Add Approved Email</h3>
              {allowMsg && <div className="mb-3 p-2 border border-accent/30 bg-accent/10 text-accent text-xs">{allowMsg}</div>}
              <form onSubmit={addToAllowlist} className="flex gap-2">
                <input type="email" value={newAllowEmail} onChange={e => setNewAllowEmail(e.target.value)}
                  placeholder="user@gmail.com"
                  className="flex-1 bg-background border border-border px-3 py-2 text-foreground text-xs focus:outline-none focus:border-accent transition-colors"
                  required />
                <button type="submit" className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-xs font-semibold uppercase tracking-wider transition-colors">
                  Add
                </button>
              </form>
            </div>

            <div className="bg-secondary border border-border overflow-hidden">
              <div className="px-5 py-3 border-b border-border">
                <span className="text-[10px] uppercase tracking-widest text-muted font-semibold">
                  {allowlist.length} Approved Email{allowlist.length !== 1 ? 's' : ''}
                </span>
              </div>
              {allowlist.length === 0 ? (
                <div className="px-5 py-10 text-center text-muted text-xs">No emails approved yet.</div>
              ) : (
                <div className="divide-y divide-border">
                  {allowlist.map(entry => (
                    <div key={entry.id} className="flex items-center justify-between px-5 py-3">
                      <span className="text-sm text-foreground">{entry.email || entry.id}</span>
                      <button onClick={() => removeFromAllowlist(entry.id)}
                        className="text-[10px] text-danger border border-danger/30 px-2 py-1 hover:bg-danger/10 transition-colors uppercase tracking-wider">
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
