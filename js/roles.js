
// ==========================================
// CAMPUSCARE - ROLE MANAGEMENT
// File: js/roles.js
// ==========================================

import { auth, db, authReady } from "./firebase.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

// Get a user's role.
export async function getUserRole(user) {
  await authReady;

  if (!user) {
    return null;
  }

  // Privileged roles must come from trusted custom claims.
  const token = await user.getIdTokenResult(true);
  const claimRole = token.claims.role;

  if (claimRole === "admin" || claimRole === "worker") {
    return claimRole;
  }

  // Basic student profile.
  const userRef = doc(db, "users", user.uid);
  const snapshot = await getDoc(userRef);

  if (!snapshot.exists()) {
    return null;
  }

  const profile = snapshot.data();

  if (profile.role === "student") {
    return "student";
  }

  return null;
}

// Redirect user to the correct dashboard.
export async function redirectByRole(user) {
  if (!user) {
    window.location.replace("login.html");
    return;
  }

  try {
    const role = await getUserRole(user);

    switch (role) {
      case "student":
        window.location.replace("student.html");
        break;

      case "admin":
        window.location.replace("admin.html");
        break;

      case "worker":
        window.location.replace("worker.html");
        break;

      default:
        throw new Error("Your account does not have an authorized role.");
    }

  } catch (error) {
    console.error("Role verification failed:", error);

    alert(error.message || "Unable to verify your account.");

    window.location.replace("login.html");
  }
}

// Protect dashboard pages from unauthenticated users.
export async function requireRole(allowedRoles) {
  await authReady;

  return new Promise((resolve) => {
    const unsubscribe = auth.onAuthStateChanged(
      async (user) => {
        unsubscribe();

        if (!user) {
          window.location.replace("login.html");
          resolve(false);
          return;
        }

        try {
          const role = await getUserRole(user);

          if (!role || !allowedRoles.includes(role)) {
            window.location.replace("login.html");
            resolve(false);
            return;
          }

          resolve(true);

        } catch (error) {
          console.error("Access verification error:", error);
          window.location.replace("login.html");
          resolve(false);
        }
      }
    );
  });
}
