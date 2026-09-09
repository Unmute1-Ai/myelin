# Security Policy

## Reporting

Use GitHub private vulnerability reporting/security advisories when available. Do not publish credentials, connection strings, production database contents, session secrets, or exploitable endpoint details in public issues.

## High-risk surfaces

- authentication/session cookies
- CORS configuration
- database credentials and migrations
- generated API clients/spec drift
- logging of sensitive request payloads
- environment-specific secrets

Production secrets must remain outside source control. Database-changing commands such as Drizzle push operations require explicit operator review in production environments.
