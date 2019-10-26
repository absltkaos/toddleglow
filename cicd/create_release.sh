#!/bin/bash

OWNER=${OWNER:-absltkaos}
REPO=${REPO:-toddleglow}
USER=${USERNAME:-$OWNER}
PASS="$PASSWORD"
RELEASE_ID=''
TOKEN="$TOKEN"
CURL_OPTS="${CURL_OPTS:--Ss}"
CURL_CONFIG=""

VERSION="$1"
RELEASE_BODY="$2"

if [ -z "$TOKEN" ] ; then
    if [ -z "$PASS" ] ; then
        read -sp "Enter password for user '$USER': " PASS
    fi
    CURL_CONFIG="user = ${USER}:${PASS}"
else
    CURL_OPTS="-H 'Authorization: token ${TOKEN}'"
fi

if [ -z "$VERSION" ] ; then
    echo "No version was supplied as the first arg! Aborting!"
    exit 1
fi

if [ ! -z "$RELEASE_BODY" ] ; then
    RELEASE_BODY=$(echo "$RELEASE_BODY" | sed 's/^/ * /')
    RELEASE_BODY=$(echo -e "# Changes\n$RELEASE_BODY" | sed 's/$/\\n/g' | tr -d '\n')
fi

RELEASE_JSON=$(cat <<EOF
{
  "tag_name": "v${VERSION}",
  "target_commitish": "master",
  "name": "New Version ${VERSION}",
  "body": "$RELEASE_BODY",
  "draft": false,
  "prerelease": false
}
EOF
)

echo -e "\n===RELEASE_JSON==="
echo "$RELEASE_JSON"
echo "===END==="

release_resp=$(curl -K <(cat <<<"$CURL_CONFIG") $CURL_OPTS -X POST https://api.github.com/repos/${OWNER}/${REPO}/releases -d "$RELEASE_JSON")
rel_rc=$?
if [ $rel_rc -ne 0 ] ; then
    echo "$release_resp"
    exit $rel_rc
fi
RELEASE_ID=$(echo "$release_resp" | jq '.id' 2>&1)
echo "New release id is: $RELEASE_ID"
if [ "$RELEASE_ID" == 'null' -o -z "$RELEASE_ID" ] ; then
    echo "Failed to parse the release id from key 'id' in output:"
    echo "$release_resp"
    exit 1
fi

for asset in $(find /code/build -type f) ; do 
    echo "=== Uploading: $asset ==="
    # deb: application/vnd.debian.binary-package
    # tar.gz: application/gzip
    # text: text/plain
    fname=$(basename $asset)
    ctype=$(file -b --mime-type $asset)
    up_resp=$(curl -K <(cat <<<"$CURL_CONFIG") $CURL_OPTS -H "Content-Type: ${ctype}" --data-binary "@${asset}" https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${RELEASE_ID}/assets?name=${fname} 2>&1)
    up_rc=$?
    echo "$up_resp" | jq
    if [ $up_rc -ne 0 ] ; then
        echo "$up_resp"
        exit $up_rc
    fi
done
