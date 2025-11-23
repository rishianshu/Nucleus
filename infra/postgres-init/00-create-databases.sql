SELECT 'CREATE DATABASE temporal'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'temporal')\gexec

SELECT 'CREATE DATABASE platform'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'platform')\gexec

SELECT 'CREATE DATABASE jira_plus_plus'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'jira_plus_plus')\gexec
