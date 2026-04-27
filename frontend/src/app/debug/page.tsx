'use client';

import { useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

export default function DebugPage() {
  const [status, setStatus] = useState<string>('Ready to test');
  const [errorDetails, setErrorDetails] = useState<string>('');

  const runTest = async () => {
    setStatus('Testing connection to Firestore...');
    setErrorDetails('');

    try {
      // Timeout promise
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Connection timed out after 10 seconds. This usually means the Firestore Database hasn't been created in your Firebase Console, or your network is blocking the connection.")), 10000)
      );

      // Firestore write promise
      const writePromise = addDoc(collection(db, 'system_test'), {
        test: true,
        timestamp: serverTimestamp()
      });

      await Promise.race([writePromise, timeoutPromise]);

      setStatus('SUCCESS! Firestore is working correctly. You have permission to write to the database.');
    } catch (err: any) {
      setStatus('FAILED: ' + err.message);
      setErrorDetails(err.toString() + "\n\nStack Trace: " + err.stack);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-8 font-mono">
      <h1 className="text-2xl font-bold mb-4 text-red-500">Firestore Diagnostic Tool</h1>
      
      <button 
        onClick={runTest}
        className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-4 rounded mb-6"
      >
        Run Firestore Test
      </button>

      <div className="mb-4">
        <strong>Status:</strong>
        <div className={`p-4 mt-2 border ${status.includes('SUCCESS') ? 'border-green-500 text-green-400' : status.includes('FAILED') ? 'border-red-500 text-red-400' : 'border-gray-500'}`}>
          {status}
        </div>
      </div>

      {errorDetails && (
        <div className="mt-4">
          <strong>Detailed Error:</strong>
          <pre className="p-4 mt-2 border border-red-500 bg-red-900/20 text-red-300 whitespace-pre-wrap text-sm">
            {errorDetails}
          </pre>
        </div>
      )}

      <div className="mt-12 p-6 border border-gray-800 bg-gray-900 text-gray-300">
        <h2 className="text-lg font-bold mb-2">Common Fixes:</h2>
        <ol className="list-decimal pl-5 space-y-2">
          <li><strong>Database not created:</strong> Go to Firebase Console &rarr; Build &rarr; Firestore Database &rarr; Click "Create Database".</li>
          <li><strong>Permissions blocking access:</strong> Go to Firestore Database &rarr; Rules tab. Change it to <code>allow read, write: if true;</code> and click Publish.</li>
        </ol>
      </div>
    </div>
  );
}
