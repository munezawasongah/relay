import { Pool } from "pg";

let _pool: Pool | undefined;
function pool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

export interface MediaObjectRow {
  id: string;
  r2_key: string;
  mime_type: string;
  size_bytes: string;
  thumbnail_key: string | null;
  uploader_id: string | null;
  created_at: string;
}

export async function insertMediaObject(params: {
  r2Key: string;
  mimeType: string;
  sizeBytes: number;
  thumbnailKey?: string;
  uploaderId: string;
}): Promise<MediaObjectRow> {
  const { rows } = await pool().query<MediaObjectRow>(
    `INSERT INTO media_objects (r2_key, mime_type, size_bytes, thumbnail_key, uploader_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [params.r2Key, params.mimeType, params.sizeBytes, params.thumbnailKey ?? null, params.uploaderId]
  );
  return rows[0];
}

export async function findMediaObjectById(id: string): Promise<MediaObjectRow | null> {
  const { rows } = await pool().query<MediaObjectRow>("SELECT * FROM media_objects WHERE id = $1", [id]);
  return rows[0] ?? null;
}

/** A media object is visible to its uploader always, and to anyone else
 *  once (and only once) some message they can see references it — see
 *  db/migrations/0003_media_uploader.sql for why the uploader carve-out
 *  exists (the window between "uploaded" and "attached to a sent
 *  message"). */
export async function userCanAccessMedia(mediaId: string, userId: string): Promise<boolean> {
  const { rows } = await pool().query(
    `SELECT 1 FROM media_objects mo
     WHERE mo.id = $1 AND mo.uploader_id = $2
     UNION
     SELECT 1 FROM messages m
     JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
     WHERE m.media_ref = $1 AND cm.user_id = $2
     LIMIT 1`,
    [mediaId, userId]
  );
  return rows.length > 0;
}
