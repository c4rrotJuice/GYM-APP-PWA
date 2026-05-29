#!/usr/bin/env bash
set -euo pipefail

node tests/membership-logic.test.mjs
node tests/payment-logic.test.mjs
