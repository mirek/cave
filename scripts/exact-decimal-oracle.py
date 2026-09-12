"""Check the solver's decimal normalization against Python's Fraction.

Run with the desired Node executable on PATH. No third-party dependencies.
"""
import json
from fractions import Fraction
from pathlib import Path
import random
import subprocess


def main():
    rng = random.Random(2301)
    inputs = []
    for _ in range(1500):
        whole = ''.join(rng.choices('0123456789', k=rng.randrange(1, 33)))
        fraction = ''.join(rng.choices('0123456789', k=rng.randrange(0, 33)))
        suffix = '0' * rng.choice([0, 1, 2, 8, 64, 256, 2048])
        sign = rng.choice(['', '+', '-'])
        exponent = rng.randrange(-100, 101)
        inputs.append(f'{sign}{whole}.{fraction}{suffix}e{exponent:+d}')
    inputs.extend(['-000.000e+100', '+000.000e-100', '.125000', '12000e-2'])
    expected = []
    for value in inputs:
        fraction = Fraction(value)
        expected.append({'numerator': str(fraction.numerator), 'denominator': str(fraction.denominator)})
    script = """
import { readFileSync } from 'node:fs'
import { Exact } from './packages/solver/src/index.ts'
const values = JSON.parse(readFileSync(0, 'utf8'))
console.log(JSON.stringify({ node: process.version, results: values.map(value => Exact.rational(value)) }))
"""
    result = subprocess.run(
        ['node', '--input-type=module', '-e', script],
        input=json.dumps(inputs), text=True, capture_output=True,
        cwd=Path(__file__).resolve().parents[1], check=True,
    )
    actual = json.loads(result.stdout)
    assert len(actual['results']) == len(expected)
    for value, wanted, received in zip(inputs, expected, actual['results']):
        assert received == wanted, (value, wanted, received)
    print(json.dumps({'node': actual['node'], 'cases': len(inputs), 'oracle': 'fractions.Fraction', 'seed': 2301}))


if __name__ == '__main__':
    main()
