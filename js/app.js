
import { auth, db, googleProvider } from "./firebase.js";
import { uploadReportImage } from "./supabase.js";

import {
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  setDoc,
  query,
  where,
  limit,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const page = document.body.dataset.page;

let currentUser = null;
let currentProfile = null;
let reportsCache = [];
let unsubscribeReports = null;
let unsubscribeNotifications = null;
let unsubscribeActivity = null;

function show(id, message) {
  const element = $(id);
  if (element) element.textContent = message;
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function formatDate(timestamp) {
  if (!timestamp?.toDate) return "Just now";
  return timestamp.toDate().toLocaleString();
}

function statusClass(status) {
  return String(status || "Pending")
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function redirectRole(role) {
  const routes = {
    student: "student.html",
    admin: "admin.html",
    worker: "worker.html"
  };

  if (routes[role]) {
    window.location.href = routes[role];
  } else {
    show("message", "Your account has not been assigned an approved role.");
    signOut(auth);
  }
}

async function writeActivity(action, details = {}) {
  if (!currentUser) return;

  await addDoc(collection(db, "activityLogs"), {
    actorId: currentUser.uid,
    actorName: currentProfile?.name || currentUser.displayName || currentUser.email,
    action,
    details,
    createdAt: serverTimestamp()
  });
}

async function notifyUser(userId, title, message, reportId) {
  if (!userId || !reportId) return;

  await addDoc(collection(db, "notifications"), {
    userId,
    title,
    message,
    reportId,
    read: false,
    createdAt: serverTimestamp()
  });
}

async function getProfile(user) {
  const profileRef = doc(db, "users", user.uid);
  const profileSnapshot = await getDoc(profileRef);

  if (!profileSnapshot.exists()) {
    const newProfile = {
      uid: user.uid,
      name: user.displayName || "CampusCare User",
      email: user.email || "",
      photoURL: user.photoURL || "",
      role: "student",
      createdAt: serverTimestamp()
    };

    await setDoc(profileRef, newProfile);

    return {
      ...newProfile,
      createdAt: null
    };
  }

  return profileSnapshot.data();
}

async function login() {
  show("message", "Opening Google sign-in...");

  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    console.error("Login error:", error);
    show("message", error.message || "Google sign-in failed.");
  }
}

async function logout() {
  if (unsubscribeReports) unsubscribeReports();
  if (unsubscribeNotifications) unsubscribeNotifications();
  if (unsubscribeActivity) unsubscribeActivity();

  await signOut(auth);
  window.location.href = "login.html";
}

function renderStats(reports) {
  const counts = {
    total: reports.length,
    pending: reports.filter(report => report.status === "Pending").length,
    progress: reports.filter(report => report.status === "In Progress").length,
    resolved: reports.filter(report => report.status === "Resolved").length
  };

  if ($("totalCount")) $("totalCount").textContent = counts.total;
  if ($("pendingCount")) $("pendingCount").textContent = counts.pending;
  if ($("progressCount")) $("progressCount").textContent = counts.progress;
  if ($("resolvedCount")) $("resolvedCount").textContent = counts.resolved;
}

function reportCard(report, id, mode = "student") {
  const image = report.imageURL
    ? `<img class="cc-report-image" src="${escapeHTML(report.imageURL)}" alt="Issue image" loading="lazy">`
    : "";

  let actions = "";

  if (mode === "admin") {
    actions = `
      <label for="worker-${escapeHTML(id)}">Assign to worker UID</label>
      <input
        id="worker-${escapeHTML(id)}"
        placeholder="Paste approved worker UID"
        value="${escapeHTML(report.assignedTo || "")}"
      >

      <button class="cc-button cc-primary"
        data-action="assign" data-id="${escapeHTML(id)}">
        Assign worker
      </button>

      ${report.status === "Awaiting Verification" ? `
        <button class="cc-button cc-outline"
          data-action="resolve" data-id="${escapeHTML(id)}">
          Verify resolution
        </button>
      ` : ""}
    `;
  }

  if (mode === "worker") {
    if (report.status === "Pending") {
      actions = `
        <button class="cc-button cc-primary"
          data-action="start" data-id="${escapeHTML(id)}">
          Start work
        </button>
      `;
    } else if (report.status === "In Progress") {
      actions = `
        <button class="cc-button cc-outline"
          data-action="complete" data-id="${escapeHTML(id)}">
          Mark completed
        </button>
      `;
    } else if (report.status === "Awaiting Verification") {
      actions = `<p class="cc-small">Waiting for admin verification.</p>`;
    } else if (report.status === "Resolved") {
      actions = `<p class="cc-small">This task has been verified.</p>`;
    }
  }

  return `
    <article class="cc-report">
      <div class="cc-report-top">
        <h3>${escapeHTML(report.title || "Untitled report")}</h3>
        <span class="cc-status ${escapeHTML(statusClass(report.status))}">
          ${escapeHTML(report.status || "Pending")}
        </span>
      </div>

      <p><strong>Category:</strong> ${escapeHTML(report.category || "Other")}</p>
      <p><strong>Location:</strong> ${escapeHTML(report.location || "Not provided")}</p>
      <p><strong>Priority:</strong> ${escapeHTML(report.priority || "Medium")}</p>
      <p>${escapeHTML(report.description || "")}</p>

      ${image}

      <p class="cc-small">
        Reported by ${escapeHTML(report.studentName || "Student")}
        · ${formatDate(report.createdAt)}
      </p>

      ${report.assignedTo
        ? `<p><strong>Assigned worker UID:</strong> ${escapeHTML(report.assignedTo)}</p>`
        : ""}

      ${actions}
    </article>
  `;
}

function renderReports(reports, targetId, mode) {
  const container = $(targetId);
  if (!container) return;

  if (!reports.length) {
    container.innerHTML = "<p>No reports found.</p>";
    return;
  }

  container.innerHTML = reports
    .map(report => reportCard(report, report.id, mode))
    .join("");
}

function listenReports() {
  const reportsReference = collection(db, "reports");
  let reportsQuery;

  if (page === "student") {
    reportsQuery = query(
      reportsReference,
      where("studentId", "==", currentUser.uid)
    );
  } else if (page === "worker") {
    reportsQuery = query(
      reportsReference,
      where("assignedTo", "==", currentUser.uid)
    );
  } else {
    reportsQuery = query(reportsReference, limit(300));
  }

  unsubscribeReports = onSnapshot(
    reportsQuery,
    (snapshot) => {
      reportsCache = snapshot.docs.map(document => ({
        id: document.id,
        ...document.data()
      }));

      reportsCache.sort((a, b) =>
        (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
      );

      renderStats(reportsCache);

      if (page === "student") {
        renderReports(reportsCache, "myReports", "student");
      }

      if (page === "admin") {
        renderReports(reportsCache, "adminReports", "admin");
        renderAnalytics(reportsCache);
      }

      if (page === "worker") {
        renderReports(reportsCache, "workerTasks", "worker");
      }
    },
    (error) => {
      console.error("Report listener error:", error);
      show("myReports", "Unable to load reports. Check Firestore rules.");
      show("adminReports", "Unable to load reports. Check Firestore rules.");
      show("workerTasks", "Unable to load tasks. Check Firestore rules.");
    }
  );
}

function renderAnalytics(reports) {
  const target = $("categoryAnalytics");
  if (!target) return;

  const counts = {};

  reports.forEach(report => {
    const category = report.category || "Other";
    counts[category] = (counts[category] || 0) + 1;
  });

  target.innerHTML = Object.entries(counts).length
    ? Object.entries(counts).map(([category, count]) => `
        <div class="cc-analytics-row">
          <span>${escapeHTML(category)}</span>
          <strong>${count}</strong>
        </div>
      `).join("")
    : "<p>No analytics available yet.</p>";
}

async function submitReport(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const data = new FormData(form);
  const message = $("reportMessage");

  try {
    if (message) message.textContent = "Submitting your report...";

    const title = String(data.get("title") || "").trim();
    const category = String(data.get("category") || "Other");
    const location = String(data.get("location") || "").trim();
    const priority = String(data.get("priority") || "Medium");
    const description = String(data.get("description") || "").trim();
    const imageFile = data.get("image");

    if (!title || !location || !description) {
      throw new Error("Please complete all required fields.");
    }

    if (imageFile instanceof File && imageFile.size > 5 * 1024 * 1024) {
      throw new Error("Image must be smaller than 5 MB.");
    }

    if (
      imageFile instanceof File &&
      imageFile.size > 0 &&
      !["image/jpeg", "image/png", "image/webp"].includes(imageFile.type)
    ) {
      throw new Error("Only JPG, PNG and WEBP images are allowed.");
    }

    const duplicate = reportsCache.some(report =>
      String(report.title || "").toLowerCase() === title.toLowerCase() &&
      String(report.location || "").toLowerCase() === location.toLowerCase() &&
      report.status !== "Resolved"
    );

    if (
      duplicate &&
      !confirm("A similar open report already exists. Do you still want to submit?")
    ) {
      if (message) message.textContent = "Submission cancelled.";
      return;
    }

    let imageURL = "";

    // Images are uploaded to Supabase, not Firebase Storage.
    if (imageFile instanceof File && imageFile.size > 0) {
      if (message) message.textContent = "Uploading report image...";
      imageURL = await uploadReportImage(imageFile, currentUser);
    }

    if (message) message.textContent = "Saving your report...";

    const reportReference = await addDoc(collection(db, "reports"), {
      title,
      category,
      location,
      priority,
      description,
      imageURL,
      studentId: currentUser.uid,
      studentName: currentProfile?.name || currentUser.displayName || currentUser.email,
      assignedTo: "",
      status: "Pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    await writeActivity("Report submitted", {
      reportId: reportReference.id,
      title
    });

    if (message) {
      message.textContent = "Your report has been submitted successfully.";
    }

    form.reset();
  } catch (error) {
    console.error("Report submission error:", error);

    if (message) {
      message.textContent = error.message || "Could not submit your report.";
    }
  }
}

function getLocation() {
  if (!navigator.geolocation) {
    show("locationMessage", "Geolocation is not supported by this browser.");
    return;
  }

  show("locationMessage", "Getting your location...");

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      const input = document.querySelector('[name="location"]');

      if (input) {
        input.value = `GPS: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
      }

      show("locationMessage", "Location added. You can edit it before submitting.");
    },
    () => {
      show("locationMessage", "Location unavailable. Please enter the location manually.");
    },
    {
      enableHighAccuracy: true,
      timeout: 10000
    }
  );
}

async function handleReportAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const id = button.dataset.id;
  const action = button.dataset.action;
  const report = reportsCache.find(item => item.id === id);

  if (!report || !currentUser) return;

  button.disabled = true;

  try {
    const reportReference = doc(db, "reports", id);

    if (action === "assign") {
      if (currentProfile.role !== "admin") {
        throw new Error("Only an admin can assign workers.");
      }

      const workerInput = $(`worker-${id}`);
      const workerId = workerInput?.value.trim();

      if (!workerId) throw new Error("Enter a worker UID.");

      const workerSnapshot = await getDoc(doc(db, "users", workerId));

      if (!workerSnapshot.exists() || workerSnapshot.data().role !== "worker") {
        throw new Error("This UID does not belong to an approved worker.");
      }

      await updateDoc(reportReference, {
        assignedTo: workerId,
        status: "Pending",
        updatedAt: serverTimestamp()
      });

      await notifyUser(
        workerId,
        "New task assigned",
        `You have been assigned: ${report.title}`,
        id
      );

      await notifyUser(
        report.studentId,
        "Report assigned",
        `Your report "${report.title}" has been assigned.`,
        id
      );

      await writeActivity("Worker assigned", {
        reportId: id,
        workerId
      });
    }

    if (action === "start") {
      if (currentProfile.role !== "worker" || report.assignedTo !== currentUser.uid) {
        throw new Error("This task is not assigned to you.");
      }

      if (report.status !== "Pending") {
        throw new Error("This task cannot be started in its current status.");
      }

      await updateDoc(reportReference, {
        status: "In Progress",
        updatedAt: serverTimestamp()
      });

      await notifyUser(
        report.studentId,
        "Work started",
        `Work has started on "${report.title}".`,
        id
      );

      await writeActivity("Work started", { reportId: id });
    }

    if (action === "complete") {
      if (currentProfile.role !== "worker" || report.assignedTo !== currentUser.uid) {
        throw new Error("This task is not assigned to you.");
      }

      if (report.status !== "In Progress") {
        throw new Error("This task is not currently in progress.");
      }

      await updateDoc(reportReference, {
        status: "Awaiting Verification",
        updatedAt: serverTimestamp()
      });

      await notifyUser(
        report.studentId,
        "Work completed",
        `The team has completed "${report.title}". It is waiting for admin verification.`,
        id
      );

      await writeActivity("Work marked complete", { reportId: id });
    }

    if (action === "resolve") {
      if (currentProfile.role !== "admin") {
        throw new Error("Only an admin can verify a report.");
      }

      if (report.status !== "Awaiting Verification") {
        throw new Error("This report is not waiting for verification.");
      }

      await updateDoc(reportReference, {
        status: "Resolved",
        verifiedBy: currentUser.uid,
        updatedAt: serverTimestamp()
      });

      await notifyUser(
        report.studentId,
        "Issue resolved",
        `Your report "${report.title}" has been verified as resolved.`,
        id
      );

      if (report.assignedTo) {
        await notifyUser(
          report.assignedTo,
          "Task verified",
          `Your work on "${report.title}" has been verified.`,
          id
        );
      }

      await writeActivity("Report verified", { reportId: id });
    }
  } catch (error) {
    console.error("Report action error:", error);
    alert(error.message || "Action failed.");
  } finally {
    button.disabled = false;
  }
}

function loadNotifications() {
  const target = $("notifications");
  if (!target) return;

  const notificationsQuery = query(
    collection(db, "notifications"),
    where("userId", "==", currentUser.uid),
    limit(50)
  );

  unsubscribeNotifications = onSnapshot(
    notificationsQuery,
    (snapshot) => {
      const notifications = snapshot.docs.map(document => ({
        id: document.id,
        ...document.data()
      }));

      notifications.sort((a, b) =>
        (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
      );

      target.innerHTML = notifications.length
        ? notifications.map(notification => `
            <article class="cc-notification">
              <strong>${escapeHTML(notification.title)}</strong>
              <p>${escapeHTML(notification.message)}</p>
              <span class="cc-small">${formatDate(notification.createdAt)}</span>
            </article>
          `).join("")
        : "<p>No notifications yet.</p>";
    },
    (error) => {
      console.error("Notification error:", error);
      target.textContent = "Unable to load notifications.";
    }
  );
}

async function loadUsers() {
  const target = $("userManagement");
  if (!target) return;

  try {
    const snapshot = await getDocs(
      query(collection(db, "users"), limit(200))
    );

    const users = snapshot.docs.map(document => ({
      id: document.id,
      ...document.data()
    }));

    target.innerHTML = users.map(user => `
      <div class="cc-user-row">
        <div>
          <strong>${escapeHTML(user.name || user.email || "User")}</strong>
          <p class="cc-small">${escapeHTML(user.email || "")}</p>
          <p class="cc-small">UID: ${escapeHTML(user.id)}</p>
          <p class="cc-small">Current role: ${escapeHTML(user.role || "student")}</p>
        </div>

        <select id="role-${escapeHTML(user.id)}">
          <option value="student" ${user.role === "student" ? "selected" : ""}>Student</option>
          <option value="worker" ${user.role === "worker" ? "selected" : ""}>Worker</option>
        </select>

        <button class="cc-button cc-outline"
          data-user-role="${escapeHTML(user.id)}">
          Save role
        </button>
      </div>
    `).join("") || "<p>No users found.</p>";
  } catch (error) {
    console.error("User loading error:", error);
    target.textContent = "Unable to load users. Check admin permissions.";
  }
}

async function handleRoleChange(event) {
  const button = event.target.closest("[data-user-role]");
  if (!button) return;

  if (currentProfile.role !== "admin") {
    alert("Only an admin can change user roles.");
    return;
  }

  const uid = button.dataset.userRole;
  const select = $(`role-${uid}`);
  if (!select) return;

  const role = select.value;

  if (uid === currentUser.uid) {
    alert("You cannot change your own admin role here.");
    return;
  }

  if (!confirm(`Change this user's role to ${role}?`)) return;

  button.disabled = true;

  try {
    await updateDoc(doc(db, "users", uid), {
      role,
      updatedAt: serverTimestamp()
    });

    await writeActivity("User role changed", { uid, role });
    alert("User role updated.");
  } catch (error) {
    console.error("Role update error:", error);
    alert(error.message || "Could not update role.");
  } finally {
    button.disabled = false;
  }
}

function listenActivity() {
  const target = $("activityLog");
  if (!target) return;

  unsubscribeActivity = onSnapshot(
    query(collection(db, "activityLogs"), limit(50)),
    (snapshot) => {
      const logs = snapshot.docs.map(document => document.data());

      logs.sort((a, b) =>
        (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
      );

      target.innerHTML = logs.length
        ? logs.map(log => `
            <article class="cc-notification">
              <strong>${escapeHTML(log.action)}</strong>
              <p>${escapeHTML(log.actorName || "User")}</p>
              <span class="cc-small">${formatDate(log.createdAt)}</span>
            </article>
          `).join("")
        : "<p>No activity yet.</p>";
    },
    (error) => {
      console.error("Activity log error:", error);
      target.textContent = "Unable to load activity logs.";
    }
  );
}

async function startDashboard(user, profile) {
  currentUser = user;
  currentProfile = profile;

  if ($("userName")) {
    $("userName").textContent = profile.name || user.email || "CampusCare User";
  }

  if ($("logout")) {
    $("logout").addEventListener("click", logout);
  }

  if (page && profile.role !== page) {
    redirectRole(profile.role);
    return;
  }

  if (page === "student") {
    $("reportForm")?.addEventListener("submit", submitReport);
    $("getLocation")?.addEventListener("click", getLocation);
  }

  if (page === "admin") {
    $("adminReports")?.addEventListener("click", handleReportAction);
    $("userManagement")?.addEventListener("click", handleRoleChange);

    await loadUsers();
    listenActivity();
  }

  if (page === "worker") {
    $("workerTasks")?.addEventListener("click", handleReportAction);
  }

  if (page) {
    listenReports();
    loadNotifications();
  }
}

const googleButton = $("googleLogin");

if (googleButton) {
  googleButton.addEventListener("click", login);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    if (page) window.location.href = "login.html";
    return;
  }

  try {
    const profile = await getProfile(user);

    if (googleButton) {
      redirectRole(profile.role);
      return;
    }

    if (page) {
      await startDashboard(user, profile);
    }
  } catch (error) {
    console.error("Account loading error:", error);
    show("message", error.message || "Unable to load your account.");
  }
});
