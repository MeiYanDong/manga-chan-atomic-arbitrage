import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('opportunity board source has no signer, wallet-client or hot-transport path', () => {
  const source = fs.readFileSync(path.join(root, 'scripts', 'opportunity-board.mjs'), 'utf8')
  for (const forbidden of [
    'createWalletClient',
    'privateKeyToAccount',
    'MANGA_PRIVATE_KEY',
    'MANGA_KEYCHAIN_SERVICE',
    'MANGA_RPC_URL',
    'MANGA_WS_URL',
  ]) {
    assert.equal(source.includes(forbidden), false, `read-only board unexpectedly references ${forbidden}`)
  }
  assert.equal(source.includes('MANGA_BOARD_RPC_URL'), true)
  assert.equal(source.includes('READ_ONLY_NO_SIGNING_NO_BROADCAST'), true)
})

test('systemd unit keeps the board in a separate loopback-only identity without credentials', () => {
  const unit = fs.readFileSync(path.join(root, 'deploy', 'systemd', 'manga-opportunity-board.service'), 'utf8')
  assert.match(unit, /^User=manga-board$/m)
  assert.match(unit, /^Group=manga-board$/m)
  assert.match(unit, /^EnvironmentFile=\/etc\/manga-opportunity-board\/live\.env$/m)
  assert.match(unit, /^ProtectSystem=strict$/m)
  assert.match(unit, /^ReadWritePaths=\/var\/lib\/manga-opportunity-board$/m)
  assert.doesNotMatch(unit, /LoadCredential|manga-private-key|MANGA_PRIVATE_KEY/)

  const example = fs.readFileSync(path.join(root, 'deploy', 'opportunity-board.env.example'), 'utf8')
  assert.match(example, /^MANGA_BOARD_HOST=127\.0\.0\.1$/m)
  assert.doesNotMatch(example, /MANGA_PRIVATE_KEY|MANGA_RPC_URL=|MANGA_WS_URL=/)
})

test('SSH access permits only a client-local forward to the loopback board', () => {
  const sshd = fs.readFileSync(path.join(root, 'deploy', 'sshd', '60-manga-chan-arbitrage-hardening.conf'), 'utf8')
  assert.match(sshd, /^AllowTcpForwarding local$/m)
  assert.match(sshd, /^PermitOpen 127\.0\.0\.1:8788$/m)
  assert.match(sshd, /^GatewayPorts no$/m)
  assert.match(sshd, /^PermitTunnel no$/m)
  assert.match(sshd, /^PasswordAuthentication no$/m)
})

test('generic signer keeps the board read-only and refuses an active fixed signer lane', () => {
  const source = fs.readFileSync(path.join(root, 'scripts', 'generic-arb.mjs'), 'utf8')
  const plannerSource = fs.readFileSync(path.join(root, 'src', 'generic-plan.mjs'), 'utf8')
  assert.match(source, /MANGA_GENERIC_BOARD_URL|genericBoardUrl/)
  assert.match(source, /buildGenericExecutionCandidates/)
  assert.match(plannerSource, /READ_ONLY_NO_SIGNING_NO_BROADCAST/)
  assert.match(source, /watch-arm\.json/)
  assert.match(source, /watch\.lock/)
  assert.match(source, /assertFixedSignerInactive\(\)/)
  assert.doesNotMatch(source, /async function watch\(/)
})
