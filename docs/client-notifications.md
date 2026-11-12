# Client plan sharing

Sending a plan makes it available for client review and records `deal.plan_sent`.
It does not prove email delivery or client receipt.
The deal's Client sharing panel shows notification progress, a private link, and the first portal-open timestamp.
The private link remains selectable if clipboard access is unavailable.
An agency member can create another link after reloading without resending the plan or sending another email.

## Send from a connected Gmail account

Configure `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI`, and `GMAIL_TOKEN_ENCRYPTION_KEY` on both the web and notification worker services.
Use a stable 64-character hexadecimal encryption key representing 32 random bytes.
The local integration setup creates this key privately when it is missing.
Never rotate it without migrating or reconnecting the stored Gmail credentials.
For local development, register `http://localhost:3000/api/gmail/callback` as a Web application redirect URI in Google Cloud.
Enable Gmail API, configure an External app in Testing, and add the connecting Google account as a test user.

The workspace owner opens Connections, clicks Connect Gmail, and authorizes the account in Google.
Tranche requests `openid`, `email`, and `gmail.send`; it does not request inbox-reading access.
The connection applies to client notifications for this workspace.
The sender uses the owner's Tranche name followed by "via Tranche", with the authenticated Google email address.
Other workspace members cannot connect or disconnect the workspace's sender.

OAuth attempts use ten-minute, single-use, session-bound state, an HttpOnly cookie, and PKCE.
Refresh tokens are encrypted with AES-256-GCM and bound to the workspace ID.
Access tokens are refreshed in memory and never written to the database.
Disconnect removes the local connection and attempts to revoke Google's token.
Connecting does not itself send a test email; a running worker can process already queued client notifications.

Client notifications prefer the connected Gmail account; workspaces without Gmail use the configured Resend sender.
Agency notifications continue to require the platform Resend sender.
Sender identity and transport are pinned when a send attempt starts.
Gmail does not provide Resend's provider idempotency key, so uncertain Gmail sends and interrupted attempts require review and are not automatically sent again.
A provider acceptance still does not confirm inbox delivery.
Use a new, intentional client communication or share the private link manually when a notification requires review.
Google consent must be completed by the account holder; storing OAuth application credentials alone does not connect an account.

## Enable automatic email

1. Create a Resend API key and verify a sender domain you own using [Resend's domain setup](https://resend.com/docs/dashboard/domains/introduction).
2. Set `RESEND_API_KEY` and `EMAIL_FROM` privately on both the web and agents services.
   For example, `EMAIL_FROM="Tranche <notifications@your-verified-domain.example>"`.
3. Set `APP_URL` to the publicly accessible address of this same Tranche instance on both services.
   A link to localhost cannot be opened by a remote client.
   Changing only the URL does not expose a local server publicly, and a deployed instance with a different database cannot resolve locally created links.
4. Restart the services after changing their environment.
5. Run the notification worker.
   For local development, `corepack pnpm --filter @tranche/agents-service consume:local` runs notifications and the other agent handlers.
   On the deployed service, enable the existing `notifications` scheduled task or VPS scheduler.

Jobs already queued become eligible for delivery when email is configured and the worker runs.
New notification emails include a seven-day portal link.
Links created by the agency's sharing button use the existing thirty-day expiry.
No email is sent directly from the web request.
The notification worker retries with the same provider idempotency key.

## What the statuses mean

- **Not configured:** manual sharing is needed until email is enabled.
- **Queued:** the notification worker has not yet completed submission.
- **Pending confirmation:** the provider's acceptance has not been confirmed; the worker retries.
- **Accepted by provider:** the provider returned a message ID; this is not inbox delivery confirmation.
- **Needs attention or cancelled:** share a new private link and inspect the notification job.
- **Portal first opened:** a browser displayed the portal and posted a valid private token while visible.
  This is a link visit, not proof of the client's identity, reading, or acceptance.
- **Agreed:** the existing client acceptance flow recorded agreement to the plan.

The panel polls notification status while the agency page is visible.
The first portal visit is recorded once, even for concurrent visits, and appears in deal activity.
Tokens and email addresses are not included in that event.
Inbox delivery, bounces, and spam placement are not tracked by this implementation.
