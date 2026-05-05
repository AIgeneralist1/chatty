'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import { signOut } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import {
  collection, query, orderBy, onSnapshot, addDoc,
  serverTimestamp, limit, doc, setDoc, arrayUnion, arrayRemove,
  getDocs, where, deleteDoc, getDoc, updateDoc
} from 'firebase/firestore';
import {
  FiLogOut, FiLock, FiTerminal, FiSend,
  FiPlus, FiLogIn, FiMessageSquare, FiArrowLeft,
  FiTrash2, FiCopy, FiCheck, FiZap, FiAlertTriangle
} from 'react-icons/fi';

type View = 'dashboard' | 'create' | 'join' | 'pending' | 'room';
type RoomType = 'persistent' | 'temp';

interface Room { roomId: string; name: string; type?: RoomType; }

export default function ChatDashboard() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [view, setView] = useState<View>('dashboard');
  const [roomName, setRoomName] = useState('');
  const [passcode, setPasscode] = useState('');
  const [roomType, setRoomType] = useState<RoomType>('persistent');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [activeRoomId, setActiveRoomId] = useState('');
  const [activeRoomName, setActiveRoomName] = useState('');
  const [activeRoomType, setActiveRoomType] = useState<RoomType>('persistent');
  const [activeRoomCreator, setActiveRoomCreator] = useState('');
  const [newPasscode, setNewPasscode] = useState(''); // shown after create

  // ── Pending / approval state ──────────────────────────────
  const [pendingRoomId, setPendingRoomId] = useState('');
  const [pendingRoomName, setPendingRoomName] = useState('');
  const [pendingRoomType, setPendingRoomType] = useState<RoomType>('persistent');
  const [pendingStatus, setPendingStatus] = useState<'pending' | 'approved' | 'denied'>('pending');
  const [pendingRequests, setPendingRequests] = useState<any[]>([]); // seen by creator

  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const lastSentRef = useRef<number>(0); // rate-limit: track last send timestamp
  const MAX_MSG_LENGTH = 500;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [savedRooms, setSavedRooms] = useState<Room[]>([]);
  const [userData, setUserData] = useState<any>(null);

  // ── Route guard ───────────────────────────────────────────
  useEffect(() => {
    if (loading) return;
    if (!user) router.push('/auth');
  }, [user, loading, router]);

  // ── User document listener ────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setUserData(data);
        setSavedRooms(data.rooms || []);
      }
    });
    return () => unsub();
  }, [user]);

  // ── Messages listener ─────────────────────────────────────
  useEffect(() => {
    if (view !== 'room' || !activeRoomId) return;
    const q = query(
      collection(db, `rooms/${activeRoomId}/messages`),
      orderBy('createdAt', 'asc'),
      limit(200)
    );
    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
    });
    return () => unsub();
  }, [view, activeRoomId]);

  // ── Burn temp room on browser close ───────────────────────
  useEffect(() => {
    if (view !== 'room' || activeRoomType !== 'temp') return;

    const burnRoom = () => {
      // Fire-and-forget: delete room doc (messages cleaned by security rule or cloud function)
      deleteDoc(doc(db, 'rooms', activeRoomId)).catch(() => {});
    };

    window.addEventListener('beforeunload', burnRoom);
    return () => window.removeEventListener('beforeunload', burnRoom);
  }, [view, activeRoomType, activeRoomId]);

  // ── Subscribe to own join-request status (waiting user) ──
  useEffect(() => {
    if (view !== 'pending' || !pendingRoomId || !user) return;
    const unsub = onSnapshot(doc(db, `rooms/${pendingRoomId}/join_requests/${user.uid}`), (snap) => {
      if (!snap.exists()) return;
      const status = snap.data().status;
      setPendingStatus(status);
      if (status === 'approved') {
        // Auto-enter room
        setActiveRoomId(pendingRoomId);
        setActiveRoomName(pendingRoomName);
        setActiveRoomType(pendingRoomType);
        setView('room');
      }
    });
    return () => unsub();
  }, [view, pendingRoomId, pendingRoomName, pendingRoomType, user]);

  // ── Creator: listen to pending join requests in active room ─
  useEffect(() => {
    if (view !== 'room' || !activeRoomId) return;
    const q = query(
      collection(db, `rooms/${activeRoomId}/join_requests`),
      where('status', '==', 'pending')
    );
    const unsub = onSnapshot(q, (snap) => {
      setPendingRequests(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [view, activeRoomId]);

  // ── Helpers ───────────────────────────────────────────────
  const goToView = (v: View) => {
    setErrorMsg('');
    setRoomName('');
    setPasscode('');
    setRoomType('persistent');
    setNewPasscode('');
    setConfirmDelete(false);
    // Reset pending state to avoid stale data bleed
    setPendingRoomId('');
    setPendingRoomName('');
    setPendingRoomType('persistent');
    setPendingStatus('pending');
    setPendingRequests([]);
    setView(v);
  };

  const copyPasscode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSignOut = async () => {
    if (user) setDoc(doc(db, 'users', user.uid), { isOnline: false }, { merge: true }).catch(() => {});
    await signOut(auth);
    router.push('/');
  };

  // ── Delete all messages in a room (subcollection) ─────────
  const deleteRoomMessages = async (roomId: string) => {
    const snap = await getDocs(collection(db, `rooms/${roomId}/messages`));
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
  };

  // ── Create Room ───────────────────────────────────────────
  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const trimName = roomName.trim();
    const trimCode = passcode.trim();

    if (trimName.length < 3) { setErrorMsg('Room name must be at least 3 characters.'); return; }
    if (trimCode.length < 4) { setErrorMsg('Passcode must be at least 4 characters.'); return; }

    setIsSubmitting(true);
    try {
      // Unique passcode check
      const existing = await getDocs(query(collection(db, 'rooms'), where('passcode', '==', trimCode)));
      if (!existing.empty) {
        setErrorMsg('Passcode already in use. Choose a different one.');
        setIsSubmitting(false);
        return;
      }

      const roomRef = await addDoc(collection(db, 'rooms'), {
        name: trimName,
        passcode: trimCode,
        type: roomType,
        createdBy: user?.uid,
        createdAt: serverTimestamp(),
      });

      // Only save persistent rooms to user's list
      if (roomType === 'persistent' && user) {
        await setDoc(doc(db, 'users', user.uid), {
          rooms: arrayUnion({ roomId: roomRef.id, name: trimName, type: 'persistent' })
        }, { merge: true });
      }

      setActiveRoomId(roomRef.id);
      setActiveRoomName(trimName);
      setActiveRoomType(roomType);
      setActiveRoomCreator(user?.uid || '');
      setNewPasscode(trimCode); // show passcode on entry for sharing
      setView('room');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create room. Check Firebase rules.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Join Room ─────────────────────────────────────────────
  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    const trimCode = passcode.trim();
    if (!trimCode) { setErrorMsg('Enter a passcode.'); return; }

    setIsSubmitting(true);
    try {
      const snap = await getDocs(query(collection(db, 'rooms'), where('passcode', '==', trimCode)));
      if (snap.empty) {
        setErrorMsg('Invalid passcode. No room found.');
        setIsSubmitting(false);
        return;
      }

      const roomDoc = snap.docs[0];
      const roomData = roomDoc.data();
      const rType: RoomType = roomData.type || 'persistent';
      const approvedMembers: string[] = roomData.approvedMembers || [];
      const isCreatorJoining = roomData.createdBy === user?.uid;
      const isAlreadyApproved = approvedMembers.includes(user?.uid || '');

      if (isCreatorJoining || isAlreadyApproved) {
        // Direct entry — no approval needed
        if (rType === 'persistent' && user) {
          const alreadySaved = savedRooms.some(r => r.roomId === roomDoc.id);
          if (!alreadySaved) {
            await setDoc(doc(db, 'users', user.uid), {
              rooms: arrayUnion({ roomId: roomDoc.id, name: roomData.name, type: 'persistent' })
            }, { merge: true });
          }
        }
        setActiveRoomId(roomDoc.id);
        setActiveRoomName(roomData.name);
        setActiveRoomType(rType);
        setActiveRoomCreator(roomData.createdBy || '');
        setNewPasscode('');
        setView('room');
      } else {
        // Submit join request — wait for creator approval
        await setDoc(doc(db, `rooms/${roomDoc.id}/join_requests/${user?.uid}`), {
          userId: user?.uid,
          displayName: userData?.displayName || user?.displayName || user?.email?.split('@')[0],
          email: user?.email,
          roomType: rType,
          status: 'pending',
          createdAt: serverTimestamp(),
        });
        setPendingRoomId(roomDoc.id);
        setPendingRoomName(roomData.name);
        setPendingRoomType(rType);
        setPendingStatus('pending');
        setView('pending');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Connection error. Check Firebase rules.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Approve join request (creator only) ───────────────────
  const handleApprove = async (requestUserId: string) => {
    const rType = activeRoomType;
    await setDoc(doc(db, `rooms/${activeRoomId}/join_requests/${requestUserId}`), {
      status: 'approved', roomType: rType, approvedAt: serverTimestamp(),
    }, { merge: true });
    await setDoc(doc(db, 'rooms', activeRoomId), {
      approvedMembers: arrayUnion(requestUserId)
    }, { merge: true });
    // Only persist room reference for persistent rooms
    if (rType === 'persistent') {
      await setDoc(doc(db, 'users', requestUserId), {
        rooms: arrayUnion({ roomId: activeRoomId, name: activeRoomName, type: rType })
      }, { merge: true });
    }
  };

  // ── Deny join request (creator only) ─────────────────────
  const handleDeny = async (requestUserId: string) => {
    await setDoc(doc(db, `rooms/${activeRoomId}/join_requests/${requestUserId}`), {
      status: 'denied', deniedAt: serverTimestamp(),
    }, { merge: true });
  };

  // ── Cancel own pending join request ───────────────────────
  const cancelJoinRequest = async () => {
    if (pendingRoomId && user) {
      await deleteDoc(doc(db, `rooms/${pendingRoomId}/join_requests/${user.uid}`)).catch(() => {});
    }
    goToView('dashboard');
  };

  // ── Enter saved room ──────────────────────────────────────
  const enterSavedRoom = async (room: Room) => {
    // Verify room still exists
    const snap = await getDoc(doc(db, 'rooms', room.roomId));
    if (!snap.exists()) {
      // Room was deleted — remove from user's list
      await setDoc(doc(db, 'users', user!.uid), {
        rooms: arrayRemove(room)
      }, { merge: true });
      return;
    }
    const data = snap.data();
    setActiveRoomId(room.roomId);
    setActiveRoomName(room.name);
    setActiveRoomType(data.type || 'persistent');
    setActiveRoomCreator(data.createdBy || '');
    setNewPasscode('');
    setMessages([]);
    setView('room');
  };

  // ── Leave room ────────────────────────────────────────────
  const leaveRoom = async () => {
    if (activeRoomType === 'temp') {
      // Auto-burn: delete messages, join_requests subcollection, then room doc
      try {
        await deleteRoomMessages(activeRoomId);
        const reqSnap = await getDocs(collection(db, `rooms/${activeRoomId}/join_requests`));
        await Promise.all(reqSnap.docs.map(d => deleteDoc(d.ref)));
        await deleteDoc(doc(db, 'rooms', activeRoomId));
      } catch {}
    }
    setPendingRequests([]);
    setMessages([]);
    setNewPasscode('');
    goToView('dashboard');
  };

  // ── Delete room (creator only) ────────────────────────────
  const handleDeleteRoom = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    try {
      // Remove from all users' room lists — limited approach (removes from current user)
      await setDoc(doc(db, 'users', user!.uid), {
        rooms: arrayRemove({ roomId: activeRoomId, name: activeRoomName, type: activeRoomType })
      }, { merge: true });
      await deleteRoomMessages(activeRoomId);
      await deleteDoc(doc(db, 'rooms', activeRoomId));
      setMessages([]);
      goToView('dashboard');
    } catch (err: any) {
      console.error('Delete error:', err);
    }
  };

  // ── Send message ──────────────────────────────────────────
  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = newMessage.trim();
    if (!text || !user) return;

    // Rate limit: max 1 message per second
    const now = Date.now();
    if (now - lastSentRef.current < 1000) return;
    lastSentRef.current = now;

    // Length check
    if (text.length > MAX_MSG_LENGTH) return;

    setNewMessage(''); // optimistic clear
    try {
      await addDoc(collection(db, `rooms/${activeRoomId}/messages`), {
        text,
        senderId: user.uid,
        senderName: userData?.displayName || user.displayName || user.email?.split('@')[0],
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Send error:', err);
      setNewMessage(text); // restore message on failure
    }
  };

  const formatTime = (ts: any) => {
    if (!ts?.toDate) return '';
    const d: Date = ts.toDate();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!user) return null;

  // ══════════════════════════════════════════════════════════
  // DASHBOARD
  // ══════════════════════════════════════════════════════════
  if (view === 'dashboard') {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="bg-secondary border-b border-border px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FiTerminal className="text-accent text-lg" />
            <span className="text-foreground font-bold uppercase tracking-widest text-sm">Chatty</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-muted text-xs hidden sm:block">{userData?.displayName || user.email}</span>
            {user.email === 'master@gmail.com' && (
              <a href="/admin" className="text-xs text-danger border border-danger/30 px-3 py-1.5 hover:bg-danger/10 transition-colors uppercase tracking-wider">
                Admin
              </a>
            )}
            <button onClick={handleSignOut} className="text-muted hover:text-foreground text-xs border border-border px-3 py-1.5 flex items-center gap-2 transition-colors">
              <FiLogOut /> Logout
            </button>
          </div>
        </header>

        <div className="flex-1 p-6 max-w-2xl mx-auto w-full">
          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            <button onClick={() => goToView('create')}
              className="flex flex-col items-center justify-center gap-3 py-8 bg-secondary border border-border hover:border-accent hover:bg-secondary-hover transition-all group">
              <FiPlus className="text-2xl text-muted group-hover:text-accent transition-colors" />
              <span className="text-xs uppercase tracking-widest text-muted group-hover:text-foreground font-semibold transition-colors">Create Room</span>
            </button>
            <button onClick={() => goToView('join')}
              className="flex flex-col items-center justify-center gap-3 py-8 bg-secondary border border-border hover:border-accent hover:bg-secondary-hover transition-all group">
              <FiLogIn className="text-2xl text-muted group-hover:text-accent transition-colors" />
              <span className="text-xs uppercase tracking-widest text-muted group-hover:text-foreground font-semibold transition-colors">Join Room</span>
            </button>
          </div>

          {/* Saved Rooms */}
          <div className="bg-secondary border border-border">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <FiMessageSquare className="text-muted text-sm" />
              <span className="text-xs uppercase tracking-widest text-muted font-semibold">Your Rooms</span>
            </div>
            <div className="divide-y divide-border">
              {savedRooms.length === 0 ? (
                <div className="px-5 py-10 text-center text-muted text-xs">No rooms yet. Create or join one above.</div>
              ) : (
                savedRooms.map(room => (
                  <button key={room.roomId} onClick={() => enterSavedRoom(room)}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-secondary-hover transition-colors group">
                    <div className="flex items-center gap-3">
                      <FiLock className="text-muted text-xs" />
                      <span className="text-sm text-foreground font-semibold">{room.name}</span>
                      {room.type === 'temp' && (
                        <span className="text-[10px] text-danger border border-danger/30 px-1.5 py-0.5 uppercase tracking-wider">Temp</span>
                      )}
                    </div>
                    <span className="text-xs text-muted group-hover:text-accent transition-colors">Enter →</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  // CREATE ROOM
  // ══════════════════════════════════════════════════════════
  if (view === 'create') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-secondary border border-border p-7">
          <button onClick={() => goToView('dashboard')} className="flex items-center gap-2 text-muted hover:text-foreground text-xs mb-6 transition-colors">
            <FiArrowLeft /> Back
          </button>
          <h2 className="text-lg font-bold text-foreground uppercase tracking-wider mb-6">Create Room</h2>
          {errorMsg && <div className="mb-5 p-3 border border-danger/40 bg-danger/10 text-danger text-xs">{errorMsg}</div>}
          <form onSubmit={handleCreateRoom} className="space-y-5">
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted mb-2">Room Name</label>
              <input type="text" value={roomName} onChange={e => setRoomName(e.target.value)}
                className="w-full px-3 py-2.5 bg-background border border-border text-foreground focus:outline-none focus:border-accent transition-colors text-sm"
                placeholder="e.g. Alpha" autoComplete="off" required />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted mb-2">
                Passcode <span className="text-muted normal-case font-normal">(share to invite)</span>
              </label>
              <input type="text" value={passcode} onChange={e => setPasscode(e.target.value)}
                className="w-full px-3 py-2.5 bg-background border border-border text-foreground focus:outline-none focus:border-accent transition-colors text-sm font-bold tracking-widest"
                placeholder="min. 4 characters" autoComplete="off" required />
            </div>

            {/* Room type */}
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted mb-3">Room Type</label>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setRoomType('persistent')}
                  className={`py-3 border text-xs uppercase tracking-wider font-semibold transition-all flex flex-col items-center gap-1.5 ${roomType === 'persistent' ? 'border-accent text-accent bg-accent/10' : 'border-border text-muted hover:border-accent/50'}`}>
                  <FiLock className="text-base" />
                  Persistent
                  <span className="text-[10px] font-normal normal-case opacity-70">Messages saved</span>
                </button>
                <button type="button" onClick={() => setRoomType('temp')}
                  className={`py-3 border text-xs uppercase tracking-wider font-semibold transition-all flex flex-col items-center gap-1.5 ${roomType === 'temp' ? 'border-danger text-danger bg-danger/10' : 'border-border text-muted hover:border-danger/50'}`}>
                  <FiZap className="text-base" />
                  Temporary
                  <span className="text-[10px] font-normal normal-case opacity-70">Auto-deletes on close</span>
                </button>
              </div>
            </div>

            {roomType === 'temp' && (
              <div className="p-3 border border-danger/30 bg-danger/5 text-danger text-xs flex items-start gap-2">
                <FiAlertTriangle className="mt-0.5 shrink-0" />
                <span>This room and all its messages will be permanently deleted when you leave or close the tab.</span>
              </div>
            )}

            <button type="submit" disabled={isSubmitting}
              className="w-full py-2.5 bg-primary hover:bg-primary-hover text-foreground text-sm font-semibold uppercase tracking-widest transition-colors disabled:opacity-50">
              {isSubmitting ? 'Creating...' : 'Create & Enter Room'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  // JOIN ROOM
  // ══════════════════════════════════════════════════════════
  if (view === 'join') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-secondary border border-border p-7">
          <button onClick={() => goToView('dashboard')} className="flex items-center gap-2 text-muted hover:text-foreground text-xs mb-6 transition-colors">
            <FiArrowLeft /> Back
          </button>
          <h2 className="text-lg font-bold text-foreground uppercase tracking-wider mb-2">Join Room</h2>
          <p className="text-muted text-xs mb-6">Enter the passcode shared by the room creator.</p>
          {errorMsg && <div className="mb-5 p-3 border border-danger/40 bg-danger/10 text-danger text-xs">{errorMsg}</div>}
          <form onSubmit={handleJoinRoom} className="space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted mb-2">Room Passcode</label>
              <input type="text" value={passcode} onChange={e => setPasscode(e.target.value)}
                className="w-full px-3 py-2.5 bg-background border border-border text-foreground focus:outline-none focus:border-accent transition-colors text-sm font-bold tracking-widest"
                placeholder="Enter passcode" autoComplete="off" required />
            </div>
            <button type="submit" disabled={isSubmitting}
              className="w-full py-2.5 bg-primary hover:bg-primary-hover text-foreground text-sm font-semibold uppercase tracking-widest transition-colors disabled:opacity-50">
              {isSubmitting ? 'Connecting...' : 'Join Room'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  // PENDING APPROVAL VIEW (waiting user)
  // ══════════════════════════════════════════════════════════
  if (view === 'pending') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-secondary border border-border p-7 text-center">
          {pendingStatus === 'denied' ? (
            <>
              <div className="text-danger text-3xl mb-4">✕</div>
              <h2 className="text-base font-bold text-danger uppercase tracking-wider mb-2">Access Denied</h2>
              <p className="text-muted text-xs mb-6">The room creator denied your request.</p>
              <button onClick={() => goToView('dashboard')}
                className="w-full py-2.5 bg-secondary border border-border text-muted text-xs uppercase tracking-widest hover:text-foreground transition-colors">
                Back to Dashboard
              </button>
            </>
          ) : (
            <>
              <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-5" />
              <h2 className="text-base font-bold text-foreground uppercase tracking-wider mb-2">Awaiting Approval</h2>
              <p className="text-muted text-xs mb-1">Room: <span className="text-foreground font-semibold">{pendingRoomName}</span></p>
              <p className="text-muted text-xs mb-6">Your join request has been sent. Waiting for the room creator to approve.</p>
              <button onClick={cancelJoinRequest}
                className="w-full py-2.5 bg-secondary border border-border text-muted text-xs uppercase tracking-widest hover:text-foreground transition-colors">
                Cancel Request
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  // CHAT ROOM
  // ══════════════════════════════════════════════════════════
  const isCreator = activeRoomCreator === user.uid;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Room header */}
      <header className="bg-secondary border-b border-border px-5 py-3.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          {activeRoomType === 'temp'
            ? <FiZap className="text-danger text-sm" />
            : <FiLock className="text-accent text-sm" />}
          <span className="text-foreground font-bold text-sm uppercase tracking-widest">{activeRoomName}</span>
          {activeRoomType === 'temp' && (
            <span className="text-[10px] text-danger border border-danger/30 px-1.5 py-0.5 uppercase tracking-wider">Temp</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Show passcode for sharing (only on first entry as creator) */}
          {newPasscode && (
            <button onClick={() => copyPasscode(newPasscode)}
              className="flex items-center gap-2 text-xs border border-border px-3 py-1.5 text-muted hover:text-foreground transition-colors">
              {copied ? <FiCheck className="text-accent" /> : <FiCopy />}
              {copied ? 'Copied!' : `Share: ${newPasscode}`}
            </button>
          )}
          {/* Delete room — creator only, persistent only */}
          {isCreator && activeRoomType === 'persistent' && (
            <button onClick={handleDeleteRoom}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 border transition-colors ${confirmDelete ? 'border-danger text-danger bg-danger/10' : 'border-border text-muted hover:text-danger hover:border-danger/50'}`}>
              <FiTrash2 />
              {confirmDelete ? 'Confirm Delete?' : 'Delete Room'}
            </button>
          )}
          <button onClick={leaveRoom}
            className="flex items-center gap-2 text-muted hover:text-foreground text-xs border border-border px-3 py-1.5 transition-colors">
            <FiArrowLeft />
            {activeRoomType === 'temp' ? 'Burn & Leave' : 'Leave'}
          </button>
        </div>
      </header>

      {/* Temp room warning banner */}
      {activeRoomType === 'temp' && (
        <div className="bg-danger/10 border-b border-danger/20 px-5 py-2 flex items-center gap-2">
          <FiAlertTriangle className="text-danger text-xs shrink-0" />
          <span className="text-danger text-xs">Temporary room — all messages will be deleted when you leave or close this tab.</span>
        </div>
      )}

      {/* Creator: Pending join request approval panel */}
      {isCreator && pendingRequests.length > 0 && (
        <div className="border-b border-border bg-secondary/80 px-4 py-3 space-y-2 shrink-0">
          <p className="text-[10px] uppercase tracking-widest text-muted font-semibold">
            {pendingRequests.length} Join Request{pendingRequests.length > 1 ? 's' : ''} Pending
          </p>
          {pendingRequests.map(req => (
            <div key={req.id} className="flex items-center justify-between gap-3 bg-background border border-border px-3 py-2">
              <div>
                <span className="text-foreground text-xs font-semibold">{req.displayName}</span>
                <span className="text-muted text-[10px] ml-2">{req.email}</span>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => handleApprove(req.userId)}
                  className="text-[10px] uppercase tracking-wider px-3 py-1 border border-accent/40 text-accent hover:bg-accent/10 transition-colors font-semibold">
                  Approve
                </button>
                <button onClick={() => handleDeny(req.userId)}
                  className="text-[10px] uppercase tracking-wider px-3 py-1 border border-danger/40 text-danger hover:bg-danger/10 transition-colors font-semibold">
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      <main className="flex-1 overflow-y-auto px-4 py-5 max-w-3xl mx-auto w-full">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted text-xs pt-20 gap-2">
            <FiMessageSquare className="text-2xl opacity-30" />
            <span>No messages yet. Start the conversation.</span>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => {
              const isMe = msg.senderId === user.uid;
              return (
                <div key={msg.id} className={`flex flex-col gap-1 ${isMe ? 'items-end' : 'items-start'}`}>
                  <div className="flex items-baseline gap-2 px-1">
                    <span className="text-[10px] text-muted uppercase tracking-widest">
                      {isMe ? 'You' : msg.senderName}
                    </span>
                    <span className="text-[10px] text-muted/50">{formatTime(msg.createdAt)}</span>
                  </div>
                  <div className={`max-w-[75%] px-4 py-2.5 text-sm leading-relaxed border ${
                    isMe
                      ? 'bg-primary border-primary text-foreground'
                      : 'bg-secondary border-border text-foreground'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Input */}
      <footer className="bg-secondary border-t border-border px-4 py-3 shrink-0">
        <form onSubmit={sendMessage} className="flex gap-2 max-w-3xl mx-auto">
          <input
            type="text"
            value={newMessage}
            onChange={e => {
              // Enforce max length client-side
              if (e.target.value.length <= MAX_MSG_LENGTH) setNewMessage(e.target.value);
            }}
            placeholder="Type a message..."
            className="flex-1 bg-background border border-border px-4 py-2.5 focus:outline-none focus:border-accent text-foreground text-sm placeholder:text-muted transition-colors"
            autoComplete="off"
            maxLength={MAX_MSG_LENGTH}
          />
          <button type="submit" disabled={!newMessage.trim()}
            className="bg-primary hover:bg-primary-hover border border-primary px-5 py-2.5 text-foreground disabled:opacity-40 flex items-center justify-center transition-colors">
            <FiSend className="text-sm" />
          </button>
        </form>
      </footer>
    </div>
  );
}
