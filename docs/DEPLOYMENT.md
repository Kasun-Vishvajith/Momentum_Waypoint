# Public deployment

The primary hosting path is **Vercel with PostgreSQL through its Marketplace**. The repository includes a Vercel Python Function adapter, a Docker image, and a local PostgreSQL Compose stack. A public URL must be verified against a real deployment before submission. Render remains an optional alternative; no Render account is required.

## Vercel — recommended for the team's existing account

1. Import the GitHub `Momentum_Waypoint` repository as a **new Vercel project**, preserving the existing static Designathon deployment.
2. Select framework preset **Other** and repository root `.`. The included `vercel.json` serves `frontend/` and routes `/api/*` to the Python Function in `api/index.py`. Leave Build Command unset; the runtime installs root `requirements.txt`.
3. In the project's **Storage** area, choose **Create Database → Neon (PostgreSQL)** from the Marketplace. Review the available plan and terms; a new integration/account or paid plan needs the owner's approval. An existing compatible PostgreSQL database can also be connected.
4. Connect the database to the project. Ensure Production has `DATABASE_URL` set to its PostgreSQL connection string. The adapter also recognizes `POSTGRES_URL` if that is the injected variable. Keep credentials in Vercel environment settings, never source or chat.
5. Set `COOKIE_SECURE=true`, `SEED_PASSWORD=demo123`, and `DEMO_CLOCK=2026-06-23T15:00:00+05:30` for the repeatable supplied-data walkthrough.
6. Redeploy after connecting the database. The first API call creates schema and seeds it transactionally. Subsequent cold starts preserve data. Serverless mode refuses to use SQLite, preventing accidental ephemeral operational storage.
7. Verify `/api/health`, all four account sign-ins, published plan sharing, a real offline reload, and reconnect synchronization on the public HTTPS URL. Ensure deployment protection does not block external judges from the Production URL.
8. Keep the project and database available throughout review and subsequent rounds if advanced. Monitor free-tier capacity if selecting a free plan; quota exhaustion can interrupt judging.

Official references: [Vercel Python Functions](https://vercel.com/docs/functions/runtimes/python), [Postgres on Vercel](https://vercel.com/docs/postgres), and [Neon Marketplace integration](https://vercel.com/marketplace/neon). Vercel routes the API and browser assets on one origin, so cookie authentication and offline service-worker scope continue to work.

## Render Blueprint

1. Create a public GitHub monorepo named **Momentum_Waypoint** (adjust the prefix only if the registered team name differs). Push this folder's contents as the repository root.
2. In Render, choose **New → Blueprint**, connect the repository, and select `render.yaml`.
3. Review the resources and current charges before confirming. The blueprint uses a small persistent paid web service and PostgreSQL database so the review deployment is not dependent on a sleeping application or expiring trial database.
4. Render wires `DATABASE_URL` from PostgreSQL to the Docker service. Startup imports all seed/reference data. The app honors the host-supplied `PORT`.
5. Keep `COOKIE_SECURE=true`. Preserve the fixed walkthrough clock to demonstrate the supplied June fixture, or remove it to use actual SLT. Displayed clock behavior is disclosed in the UI and README.
6. Open the provided HTTPS URL, check `/api/health`, and complete the README walkthrough with four accounts. Verify an offline reload on the driver device. Test the actual deployed URL, not only localhost.
7. Record the URL and credentials in your submission form. Keep the deployment alive through review, and subsequent rounds if advanced.

Official references: [Render Blueprint specification](https://render.com/docs/blueprint-spec), [compute plans](https://render.com/docs/compute-plans), and [Docker deployment](https://render.com/docs/docker). Plan names and prices can change; review the provider's actual preview before creating paid resources.

## Docker host alternative

On a Linux host with Docker/Compose, clone the repository, copy `.env.example` to `.env`, set a strong alphanumeric database password, set `COOKIE_SECURE=true`, and start `docker compose up --build -d`. Put the app behind an HTTPS reverse proxy using your domain. Do not expose PostgreSQL publicly. Back up the named database volume and retain it for the entire review period.

## Operational checks

- Health: `GET /api/health` returns `{"status":"ok"}` and checks database connectivity.
- Credentials: default four seeded passwords are `demo123`; if `SEED_PASSWORD` was changed before first seed, submit that password instead.
- Database durability: restarting the application must preserve published trips and deliveries.
- Browser durability: records remain in the driver's IndexedDB until acknowledged; clearing browser data before sync loses unsent records.
- Server logs report HTTP requests and internal failures without logging submitted credentials/evidence.
- Restrict access to hosting account and database credentials. The judge account passwords are intentionally demo credentials.

## Pushing source

Use GitHub Desktop or an authenticated GitHub CLI session from this folder. For a new repository:

```sh
git init
git add .
git commit -m "Build Waypoint Hackathon delivery workflow"
gh repo create Momentum_Waypoint --public --source . --remote origin --push
```

Do not force-push over your Designathon repository. Commit/push all final code before the booklet's deadline. Record the final commit SHA with the submission; later code pushes are outside judging scope.
