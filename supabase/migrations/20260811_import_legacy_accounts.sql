-- ============================================================================
-- Import legacy ArenaX accounts into Supabase Auth
--
-- Run this AFTER 20260811_p2p_marketplace.sql.
--
-- The old Express backend stored its own accounts in public.users with a
-- bcrypt password_hash. Supabase Auth (GoTrue) also hashes with bcrypt, so the
-- existing hashes can be moved across as-is: every old password keeps working
-- and nobody has to reset anything.
--
-- Each auth.users row is created with THE SAME id as its public.users row, so
-- auth.uid() lines up with the existing profile and every foreign key already
-- pointing at public.users (matches, transactions, user_activity) stays valid.
--
-- Writing to auth.users directly is normally discouraged; a bulk import of
-- pre-hashed credentials is the one case where it is the intended route, since
-- GoTrue exposes no API that accepts an existing hash.
--
-- Safe to re-run: rows that already exist are skipped.
-- ============================================================================

DO $$
DECLARE
  u              RECORD;
  imported       INT := 0;
  skipped_email  INT := 0;
  skipped_hash   INT := 0;
  has_identities BOOLEAN;
  has_provider_id BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'auth' AND table_name = 'identities'
  ) INTO has_identities;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'identities' AND column_name = 'provider_id'
  ) INTO has_provider_id;

  FOR u IN
    SELECT p.id, p.email, p.username, p.phone, p.password_hash, p.created_at
    FROM public.users p
    LEFT JOIN auth.users a ON a.id = p.id
    WHERE a.id IS NULL
      AND p.email IS NOT NULL
      AND p.email <> ''
      -- rows already migrated to Supabase Auth carry this placeholder
      AND p.password_hash <> 'supabase-auth'
    ORDER BY p.created_at
  LOOP
    -- Only real bcrypt hashes can be handed to GoTrue.
    IF u.password_hash !~ '^\$2[aby]\$' THEN
      skipped_hash := skipped_hash + 1;
      CONTINUE;
    END IF;

    -- Someone else already owns this email in auth.users; leave both alone.
    IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = lower(u.email)) THEN
      skipped_email := skipped_email + 1;
      CONTINUE;
    END IF;

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      is_super_admin
    )
    VALUES (
      '00000000-0000-0000-0000-000000000000',
      u.id,
      'authenticated',
      'authenticated',
      lower(u.email),
      u.password_hash,
      -- pre-confirmed: these people already had working accounts, and email
      -- verification is deliberately off for now
      COALESCE(u.created_at, now()),
      COALESCE(u.created_at, now()),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_strip_nulls(jsonb_build_object('username', u.username, 'phone', u.phone)),
      '', '', '', '',
      false
    );

    -- GoTrue resolves email/password logins through auth.identities.
    IF has_identities THEN
      IF has_provider_id THEN
        INSERT INTO auth.identities (
          id, user_id, identity_data, provider, provider_id,
          last_sign_in_at, created_at, updated_at
        )
        VALUES (
          gen_random_uuid(), u.id,
          jsonb_build_object('sub', u.id::TEXT, 'email', lower(u.email), 'email_verified', true),
          'email', u.id::TEXT,
          now(), COALESCE(u.created_at, now()), now()
        )
        ON CONFLICT DO NOTHING;
      ELSE
        INSERT INTO auth.identities (
          id, user_id, identity_data, provider,
          last_sign_in_at, created_at, updated_at
        )
        VALUES (
          u.id::TEXT, u.id,
          jsonb_build_object('sub', u.id::TEXT, 'email', lower(u.email), 'email_verified', true),
          'email',
          now(), COALESCE(u.created_at, now()), now()
        )
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;

    -- mark the profile as owned by Supabase Auth from here on
    UPDATE public.users SET password_hash = 'supabase-auth' WHERE id = u.id;

    imported := imported + 1;
  END LOOP;

  RAISE NOTICE 'Legacy import complete: % imported, % skipped (email taken), % skipped (unusable hash)',
    imported, skipped_email, skipped_hash;
END;
$$;

-- What you should see afterwards: every profile paired with an auth account.
SELECT
  (SELECT count(*) FROM public.users)                                AS profiles,
  (SELECT count(*) FROM auth.users)                                  AS auth_accounts,
  (SELECT count(*) FROM public.users p
     JOIN auth.users a ON a.id = p.id)                               AS linked,
  (SELECT count(*) FROM public.users p
     LEFT JOIN auth.users a ON a.id = p.id WHERE a.id IS NULL)       AS still_unlinked;
