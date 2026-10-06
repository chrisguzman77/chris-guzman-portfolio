-- Checks that a restored backup holds real data. restore.sh runs it with
-- ON_ERROR_STOP, so any RAISE EXCEPTION fails the restore. Prints row counts only.
\connect directus
DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects', 'experience', 'profile', 'directus_collections'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    IF n = 0 THEN
      RAISE EXCEPTION 'verify: directus.% has no rows', t;
    END IF;
    RAISE NOTICE 'verify: directus.% has % rows', t, n;
  END LOOP;
END $$;

\connect portfolio
DO $$
BEGIN
  IF to_regclass('public.alembic_version') IS NULL THEN
    RAISE EXCEPTION 'verify: portfolio.alembic_version is missing';
  END IF;
  RAISE NOTICE 'verify: portfolio.alembic_version exists';
END $$;
