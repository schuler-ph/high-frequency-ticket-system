# Getting Started with [Fastify-CLI](https://www.npmjs.com/package/fastify-cli)

This project was bootstrapped with Fastify-CLI.

## Environment Variables

The API expects shared variables from the workspace root `.env` file via `@repo/env`.

- `GOOGLE_CLOUD_PROJECT` (default: `high-frequency-ticket-system`)
- `PUBSUB_TOPIC_BUY_TICKET` (default: `buy-ticket`)
- `PUBSUB_EMULATOR_HOST` (optional, e.g. `localhost:8085` for local emulator)

## Available Scripts

In the project directory, you can run:

### `npm run dev`

To start the app in dev mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

### `npm start`

For production mode

### `npm run test`

Run the test cases.

## Learn More

To learn Fastify, check out the [Fastify documentation](https://fastify.dev/docs/latest/).
