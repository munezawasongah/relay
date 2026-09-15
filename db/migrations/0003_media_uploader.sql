-- media-service needs to know who uploaded a media object, to answer "can
-- this caller access it" for a media object that hasn't been attached to a
-- message yet (a message referencing it — and so the normal conversation-
-- membership check — doesn't exist until the client sends message:send
-- with mediaRef after the upload completes; the uploader must still be
-- able to fetch their own just-uploaded media in that window).

ALTER TABLE media_objects ADD COLUMN IF NOT EXISTS uploader_id UUID REFERENCES users(id);
