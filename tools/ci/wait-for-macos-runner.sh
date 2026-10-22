#!/usr/bin/env bash
# Wait for the self-hosted macOS runner to be online, and report whether it is.
#
# Usage: wait-for-macos-runner.sh <minutes> <skip|fail>
#
# Polls once a minute (and once at the start) for an online runner labelled `self-hosted` and
# `macOS`, and writes `online=true` or `online=false` to `$GITHUB_OUTPUT`. GitHub has no queue
# timeout, so without this a job for an offline runner waits a day before failing.
#
# - `skip`: never fails. Workflows that can go ahead without macOS (the release, the nightly
#   checks) skip their macOS jobs on `online=false`.
# - `fail`: exits 1 when the runner is not online. Used when macOS was asked for explicitly.
#
# Listing runners needs "Administration: read", which `GITHUB_TOKEN` cannot be given, so this reads
# a fine-grained token from `RUNNER_STATUS_TOKEN` (the secret of the same name). Pull requests from
# forks get no secrets, so `fail` mode also keeps them off the machine.
set -euo pipefail

minutes="$1"
mode="$2"

finish() {
  local online="$1" message="$2"
  echo "online=$online" >> "$GITHUB_OUTPUT"
  if [ "$online" = true ]; then
    echo "$message"
  elif [ "$mode" = fail ]; then
    echo "::error::$message"
    exit 1
  else
    echo "::warning::$message; skipping the macOS jobs."
  fi
  exit 0
}

if [ -z "${RUNNER_STATUS_TOKEN:-}" ]; then
  finish false "The RUNNER_STATUS_TOKEN secret is not set (pull requests from forks never get it)"
fi

online_macos='.runners[] | select(.status == "online" and any(.labels[]; .name == "self-hosted") and any(.labels[]; .name == "macOS")) | .name'
for minute in $(seq 0 "$minutes"); do
  runners=$(GH_TOKEN="$RUNNER_STATUS_TOKEN" gh api --paginate "repos/$GITHUB_REPOSITORY/actions/runners" --jq "$online_macos")
  if [ -n "$runners" ]; then
    finish true "Self-hosted macOS runner online: $runners"
  fi
  if [ "$minute" -lt "$minutes" ]; then sleep 60; fi
done
finish false "No self-hosted macOS runner came online within $minutes min"
