# Paid gate checklist

Do not create live products or charge real users as a setup step.

1. Owner approves: one-child entitlement scope, product ids and prices (from the store/RevenueCat,
   not hard-coded), target countries, refund/support process, transaction reassignment policy.
2. RevenueCat: create sandbox products and an entitlement; set `REVENUECAT_API_KEY`,
   `BILLING_PRODUCT_IDS`, webhook URL `/webhooks/revenuecat` with an `Authorization` value equal to
   `BILLING_WEBHOOK_SECRET`.
3. Mobile: add `react-native-purchases`, configure with `appUserID = billingCustomerId` returned by
   `POST /v1/billing/purchase-intents`, replace `nativeStorePurchase` in `apps/mobile/src/purchases.ts`,
   then call `POST /v1/billing/restore` after the store completes. Add a manage-subscription link
   per platform.
4. Verify the adapter mapping (`mapRevenueCatSubscription`) against real sandbox payloads,
   especially the original-transaction identity (decisions D-015).
5. Sandbox tests: purchase, restore after reinstall, renewal, cancellation until expiry, grace,
   billing issue, refund, duplicate and out-of-order webhooks, account deletion with an active
   subscription.
6. Turn on `billing` for the pilot cohort only; monitor `billing_mismatch` alerts.
