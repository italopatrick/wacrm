#!/usr/bin/env node
/**
 * T6.3 — Crypto vector generator for Go cross-compatibility tests.
 *
 * Run from the ulabchat monolith:
 *   ENCRYPTION_KEY=<your 64-char hex key> node scripts/gen-crypto-vectors.mjs
 *
 * Output: ulabchat-backend/test/vectors/crypto.json
 * The file is committed to ulabchat-backend and read by TestCrossVectors in Go.
 *
 * IMPORTANT: run this before any Go implementation work so the vectors
 * reflect production-like Node output, not a future Go round-trip.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))

const key = process.env.ENCRYPTION_KEY
if (!key || key.length !== 64) {
  console.error('Set ENCRYPTION_KEY to a 64-char hex string')
  process.exit(1)
}

// --- AES-256-GCM (matches encryption.ts) ---
function encrypt(plain) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv)
  let ct = cipher.update(plain, 'utf8', 'hex')
  ct += cipher.final('hex')
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${ct}:${tag.toString('hex')}`
}

const gcmPlainTexts = [
  'EAABcdef1234567890',           // typical Meta access token
  'hello world',
  '',                             // empty string edge case
  'unicode: こんにちは',
]
const gcm = gcmPlainTexts.map(plain => ({ plain, enc: encrypt(plain) }))

// Verify roundtrip in Node itself.
gcm.forEach(({ plain, enc }) => {
  const [ivH, ctH, tagH] = enc.split(':')
  const d = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(ivH, 'hex'))
  d.setAuthTag(Buffer.from(tagH, 'hex'))
  const dec = d.update(ctH, 'hex', 'utf8') + d.final('utf8')
  if (dec !== plain) throw new Error(`Self-check failed for: ${plain}`)
})

// --- Webhook signatures (matches sign.ts) ---
function buildSig(body, secret, ts) {
  const mac = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')
  return `t=${ts},v1=${mac}`
}

const signatures = [
  { body: '{"event":"message.received","data":{}}', secret: 'wh_secret_abc', timestamp: 1700000000 },
  { body: '', secret: 'empty-body-secret', timestamp: 1700000001 },
  { body: 'raw text payload', secret: 'another-secret', timestamp: 9999999999 },
].map(v => ({ ...v, header: buildSig(v.body, v.secret, v.timestamp) }))

// --- API keys (matches keys.ts) ---
function genApiKey() {
  const body = randomBytes(32).toString('hex')
  const plaintext = `wacrm_live_${body}`
  const hash = createHash('sha256').update(plaintext).digest('hex')
  const prefix = `wacrm_live_${body.slice(0, 8)}`
  return { plaintext, hash, prefix }
}
const apiKeys = Array.from({ length: 5 }, genApiKey)

// --- Write output ---
const output = { key, gcm, signatures, apiKeys }
const outPath = resolve(__dir, '../../ulabchat-backend/test/vectors/crypto.json')
writeFileSync(outPath, JSON.stringify(output, null, 2))
console.log(`Written ${outPath}`)
console.log(`  GCM vectors:       ${gcm.length}`)
console.log(`  Signature vectors: ${signatures.length}`)
console.log(`  API key vectors:   ${apiKeys.length}`)
