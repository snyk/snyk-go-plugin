import { toSnykVersion } from 'snyk-go-parser';
import * as subProcess from './sub-process';
import { parseVersion } from 'snyk-go-parser/dist/gomod-parser';
import { version } from 'punycode';

// We could use graphlib, but we don't need its functionality for now
interface ModulesGraph {
  root: string;
  // All the strings here are module@version (with the exception of root, which has no version),
  // where version is either "v1.2.3" (possibly with -suffix) or "#012abc" hash
  edges: { [mv: string]: string[] };
}

function moduleAtVersionToSnykVersion(mv: string) {
  const parts = mv.split('@');
  if (parts.length > 2) {
    throw new Error('Invalid module@version: ' + mv);
  }
  if (parts.length === 2) {
    return `${parts[0]}@${toSnykVersion(parseVersion(parts[1]))}`;
  }
  return parts[0];
}

// Runs `go mod graph` in the target folder and builds a graph of module relationships
// with versions.
export async function buildModuleGraph(root: string): Promise<ModulesGraph> {
  const graph: ModulesGraph = {
    root: '',
    edges: {},
  };

  const graphStr = await subProcess.execute(
    'go',
    ['mod', 'graph'],
    { cwd: root },
  );
  const lines = graphStr.trim().split('\n');
  if (lines) {
    graph.root = lines[0].split(' ')[0];
    // First pass: record versions in Go Modules format
    for (const line of lines) {
      const [from, to] = line.trim().split(' ').map(moduleAtVersionToSnykVersion);

      if (!graph.edges[from]) {
        graph.edges[from] = [];
      }
      graph.edges[from].push(to);
    }
  }
  return graph;
}

export function isPackageInTheModule(packageName: string, moduleName: string): boolean {
  const reModuleName = /^(.+?)(\/v[0-9]+)?$/;
  const unversionedModuleName = reModuleName.exec(moduleName)![1];
  return packageName.startsWith(unversionedModuleName);
}
