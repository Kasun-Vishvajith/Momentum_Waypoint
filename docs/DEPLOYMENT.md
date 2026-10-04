# Public deployment

The repository includes a Docker image, a local PostgreSQL Compose stack, and a Render Blueprint. These are deployable configurations; a public URL must be obtained from a real hosting account before submission.

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
