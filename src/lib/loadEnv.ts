import dotenv from 'dotenv';

// Ensure local .env overrides any stale environment variables injected at container startup
dotenv.config({ override: true });
