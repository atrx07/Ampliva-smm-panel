import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';

// This config is public by design (Firebase web configs are meant to ship
// in client code): it only identifies the project. Nothing here is a
// secret — sign-ins are gated by the authorized-domains list in the
// Firebase console plus server-side ID-token verification in the Worker.
const firebaseConfig = {
  apiKey: 'AIzaSyCqCYriovYLsv5PZmi6M1m7ywWl8YFaVio',
  authDomain: 'ampliva-25036.firebaseapp.com',
  projectId: 'ampliva-25036',
  storageBucket: 'ampliva-25036.firebasestorage.app',
  messagingSenderId: '207328059307',
  appId: '1:207328059307:web:5335b5e9e02de3fd903cee',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

/** Opens the Google sign-in popup and returns a Firebase ID token for the Worker. */
export async function signInWithGoogleIdToken(): Promise<string> {
  const credential = await signInWithPopup(auth, googleProvider);
  return credential.user.getIdToken();
}
