
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://ergyyzgtvszqqpdylifu.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_OZFwKyZrtwu3gjnp_msqxQ__4SSp_dq";

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

const UPLOAD_FUNCTION_URL =
  `${SUPABASE_URL}/functions/v1/create-upload-url`;

export async function uploadReportImage(file, firebaseUser) {
  if (!file || !firebaseUser) {
    throw new Error("Image or signed-in user is missing.");
  }

  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp"
  ];

  if (!allowedTypes.includes(file.type)) {
    throw new Error("Only JPG, PNG and WEBP images are allowed.");
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Image must be smaller than 5 MB.");
  }

  const firebaseToken = await firebaseUser.getIdToken();

  const response = await fetch(UPLOAD_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${firebaseToken}`,
      "apikey": SUPABASE_PUBLISHABLE_KEY
    },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      fileSize: file.size
    })
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok || !result.path || !result.token) {
    throw new Error(
      result.error || "Could not create a secure image upload link."
    );
  }

  const { error: uploadError } = await supabase.storage
    .from("campuscare-reports")
    .uploadToSignedUrl(
      result.path,
      result.token,
      file,
      {
        contentType: file.type,
        cacheControl: "3600",
        upsert: false
      }
    );

  if (uploadError) {
    console.error("Supabase image upload error:", uploadError);
    throw new Error(uploadError.message || "Image upload failed.");
  }

  const { data } = supabase.storage
    .from("campuscare-reports")
    .getPublicUrl(result.path);

  return data.publicUrl;
}
