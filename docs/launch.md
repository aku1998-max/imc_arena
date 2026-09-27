# Launch guide: Math Challenge on the App Store and Google Play

Decisions made (September 2026): store name **Math Challenge: IMC Prep**, app ID
**th.in.mathchallenge.app** (permanent once submitted), hosting **Render + Supabase** in
Singapore, App Store category **Education** (not the Kids category), Full plan **$6.99/month**.

The code is ready for store builds. What remains are accounts, keys and content that only the
owner can create. Steps marked **(owner)** need your accounts or payment; everything else is
already in this repository.

## 0. Blockers to clear before public release

| Blocker                                                                                                                                                     | Why it matters                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Real question bank.** The database only has synthetic development questions. Import the approved, rights-cleared IMC questions (docs/content-import.md).  | Reviewers and families will see the questions; a thin or placeholder bank gets rejected.         |
| **Privacy policy reviewed** (`apps/landing/privacy.html`). Have it checked for Thailand's PDPA and each launch country; confirm the support mailbox exists. | Both stores require a live privacy policy URL; children's data needs particular care.            |
| **Paid-gate sandbox tests** (docs/runbooks/paid-gate.md step 5).                                                                                            | Confirms that buying, restoring, renewing and cancelling unlock and lock the Full plan properly. |

## 1. Accounts (owner)

| Account                                         | Cost                          | Notes                                                                                                 |
| ----------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| Apple Developer Program, as an **organization** | US$99 / year                  | Needs a D-U-N-S number for the organization; enrolment can take 1–2 weeks. Start this first.          |
| Google Play Console, as an **organization**     | US$25 once                    | New personal accounts must run a 14-day closed test with 12 testers; organization accounts skip that. |
| Expo (EAS) — existing account `akunana`         | Free tier                     | Free tier includes a limited number of cloud builds per month.                                        |
| Supabase                                        | Free → US$25/mo               | Pro plan for production (daily backups, no pausing). Region: Southeast Asia (Singapore).              |
| Render                                          | ~US$14/mo                     | API + worker on Starter plans; the two static sites are free.                                         |
| RevenueCat                                      | Free until US$2.5k/mo revenue | Connects to both stores and tells the server who has paid.                                            |
| Domain (optional)                               | —                             | e.g. `api.mathchallenge.in.th`, `app.mathchallenge.in.th` on the existing domain.                     |

## 2. Server (owner creates accounts; commands are ready)

1. **Supabase:** create a project in Singapore. In Authentication → Providers keep Email on with
   one-time codes; in Authentication → URL settings add the app scheme `mathchallenge://`. Create a
   private storage bucket named `imc-private`. Enable TOTP MFA for staff.
2. **Database roles:** in the Supabase SQL editor run the statements in
   docs/runbooks/database-roles.md with two new strong passwords.
3. **Migrations:** from your Mac, with the owner connection string:
   `DATABASE_MIGRATION_URL='postgres://imc_owner:…@…pooler.supabase.com:5432/postgres' pnpm db:migrate`
4. **Render:** New → Blueprint → pick this repository. Render reads `render.yaml` and asks for the
   secret values (Supabase URLs and keys, RevenueCat secret key, the API's public URL). The API
   checks its configuration on start and names anything missing.
5. **Staff account:** grant yourself the administrator role (`pnpm --filter @imc/api staff:grant`,
   see the README) and import the question bank through the staff website.

## 3. Subscriptions (owner)

1. **App Store Connect:** create the app (name, bundle ID `th.in.mathchallenge.app`, SKU
   `mathchallenge-ios`). Under Subscriptions create group "Full plan" with product
   `imc_pro_monthly`, 1 month, price tier US$6.99 (Apple converts to local prices). Fill in the
   paid-apps agreement, tax and banking.
2. **Google Play Console:** create the app, then Monetize → Subscriptions → product
   `imc_pro_monthly`, base plan monthly auto-renewing, US$6.99. Set up a payments profile.
3. **RevenueCat:** add both apps, import the product, create entitlement `pro` attached to it.
   Webhook URL `https://<api>/webhooks/revenuecat` with Authorization header = the
   `BILLING_WEBHOOK_SECRET` Render generated. Copy the public SDK keys for step 4.
4. Run the sandbox test matrix in docs/runbooks/paid-gate.md, then turn on the `billing` flag.

## 4. App builds (commands ready)

From `apps/mobile` on your Mac:

```sh
npm install -g eas-cli
eas login                      # account akunana
eas init                       # links the project, adds extra.eas.projectId to app.json
```

Set these in expo.dev → Project → Environment variables, for the `preview` and `production`
environments (all are public client values, not secrets):

| Variable                               | Value                             |
| -------------------------------------- | --------------------------------- |
| `EXPO_PUBLIC_API_BASE_URL`             | the Render API URL (https)        |
| `EXPO_PUBLIC_SUPABASE_URL`             | `https://<project>.supabase.co`   |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key          |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY`       | RevenueCat Apple public key       |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`   | RevenueCat Google public key      |
| `EXPO_PUBLIC_PRIVACY_URL`              | where `privacy.html` is published |
| `EXPO_PUBLIC_SUPPORT_URL`              | where `support.html` is published |

Then:

```sh
pnpm build:preview       # installable test builds for your own phones (TestFlight / internal)
pnpm build:production    # store builds; EAS creates signing keys on first run
pnpm submit:production   # uploads to App Store Connect and the Play internal track
```

Put the App Store Connect app id into `eas.json` (`submit.production.ios.ascAppId`) before the
first submit. Expo Go keeps working for design checks (`pnpm start`); purchases need a
development or preview build (`pnpm start:dev-client`).

## 5. Store listing text

**App name:** Math Challenge: IMC Prep
**Subtitle (iOS, 30 chars):** Daily maths for grades 4–6
**Promotional text (iOS, 170):** Five new maths questions every day, with an explanation for every
answer. Get prepared for IMC competitions.
**Short description (Google, 80):** 5 maths questions a day with explanations. Prepare for IMC
competitions.
**Keywords (iOS, 100):** math,maths,IMC,olympiad,competition,grade 4,grade 5,grade 6,practice,
fractions,geometry,logic

**Description:**

> Math Challenge is a short daily maths workout for students in grades 4–6, made by the
> organisers of the IMC Math Challenge competitions.
>
> DAILY CHALLENGE — FREE
> Five new questions every day: two easy, two medium and one harder. It takes about six minutes.
>
> AN EXPLANATION FOR EVERY ANSWER
> Right or wrong, you see the working, step by step.
>
> FULL PLAN — $6.99 PER MONTH
> • Practise any topic: Arithmetic, Fractions, Geometry, Patterns, Measurement and Logic
> • Retry the questions you missed until you get them right
> • 30 days of progress for each topic
> • Be prepared for IMC competitions
>
> MADE FOR KIDS, CONTROLLED BY PARENTS
> No ads, no chat and no public profiles. Children use a nickname only. A parent sets up the
> account, gives consent and can export or delete data at any time.
>
> Subscriptions renew monthly until cancelled in your Apple or Google account settings. Payment
> is charged to your store account at confirmation of purchase.

**Category:** Education. **Age rating:** 4+ (Apple) / Everyone (Google). No ads.
**Privacy / Data safety answers:** collects email (account management), user content (problem
reports) and app activity (practice history), all linked to the account, not used for tracking,
not sold, encrypted in transit, deletable in the app.
**Google Play target audience:** ages 9–12 and adults (parents). This puts the app under the
Families policy: no ads SDKs, which the app already meets.
**Review notes for Apple/Google:** the reviewers must be able to sign in, but sign-in is a
one-time code sent by email. Reviewers cannot read your mailbox, so before submitting, decide
with the developer how to give them access (for example, a review-only sign-in for one reviewer
account). This is not built yet; plan it before the first submission.
**Screenshots:** 6.9" iPhone (1320×2868) and Android phone. Take them from a preview build with
the real question bank; the landing page mockups show the intended screens.

## 6. Release

1. TestFlight + Play internal testing with staff and a few families (rollout step 2–3 in
   docs/runbooks/deployment.md).
2. Fix what they find; import the full question bank.
3. Submit for review. Apple usually replies within 1–3 days; Google within a few days for a new
   app.
