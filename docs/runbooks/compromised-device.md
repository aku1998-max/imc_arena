# Compromised or lost child device

1. **Revoke child sessions:** parent app → child → _Signed-in devices_ → _Sign out_, or
   `DELETE /v1/child-sessions/:id`. Revocation is immediate; the device gets 401 on its next call.
2. **Require parent sign-in:** returning to parent mode always needs an email code; there is no
   PIN-only path.
3. **Inspect suspicious activity:** audit events for the student (`target_type = 'student'`),
   `child_sessions.last_used_at`, unusual attempt volume in `app.attempts`.
4. If the parent's email may be compromised, revoke Supabase sessions for the account and ask the
   parent to secure their mailbox before signing in again.
