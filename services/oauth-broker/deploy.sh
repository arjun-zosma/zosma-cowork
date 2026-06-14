#!/usr/bin/env bash
# Deploy the Zosma OAuth broker as a Cloud Functions gen2 (Cloud Run) service.
#
# Why this script (and not `gcloud functions deploy --source=functions`):
#   - The buildpack auto-runs the "build" script with prod-only deps, and from a
#     monorepo it can pick up the ROOT package.json. We therefore deploy from an
#     ISOLATED, precompiled copy and disable buildpack script execution.
#
# Usage:
#   GOOGLE_OAUTH_CLIENT_ID=<web client id> \
#   CLIENT_SECRET_FILE=~/Downloads/client_secret_...json \
#   [REGION=us-central1] [PROJECT=keen-wavelet-461720-h0] [GCLOUD_CONFIG=zosma] \
#   ./deploy.sh
set -euo pipefail

PROJECT="${PROJECT:-keen-wavelet-461720-h0}"
REGION="${REGION:-us-central1}"
GCLOUD_CONFIG="${GCLOUD_CONFIG:-zosma}"
: "${GOOGLE_OAUTH_CLIENT_ID:?set GOOGLE_OAUTH_CLIENT_ID (the public Web client id)}"
GC=(gcloud --configuration="$GCLOUD_CONFIG" --project="$PROJECT")
SECRET_NAME="GOOGLE_OAUTH_CLIENT_SECRET"
here="$(cd "$(dirname "$0")" && pwd)"

echo "==> Enable APIs"
"${GC[@]}" services enable run.googleapis.com cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com >/dev/null

PN="$("${GC[@]}" projects describe "$PROJECT" --format='value(projectNumber)')"
COMPUTE_SA="${PN}-compute@developer.gserviceaccount.com"

if [[ -n "${CLIENT_SECRET_FILE:-}" ]]; then
  echo "==> Store client secret in Secret Manager (value never printed)"
  "${GC[@]}" secrets describe "$SECRET_NAME" >/dev/null 2>&1 || \
    "${GC[@]}" secrets create "$SECRET_NAME" --replication-policy=automatic >/dev/null
  jq -rj '.web.client_secret // .installed.client_secret' "$CLIENT_SECRET_FILE" | \
    "${GC[@]}" secrets versions add "$SECRET_NAME" --data-file=- >/dev/null
fi

echo "==> Grant the gen2 build/runtime SA the roles it needs"
"${GC[@]}" secrets add-iam-policy-binding "$SECRET_NAME" \
  --member="serviceAccount:${COMPUTE_SA}" --role=roles/secretmanager.secretAccessor >/dev/null
# gen2 builds run as the compute SA; it needs build (logging + AR writer) perms.
"${GC[@]}" projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${COMPUTE_SA}" --role=roles/cloudbuild.builds.builder --condition=None >/dev/null

echo "==> Build + stage an isolated deploy dir"
( cd "$here/functions" && npm ci && npm run build )
stage="$(mktemp -d)"
cp -r "$here/functions/lib" "$stage/lib"
node -e "const fs=require('fs');const p=require('$here/functions/package.json');delete p.scripts.build;delete p.scripts['build:watch'];delete p.devDependencies;fs.writeFileSync('$stage/package.json',JSON.stringify(p,null,2))"

echo "==> Deploy"
"${GC[@]}" functions deploy broker \
  --gen2 --region="$REGION" --runtime=nodejs22 \
  --source="$stage" --entry-point=broker \
  --trigger-http --allow-unauthenticated \
  --set-build-env-vars=GOOGLE_NODE_RUN_SCRIPTS= \
  --set-env-vars="GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_OAUTH_CLIENT_ID}" \
  --set-secrets="${SECRET_NAME}=${SECRET_NAME}:latest" \
  --memory=512Mi --timeout=30s --max-instances=20 --concurrency=1

# Public access. NOTE: requires the org policy iam.allowedPolicyMemberDomains to
# permit allUsers on this project (set a project-level override allowAll=true if
# your org enforces Domain Restricted Sharing).
"${GC[@]}" run services add-iam-policy-binding broker --region="$REGION" \
  --member=allUsers --role=roles/run.invoker >/dev/null || \
  echo "!! Could not grant allUsers — relax iam.allowedPolicyMemberDomains for this project."

URL="$("${GC[@]}" functions describe broker --gen2 --region="$REGION" --format='value(serviceConfig.uri)')"
rm -rf "$stage"
echo
echo "Broker URL : $URL"
echo "Register   : ${URL}/callback  as an Authorised redirect URI on the Web OAuth client."
