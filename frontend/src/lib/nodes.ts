/**
 * Mesh topology comes from the master's `nodes` action (see meshApi.ts).
 * The master always has id "master"; slaves are "node<last octet>".
 */

/** Display name for a node: custom name from config, else a default label. */
export function nodeLabel(nodeId: string, nodeNames: Record<string, string>): string {
  if (nodeNames[nodeId]) return nodeNames[nodeId];
  if (nodeId === 'master') return 'Master';
  const m = nodeId.match(/^node(\d+)$/);
  return m ? `Node .${m[1]}` : nodeId;
}
