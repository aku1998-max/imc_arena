# Lost paid access

1. **Verify provider state first.** Ask the parent to tap _Restore purchases_ (calls
   `POST /v1/billing/restore`, which re-reads RevenueCat and reconciles). Check the result in
   `GET /v1/billing/entitlements`.
2. **Inspect event history:** `app.billing_events` for the account's `billing_customer_id`
   (processing status, order), `app.subscriptions` (status, expiry, `last_verified_at`),
   `app.purchase_intents` (pending/ambiguous), and `billing_mismatch` ops alerts.
3. **Original binding:** entitlements reference the subscription (`source_id`). A transaction
   bound to another account is never moved automatically.
4. **Reconcile** by re-running the sweep for the account (worker `billing.sweep`) or the restore
   call. **No blind manual grants.** If a transfer to another child is justified, perform it as an
   explicit, audited support action with a documented reason (self-service transfers are disabled
   in V1).
