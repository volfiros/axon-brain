import assert from "node:assert/strict";
import { test } from "node:test";

import { assertPublicHost, normalizeApiUrl, PLANE_CLOUD_API } from "./connect";

const REFUSED = /must be a public https address/;

const blocked = [
  "127.0.0.1",
  "127.255.0.9",
  "0.0.0.0",
  "10.1.2.3",
  "172.16.0.1",
  "172.31.255.255",
  "192.168.1.1",
  "169.254.169.254",
  "100.64.0.1",
  "100.127.255.254",
  "198.18.0.1",
  "224.0.0.1",
  "255.255.255.255",
  "::",
  "::1",
  "[::1]",
  "fc00::1",
  "fd12:3456::1",
  "fe80::1",
  "ff02::1",
  "::ffff:127.0.0.1",
  "::ffff:169.254.169.254",
  "[::ffff:7f00:1]",
  "::ffff:a00:1",
];

for (const host of blocked) {
  test(`The internal address ${host} is refused`, async () => {
    await assert.rejects(assertPublicHost(host), REFUSED);
  });
}

for (const host of ["1.1.1.1", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "[2606:4700:4700::1111]"]) {
  test(`The public address ${host} passes`, async () => {
    await assertPublicHost(host);
  });
}

test("An empty API URL means Plane Cloud", async () => {
  assert.equal(await normalizeApiUrl(undefined), PLANE_CLOUD_API);
  assert.equal(await normalizeApiUrl("   "), PLANE_CLOUD_API);
});

test("A public https API URL is reduced to its origin", async () => {
  assert.equal(await normalizeApiUrl(" https://1.1.1.1/api/v1/ "), "https://1.1.1.1");
  assert.equal(await normalizeApiUrl("https://1.1.1.1:8443/x"), "https://1.1.1.1:8443");
});

test("Plain http, other schemes and unparseable URLs are refused", async () => {
  await assert.rejects(normalizeApiUrl("http://1.1.1.1"), REFUSED);
  await assert.rejects(normalizeApiUrl("ftp://1.1.1.1"), REFUSED);
  await assert.rejects(normalizeApiUrl("not a url"), REFUSED);
});

test("URLs carrying credentials are refused", async () => {
  await assert.rejects(normalizeApiUrl("https://user:pass@1.1.1.1"), REFUSED);
  await assert.rejects(normalizeApiUrl("https://user@1.1.1.1"), REFUSED);
});

test("https URLs pointing at internal addresses are refused, however they are spelled", async () => {
  for (const url of [
    "https://127.0.0.1",
    "https://2130706433",
    "https://0x7f.1",
    "https://[::1]:443",
    "https://[::ffff:10.0.0.1]",
    "https://169.254.169.254/latest/meta-data",
  ]) {
    await assert.rejects(normalizeApiUrl(url), REFUSED, url);
  }
});
