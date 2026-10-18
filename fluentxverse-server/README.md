# fluentxverse-server

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.3. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Environment Configuration

### Notification Retention

Notifications are automatically cleaned up daily. Adjust retention via:

```env
# Keep notifications for N days (default: 30). Read notifications older than this are deleted.
NOTIFICATION_RETENTION_DAYS=30
```

The cleanup job runs:
- Once at server startup
- Every 24 hours thereafter

Only read notifications are deleted; unread notifications are preserved indefinitely.
