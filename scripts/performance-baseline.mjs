const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const label = value => typeof value === 'string' && value.trim().length > 0

export const validatePerformanceBaseline = baseline => {
  if (!object(baseline) || baseline.format !== 'cave.performance-baseline' || baseline.version !== 1) {
    throw new Error('performance benchmark: unsupported baseline format')
  }
  if (!label(baseline.runtime) || !object(baseline.workloads) || Object.keys(baseline.workloads).length === 0) {
    throw new Error('performance benchmark: baseline requires a runtime and workloads')
  }
  for (const [name, budget] of Object.entries(baseline.workloads)) {
    if (!label(name) || !object(budget) ||
        !Number.isFinite(budget.baselineMs) || budget.baselineMs <= 0 ||
        !Number.isFinite(budget.thresholdMs) || budget.thresholdMs < budget.baselineMs ||
        budget.thresholdMs / budget.baselineMs > 25 ||
        (budget.runtime !== undefined && !label(budget.runtime))) {
      throw new Error(`performance benchmark: invalid baseline budget for ${name}`)
    }
  }
}

export const assertPerformanceCoverage = (baseline, measurements) => {
  const missing = Object.keys(baseline.workloads).filter(name => !Object.hasOwn(measurements, name))
  const extra = Object.keys(measurements).filter(name => !Object.hasOwn(baseline.workloads, name))
  if (missing.length || extra.length) {
    throw new Error(`performance benchmark: workload coverage mismatch; unmeasured: ${missing.join(', ') || 'none'}; unrecorded: ${extra.join(', ') || 'none'}`)
  }
}
