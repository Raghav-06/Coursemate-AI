import { query } from "./pool.js";

// User settings (users.preferences JSONB) and per-course overrides
// (course_preferences), both personal.

export async function getUserPreferences(userId) {
  const { rows } = await query("SELECT preferences FROM users WHERE id = $1", [userId]);
  return rows[0]?.preferences ?? {};
}

/** Merges `patch` into the user's preferences (a null value removes that key). */
export async function updateUserPreferences(userId, patch) {
  const { rows } = await query(
    `UPDATE users SET preferences = jsonb_strip_nulls(preferences || $2::jsonb), updated_at = NOW()
      WHERE id = $1 RETURNING preferences`,
    [userId, JSON.stringify(patch)]
  );
  return rows[0]?.preferences ?? {};
}

export async function getCoursePreferences(userId, notebookId) {
  const { rows } = await query("SELECT preferences FROM course_preferences WHERE user_id = $1 AND notebook_id = $2", [userId, notebookId]);
  return rows[0]?.preferences ?? {};
}

/** Merges `patch` into this user's settings for a course (a null value removes that key). */
export async function updateCoursePreferences(userId, notebookId, patch) {
  const { rows } = await query(
    `INSERT INTO course_preferences (user_id, notebook_id, preferences) VALUES ($1, $2, jsonb_strip_nulls($3::jsonb))
     ON CONFLICT (user_id, notebook_id) DO UPDATE SET
       preferences = jsonb_strip_nulls(course_preferences.preferences || $3::jsonb), updated_at = NOW()
     RETURNING preferences`,
    [userId, notebookId, JSON.stringify(patch)]
  );
  return rows[0].preferences;
}
