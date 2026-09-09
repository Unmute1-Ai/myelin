# Production Readiness

**Current classification: platform production candidate.**

## Workspace
- [ ] `pnpm install --frozen-lockfile` succeeds
- [ ] Typecheck passes across workspace
- [ ] All buildable packages build
- [ ] Generated API clients match committed API specification

## API server
- [ ] Authentication/session strategy documented
- [ ] CORS allowlist is environment-specific
- [ ] Structured logging redacts secrets/sensitive fields
- [ ] Health/readiness endpoints exist
- [ ] Timeouts, request size limits, and rate limits are configured
- [ ] Database connection pooling/limits are documented

## Database
- [ ] Schema changes reviewed
- [ ] Migration/rollback plan tested
- [ ] Production DB credentials stored in managed secrets
- [ ] Backup/restore tested
- [ ] Destructive database operations require explicit operator action

## Release
- [ ] Artifact versions assigned
- [ ] Environment variables documented
- [ ] Deployment rollback path verified
- [ ] Monitoring owner assigned
