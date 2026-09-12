const fail = message => { throw new Error(message) }

export const parseChangeset = (text, path) => {
  const lines = text.split(/\r?\n/)
  const closingDelimiter = lines.indexOf('---', 1)
  if (lines[0] !== '---' || closingDelimiter < 1) {
    fail(`${path} must contain YAML frontmatter and a summary`)
  }
  const summary = lines.slice(closingDelimiter + 1).join('\n').trim()
  if (summary.length === 0) fail(`${path} has an empty summary`)

  const releases = []
  for (const line of lines.slice(1, closingDelimiter).filter(line => line.trim().length > 0)) {
    const release = /^(?:"([^"]+)"|'([^']+)'): (major|minor|patch)$/.exec(line)
    if (release === null) fail(`${path} has invalid release entry ${JSON.stringify(line)}`)
    releases.push({ name: release[1] ?? release[2], type: release[3] })
  }
  const names = releases.map(release => release.name)
  if (new Set(names).size !== names.length) fail(`${path} names a package more than once`)
  return releases
}

export const validateChangeset = (path, releases, manifests, fixedGroup) => {
  const packageByName = new Map(manifests.map(entry => [entry.manifest.name, entry]))
  // Derive bundled private modules from the CLI's published exports,
  // rather than maintaining a second list of internal package names.
  const bundled = new Set()
  const exportTargets = [packageByName.get('@cavelang/cli')?.manifest.publishConfig?.exports]
  while (exportTargets.length > 0) {
    const target = exportTargets.pop()
    if (typeof target === 'string') {
      const match = /^\.\/dist\/internal\/([^/]+)\//.exec(target)
      const entry = match === null ? undefined : manifests.find(entry => entry.path === `packages/${match[1]}/package.json`)
      if (entry?.manifest.private === true) bundled.add(entry.manifest.name)
    } else if (target !== null && typeof target === 'object') {
      for (const value of Object.values(target)) exportTargets.push(value)
    }
  }
  const severity = { patch: 1, minor: 2, major: 3 }
  for (const release of releases) {
    if (!packageByName.has(release.name)) fail(`${path} names unknown package ${release.name}`)
  }
  if (releases.length > 0 && !releases.some(release => fixedGroup.has(release.name))) {
    fail(`${path} names only packages outside the fixed release group (${releases.map(release => release.name).join(', ')}); name a fixed-group package so the release version advances`)
  }
  const cliRelease = releases.find(release => release.name === '@cavelang/cli')
  for (const release of releases) {
    if (bundled.has(release.name) &&
        (cliRelease === undefined || severity[cliRelease.type] < severity[release.type])) {
      fail(`${path} changes bundled ${release.name} at ${release.type}; name @cavelang/cli at the same or higher severity`)
    }
  }
}
