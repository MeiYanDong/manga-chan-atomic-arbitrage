import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ignoredDirectories = new Set(['.git', 'node_modules', 'runs', 'artifacts', 'cache', 'coverage'])
const allowedBinaryExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.pdf'])

const rules = [
  {
    name: 'private-key-assignment',
    expression: new RegExp(`(?:private[_-]?key|secret)[\\w-]*\\s*[:=]\\s*["']?${'0x'}[0-9a-f]{64}`, 'i'),
  },
  { name: 'private-key-pem', expression: new RegExp(`-----BEGIN [A-Z ]*${'PRIVATE KEY'}-----`) },
  { name: 'credential-in-url', expression: /(?:https?|wss):\/\/[^\s/:'"]+:[^\s/@'"]+@/i },
  { name: 'personal-absolute-path', expression: new RegExp(`/Users/${'myandong'}(?:/|\\b)`) },
  { name: 'inline-private-key-env', expression: new RegExp(`${'MANGA_PRIVATE_KEY'}\\s*=`) },
]

function filesUnder(directory) {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...filesUnder(target))
    else if (entry.isFile() && !allowedBinaryExtensions.has(path.extname(entry.name).toLowerCase())) files.push(target)
  }
  return files
}

const findings = []
for (const file of filesUnder(root)) {
  const relative = path.relative(root, file)
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, index) => {
    for (const rule of rules) {
      if (rule.expression.test(line)) findings.push({ file: relative, line: index + 1, rule: rule.name })
    }
  })
}

if (findings.length > 0) {
  console.error(JSON.stringify({ status: 'SECRET_SCAN_FAILED', findings }, null, 2))
  process.exitCode = 1
} else {
  console.log(JSON.stringify({ status: 'SECRET_SCAN_PASSED', filesScanned: filesUnder(root).length }))
}
