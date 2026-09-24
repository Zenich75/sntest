#!/usr/bin/env bash
# End-to-end smoke check of the running `docker compose` stack: sign-up, email
# confirmation, login, post with real images (JPEG/PNG/WebP), comments, likes,
# follows, search, deletion with cascades. Unlike `npm run test:e2e`, nothing is
# mocked: files really hit ./uploads and rows really hit the dev database.
#
# Usage: docker compose up -d && scripts/smoke-flow.sh
# Needs: curl, jq, STORAGE_DRIVER=local. Registration is limited to 3 requests
# per minute per IP, so wait a minute between runs (otherwise: 429).
# The two users it creates (alice<N>, bob<N>) are deleted on exit.
set -u

ROOT=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
FIX=$ROOT/scripts/fixtures
cd "$ROOT"
API=${API:-http://localhost:3000}
UPLOADS=/usr/src/app/uploads
RUN=$(date +%s | tail -c 7)
A=alice$RUN; B=bob$RUN
PASS=0; FAIL=0
STATE=$(mktemp -d)

sql() { docker compose exec -T postgres psql -U postgres -d sn_test -tAc "$1"; }

cleanup() {
  # Files of posts that were not deleted through the API (e.g. after a failure):
  # the FK cascade removes their rows but not the files on disk.
  local keys
  keys=$(sql "select f.key from public_file f join post p on p.id=f.\"postId\" join \"user\" u on u.id=p.\"authorId\" where u.username in ('$A','$B')" 2>/dev/null)
  for k in $keys; do docker compose exec -T app rm -f "$UPLOADS/$k"; done
  sql "delete from \"user\" where username in ('$A','$B')" >/dev/null 2>&1
  rm -rf "$STATE"
}
trap cleanup EXIT

for bin in curl jq; do
  command -v $bin >/dev/null || { echo "$bin is required"; exit 2; }
done
curl -s -o /dev/null "$API/auth/csrf-token" || { echo "API is not reachable at $API (docker compose up -d?)"; exit 2; }
[ "$(docker compose exec -T app printenv STORAGE_DRIVER)" = local ] || { echo "STORAGE_DRIVER=local is required"; exit 2; }

# req <user|-> <expected code> <label> <curl args...>   -> response body in $BODY
req() {
  local who=$1 want=$2 label=$3; shift 3
  local jar=() hdr=()
  if [ "$who" != "-" ]; then
    jar=(-b "$STATE/$who.jar" -c "$STATE/$who.jar")
    [ -f "$STATE/$who.csrf" ] && hdr=(-H "X-CSRF-Token: $(cat "$STATE/$who.csrf")")
  fi
  local out code
  out=$(curl -s -w $'\n%{http_code}' "${jar[@]}" "${hdr[@]}" "$@")
  code=${out##*$'\n'}; BODY=${out%$'\n'*}
  if [ "$code" = "$want" ]; then PASS=$((PASS+1)); printf '  ok   %-58s %s\n' "$label" "$code"
  else FAIL=$((FAIL+1)); printf '  FAIL %-58s got %s want %s\n       %s\n' "$label" "$code" "$want" "${BODY:0:200}"; fi
}
check() { # check <label> <actual> <expected>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf '  ok   %-58s %s\n' "$1" "$2"
  else FAIL=$((FAIL+1)); printf '  FAIL %-58s got %s want %s\n' "$1" "$2" "$3"; fi
}
csrf() { curl -s -b "$STATE/$1.jar" -c "$STATE/$1.jar" "$API/auth/csrf-token" | jq -r .csrfToken > "$STATE/$1.csrf"; }

echo "== 1. Registration & email confirmation ($A, $B)"
for u in $A $B; do
  req - 201 "register $u" -X POST $API/auth/register -H 'Content-Type: application/json' \
    -d "{\"username\":\"$u\",\"email\":\"$u@example.com\",\"password\":\"password123\",\"firstName\":\"${u%%[0-9]*}\",\"lastName\":\"Test\"}"
done
[ $FAIL -gt 0 ] && { echo "registration failed (rate limit? wait a minute) - aborting"; exit 1; }
req - 409 "register duplicate username" -X POST $API/auth/register -H 'Content-Type: application/json' \
  -d "{\"username\":\"$A\",\"email\":\"other$RUN@example.com\",\"password\":\"password123\"}"
req - 401 "login before email confirmation" -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d "{\"username\":\"$A\",\"password\":\"password123\"}"
sleep 1
# MAIL_HOST is not configured in dev, so the confirmation link is only logged.
for u in $A $B; do
  tok=$(docker compose logs app 2>&1 | grep -A6 "$u@example.com" | grep -oE 'token=[A-Za-z0-9_-]+' | tail -1 | cut -d= -f2)
  req - 200 "confirm email $u" "$API/auth/confirm-email?token=$tok"
done
req - 400 "confirm with reused token" "$API/auth/confirm-email?token=$tok"
check "isEmailConfirmed in DB" "$(sql "select count(*) from \"user\" where username in ('$A','$B') and \"isEmailConfirmed\"")" 2

echo "== 2. Login"
req - 401 "login wrong password" -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d "{\"username\":\"$A\",\"password\":\"wrongpass1\"}"
for u in $A $B; do
  req $u 200 "login $u" -X POST $API/auth/login -H 'Content-Type: application/json' \
    -d "{\"username\":\"$u\",\"password\":\"password123\"}"
  csrf $u
done
AID=$(sql "select id from \"user\" where username='$A'"); BID=$(sql "select id from \"user\" where username='$B'")

echo "== 3. Alice creates a post with images"
req - 401 "create post anonymously" -X POST $API/posts -F text=x
mv "$STATE/$A.csrf" "$STATE/$A.csrf.bak"
req $A 403 "create post without CSRF header" -X POST $API/posts -F text=x
mv "$STATE/$A.csrf.bak" "$STATE/$A.csrf"
req $A 201 "create post: text + jpeg + png + webp" -X POST $API/posts -F "text=Alice's trip $RUN" \
  -F "files=@$FIX/mountain photo.jpg;type=image/jpeg" -F "files=@$FIX/chart.png;type=image/png" -F "files=@$FIX/dot.webp;type=image/webp"
POST=$(jq -r .id <<<"$BODY")
check "files in response" "$(jq '.files|length' <<<"$BODY")" 3
check "public_file rows linked to post" "$(sql "select count(*) from public_file where \"postId\"='$POST'")" 3
check "space in file name replaced" "$(jq -r '[.files[].key|test("-mountain-photo\\.jpg$")]|any' <<<"$BODY")" true
ok=0
for row in $(jq -r '.files[]|.key+"|"+.url' <<<"$BODY"); do
  key=${row%%|*}; url=${row#*|}
  case $key in *mountain*) src="$FIX/mountain photo.jpg";; *chart*) src=$FIX/chart.png;; *) src=$FIX/dot.webp;; esac
  orig=$(sha256sum "$src" | cut -c1-64)
  disk=$(docker compose exec -T app sha256sum "$UPLOADS/$key" | cut -c1-64)
  http=$(curl -s "$url" | sha256sum | cut -c1-64)
  [ "$disk" = "$orig" ] && [ "$http" = "$orig" ] && ok=$((ok+1))
done
check "files identical on disk and via URL" $ok 3
req $A 201 "create second post, text only" -X POST $API/posts -F "text=Second $RUN"
POST2=$(jq -r .id <<<"$BODY")

echo "== 4. Bob reads the feed and the post"
req $B 200 "GET /posts (feed)" "$API/posts?limit=5"
check "Alice's post is in the feed" "$(jq --arg p $POST '[.[].id]|index($p)!=null' <<<"$BODY")" true
req - 200 "GET /posts/:id anonymously" $API/posts/$POST
check "post has 3 files, author=$A" "$(jq -r '"\(.files|length) \(.author.username)"' <<<"$BODY")" "3 $A"
check "author password/email not exposed" "$(jq -r '.author|has("password") or has("email")' <<<"$BODY")" false
req $B 200 "GET /posts/user/:userId" $API/posts/user/$AID
check "Alice has 2 posts" "$(jq .total <<<"$BODY")" 2

echo "== 5. Comments"
req - 401 "comment anonymously" -X POST $API/posts/$POST/comments -H 'Content-Type: application/json' -d '{"text":"hi"}'
req $B 400 "empty comment" -X POST $API/posts/$POST/comments -H 'Content-Type: application/json' -d '{"text":""}'
req $B 201 "Bob comments on Alice's post" -X POST $API/posts/$POST/comments -H 'Content-Type: application/json' -d '{"text":"Great photos!"}'
CB=$(jq -r .id <<<"$BODY")
req $A 201 "Alice replies" -X POST $API/posts/$POST/comments -H 'Content-Type: application/json' -d '{"text":"Thanks, Bob"}'
req $B 404 "comment on missing post" -X POST $API/posts/00000000-0000-4000-8000-000000000000/comments -H 'Content-Type: application/json' -d '{"text":"x"}'
req - 200 "GET comments anonymously" $API/posts/$POST/comments
check "2 comments, authors" "$(jq -r '"\(.total) " + ([.items[].author.username]|sort|join(","))' <<<"$BODY")" "2 $(printf '%s\n' $A $B | sort | paste -sd,)"
req $A 403 "Alice deletes Bob's comment" -X DELETE $API/comments/$CB
req $B 403 "Bob deletes Alice's post" -X DELETE $API/posts/$POST

echo "== 6. Likes"
req $B 201 "Bob likes" -X POST $API/posts/$POST/likes
req $B 201 "Bob likes again (idempotent)" -X POST $API/posts/$POST/likes
check "only one like row for Bob" "$(sql "select count(*) from \"like\" where \"postId\"='$POST' and \"userId\"='$BID'")" 1
req $A 201 "Alice likes own post" -X POST $API/posts/$POST/likes
req $B 200 "GET likes as Bob" $API/posts/$POST/likes
check "count=2 likedByMe=true" "$(jq -r '"\(.count) \(.likedByMe)"' <<<"$BODY")" "2 true"
req - 200 "GET likes anonymously" $API/posts/$POST/likes
check "anonymous likedByMe=false" "$(jq -r .likedByMe <<<"$BODY")" false
req $B 204 "Bob unlikes" -X DELETE $API/posts/$POST/likes
req $B 404 "Bob unlikes again" -X DELETE $API/posts/$POST/likes
req $B 200 "GET likes after unlike" $API/posts/$POST/likes
check "count=1 likedByMe=false" "$(jq -r '"\(.count) \(.likedByMe)"' <<<"$BODY")" "1 false"

echo "== 7. Follow, profiles, search"
req $B 400 "Bob follows himself" -X POST $API/users/$BID/follow
req $B 201 "Bob follows Alice" -X POST $API/users/$AID/follow
req $B 201 "Bob follows Alice again (idempotent)" -X POST $API/users/$AID/follow
req $B 200 "GET /users/:id (Alice) as Bob" $API/users/$AID
check "followers=1 isFollowedByMe=true" "$(jq -r '"\(.followersCount) \(.isFollowedByMe)"' <<<"$BODY")" "1 true"
req $B 200 "GET /users/:id/followers" $API/users/$AID/followers
check "Bob among Alice's followers" "$(jq -r --arg b $B '[.. | .username? // empty] | index($b) != null' <<<"$BODY")" true
req - 200 "GET /users/:id/following (Bob)" $API/users/$BID/following
req - 200 "GET /users/by-username/:username" $API/users/by-username/$A
check "by-username returns Alice" "$(jq -r .id <<<"$BODY")" $AID
req - 200 "GET /users/:id/posts" $API/users/$AID/posts
req $B 200 "search users" "$API/search/users?query=$A"
check "search finds Alice" "$(jq -r --arg a $A '[.items[].username]|index($a)!=null' <<<"$BODY")" true
req $B 204 "Bob unfollows Alice" -X DELETE $API/users/$AID/follow
req - 200 "GET Alice after unfollow" $API/users/$AID
check "followers=0" "$(jq -r .followersCount <<<"$BODY")" 0

echo "== 8. Deletion and cascades"
req $B 204 "Bob deletes own comment" -X DELETE $API/comments/$CB
req $B 200 "Bob logs out" -X POST $API/auth/logout
req $B 401 "Bob after logout: comment" -X POST $API/posts/$POST/comments -H 'Content-Type: application/json' -d '{"text":"x"}'
KEYS=$(sql "select key from public_file where \"postId\"='$POST'")
req $A 204 "Alice deletes her post" -X DELETE $API/posts/$POST
check "post/comments/likes/files rows left" "$(sql "select (select count(*) from post where id='$POST')+(select count(*) from comment where \"postId\"='$POST')+(select count(*) from \"like\" where \"postId\"='$POST')+(select count(*) from public_file where \"postId\"='$POST')")" 0
left=0; for k in $KEYS; do docker compose exec -T app test -e "$UPLOADS/$k" && left=$((left+1)); done
check "files left on disk" $left 0
req - 404 "GET deleted post" $API/posts/$POST
req $A 204 "Alice deletes second post" -X DELETE $API/posts/$POST2

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
