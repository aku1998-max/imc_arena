# Wrong answer key

1. **Retire assignment.** Admin website → version → _Retire_ with a reason and tick _Answer key is
   wrong_. This stops new selection immediately and enqueues `content.correction`, which halts
   active sessions still holding the version and raises a `content_correction` ops alert with the
   number of affected attempts.
2. **Identify affected versions/attempts.** Query (read-only, owner role):
   `select count(*), min(received_at), max(received_at) from app.attempts a join app.session_items i on i.id = a.session_item_id where i.question_version_id = '<version>';`
3. **Review the correction.** _Create correction draft_ → fix → submit → independent review →
   publish. The corrected version only reaches new sessions.
4. **Notify** affected families if results were shown incorrectly (support process).
5. **Audit.** Attempts are immutable. Any rescoring is an explicit, separately approved decision;
   record it as an audit event with the reason. Never update attempts in place.
