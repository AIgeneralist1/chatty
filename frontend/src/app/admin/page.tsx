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
  const { user } = useAuth();
  const router = useRouter();

  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [allRooms, setAllRooms] = useState<any[]>([]);
  const [allowlist, setAllowlist] = useState<any[]>([]);
  const [tab, setTab] = useState<'agents' | 'rooms' | 'access'>('agents');
  const [newAllowEmail, setNewAllowEmail] = useState('');
  const [allowMsg, setAllowMsg] = useState('');
  const [adminError, setAdminError] = useState('');
  const [revealedPasscodes, setRevealedPasscodes] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string>('');

  // ── Admin-only guard ──────────────────────────────────────
  useEffect(() => {
    if (!user) { router.push('/auth'); return; }
    if (user.email !== 'master@gmail.com') { router.push('/chat'); return; }

    // Real-time users listener — no orderBy to avoid index requirement
    const unsubUsers = onSnapshot(collection(db, 'users'),
      (snap) => { setAllUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }))); },
      (err) => { console.error('Users listener error:', err); setAdminError('Firestore error: ' + err.message); }
    );

    // Real-time rooms listener
    const unsubRooms = onSnapshot(collection(db, 'rooms'),
      (snap) => { setAllRooms(snap.docs.map(d => ({ id: d.id, ...d.data() }))); },
      (err) => { console.error('Rooms listener error:', err); setAdminError('Firestore error: ' + err.message); }
    );

    // Real-time allowlist listener
    const unsubAllow = onSnapshot(collection(db, 'allowlist'), (snap) => {
      setAllowlist(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => { unsubUsers(); unsubRooms(); unsubAllow(); };
  }, [user, router]);

  if (!user || user.email !== 'master@gmail.com') return null;

  const addToAllowlist = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailVal = newAllowEmail.trim().toLowerCase();
    if (!emailVal || !emailVal.includes('@')) { setAllowMsg('Enter a valid email.'); return; }
    await setDoc(doc(db, 'allowlist', emailVal), {
      email: emailVal, addedAt: serverTimestamp(), addedBy: user.uid
    });
    setNewAllowEmail('');
    setAllowMsg(`✓ ${emailVal} added to access list.`);
    setTimeout(() => setAllowMsg(''), 3000);
  };

  const removeFromAllowlist = async (emailId: string) => {
    await deleteDoc(doc(db, 'allowlist', emailId));
  };

  const onlineUsers = allUsers.filter(u => u.isOnline);
  const persistentRooms = allRooms.filter(r => r.type !== 'temp');
  const tempRooms = allRooms.filter(r => r.type === 'temp');

  // Find which users are in a given room
  const getUsersInRoom = (roomId: string) => {
    return allUsers.filter(u =>
      u.rooms && u.rooms.some((r: any) => r.roomId === roomId)
    );
  };

  // Find creator display name
  const getCreatorName = (uid: string) => {
    const found = allUsers.find(u => u.id === uid);
    return found?.displayName || found?.email || uid;
  };

  const togglePasscode = (roomId: string) => {
    setRevealedPasscodes(prev => {
      const next = new Set(prev);
      next.has(roomId) ? next.delete(roomId) : next.add(roomId);
      return next;
    });
  };

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(''), 2000);
  };

  const formatDate = (ts: any) => {
    if (!ts?.toDate) return '—';
    return ts.toDate().toLocaleString('en-IN', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });
  };

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

      {adminError && (
        <div className="mx-4 sm:mx-6 mt-4 p-3 border border-danger/40 bg-danger/10 text-danger text-xs">
          <strong>Admin Error:</strong> {adminError}<br />
          <span className="opacity-70">Check your Firestore Security Rules — admin needs read access to all collections.</span>
        </div>
      )}

      <div className="flex-1 p-4 sm:p-6 max-w-6xl mx-auto w-full">
        {/* Stats cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total Agents', value: allUsers.length, color: 'text-foreground' },
            { label: 'Online Now', value: onlineUsers.length, color: 'text-accent' },
            { label: 'Persistent Rooms', value: persistentRooms.length, color: 'text-foreground' },
            { label: 'Temp Rooms', value: tempRooms.length, color: 'text-danger' },
          ].map(stat => (
            <div key={stat.label} className="bg-secondary border border-border px-4 py-4">
              <div className="text-[10px] uppercase tracking-widest text-muted mb-1">{stat.label}</div>
              <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border mb-6">
          <button
            onClick={() => setTab('agents')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs uppercase tracking-widest font-semibold border-b-2 transition-colors ${tab === 'agents' ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-foreground'}`}
          >
            <FiUsers /> Agents ({allUsers.length})
          </button>
          <button
            onClick={() => setTab('rooms')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs uppercase tracking-widest font-semibold border-b-2 transition-colors ${tab === 'rooms' ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-foreground'}`}
          >
            <FiMessageSquare /> Rooms ({allRooms.length})
          </button>
          <button
            onClick={() => setTab('access')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs uppercase tracking-widest font-semibold border-b-2 transition-colors ${tab === 'access' ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-foreground'}`}
          >
            <FiShield /> Access List ({allowlist.length})
          </button>
        </div>

        {/* ── AGENTS TAB ── */}
        {tab === 'agents' && (
          <div className="bg-secondary border border-border overflow-hidden">
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-background">
                  <tr>
                    {['Status', 'Agent Name', 'Email', 'Joined Rooms', 'Last Login'].map(h => (
                      <th key={h} className="px-5 py-3 font-semibold uppercase tracking-wider text-muted">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {allUsers.map(u => (
                    <tr key={u.id} className="hover:bg-secondary-hover transition-colors">
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
                        {u.rooms && u.rooms.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {u.rooms.map((r: any) => (
                              <span key={r.roomId} className="px-2 py-0.5 bg-background border border-border text-foreground">
                                {r.name}
                              </span>
                            ))}
                          </div>
                        ) : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-5 py-4 text-muted">{formatDate(u.lastLogin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-border">
              {allUsers.map(u => (
                <div key={u.id} className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-foreground font-bold">{u.displayName || u.email}</span>
                    <div className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full ${u.isOnline ? 'bg-accent' : 'bg-border'}`} />
                      <span className={`text-xs ${u.isOnline ? 'text-accent' : 'text-muted'}`}>
                        {u.isOnline ? 'Online' : 'Offline'}
                      </span>
                    </div>
                  </div>
                  <div className="text-muted text-xs mb-2">{u.email}</div>
                  {u.rooms && u.rooms.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {u.rooms.map((r: any) => (
                        <span key={r.roomId} className="px-2 py-0.5 bg-background border border-border text-foreground text-[10px]">
                          {r.name}
                        </span>
                      ))}
                    </div>
                  )}
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
              <div className="bg-secondary border border-border px-5 py-12 text-center text-muted text-xs">
                No rooms created yet.
              </div>
            )}
            {allRooms.map(room => {
              const usersInRoom = getUsersInRoom(room.id);
              const isRevealed = revealedPasscodes.has(room.id);
              const isTemp = room.type === 'temp';

              return (
                <div key={room.id} className={`bg-secondary border ${isTemp ? 'border-danger/30' : 'border-border'} p-4 sm:p-5`}>
                  {/* Room header */}
                  <div className="flex flex-wrap items-start gap-3 justify-between mb-4">
                    <div className="flex items-center gap-3">
                      {isTemp
                        ? <FiZap className="text-danger text-base shrink-0" />
                        : <FiLock className="text-accent text-base shrink-0" />}
                      <div>
                        <span className="text-foreground font-bold text-sm">{room.name}</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 border ${isTemp ? 'text-danger border-danger/40 bg-danger/5' : 'text-accent border-accent/30 bg-accent/5'}`}>
                            {isTemp ? 'Temporary' : 'Persistent'}
                          </span>
                          <span className="text-[10px] text-muted">Created {formatDate(room.createdAt)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Passcode — ADMIN ONLY SEES THIS */}
                    <div className="flex items-center gap-2 flex-wrap">
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

                  {/* Room details grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted mb-1.5">Created By</div>
                      <div className="text-xs text-foreground">{getCreatorName(room.createdBy)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted mb-1.5">
                        Members ({usersInRoom.length})
                      </div>
                      {usersInRoom.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {usersInRoom.map(u => (
                            <div key={u.id} className="flex items-center gap-1.5 bg-background border border-border px-2 py-1">
                              <div className={`w-1.5 h-1.5 rounded-full ${u.isOnline ? 'bg-accent' : 'bg-border'}`} />
                              <span className="text-[10px] text-foreground">{u.displayName || u.email}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted">No members saved yet</span>
                      )}
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
            {/* Add email form */}
            <div className="bg-secondary border border-border p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-4">Add Approved Email</h3>
              {allowMsg && <div className="mb-3 p-2 border border-accent/30 bg-accent/10 text-accent text-xs">{allowMsg}</div>}
              <form onSubmit={addToAllowlist} className="flex gap-2">
                <input
                  type="email"
                  value={newAllowEmail}
                  onChange={e => setNewAllowEmail(e.target.value)}
                  placeholder="user@gmail.com"
                  className="flex-1 bg-background border border-border px-3 py-2 text-foreground text-xs focus:outline-none focus:border-accent transition-colors"
                  required
                />
                <button type="submit"
                  className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-xs font-semibold uppercase tracking-wider transition-colors">
                  Add
                </button>
              </form>
            </div>

            {/* Allowlist entries */}
            <div className="bg-secondary border border-border overflow-hidden">
              <div className="px-5 py-3 border-b border-border">
                <span className="text-[10px] uppercase tracking-widest text-muted font-semibold">
                  {allowlist.length} Approved Email{allowlist.length !== 1 ? 's' : ''}
                </span>
              </div>
              {allowlist.length === 0 ? (
                <div className="px-5 py-10 text-center text-muted text-xs">
                  No emails approved yet. Add emails above to allow registration.
                </div>
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
