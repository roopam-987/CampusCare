
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  createRemoteJWKSet,
  jwtVerify
} from "npm:jose@5";

// Firebase project ID
const PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID")!;

// Supabase environment variables
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Storage settings
const BUCKET = "campuscare-reports";
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// Allowed image formats
const allowedTypes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

// Firebase token verification keys
const firebaseKeys = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
  )
);

// Supabase client
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

// CORS settings
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

// JSON response helper
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders
  });
}

// Main Edge Function
Deno.serve(async (request) => {

  // Handle browser preflight requests
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }

  // Allow only POST requests
  if (request.method !== "POST") {
    return response(
      { error: "Method not allowed." },
      405
    );
  }

  try {

    // Get Firebase authentication token
    const authorization =
      request.headers.get("Authorization") || "";

    const firebaseToken = authorization.replace(
      /^Bearer\s+/i,
      ""
    );

    if (!firebaseToken) {
      return response(
        { error: "Authentication required." },
        401
      );
    }

    // Verify Firebase ID token
    const { payload } = await jwtVerify(
      firebaseToken,
      firebaseKeys,
      {
        issuer: `https://securetoken.google.com/${PROJECT_ID}`,
        audience: PROJECT_ID
      }
    );

    const userId = payload.sub;

    if (!userId) {
      return response(
        { error: "Invalid user token." },
        401
      );
    }

    // Read upload information
    const body = await request.json();

    const contentType = String(
      body.contentType || ""
    );

    const fileSize = Number(
      body.fileSize || 0
    );

    // Validate image format
    if (!allowedTypes[contentType]) {
      return response(
        { error: "Unsupported image type." },
        400
      );
    }

    // Validate image size
    if (
      !Number.isFinite(fileSize) ||
      fileSize <= 0 ||
      fileSize > MAX_FILE_SIZE
    ) {
      return response(
        {
          error: "Image must be between 1 byte and 5 MB."
        },
        400
      );
    }

    // Generate a unique file path
    const extension = allowedTypes[contentType];

    const path =
      `${userId}/${crypto.randomUUID()}.${extension}`;

    // Generate signed upload URL
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(path);

    if (error || !data) {
      console.error(
        "Signed upload URL error:",
        error
      );

      return response(
        { error: "Could not create upload URL." },
        500
      );
    }

    // Return upload path and token
    return response({
      path: data.path,
      token: data.token
    });

  } catch (error) {

    console.error(
      "Upload function error:",
      error
    );

    return response(
      {
        error: "Authentication or upload request failed."
      },
      401
    );
  }
});
