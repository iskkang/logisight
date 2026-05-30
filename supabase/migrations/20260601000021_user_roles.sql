-- 021: 사용자 역할 (앱 내 권한 관리)
-- CREATE TYPE IF NOT EXISTS는 PG 9.6+에서만 지원하므로 안전한 DO 블록 사용.
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'editor', 'viewer');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS user_roles (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       public.app_role NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, role)
);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
-- 본인 역할만 읽기 허용
CREATE POLICY "own_role_read" ON user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "service_write" ON user_roles
  FOR ALL TO service_role USING (true);
