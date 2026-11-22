
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";

import {
  getAuth,
  GoogleAuthProvider
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAVahNMxYPiDKJiqTDoXrQCblki-CHyiik",
  authDomain: "campuscare-8c1ca.firebaseapp.com",
  projectId: "campuscare-8c1ca",
  storageBucket: "campuscare-8c1ca.firebasestorage.app",
  messagingSenderId: "814704277694",
  appId: "1:814704277694:web:d67e9906481c9a1fbac6ef"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: "select_account"
});
