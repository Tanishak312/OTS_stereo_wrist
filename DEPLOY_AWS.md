# Deploying OTS on AWS with Docker

The site is one container on port 3010. It needs no database or disk of its own:
data lives in Supabase and email goes through Resend. Before the first deploy, do
section 0 of [DEPLOY_E2E.md](DEPLOY_E2E.md) (SQL files, Supabase plan, Drive folders,
Resend domain). Those steps don't depend on the host.

**Recommended setup:** ECS Fargate behind an Application Load Balancer, in Mumbai
(`ap-south-1`). For a single small server, use [EC2 with Docker Compose](#option-b-one-ec2-instance) instead.

## 1. Environment variables

Set these when the container starts. The image holds none of them, and building it
needs no keys.

| Variable | Needed | What it is |
|---|---|---|
| `SUPABASE_ANON_PUBLIC` | Yes | Supabase anon key |
| `ADMIN_EMAIL` | Yes | Email of the shared Supabase admin user. Its password is set in Supabase, not here |
| `RESEND_API_KEY` | Yes | Sends the customer emails. Keep it in AWS Secrets Manager |
| `EMAIL_FROM` | Yes | e.g. `Awign Robotics Data <data@awign.in>`, on a domain verified in Resend |
| `SAMPLE_DRIVE_URL_EGO` | Yes | Ego sample folder |
| `OFFER_MCAP` | Yes | `true`, so full-dataset sizes count MCAP |
| `SUPABASE_URL` | No | Only if the anon key doesn't carry the project ref |

**Never set `SUPABASE_SERVICE_ROLE` or any R2 key.** The site doesn't use them. Don't
copy the local `.env` across as it is.

## 2. Build and try it locally

```bash
docker build --platform linux/amd64 -t ots-web .
cp .env.docker.example .env.docker      # then fill it in
docker run --rm -p 3010:3010 --env-file .env.docker ots-web
```

`http://localhost:3010/api/health` should print `{"ok":true}`, and the home page should
show 14,701 hours. These keys are live, so a form submitted here creates a real request
and sends a real email.

## 3. Push the image to ECR

Use a new tag for every release, so you can go back to the last one.

```bash
ACCOUNT=<aws account id>
REGION=ap-south-1
TAG=$(date +%Y%m%d-%H%M)
REPO=$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/ots-web

aws ecr create-repository --repository-name ots-web --region $REGION     # first time only
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.$REGION.amazonaws.com
docker tag ots-web $REPO:$TAG
docker push $REPO:$TAG
```

The image is built for x86 (`linux/amd64`), so choose x86 in the ECS task or EC2
instance. For Graviton, build with `--platform linux/arm64`.

## 4. Option A: ECS Fargate + load balancer

**Task definition**
- Image: `$REPO:$TAG`, container port 3010
- Start with 0.5 vCPU and 1 GB memory, then adjust from CloudWatch
- Environment: the table above, with `RESEND_API_KEY` as a secret
- Logs: `awslogs`

**Target group**
- Target type IP, port 3010
- Health check path `/api/health`

**Load balancer**
- HTTPS on 443 with an ACM certificate for the domain, and HTTP 80 redirecting to it
- **Idle timeout 600 seconds.** The default of 60 can cut off the file list download
  for a big dataset

**Network**
- The task must reach Supabase and Resend on the internet: public subnet with a public
  IP, or private subnet with a NAT gateway
- The task's security group allows port 3010 from the load balancer only

**DNS:** point the domain at the load balancer (CNAME, or a Route 53 alias).

## Option B: one EC2 instance

On a t3.small or larger, with Docker installed and this folder copied over, without
`.env`, `data/` and `archive/`:

```bash
cp .env.docker.example .env.docker      # then fill it in
docker compose up -d --build
```

Put a load balancer or Nginx with HTTPS in front, using the same 600-second timeout.
Don't open port 3010 to the internet.

## Things that behave differently on AWS

- **App Runner:** it limits a request to 120 seconds, so big file list downloads can
  fail. Use ECS or EC2.
- **CloudFront:** if you add it, forward the `Host` header to the origin. Otherwise Next.js
  rejects form submissions, because the origin doesn't match.
- **After a new release:** refresh every kiosk screen that was already open. A form on
  an old page can't submit to the new version. Don't deploy during a booth session.

## 5. Check it

Run the checklist in section 8 of [DEPLOY_E2E.md](DEPLOY_E2E.md), with your own email.

## Updating and going back

New SQL files in `supabase/` run in the Supabase SQL editor **before** the new image goes out.

1. Build and push a new tag (sections 2 and 3).
2. ECS: new task definition revision with that tag, then update the service. It swaps
   containers with no downtime. EC2: `docker compose up -d --build`.

To go back, point the service at the previous task definition revision.

## When something's wrong

| You see | Look at |
|---|---|
| Home page shows about 4,147 hours, not 14,701 | Datasheet estimate: `SUPABASE_ANON_PUBLIC` is missing or Supabase can't be reached. `[inventory]` in the logs says which |
| `/admin` gives 500 | `SUPABASE_ANON_PUBLIC` is missing |
| Admin sign-in says `ADMIN_EMAIL` is missing | Set it on the container and restart |
| Admin sign-in says the password isn't right | Check the password of the `ADMIN_EMAIL` user in Supabase, and that this user is in `ots_admins` |
| Target stays unhealthy | Target group port 3010, path `/api/health`, and the security group |
| Container can't reach Supabase or Resend | The subnet has no internet route: public IP or NAT |
| File list download stops at 60 seconds | Load balancer idle timeout |
| "Invalid Server Actions request" in the logs | `Host` header not forwarded by CloudFront or a proxy |
| A kiosk form fails right after a release | That screen has the old page. Refresh it |
| A customer's email didn't go out | The reason is on the request page. Then `EMAIL_FROM`, the Resend domain, and **Send again** |

`/api/health` only shows that the server is up. A container with a missing key still
reports healthy, so check the home page number after every deploy.
