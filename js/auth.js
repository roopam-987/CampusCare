
// ==========================================
// CAMPUSCARE - AUTHENTICATION
// File: js/auth.js
// ==========================================

import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

import { auth, db, authReady } from "./firebase.js";

const provider = new GoogleAuthProvider();

provider.setCustomParameters({
  prompt: "select_account"
});

// Google Login
export async function loginWithGoogle() {
  try {
    await authReady;

    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    // Create the profile only for a new user.
    const userRef = doc(db, "users", user.uid);
    const userSnapshot = await getDoc(userRef);

    if (!userSnapshot.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        name: user.displayName || "CampusCare User",
        email: user.email,
        photoURL: user.photoURL || "",
        role: "student",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }

    return user;

  } catch (error) {
    console.error("Login error:", error);

    if (error.code === "auth/popup-closed-by-user") {
      throw new Error("Login cancelled. Please try again.");
    }

    if (error.code === "auth/popup-blocked") {
      throw new Error("Your browser blocked the login popup. Allow popups and try again.");
    }

    if (error.code === "auth/unauthorized-domain") {
      throw new Error("This website domain is not authorized in Firebase.");
    }

    throw new Error(error.message || "Unable to sign in.");
  }
}

// Logout
export async function logoutUser() {
  await authReady;
  await signOut(auth);
}

// Listen for login/logout changes
export function observeAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

// Get current user
export function getCurrentUser() {
  return auth.currentUser;
}
