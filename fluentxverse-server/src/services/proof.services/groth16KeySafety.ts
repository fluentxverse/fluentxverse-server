// Structural rejection of initial Groth16 setup keys; not a ceremony audit.
export function assertContributedGroth16Key(value: unknown): void {
  const vk = value as Record<string, unknown> | null;
  const baseField = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
  function affineG2(point: unknown): string {
    if (!Array.isArray(point) || point.length !== 3 || point.some(row => !Array.isArray(row) || row.length !== 2)
      || point[2][0] !== '1' || point[2][1] !== '0') throw new Error('Noncanonical Groth16 G2 key');
    const coords = point.slice(0, 2).flat();
    if (coords.some(n => typeof n !== 'string' || !/^(0|[1-9][0-9]{0,76})$/.test(n) || BigInt(n) >= baseField))
      throw new Error('Noncanonical Groth16 G2 coordinate');
    if (coords.every(n => n === '0')) throw new Error('Invalid Groth16 G2 identity');
    return JSON.stringify(coords);
  }
  if (!vk || vk.protocol !== 'groth16' || !['bn128', 'bn254'].includes(String(vk.curve)))
    throw new Error('Expected snarkjs BN254 Groth16 verification key');
  if (affineG2(vk.vk_gamma_2) === affineG2(vk.vk_delta_2))
    throw new Error('Unsafe uncontributed Groth16 setup key is retired');
}
