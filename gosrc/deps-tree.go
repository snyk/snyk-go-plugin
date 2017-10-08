package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"go/build"
	"os"
	"path"
	"sort"
	"strings"
)

/*
	This code is based on https://github.com/KyleBanks/depth
*/

// Pkg represents a Go source package, and its dependencies.
type Pkg struct {
	Name           string
	FullImportPath string
	Dir            string
	Depth          int `json:"-"`

	IsBuiltin  bool `json:"-"`
	IsResolved bool `json:"-"`

	Tree      *Tree  `json:"-"`
	Parent    *Pkg   `json:"-"`
	ParentDir string `json:"-"`
	Deps      []Pkg  `json:"-"`

	Raw *build.Package `json:"-"`
}

// Resolve recursively finds all dependencies for the Pkg and the packages it depends on.
func (p *Pkg) Resolve() {
	// IsResolved is always true, regardless of if we skip the import,
	// it is only false if there is an error while importing.
	p.IsResolved = true

	name := p.cleanName()
	if name == "" {
		return
	}

	// Stop resolving imports if we've reached a loop.
	var importMode build.ImportMode
	if p.Tree.hasSeenImport(name) && p.isAncestor(name) {
		importMode = build.FindOnly
	}

	pkg, err := build.Default.Import(name, p.ParentDir, importMode)
	if err != nil {
		// TODO: Check the error type?
		p.IsResolved = false
		p.Tree.rememverUnresolvedPkg(name)
		return
	}
	p.Raw = pkg
	p.Dir = pkg.Dir

	// Clear some too verbose fields
	p.Raw.ImportPos = nil
	p.Raw.TestImportPos = nil

	// Update the name with the fully qualified import path.
	p.FullImportPath = pkg.ImportPath

	// If this is an builtin package, we don't resolve deeper
	if pkg.Goroot {
		p.IsBuiltin = true
		return
	}

	imports := pkg.Imports
	if p.Tree.ResolveTest {
		imports = append(imports, append(pkg.TestImports, pkg.XTestImports...)...)
	}

	p.setDeps(imports, pkg.Dir)
}

// setDeps takes a slice of import paths and the source directory they are relative to,
// and creates the Deps of the Pkg. Each dependency is also further resolved prior to being added
// to the Pkg.
func (p *Pkg) setDeps(imports []string, parentDir string) {
	unique := make(map[string]struct{})

	for _, imp := range imports {
		// Mostly for testing files where cyclic imports are allowed.
		if imp == p.Name {
			continue
		}

		// Skip duplicates.
		if _, ok := unique[imp]; ok {
			continue
		}
		unique[imp] = struct{}{}

		p.addDep(imp, parentDir)
	}

	sort.Sort(sortablePkgsList(p.Deps))
}

// addDep creates a Pkg and it's dependencies from an imported package name.
func (p *Pkg) addDep(name string, parentDir string) {
	var dep Pkg
	cached := p.Tree.getCachedPkg(name)
	if cached != nil {
		dep = *cached
		dep.ParentDir = parentDir
		dep.Parent = p
	} else {
		dep = Pkg{
			Name: name,
			Tree: p.Tree,
			//TODO: maybe better pass ParentDir as a param to Resolve() instead
			ParentDir: parentDir,
			Parent:    p,
		}
		dep.Resolve()

		p.Tree.cacheResolvedPackage(&dep)
	}

	p.Depth = p.depth()

	if dep.IsBuiltin || dep.Name == "C" {
		return
	}

	if isInternalImport(dep.Name) {
		p.Deps = append(p.Deps, dep.Deps...)
	} else {
		p.Deps = append(p.Deps, dep)
	}
}

// depth returns the depth of the Pkg within the Tree.
func (p *Pkg) depth() int {
	if p.Parent == nil {
		return 0
	}

	return p.Parent.depth() + 1
}

// isAncestor goes recursively up the chain of Pkgs to determine if the name provided is ever a
// parent of the current Pkg.
func (p *Pkg) isAncestor(name string) bool {
	if p.Parent == nil {
		return false
	}

	if p.Parent.Name == name {
		return true
	}

	return p.Parent.isAncestor(name)
}

// cleanName returns a cleaned version of the Pkg name used for resolving dependencies.
//
// If an empty string is returned, dependencies should not be resolved.
func (p *Pkg) cleanName() string {
	name := p.Name

	// C 'package' cannot be resolved.
	if name == "C" {
		return ""
	}

	// Internal golang_org/* packages must be prefixed with vendor/
	//
	// Thanks to @davecheney for this:
	// https://github.com/davecheney/graphpkg/blob/master/main.go#L46
	if strings.HasPrefix(name, "golang_org") {
		name = path.Join("vendor", name)
	}

	return name
}

func isInternalImport(importPath string) bool {
	return strings.Contains(importPath, "/internal/")
}

// sortablePkgsList ensures a slice of Pkgs are sorted such that the builtin stdlib
// packages are always above external packages (ie. github.com/whatever).
type sortablePkgsList []Pkg

func (b sortablePkgsList) Len() int {
	return len(b)
}

func (b sortablePkgsList) Swap(i, j int) {
	b[i], b[j] = b[j], b[i]
}

func (b sortablePkgsList) Less(i, j int) bool {
	if b[i].IsBuiltin && !b[j].IsBuiltin {
		return true
	} else if !b[i].IsBuiltin && b[j].IsBuiltin {
		return false
	}

	return b[i].Name < b[j].Name
}

// Tree represents the top level of a Pkg and the configuration used to
// initialize and represent its contents.
type Tree struct {
	Root *Pkg

	ResolveTest bool

	UnresolvedPkgs map[string]struct{}

	PkgCache map[string]*Pkg

	importCache map[string]struct{}
}

// Resolve recursively finds all dependencies for the root Pkg name provided,
// and the packages it depends on.
func (t *Tree) Resolve(name string) error {
	pwd, err := os.Getwd()
	if err != nil {
		return err
	}

	t.Root = &Pkg{
		Name:      name,
		Tree:      t,
		ParentDir: pwd,
	}

	// Reset the import cache each time to ensure a reused Tree doesn't
	// reuse the same cache.
	t.importCache = map[string]struct{}{}
	t.UnresolvedPkgs = map[string]struct{}{}
	t.PkgCache = map[string]*Pkg{}

	t.Root.Resolve()
	if !t.Root.IsResolved {
		return errors.New("unable to resolve root package")
	}

	return nil
}

// hasSeenImport returns true if the import name provided has already been seen within the tree.
// This function only returns false for a name once.
func (t *Tree) hasSeenImport(name string) bool {
	if _, ok := t.importCache[name]; ok {
		return true
	}
	t.importCache[name] = struct{}{}
	return false
}

func (t *Tree) rememverUnresolvedPkg(name string) {
	t.UnresolvedPkgs[name] = struct{}{}
}

func (t *Tree) cacheResolvedPackage(pkg *Pkg) {
	t.PkgCache[pkg.Name] = pkg
}

func (t *Tree) getCachedPkg(name string) *Pkg {
	pkg, ok := t.PkgCache[name]
	if !ok {
		return nil
	}
	return pkg
}

// Node is Grpah's node
type Node struct {
	Name  string      `json:"v"`
	Value interface{} `json:"value"`
}

// Edge is Graph's edge
type Edge struct {
	From string `json:"v"`
	To   string `json:"w"`
}

// GraphOptions is Graph's options
type GraphOptions struct {
	Directed   bool `json:"directed"`
	Multigraph bool `json:"multigraph"`
	Compound   bool `json:"compound"`
}

// Graph is graph that when marshaled to JSON can be imported via Graphlib JS pkg from NPM
type Graph struct {
	Nodes   []Node       `json:"nodes"`
	Edges   []Edge       `json:"edges"`
	Options GraphOptions `json:"options"`
}

func (t *Tree) toGraph() Graph {
	nodesMap := map[string]Node{}
	edgesMap := map[string]Edge{}

	var recurse func(pkg *Pkg)
	recurse = func(pkg *Pkg) {
		_, exists := nodesMap[pkg.Name]
		if exists {
			return
		}

		node := Node{
			Name:  pkg.Name,
			Value: *pkg,
		}
		nodesMap[pkg.Name] = node

		for _, child := range pkg.Deps {
			edge := Edge{
				From: pkg.Name,
				To:   child.Name,
			}
			edgesMap[pkg.Name+":"+child.Name] = edge

			recurse(&child)
		}
	}

	recurse(t.Root)

	var nodes []Node
	for _, v := range nodesMap {
		nodes = append(nodes, v)
	}

	var edges []Edge
	for _, v := range edgesMap {
		edges = append(edges, v)
	}

	return Graph{
		Nodes: nodes,
		Edges: edges,
		Options: GraphOptions{
			Directed: true,
		},
	}
}

func (g Graph) toDOT() string {
	dot := "digraph {\n"

	id := 0
	nodeIDs := map[string]int{}

	for _, n := range g.Nodes {
		nodeIDs[n.Name] = id
		dot += fmt.Sprintf("\t%d [label=\"%s\"]\n", id, n.Name)
		id++
	}

	dot += "\n"

	for _, e := range g.Edges {
		dot += fmt.Sprintf("\t%d -> %d;\n", nodeIDs[e.From], nodeIDs[e.To])
	}
	dot += "}\n"

	return dot
}

func (g Graph) sortedNodeNames() []string {
	names := []string{}

	for _, n := range g.Nodes {
		names = append(names, n.Name)
	}

	sort.Strings(names)
	return names
}

func prettyPrintJSON(j interface{}) {
	e := json.NewEncoder(os.Stdout)
	e.SetIndent("", "  ")
	e.Encode(j)
}

func main() {
	flag.Usage = func() {
		fmt.Println(`  Scans the imports tree from the Go package in current-dir,
  and prints the dependency graph in a JSON format that can be imported via npmjs.com/graphlib
		`)
		flag.PrintDefaults()
		fmt.Println("")
	}
	var outputDOT = flag.Bool("dot", false, "Output as Graphviz DOT format")
	var outputList = flag.Bool("list", false, "Output a flat JSON array of all reachable deps")
	flag.Parse()

	var t Tree

	err := t.Resolve(".")
	if err != nil {
		panic(err)
	}

	graph := t.toGraph()

	if *outputDOT {
		fmt.Println(graph.toDOT())
	} else if *outputList {
		prettyPrintJSON(graph.sortedNodeNames())
	} else {
		prettyPrintJSON(graph)
	}

	if len(t.UnresolvedPkgs) != 0 {
		fmt.Println("\nUnresolved packages:")

		for unresolved := range t.UnresolvedPkgs {
			fmt.Println(" - ", unresolved)
		}

		os.Exit(1)
	}
}
