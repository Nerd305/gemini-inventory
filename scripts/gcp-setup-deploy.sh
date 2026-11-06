#!/usr/bin/env bash
# One-time Google Cloud setup so GitHub Actions can deploy VialTrack to the Cloud Run service
# "blu35inventory". Run it in Google Cloud Shell (https://shell.cloud.google.com), signed in as the
# account that owns the project:
#
#   curl -fsSL https://raw.githubusercontent.com/Nerd305/gemini-inventory/main/scripts/gcp-setup-deploy.sh -o gcp-setup-deploy.sh
#   bash gcp-setup-deploy.sh
#
# It is safe to run again: every step checks before it creates. At the end it prints the two values to
# paste into GitHub. It never deploys anything and never changes the running service.
set -euo pipefail

PROJECT_ID="gen-lang-client-0920383400"
PROJECT_NUMBER="156214809618"
REGION="us-west1"
SERVICE="blu35inventory"
AR_REPO="vialtrack"                      # Artifact Registry repository that holds the web image
SECRET_NAME="gemini-api-key"
DEPLOYER_NAME="github-deployer"
DEPLOYER_SA="${DEPLOYER_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
POOL="github"
PROVIDER="github"
GITHUB_REPO="Nerd305/gemini-inventory"   # case-sensitive: must match github.com exactly
GITHUB_REPO_ID="1206959511"              # numeric id, so a renamed or re-created repo cannot borrow this trust

say() { printf '\n==> %s\n' "$*"; }

say "Project"
gcloud config set project "$PROJECT_ID" >/dev/null
ACTUAL_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format 'value(projectNumber)')"
[ "$ACTUAL_NUMBER" = "$PROJECT_NUMBER" ] || { echo "Project number is $ACTUAL_NUMBER, expected $PROJECT_NUMBER. Wrong account or project?"; exit 1; }

say "Turning on the Google services this needs (about a minute the first time)"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com \
  iamcredentials.googleapis.com iam.googleapis.com cloudresourcemanager.googleapis.com sts.googleapis.com

say "Looking at the running service"
if ! gcloud run services describe "$SERVICE" --region "$REGION" >/dev/null 2>&1; then
  echo "Cloud Run service $SERVICE was not found in $REGION. Stopping."; exit 1
fi
SNAPSHOT="$HOME/${SERVICE}-before.yaml"
gcloud run services describe "$SERVICE" --region "$REGION" --format export > "$SNAPSHOT"
chmod 600 "$SNAPSHOT"
echo "Saved $SNAPSHOT as your rollback reference. It may contain the old Gemini key in plain text: keep it private."
gcloud run services describe "$SERVICE" --region "$REGION" --format json | python3 -c '
import json, sys
svc = json.load(sys.stdin)
spec = svc["spec"]["template"]["spec"]
cs = spec.get("containers", [])
envs = {e["name"]: e for c in cs for e in c.get("env", [])}
key = envs.get("GEMINI_API_KEY")
kind = "not set" if key is None else ("from a secret" if "valueFrom" in key else "a PLAIN environment variable (the deploy will replace it with the secret)")
extra = "  <-- more than one: the deploy workflow removes extra helper containers" if len(cs) > 1 else ""
print("  containers: " + str(len(cs)) + " (expected 1)" + extra)
print("  custom command/args:", "yes (the deploy resets them)" if any(c.get("command") or c.get("args") for c in cs) else "no")
print("  GEMINI_API_KEY is:", kind)
print("  runs as:", spec.get("serviceAccountName") or "the default compute service account")
'
RUNTIME_SA="$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(spec.template.spec.serviceAccountName)')"
RUNTIME_SA="${RUNTIME_SA:-${PROJECT_NUMBER}-compute@developer.gserviceaccount.com}"

say "Image storage ($AR_REPO in $REGION)"
gcloud artifacts repositories describe "$AR_REPO" --location "$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "$AR_REPO" --location "$REGION" --repository-format docker \
    --description "VialTrack web images (built by GitHub Actions)"

say "Gemini key ($SECRET_NAME in Secret Manager)"
gcloud secrets describe "$SECRET_NAME" >/dev/null 2>&1 || gcloud secrets create "$SECRET_NAME" --replication-policy automatic
STORE_KEY=1
if [ -n "$(gcloud secrets versions list "$SECRET_NAME" --filter 'state=enabled' --format 'value(name)' --limit 1)" ]; then
  read -r -p "A Gemini key is already stored. Replace it? [y/N] " ANSWER
  [[ "${ANSWER:-N}" =~ ^[Yy]$ ]] || STORE_KEY=0
fi
if [ "$STORE_KEY" = 1 ]; then
  while true; do
    read -r -s -p "Paste your Gemini API key (from https://aistudio.google.com/apikey) and press Enter (nothing shows as you type): " GEMINI_KEY; echo
    [ -n "$GEMINI_KEY" ] || { echo "Nothing entered. Try again."; continue; }
    CODE="$(curl -s -o /dev/null -w '%{http_code}' -H "x-goog-api-key: $GEMINI_KEY" "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash" || true)"
    if [ "$CODE" = "200" ]; then break; fi
    echo "Google rejected that key (HTTP $CODE). It must be a Gemini key from aistudio.google.com/apikey, not the Firebase web key. Try again."
  done
  printf '%s' "$GEMINI_KEY" | gcloud secrets versions add "$SECRET_NAME" --data-file=- >/dev/null
  unset GEMINI_KEY
  echo "Key checked with Google and stored."
fi
# The running app (the runtime account) reads the key; the deployer only needs to see that the secret exists.
gcloud secrets add-iam-policy-binding "$SECRET_NAME" --member "serviceAccount:${RUNTIME_SA}" --role roles/secretmanager.secretAccessor >/dev/null

say "Giving the running app access to the database (it already needs this for the reporting API)"
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:${RUNTIME_SA}" --role roles/datastore.user --condition None >/dev/null

say "Deployer account ($DEPLOYER_SA)"
gcloud iam service-accounts describe "$DEPLOYER_SA" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$DEPLOYER_NAME" --display-name "GitHub Actions deployer (VialTrack)"
for ROLE in roles/run.developer roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:${DEPLOYER_SA}" --role "$ROLE" --condition None >/dev/null
done
# Deploying a new revision means "acting as" the account the app runs as.
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --member "serviceAccount:${DEPLOYER_SA}" --role roles/iam.serviceAccountUser >/dev/null
gcloud secrets add-iam-policy-binding "$SECRET_NAME" --member "serviceAccount:${DEPLOYER_SA}" --role roles/secretmanager.viewer >/dev/null

say "Trust between GitHub and Google (no passwords or keys to leak)"
gcloud iam workload-identity-pools describe "$POOL" --location global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create "$POOL" --location global --display-name "GitHub Actions"
gcloud iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool "$POOL" --location global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --workload-identity-pool "$POOL" --location global --display-name "GitHub" \
    --issuer-uri "https://token.actions.githubusercontent.com" \
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_id=assertion.repository_id,attribute.ref=assertion.ref" \
    --attribute-condition "assertion.repository == '${GITHUB_REPO}' && assertion.repository_id == '${GITHUB_REPO_ID}' && assertion.ref == 'refs/heads/main'"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_SA" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${GITHUB_REPO}" >/dev/null
PROVIDER_NAME="$(gcloud iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool "$POOL" --location global --format 'value(name)')"

cat <<DONE

==================================================================================
DONE. Google is ready. Now, in GitHub:

1. Open  https://github.com/${GITHUB_REPO}/settings/secrets/actions  and press
   "New repository secret" twice:
     Name:  GCP_WORKLOAD_IDENTITY_PROVIDER
     Value: ${PROVIDER_NAME}

     Name:  GCP_SERVICE_ACCOUNT
     Value: ${DEPLOYER_SA}

2. On the same page open the "Variables" tab -> "New repository variable":
     Name:  DEPLOY_ENABLED
     Value: true

3. Wait about 5 minutes (Google needs a moment to apply the new access), then
   GitHub -> Actions -> "Deploy" -> "Run workflow" (branch main). If the first step fails
   with a 403, wait a few more minutes and press "Re-run all jobs".

4. When it is green, open
   https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app/api/v1/health
   "commit" must be filled in and "gemini" must say "ok".

From now on GitHub owns this service. NEVER press "Deploy" in Google AI Studio again:
it would overwrite the service with its own wrapper and an old copy of the code.
Rollback reference for the old setup: ${SNAPSHOT}
==================================================================================
DONE
